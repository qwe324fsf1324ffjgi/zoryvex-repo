import type { AuditEvent, PaymentAttempt, PaymentStatus } from '@zoryvex/contracts';
import { isTerminalPayment, paymentStatusFromPaystack } from '@zoryvex/contracts';
import { billingLog } from '../lib/billing-log';
import type { Clock } from '../repositories/clock-repository';
import { canTransitionPayment } from './billing-state';
import { parsePaymentReference } from './payment-reference';

/**
 * The half of the billing system that webhooks cannot cover.
 *
 * Paystack's own documentation is explicit: "we currently send webhook
 * events for just successful transactions". There is no `charge.failed`
 * and no `charge.abandoned`. So every one of these leaves no trace at all
 * in an integration that only listens:
 *
 * - a buyer who opens the checkout and closes the tab
 * - a card the bank declines at the hosted page
 * - a bank transfer the buyer starts and never completes
 * - a `charge.success` whose delivery failed for the full 72-hour retry
 *   window (a deploy, an outage, a mis-set webhook URL)
 *
 * Without reconciliation the first three sit as `initialized` forever and
 * the fourth is a customer who paid and got nothing. This job closes all
 * four, and it closes them the same way the webhook does — by asking
 * Paystack and believing only Paystack — so a payment can never be granted
 * twice or granted on a guess.
 */

/**
 * How old an attempt must be before it is worth asking about.
 *
 * Paystack's hosted checkout session is not instant: a buyer switching to
 * a banking app to authorize a transfer can legitimately take a while.
 * Verifying too early would find `pending` and prove nothing, and writing
 * `abandoned` on it would settle a payment that was still happening.
 */
export const RECONCILE_AFTER_MINUTES = 30;

/**
 * When to give up and call an unfinished attempt abandoned.
 *
 * Only applied to attempts Paystack itself still reports as unfinished. An
 * attempt Paystack calls `success` is never aged out, however old it is.
 */
export const ABANDON_AFTER_HOURS = 24;

export interface ReconciliationDependencies {
  clock: Clock;
  listOpenPaymentAttempts(createdBefore: string): Promise<PaymentAttempt[]>;
  updatePaymentAttempt(
    employerId: string,
    attemptId: string,
    expectedStatus: PaymentStatus,
    patch: Partial<PaymentAttempt>,
    updatedAt: string,
  ): Promise<PaymentAttempt | null>;
  verifyTransaction(reference: string): Promise<{
    status: string;
    reference: string;
    amountKobo: number;
    currency: string;
    transactionId: string | null;
    channel: string | null;
    gatewayResponse: string | null;
    customerCode: string | null;
    customerEmail: string | null;
  }>;
  /** Paystack's own list, for finding payments this system has no row for at all. */
  listRemoteTransactions(input: {
    status: string;
    from: string;
    to: string;
  }): Promise<{ reference: string; status: string; amountKobo: number }[]>;
  findPaymentAttemptByReference(reference: string): Promise<PaymentAttempt | null>;
  /**
   * Applies the grant a successful payment earns, using exactly the same
   * path the webhook uses so it cannot be granted twice.
   */
  applySuccessfulPayment(attempt: PaymentAttempt): Promise<void>;
  /**
   * Settles whatever the attempt was buying, once it has definitively not
   * been paid for.
   *
   * The mirror of `applySuccessfulPayment`, and it was missing. A Kit
   * order is written pending before Paystack is contacted, and only the
   * webhook's success path or the recovery above ever moved it. A
   * declined card settled the payment attempt and left the order pending
   * for good, so the role page went on saying "Payment pending." to
   * somebody whose payment had failed an hour earlier. Seen in production
   * on a real attempt.
   */
  applyUnsuccessfulPayment(attempt: PaymentAttempt): Promise<void>;
  appendAuditEvent(event: AuditEvent): Promise<AuditEvent>;
  publishAlert(message: string): Promise<void>;
  generateId(): string;
}

