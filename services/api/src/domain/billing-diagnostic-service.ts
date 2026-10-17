import type {
  AccessState,
  BillingInvoice,
  BillingSubscription,
  Entitlement,
  PaymentAttempt,
} from '@zoryvex/contracts';
import { PAYMENT_FAILURE_GRACE_DAYS } from '@zoryvex/contracts';
import type { Clock } from '../repositories/clock-repository';
import { deriveAccess, entitlementStatusForAccess } from './billing-state';

/**
 * The founder's answer to "why is this organization's billing in the state
 * it is in".
 *
 * Every other view in this product is written for the person it is about.
 * This one is written for whoever has to explain a payment that did not
 * work, so it keeps the things those views drop: the raw Paystack status
 * strings, the gateway response, the transaction ids, the reconciliation
 * count, and an explicit statement of whether the two systems currently
 * agree.
 *
 * It keeps one thing back regardless of who is asking. The subscription's
 * `email_token` is the credential that can cancel somebody's subscription,
 * and a diagnostic page is not a reason to put it on a screen or into a
 * log. Its presence is reported; its value never is.
 */

export interface BillingDiagnosticDependencies {
  clock: Clock;
  getEntitlement(employerId: string): Promise<Entitlement | null>;
  getBillingSubscription(employerId: string): Promise<BillingSubscription | null>;
  listBillingInvoices(employerId: string): Promise<BillingInvoice[]>;
  listPaymentAttempts(employerId: string): Promise<PaymentAttempt[]>;
}

export interface BillingTimelineEntry {
  at: string;
  kind: 'payment' | 'invoice' | 'subscription';
  summary: string;
  detail: string | null;
}

export interface BillingDiagnostic {
  employerId: string;
  access: AccessState;
  /** What the entitlement says, and what it ought to say. Different means drift. */
  entitlementStatus: Entitlement['status'] | null;
  expectedEntitlementStatus: Entitlement['status'] | null;
  inSync: boolean;
  subscription:
    (Omit<BillingSubscription, 'emailToken'> & { hasCancellationToken: boolean }) | null;
  invoices: BillingInvoice[];
  payments: PaymentAttempt[];
  timeline: BillingTimelineEntry[];
  /** Plain sentences naming what is wrong, or an empty list when nothing is. */
  findings: string[];
}

function describePayment(attempt: PaymentAttempt): BillingTimelineEntry {
  const detail =
    attempt.failureReason ??
    attempt.gatewayResponse ??
    (attempt.status === 'initialized' ? 'Checkout opened; Paystack has no outcome yet.' : null);
  return {
    at: attempt.createdAt,
    kind: 'payment',
    summary: `${attempt.purpose} payment ${attempt.status} · NGN ${attempt.amountNGN.toLocaleString('en-NG')} · ${attempt.reference}`,
    detail,
  };
}

function describeInvoice(invoice: BillingInvoice): BillingTimelineEntry {
  return {
    at: invoice.createdAt,
    kind: 'invoice',
    summary: `invoice ${invoice.invoiceCode} · ${invoice.status} · ${invoice.paid ? 'paid' : 'unpaid'}`,
    detail: invoice.description,
  };
}

/**
 * Assembles the whole picture and states, in sentences, what is wrong with
 * it.
 *
 * The findings are the point. A timeline alone still requires the reader
 * to know that Paystack does not retry failed renewals, that an
 * `initialized` row means a checkout nobody finished, and that a
 * subscription without a cancellation token cannot be cancelled through
 * the product. Writing those out is the difference between a diagnostic
 * and a data dump.
 */
export async function getBillingDiagnostic(
  employerId: string,
  deps: BillingDiagnosticDependencies,
): Promise<BillingDiagnostic> {
  const now = deps.clock.now();
  const [entitlement, subscription, invoices, payments] = await Promise.all([
    deps.getEntitlement(employerId),
    deps.getBillingSubscription(employerId),
    deps.listBillingInvoices(employerId),
    deps.listPaymentAttempts(employerId),
  ]);

  const access = deriveAccess(subscription, now);
  const expectedEntitlementStatus = subscription ? entitlementStatusForAccess(access) : null;
  const findings: string[] = [];

  if (subscription && entitlement && entitlement.status !== expectedEntitlementStatus) {
    findings.push(
      `The entitlement says "${entitlement.status}" but the subscription state implies ` +
        `"${expectedEntitlementStatus}". A webhook was probably missed; the next reconciliation ` +
        'run should correct it.',
    );
  }

  if (subscription && !subscription.emailToken) {
    findings.push(
      'This subscription has no stored cancellation token, so cancelling from inside the ' +
        'product will fail. Fetch the subscription from Paystack to recover its email_token.',
    );
  }

  if (subscription?.status === 'attention') {
    findings.push(
      `Paystack could not charge the card. It does not retry — the next attempt is the next ` +
        `payment date. Access ends ${subscription.graceEndsAt ?? 'once the grace window closes'} ` +
        `(${PAYMENT_FAILURE_GRACE_DAYS} days from the failure).`,
    );
  }

  const stuck = payments.filter(
    (attempt) => attempt.status === 'initialized' || attempt.status === 'pending',
  );
  if (stuck.length > 0) {
    findings.push(
      `${stuck.length} payment attempt(s) never reached an outcome. Paystack sends no webhook ` +
        'for an abandoned or declined checkout, so these settle through reconciliation rather ' +
        'than on their own.',
    );
  }

  const reversed = payments.filter((attempt) => attempt.status === 'reversed');
  if (reversed.length > 0) {
    findings.push(
      `${reversed.length} payment(s) were refunded or charged back. Paid access is never removed ` +
        'automatically for a reversal; check whether it still should be granted.',
    );
  }

  if (!subscription && entitlement && ['scout', 'team', 'partner'].includes(entitlement.plan)) {
    findings.push(
      `The entitlement grants the ${entitlement.plan} plan but there is no subscription record ` +
        'behind it. Nothing will renew, and cancelling is impossible.',
    );
  }

  const timeline = [...payments.map(describePayment), ...invoices.map(describeInvoice)].sort(
    (a, b) => b.at.localeCompare(a.at),
  );

  if (subscription) {
    timeline.push({
      at: subscription.createdAt,
      kind: 'subscription',
      summary: `subscription ${subscription.subscriptionCode} · ${subscription.plan} ${subscription.interval} · ${subscription.status}`,
      detail: subscription.lastFailureReason,
    });
    timeline.sort((a, b) => b.at.localeCompare(a.at));
  }

  const { emailToken, ...withoutToken } = subscription ?? ({} as BillingSubscription);

  return {
    employerId,
    access,
    entitlementStatus: entitlement?.status ?? null,
    expectedEntitlementStatus,
    inSync: findings.length === 0,
    subscription: subscription
      ? { ...withoutToken, hasCancellationToken: Boolean(emailToken) }
      : null,
    invoices,
    payments,
    timeline,
    findings,
  };
}