export interface ReconciliationReport {
  checked: number;
  /** Reached a terminal state because Paystack said so. */
  settled: number;
  granted: number;
  /**
   * Aged out by this job, not settled by Paystack. A rising count here
   * means checkouts are being started and left, which is a funnel problem
   * rather than a billing one — worth separating from `settled` for that
   * reason alone.
   */
  abandoned: number;
  unreachable: number;
  discrepancies: string[];
}

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;

/**
 * Reconciles our open payments against Paystack, then Paystack's recent
 * successes against ours.
 *
 * Two directions, because they catch different failures. Ours-to-theirs
 * finds payments we started and never heard the end of. Theirs-to-ours
 * finds money that arrived with no matching row here at all — a webhook
 * that never landed, or a transaction created directly in the dashboard.
 * A one-directional reconciliation would report "all clear" in exactly the
 * case that costs the most.
 */
export async function reconcileBilling(
  deps: ReconciliationDependencies,
): Promise<ReconciliationReport> {
  const now = deps.clock.now();
  const report: ReconciliationReport = {
    checked: 0,
    settled: 0,
    granted: 0,
    abandoned: 0,
    unreachable: 0,
    discrepancies: [],
  };

  const cutoff = new Date(now.getTime() - RECONCILE_AFTER_MINUTES * MINUTE_MS).toISOString();
  const open = await deps.listOpenPaymentAttempts(cutoff);

  for (const attempt of open) {
    report.checked += 1;
    await reconcileOne(attempt, now, report, deps);
  }

  await findUnmatchedRemoteSuccesses(now, report, deps);

  if (report.discrepancies.length > 0) {
    await deps.publishAlert(
      `Billing reconciliation found ${report.discrepancies.length} discrepancy(ies):\n` +
        report.discrepancies.join('\n'),
    );
  }

  billingLog.info('billing reconciliation complete', { ...report, discrepancies: undefined });
  return report;
}

async function reconcileOne(
  attempt: PaymentAttempt,
  now: Date,
  report: ReconciliationReport,
  deps: ReconciliationDependencies,
): Promise<void> {
  let verification: Awaited<ReturnType<ReconciliationDependencies['verifyTransaction']>>;
  try {
    verification = await deps.verifyTransaction(attempt.reference);
  } catch {
    // Paystack unreachable, or the reference genuinely does not exist
    // there. Either way the attempt is left exactly as it is and looked at
    // again next run: guessing here is how an unpaid checkout becomes a
    // granted entitlement.
    report.unreachable += 1;
    await deps.updatePaymentAttempt(
      attempt.employerId,
      attempt.id,
      attempt.status,
      { reconcileAttempts: attempt.reconcileAttempts + 1 },
      now.toISOString(),
    );
    return;
  }

  const mapped = paymentStatusFromPaystack(verification.status);
  if (!mapped) {
    // A status Paystack has added since this code was written. Reported
    // rather than mapped to a guess, because the two available guesses are
    // "revoke access" and "grant access".
    report.discrepancies.push(
      `${attempt.reference}: Paystack reports an unrecognized status "${verification.status}".`,
    );
    return;
  }

  if (mapped === 'success') {
    const amountMatches = verification.amountKobo === attempt.amountNGN * 100;
    const currencyMatches = verification.currency === 'NGN';
    if (!amountMatches || !currencyMatches) {
      report.discrepancies.push(
        `${attempt.reference}: paid ${verification.amountKobo} ${verification.currency}, ` +
          `expected ${attempt.amountNGN * 100} NGN. Nothing was granted.`,
      );
      return;
    }

    if (!canTransitionPayment(attempt.status, 'success')) return;
    const updated = await deps.updatePaymentAttempt(
      attempt.employerId,
      attempt.id,
      attempt.status,
      {
        status: 'success',
        paystackStatus: verification.status,
        paystackTransactionId: verification.transactionId,
        channel: verification.channel,
        gatewayResponse: verification.gatewayResponse,
        customerCode: verification.customerCode,
        verifiedAt: now.toISOString(),
      },
      now.toISOString(),
    );
    // Losing this conditional update means a webhook settled it a moment
    // ago and has already granted. Stopping here is what makes the two
    // paths safe to run at the same time.
    if (!updated) return;

    report.settled += 1;
    report.granted += 1;
    await deps.applySuccessfulPayment(updated);
    await deps.appendAuditEvent({
      id: deps.generateId(),
      actorId: 'system:billing-reconciliation',
      actorRole: 'admin',
      action: 'payment_recovered_by_reconciliation',
      targetType: 'payment_attempt',
      targetId: attempt.id,
      reason: `Paystack confirmed ${attempt.reference} as paid; no webhook had been processed.`,
      createdAt: now.toISOString(),
    });
    // Worth a person knowing: a payment that only reconciliation caught
    // means a webhook did not arrive, which is a delivery problem that
    // will happen again.
    report.discrepancies.push(
      `${attempt.reference}: was paid but no webhook was processed. Recovered and granted. ` +
        'Check the webhook URL and its delivery log in the Paystack dashboard.',
    );
    return;
  }

  if (isTerminalPayment(mapped)) {
    if (!canTransitionPayment(attempt.status, mapped)) return;
    const updated = await deps.updatePaymentAttempt(
      attempt.employerId,
      attempt.id,
      attempt.status,
      {
        status: mapped,
        paystackStatus: verification.status,
        gatewayResponse: verification.gatewayResponse,
        failureReason: verification.gatewayResponse,
        verifiedAt: now.toISOString(),
      },
      now.toISOString(),
    );
    if (updated) {
      report.settled += 1;
      // Success is handled and returned above, so reaching here means
      // failed, abandoned or reversed — whatever the attempt was buying
      // has to be closed out.
      await deps.applyUnsuccessfulPayment(updated);
    }
    return;
  }

  // Still in flight at Paystack (`pending`, `ongoing`, `processing`,
  // `queued`). Mirrored so the founder's diagnostic view shows what
  // Paystack shows, and aged out only once it is old enough that no bank
  // is still working on it.
  const ageMs = now.getTime() - Date.parse(attempt.createdAt);
  const stale = Number.isFinite(ageMs) && ageMs > ABANDON_AFTER_HOURS * HOUR_MS;

  const next: PaymentStatus = stale ? 'abandoned' : mapped;
  if (!canTransitionPayment(attempt.status, next)) return;

  const updated = await deps.updatePaymentAttempt(
    attempt.employerId,
    attempt.id,
    attempt.status,
    {
      status: next,
      paystackStatus: verification.status,
      gatewayResponse: verification.gatewayResponse,
      reconcileAttempts: attempt.reconcileAttempts + 1,
      verifiedAt: now.toISOString(),
    },
    now.toISOString(),
  );
  if (updated && stale) {
    report.abandoned += 1;
    await deps.applyUnsuccessfulPayment(updated);
  }
}

/**
 * Paystack's recent successes that have no row here.
 *
 * The window is deliberately short. This is a safety net for a webhook
 * outage or a hand-made dashboard transaction, not a second ledger, and
 * asking Paystack for a month of history on every run would be both slow
 * and a way to keep re-reporting the same known-unmatched rows.
 */
async function findUnmatchedRemoteSuccesses(
  now: Date,
  report: ReconciliationReport,
  deps: ReconciliationDependencies,
): Promise<void> {
  const from = new Date(now.getTime() - 48 * HOUR_MS).toISOString();
  let remote: { reference: string; status: string; amountKobo: number }[];
  try {
    remote = await deps.listRemoteTransactions({
      status: 'success',
      from,
      to: now.toISOString(),
    });
  } catch {
    report.unreachable += 1;
    return;
  }

  for (const transaction of remote) {
    const parsed = parsePaymentReference(transaction.reference);
    // A reference Paystack generated is a subscription renewal, and there
    // is deliberately no payment-attempt row for one: renewals are
    // recorded as invoices. Skipping them here is correct, not a gap.
    if (!parsed) continue;

    const attempt = await deps.findPaymentAttemptByReference(transaction.reference);
    if (attempt) continue;

    report.discrepancies.push(
      `${transaction.reference}: Paystack reports a successful payment of ` +
        `${transaction.amountKobo} kobo that has no record in this system at all.`,
    );
  }
}
