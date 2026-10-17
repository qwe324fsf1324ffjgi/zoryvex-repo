import { createHash } from 'node:crypto';
import type {
  AuditEvent,
  BillingInvoice,
  BillingSubscription,
  CardSummary,
  Entitlement,
  KitOrder,
  PaymentAttempt,
  SubscriptionStatus,
} from '@zoryvex/contracts';
import { BILLING_INTERVALS } from '@zoryvex/contracts';
import {
  PRICE_TIERS,
  SUBSCRIPTION_PLANS,
  paymentStatusFromPaystack,
  planKey,
  subscriptionStatusFromPaystack,
  type BillingInterval,
  type PaymentStatus,
  type PlanCodeRegistry,
  type PriceTier,
  type SubscriptionPlan,
} from '@zoryvex/contracts';
import { UnauthorizedError, ValidationError } from '../errors/typed-errors';
import { billingLog } from '../lib/billing-log';
import { verifyPaystackSignature } from '../lib/paystack-signature';
import type { Clock } from '../repositories/clock-repository';
import { canTransitionPayment, graceDeadline, isFresherThan } from './billing-state';
import { parsePaymentReference } from './payment-reference';

/**
 * Paystack's webhook endpoint.
 *
 * Three facts from Paystack's current documentation shape everything here,
 * and getting any of them wrong is what makes billing systems lose money
 * quietly:
 *
 * 1. **There is no unique event id in a Paystack webhook body.** The
 *    previous version of this file keyed idempotency on `data.id`, which
 *    is the *transaction* id and is present on `charge.success` and the
 *    dispute events only. Every subscription and invoice event
 *    (`subscription.create`, `subscription.disable`, `invoice.create`,
 *    `invoice.update`, `invoice.payment_failed`) has no `data.id` at all,
 *    and `subscription.expiring_cards` delivers `data` as an array. Under
 *    the old key, the first subscription event to arrive would have thrown
 *    "missing data.id", returned 500, and been retried every three minutes
 *    for four attempts and then hourly for seventy-two hours — for every
 *    such event, forever. Idempotency is now keyed on a SHA-256 of the raw
 *    request body, which is exactly what Paystack redelivers on a retry
 *    and needs no per-event field knowledge.
 * 2. **Paystack only webhooks successful transactions.** There is no
 *    `charge.failed` and no `charge.abandoned` event; the old code handled
 *    a `charge.failed` that is never sent. A declined card or a closed
 *    checkout tab produces silence, which is why reconciliation
 *    (`billing-reconciliation-service.ts`) is a required part of this
 *    system and not a refinement of it.
 * 3. **A renewal charge does not carry our reference.** Paystack generates
 *    its own for the recurring debit, so a renewal is attributed through
 *    the subscription and customer code pointers, never by parsing the
 *    reference.
 */

const SUPPORTED_EVENTS = [
  'charge.success',
  'charge.dispute.create',
  'charge.dispute.remind',
  'charge.dispute.resolve',
  'invoice.create',
  'invoice.update',
  'invoice.payment_failed',
  'subscription.create',
  'subscription.disable',
  'subscription.not_renew',
  'subscription.expiring_cards',
  'refund.pending',
  'refund.processing',
  'refund.processed',
  'refund.failed',
] as const;

interface PaystackAuthorizationPayload {
  last4?: string;
  brand?: string;
  exp_month?: string;
  exp_year?: string;
  channel?: string;
}

interface PaystackSubscriptionPayload {
  status?: string;
  subscription_code?: string;
  email_token?: string;
  amount?: number;
  next_payment_date?: string | null;
  open_invoice?: string | null;
  plan?: { plan_code?: string; interval?: string; amount?: number } | null;
  customer?: { customer_code?: string; email?: string } | null;
  authorization?: PaystackAuthorizationPayload | null;
  created_at?: string | null;
  createdAt?: string | null;
}

interface PaystackInvoicePayload {
  invoice_code?: string;
  amount?: number;
  period_start?: string | null;
  period_end?: string | null;
  status?: string;
  paid?: boolean | number;
  paid_at?: string | null;
  description?: string | null;
  authorization?: PaystackAuthorizationPayload | null;
  subscription?: PaystackSubscriptionPayload | null;
  customer?: { customer_code?: string; email?: string } | null;
  transaction?: { reference?: string; status?: string; amount?: number; currency?: string } | null;
  created_at?: string | null;
}

interface PaystackChargePayload {
  id?: number | string;
  reference?: string;
  status?: string;
  amount?: number;
  currency?: string;
  channel?: string | null;
  gateway_response?: string | null;
  paid_at?: string | null;
  customer?: { customer_code?: string; email?: string } | null;
  plan?: string | { plan_code?: string } | null;
  authorization?: PaystackAuthorizationPayload | null;
}

interface PaystackWebhookEnvelope {
  event?: string;
  data?: unknown;
}

export interface PaystackWebhookDependencies {
  clock: Clock;
  /** True the first time this exact delivery is seen, false on a redelivery. */
  recordWebhookEventOnce(dedupeKey: string, receivedAt: string): Promise<boolean>;
  /** Removes the marker so a Paystack retry can genuinely re-attempt. */
  forgetWebhookEvent(dedupeKey: string): Promise<void>;

  getKitOrder(roleId: string, kitOrderId: string): Promise<KitOrder | null>;
  /** Conditional: returns null when the order was not in `expected`, so the caller knows it lost the race. */
  transitionKitOrderStatus(
    roleId: string,
    kitOrderId: string,
    expected: KitOrder['status'],
    next: KitOrder['status'],
  ): Promise<KitOrder | null>;
  generateKitArtifact(roleId: string): Promise<unknown>;
  /**
   * Whether the Kit this order paid for actually exists yet.
   *
   * Settling the order and delivering it are two different facts, and the
   * order's status only records the first.
   */
  hasKitArtifact(roleId: string): Promise<boolean>;

  getPaymentAttempt(employerId: string, attemptId: string): Promise<PaymentAttempt | null>;
  listPaymentAttempts(employerId: string): Promise<PaymentAttempt[]>;
  updatePaymentAttempt(
    employerId: string,
    attemptId: string,
    expectedStatus: PaymentStatus,
    patch: Partial<PaymentAttempt>,
    updatedAt: string,
  ): Promise<PaymentAttempt | null>;

  employerIdForSubscriptionCode(subscriptionCode: string): Promise<string | null>;
  employerIdForCustomerCode(customerCode: string): Promise<string | null>;
  getBillingSubscription(employerId: string): Promise<BillingSubscription | null>;
  putBillingSubscription(subscription: BillingSubscription): Promise<BillingSubscription>;
  /**
   * Patches the employer's subscription. With `expectedSubscriptionCode`,
   * the write is refused (null) unless that is still the code on record —
   * see the repository function for why every event-driven caller passes
   * it.
   */
  updateBillingSubscription(
    employerId: string,
    patch: Partial<BillingSubscription>,
    updatedAt: string,
    expectedSubscriptionCode?: string,
  ): Promise<BillingSubscription | null>;
  putBillingInvoice(invoice: BillingInvoice): Promise<BillingInvoice>;
  putBillingCustomer(input: {
    employerId: string;
    customerCode: string;
    email: string;
    createdAt: string;
  }): Promise<unknown>;

  /**
   * Which Paystack Plan each of our plan keys maps to.
   *
   * Read here because `subscription.create` carries a `plan_code` and
   * nothing else that identifies the tier. Only this system knows that
   * `PLN_xyz` means "Scout, founding, monthly", and guessing it wrong
   * records a Partner subscriber as a Scout.
   */
  getPlanCodeRegistry(): Promise<PlanCodeRegistry>;
  getEntitlement(employerId: string): Promise<Entitlement | null>;
  updateEntitlement(employerId: string, patch: Partial<Entitlement>): Promise<Entitlement>;
  recordFoundingPlaceTaken(employerId: string): Promise<void>;

  appendAuditEvent(event: AuditEvent): Promise<AuditEvent>;
  publishAlert(message: string): Promise<void>;
  generateId(): string;

  /** Independent server-to-server confirmation. Never trusted from the body alone. */
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
}

export interface WebhookOutcome {
  event: string;
  handled: boolean;
  duplicate: boolean;
}

/**
 * Idempotency key: a hash of exactly the bytes Paystack signed.
 *
 * A retry is a byte-identical redelivery, so this catches every retry. Two
 * genuinely different events never produce the same hash, because at
 * minimum their status or timestamp differs — and in the impossible case
 * that two deliveries really are byte-identical, applying one of them
 * twice would be a no-op anyway, since every effect below is idempotent.
 */
function dedupeKeyFor(rawBody: string): string {
  return `body:${createHash('sha256').update(rawBody).digest('hex')}`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Paystack sends `paid` as a boolean on some payloads and 0/1 on others. */
function asBoolean(value: boolean | number | undefined): boolean {
  return value === true || value === 1;
}

function toCardSummary(auth: PaystackAuthorizationPayload | null | undefined): CardSummary | null {
  if (!auth?.last4 || !auth.brand || !auth.exp_month || !auth.exp_year) return null;
  return {
    last4: auth.last4,
    brand: auth.brand,
    expMonth: auth.exp_month,
    expYear: auth.exp_year,
    channel: auth.channel ?? 'card',
  };
}

/**
 * Paystack timestamps arrive in several shapes (`2018-12-20T15:00:06.000Z`,
 * and occasionally without the zone). Anything unreadable becomes null
 * rather than an invalid Date that would later be compared as if it meant
 * something.
 */
function toIso(value: string | null | undefined): string | null {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : new Date(time).toISOString();
}

export async function processPaystackWebhook(
  input: { rawBody: string; signatureHeader: string | undefined; secretKey: string },
  deps: PaystackWebhookDependencies,
): Promise<WebhookOutcome> {
  if (!verifyPaystackSignature(input.rawBody, input.signatureHeader, input.secretKey)) {
    throw new UnauthorizedError('Invalid webhook signature');
  }

  let envelope: PaystackWebhookEnvelope;
  try {
    envelope = JSON.parse(input.rawBody) as PaystackWebhookEnvelope;
  } catch {
    throw new ValidationError('Webhook body is not valid JSON');
  }

  const event = typeof envelope.event === 'string' ? envelope.event : '';
  if (!event) throw new ValidationError('Webhook payload has no event name');

  const dedupeKey = dedupeKeyFor(input.rawBody);
  const now = deps.clock.now().toISOString();

  const isNew = await deps.recordWebhookEventOnce(dedupeKey, now);
  if (!isNew) {
    billingLog.info('paystack webhook redelivery ignored', { event });
    return { event, handled: false, duplicate: true };
  }

  try {
    const handled = await applyWebhookEffect(event, envelope.data, now, deps);
    billingLog.info('paystack webhook processed', { event, handled });
    return { event, handled, duplicate: false };
  } catch (error) {
    // Marker removed so Paystack's retry genuinely re-attempts rather than
    // being swallowed by the duplicate check.
    //
    // This is the half of the bargain the previous version was missing.
    // It wrote the marker first (correctly — that is what stops two
    // concurrent deliveries both granting an entitlement) and then treated
    // any later failure as unrecoverable, alerting a human and giving up
    // on a payment the customer had already made. Every effect below is
    // idempotent by construction, so re-applying one is safe, and letting
    // Paystack retry into a cleared marker turns a lost payment into a
    // three-minute delay.
    //
    // If the delete itself fails there is nothing further to try, and the
    // event really is stuck: that is the one case that still alerts.
    let reopened = true;
    try {
      await deps.forgetWebhookEvent(dedupeKey);
    } catch {
      reopened = false;
    }

    await reportFailedEvent(event, error, now, reopened, deps);
    // Rethrown so API Gateway answers 5xx and Paystack retries. Answering
    // 200 here would tell Paystack the event was accepted and stop the
    // retries that are the recovery path.
    throw error;
  }
}

/**
 * Records and, when it cannot be retried, alerts.
 *
 * Best-effort by construction: this runs because something already failed,
 * so neither write may throw on its way out. The alert is attempted even
 * when the audit write fails, because the alert is the part that reaches a
 * person.
 */
async function reportFailedEvent(
  event: string,
  error: unknown,
  now: string,
  reopened: boolean,
  deps: PaystackWebhookDependencies,
): Promise<void> {
  const detail = error instanceof Error ? error.message : String(error);
  billingLog.error('paystack webhook failed', { event, problem: detail, retryable: reopened });

  try {
    await deps.appendAuditEvent({
      id: deps.generateId(),
      actorId: 'system:paystack-webhook',
      actorRole: 'admin',
      action: reopened ? 'paystack_event_failed_will_retry' : 'paystack_event_unprocessable',
      targetType: 'paystack_event',
      targetId: event,
      reason: detail,
      createdAt: now,
    });
  } catch {
    // Swallowed deliberately — the alert below still has to go out.
  }

  if (reopened) return; // Paystack will try again; no human needed yet.

  try {
    await deps.publishAlert(
      `Paystack event ${event} failed and its idempotency marker could not be cleared, so ` +
        `Paystack's retry will be ignored as a duplicate: ${detail}. Check the Paystack ` +
        'dashboard against the billing records and resolve by hand.',
    );
  } catch {
    // Nothing further to try.
  }
}

async function applyWebhookEffect(
  event: string,
  data: unknown,
  now: string,
  deps: PaystackWebhookDependencies,
): Promise<boolean> {
  if (event.startsWith('charge.dispute.')) {
    await handleDispute(event, data, now, deps);
    return true;
  }
  if (event.startsWith('refund.')) {
    await handleRefund(event, data, now, deps);
    return true;
  }

  switch (event) {
    case 'charge.success':
      return handleChargeSuccess(data, now, deps);
    case 'subscription.create':
      return handleSubscriptionCreate(data, now, deps);
    case 'subscription.not_renew':
      return handleSubscriptionStatusEvent(data, 'non-renewing', now, deps);
    case 'subscription.disable':
      return handleSubscriptionDisable(data, now, deps);
    case 'invoice.create':
    case 'invoice.update':
    case 'invoice.payment_failed':
      return handleInvoiceEvent(event, data, now, deps);
    case 'subscription.expiring_cards':
      return handleExpiringCards(data, now, deps);
    default:
      // Acknowledged and ignored. Paystack raises events this product has
      // no stake in (transfers, DVA assignment, customer identification);
      // 200 with no effect is the correct answer, and a 500 would put them
      // into a 72-hour retry loop for nothing.
      billingLog.info('paystack event not acted on', {
        event,
        known: (SUPPORTED_EVENTS as readonly string[]).includes(event),
      });
      return false;
  }
}

async function handleDispute(
  event: string,
  data: unknown,
  now: string,
  deps: PaystackWebhookDependencies,
): Promise<void> {
  const record = asRecord(data);
  const disputeId = record?.id === undefined ? 'unknown' : String(record.id);

  await deps.appendAuditEvent({
    id: deps.generateId(),
    actorId: 'system:paystack-webhook',
    actorRole: 'admin',
    action: 'paystack_dispute_event',
    targetType: 'paystack_dispute',
    targetId: disputeId,
    reason: event,
    createdAt: now,
  });
  // Never auto-resolved and never allowed to move an entitlement. A
  // dispute is a claim by a cardholder that needs a person to answer it
  // with evidence, and an automatic response would be either a refund
  // nobody approved or a defence nobody wrote.
  await deps.publishAlert(
    `Paystack dispute event: ${event} (dispute ${disputeId}). Review it in the Paystack ` +
      'dashboard. Nothing has been changed automatically.',
  );
}

/**
 * A refund or chargeback: money going back out.
 *
 * Only `refund.processed` changes anything, because only it means the
 * money has actually left. Access is not revoked here either — the
 * entitlement that was paid for is taken away by the founder, deliberately,
 * after looking at why the refund happened. Automatically stripping access
 * the moment a partial refund settles would punish a customer who was
 * refunded a service credit.
 */
async function handleRefund(
  event: string,
  data: unknown,
  now: string,
  deps: PaystackWebhookDependencies,
): Promise<void> {
  const record = asRecord(data);
  const reference =
    typeof record?.transaction_reference === 'string'
      ? record.transaction_reference
      : typeof record?.reference === 'string'
        ? record.reference
        : 'unknown';

  await deps.appendAuditEvent({
    id: deps.generateId(),
    actorId: 'system:paystack-webhook',
    actorRole: 'admin',
    action: 'paystack_refund_event',
    targetType: 'paystack_transaction',
    targetId: reference,
    reason: event,
    createdAt: now,
  });

  if (event !== 'refund.processed') return;

  const parsed = parsePaymentReference(reference);
  if (parsed?.kind === 'subscription') {
    const attempt = await deps.getPaymentAttempt(parsed.employerId, parsed.attemptId);
    if (attempt && canTransitionPayment(attempt.status, 'reversed')) {
      await deps.updatePaymentAttempt(
        parsed.employerId,
        parsed.attemptId,
        attempt.status,
        { status: 'reversed', paystackStatus: 'reversed' },
        now,
      );
    }
  }

  await deps.publishAlert(
    `Paystack refund processed for ${reference}. The payment is recorded as reversed. ` +
      'Paid access has NOT been removed automatically — decide and apply that by hand.',
  );
}

/**
 * A successful charge.
 *
 * Two very different things arrive as `charge.success`: the first payment
 * of a checkout we started (our reference, parseable), and every
 * subsequent renewal of a subscription (Paystack's own reference, not
 * parseable). The second is attributed through the customer code, which is
 * the only handle it carries.
 */
async function handleChargeSuccess(
  data: unknown,
  now: string,
  deps: PaystackWebhookDependencies,
): Promise<boolean> {
  const charge = asRecord(data) as PaystackChargePayload | null;
  const reference = typeof charge?.reference === 'string' ? charge.reference : '';
  if (!reference) return false;

  const parsed = parsePaymentReference(reference);

  if (parsed?.kind === 'kit') {
    return handleKitCharge(parsed.roleId, parsed.kitOrderId, reference, now, deps);
  }
  if (parsed?.kind === 'subscription') {
    return handleSubscriptionCharge(parsed.employerId, parsed.attemptId, reference, now, deps);
  }

  // Paystack's own reference: a renewal. There is no payment attempt row
  // for it, because we never started it — the record of a renewal is its
  // invoice, which `invoice.update` writes.
  const customerCode = charge?.customer?.customer_code;
  if (!customerCode) return false;
  const employerId = await deps.employerIdForCustomerCode(customerCode);
  if (!employerId) {
    // Money arrived that cannot be attributed to anybody here. Never
    // silent: this is either a dashboard-created transaction or a real
    // gap, and both need a person.
    await deps.publishAlert(
      `Paystack reported a successful charge (${reference}) for customer ${customerCode}, ` +
        'which does not match any organization in this system. Nothing was granted. Check the ' +
        'Paystack dashboard.',
    );
    return false;
  }

  const subscription = await deps.getBillingSubscription(employerId);

  // Only a charge for the price of the subscription reopens access.
  //
  // Not every successful charge on a customer is a renewal, and this
  // branch sees all of them: it is reached by anything whose reference
  // this system did not write. Paystack's own card-update page takes a
  // small amount to confirm a new card and refunds it immediately, and
  // that is a successful charge on this customer like any other. Without
  // an amount check, an employer whose renewal had failed could clear
  // their grace window, flip back to `active` and hold a month of paid
  // access by adding a card, for the price of the confirmation charge.
  // A charge created by hand in the Paystack dashboard would do the same.
  //
  // The amount is compared against the price actually held rather than a
  // price table, for the same reason it is stamped on the subscription:
  // it survives a price change, and a founding member pays less than the
  // list price for the life of their subscription.
  const chargedKobo = Number(charge?.amount ?? 0);
  const expectedKobo = (subscription?.priceNGN ?? 0) * 100;
  const looksLikeRenewal =
    expectedKobo > 0 && chargedKobo === expectedKobo && (charge?.currency ?? 'NGN') === 'NGN';

  if (!looksLikeRenewal) {
    billingLog.info('charge is not a subscription renewal, so access was not extended', {
      employerId,
      reference,
      chargedKobo,
      expectedKobo,
    });

    // A confirmation charge is a few naira and needs nobody's attention.
    // A charge for most of the price of the plan is a different thing
    // entirely: either Paystack billed an amount this system does not
    // expect, or somebody paid and got nothing for it. Half the price is
    // the line between the two, and it is drawn well above any card
    // check and well below any real renewal.
    if (expectedKobo > 0 && chargedKobo >= expectedKobo / 2) {
      await deps.publishAlert(
        `Paystack took ${chargedKobo} kobo from employer ${employerId} (${reference}), but their ` +
          `subscription is priced at ${expectedKobo} kobo. No access was extended, because the ` +
          'amounts do not match. Somebody may have paid for a month they did not get. Check the ' +
          'Paystack dashboard against this subscription.',
      );
    }
    return true;
  }

  await deps.appendAuditEvent({
    id: deps.generateId(),
    actorId: 'system:paystack-webhook',
    actorRole: 'admin',
    action: 'subscription_renewal_charged',
    targetType: 'employer',
    targetId: employerId,
    reason: reference,
    createdAt: now,
  });

  // A successful renewal closes any grace window that was open. It does not
  // set the status to `active` unconditionally: a subscription the employer
  // has already cancelled is `non-renewing`, and a charge that lands in the
  // gap between the cancel request and Paystack processing it would
  // otherwise show them as subscribed again, on a page they cancelled from.
  const revivable = subscription?.status === 'attention' || subscription?.status === 'active';
  await patchCurrentSubscription(
    employerId,
    subscription?.subscriptionCode ?? '',
    {
      graceEndsAt: null,
      lastFailureReason: null,
      ...(revivable ? { status: 'active' as const } : {}),
    },
    'charge.success',
    now,
    deps,
  );
  if (revivable) await deps.updateEntitlement(employerId, { status: 'active' });
  return true;
}

/**
 * The Kit's one-time purchase, verified independently before anything is
 * granted.
 *
 * `transitionKitOrderStatus` is conditional on the order still being
 * `pending`, which is what makes this whole path safe to run twice: the
 * second run loses the transition, returns null, and skips artifact
 * generation rather than producing a second Kit version for one payment.
 */
async function handleKitCharge(
  roleId: string,
  kitOrderId: string,
  reference: string,
  now: string,
  deps: PaystackWebhookDependencies,
): Promise<boolean> {
  const order = await deps.getKitOrder(roleId, kitOrderId);
  if (!order) return false;
  // "Paid" and "delivered" are different facts, and the order's status
  // only records the first.
  //
  // This used to read `if (order.status === 'succeeded') return false`,
  // commented "already granted; nothing to do". A succeeded order does not
  // mean the grant happened. The status is set first, and the entitlement,
  // the audit event and the Kit itself come after it — so any failure in
  // that tail left an order marked succeeded with nothing delivered, and
  // this line then turned Paystack's retry, the recovery path, into an
  // immediate no-op. Reconciliation could not help either: it only looks
  // at payment attempts still open, and this one had already settled.
  //
  // Seen for real. A `charge.success` for NGN 95,000 settled the order,
  // then `updateEntitlement` threw ConditionalCheckFailedException. The
  // customer had paid, Paystack said success, the order said succeeded,
  // and no entitlement and no Kit existed — permanently.
  //
  // So the question asked here is whether the Kit exists, not whether the
  // order settled. Everything after the transition is idempotent and safe
  // to re-run: the entitlement write is a patch, and artifact creation is
  // conditional on its own version key.
  if (order.status === 'succeeded' && (await deps.hasKitArtifact(roleId))) return false;

  // Already settled but not delivered: skip straight to delivery. The
  // verification below ran when it settled, so it is not repeated.
  if (order.status === 'succeeded') {
    await deliverKit(order.employerId, roleId, kitOrderId, now, deps);
    return true;
  }

  const verification = await deps.verifyTransaction(order.paystackReference);
  const verified =
    verification.status === 'success' &&
    verification.reference === order.paystackReference &&
    verification.currency === 'NGN' &&
    verification.amountKobo === order.amountNGN * 100;

  if (!verified) {
    await deps.transitionKitOrderStatus(roleId, kitOrderId, 'pending', 'failed');
    await settleKitAttempt(order.employerId, kitOrderId, 'failed', verification, now, deps);
    await deps.appendAuditEvent({
      id: deps.generateId(),
      actorId: 'system:paystack-webhook',
      actorRole: 'admin',
      action: 'paystack_verification_mismatch',
      targetType: 'kit_order',
      targetId: kitOrderId,
      reason: `expected ${order.amountNGN * 100} NGN kobo for ${order.paystackReference}`,
      createdAt: now,
    });
    await deps.publishAlert(
      `Paystack verification mismatch for kit order ${kitOrderId} (reference ${reference}). ` +
        'The webhook claimed success; an independent verify did not confirm matching ' +
        'status, reference, currency and amount. No entitlement was granted.',
    );
    return true;
  }

  const transitioned = await deps.transitionKitOrderStatus(
    roleId,
    kitOrderId,
    'pending',
    'succeeded',
  );
  if (!transitioned) return false; // another delivery got there first

  await settleKitAttempt(transitioned.employerId, kitOrderId, 'success', verification, now, deps);
  await deliverKit(transitioned.employerId, roleId, kitOrderId, now, deps);
  return true;
}

/**
 * What the buyer actually receives, once the money is settled.
 *
 * Separated from settlement so a retry can re-run it. Every step is
 * idempotent: the entitlement write is a patch, and artifact creation is
 * conditional on its own version key, so a second delivery cannot produce
 * a second Kit.
 */
async function deliverKit(
  employerId: string,
  roleId: string,
  kitOrderId: string,
  now: string,
  deps: PaystackWebhookDependencies,
): Promise<void> {
  const entitlement = await deps.getEntitlement(employerId);
  const patch: Partial<Entitlement> = { kitPurchasedAt: now };
  if (!entitlement || entitlement.plan === 'none') {
    patch.plan = 'kit';
    patch.status = 'active';
  }
  await deps.updateEntitlement(employerId, patch);

  await deps.appendAuditEvent({
    id: deps.generateId(),
    actorId: 'system:paystack-webhook',
    actorRole: 'admin',
    action: 'kit_order_succeeded',
    targetType: 'kit_order',
    targetId: kitOrderId,
    createdAt: now,
  });

  await deps.generateKitArtifact(roleId);
}

/**
 * Mirrors a Kit order's outcome onto its payment attempt.
 *
 * The order is what the employer bought; the attempt is what reconciliation
 * looks at. Keeping the attempt open after the order settles would leave the
 * hourly job re-verifying a payment that finished, forever.
 *
 * Deliberately tolerant: the attempt did not exist for Kit orders created
 * before this record did, and a Kit order settling correctly matters more
 * than its attempt row being present.
 */
async function settleKitAttempt(
  employerId: string,
  kitOrderId: string,
  status: 'success' | 'failed',
  verification: Awaited<ReturnType<PaystackWebhookDependencies['verifyTransaction']>>,
  now: string,
  deps: PaystackWebhookDependencies,
): Promise<void> {
  const attempt = await deps.getPaymentAttempt(employerId, kitOrderId);
  if (!attempt || !canTransitionPayment(attempt.status, status)) return;
  await deps.updatePaymentAttempt(
    employerId,
    kitOrderId,
    attempt.status,
    {
      status,
      paystackStatus: verification.status,
      paystackTransactionId: verification.transactionId,
      channel: verification.channel,
      gatewayResponse: verification.gatewayResponse,
      customerCode: verification.customerCode,
      verifiedAt: now,
      ...(status === 'failed'
        ? { failureReason: 'independent verification did not match the webhook' }
        : {}),
    },
    now,
  );
}

/**
 * The first charge of a subscription checkout we started.
 *
 * This marks the payment attempt paid. It does not create the subscription
 * record: `subscription.create` carries the subscription code, the email
 * token and the plan, and arrives for the same checkout. Trying to
 * assemble a subscription from a charge would mean inventing the token
 * that cancellation depends on.
 */
async function handleSubscriptionCharge(
  employerId: string,
  attemptId: string,
  reference: string,
  now: string,
  deps: PaystackWebhookDependencies,
): Promise<boolean> {
  const attempt = await deps.getPaymentAttempt(employerId, attemptId);
  if (!attempt) return false;
  if (!canTransitionPayment(attempt.status, 'success')) return false;

  const verification = await deps.verifyTransaction(attempt.reference);
  const verified =
    verification.status === 'success' &&
    verification.reference === attempt.reference &&
    verification.currency === 'NGN' &&
    verification.amountKobo === attempt.amountNGN * 100;

  if (!verified) {
    await deps.updatePaymentAttempt(
      employerId,
      attemptId,
      attempt.status,
      {
        status: 'failed',
        paystackStatus: verification.status,
        failureReason: 'independent verification did not match the webhook',
        verifiedAt: now,
      },
      now,
    );
    await deps.publishAlert(
      `Paystack verification mismatch on subscription payment ${reference} for employer ` +
        `${employerId}. The webhook claimed success; the verify call did not confirm it. ` +
        'No access was granted.',
    );
    return true;
  }

  await deps.updatePaymentAttempt(
    employerId,
    attemptId,
    attempt.status,
    {
      status: 'success',
      paystackStatus: verification.status,
      paystackTransactionId: verification.transactionId,
      channel: verification.channel,
      gatewayResponse: verification.gatewayResponse,
      customerCode: verification.customerCode,
      verifiedAt: now,
    },
    now,
  );

  if (verification.customerCode && verification.customerEmail) {
    // Written here because this is the first moment the customer code and
    // our employer id are both known. Every future renewal is attributed
    // through this pointer, so a missing email — which the schema will not
    // accept — must not be the reason the pointer never gets written.
    await deps.putBillingCustomer({
      employerId,
      customerCode: verification.customerCode,
      email: verification.customerEmail,
      createdAt: now,
    });
  } else if (verification.customerCode) {
    await deps.publishAlert(
      `Paystack confirmed payment ${reference} for employer ${employerId} but returned no ` +
        'customer email, so the customer-code pointer was not written. Renewal charges for ' +
        'this organization cannot be attributed until it is.',
    );
  }
  return true;
}

function readSubscriptionPayload(data: unknown): PaystackSubscriptionPayload | null {
  const record = asRecord(data);
  if (!record) return null;
  return record as PaystackSubscriptionPayload;
}

/**
 * `subscription.create`: the only event that carries the `email_token`.
 *
 * Without that token there is no way to call `POST /subscription/disable`,
 * which means no way to cancel on the employer's behalf — so this handler
 * failing to store it would silently remove the cancel button from the
 * product.
 */
async function handleSubscriptionCreate(
  data: unknown,
  now: string,
  deps: PaystackWebhookDependencies,
): Promise<boolean> {
  const payload = readSubscriptionPayload(data);
  const subscriptionCode = payload?.subscription_code;
  const customerCode = payload?.customer?.customer_code;
  if (!subscriptionCode || !customerCode) return false;

  const employerId = await deps.employerIdForCustomerCode(customerCode);
  if (!employerId) {
    await deps.publishAlert(
      `Paystack created subscription ${subscriptionCode} for customer ${customerCode}, which ` +
        'does not match any organization here. No access was granted.',
    );
    return false;
  }

  const existing = await deps.getBillingSubscription(employerId);
  const eventAt = toIso(payload?.created_at ?? payload?.createdAt) ?? now;
  if (existing && existing.subscriptionCode === subscriptionCode) {
    // A redelivery whose body differed enough to pass the hash check, or a
    // reconciliation that already wrote this. Only overwrite with fresher
    // information.
    if (!isFresherThan(eventAt, existing.updatedAt)) return false;
  }

  // Paystack knows the plan code and the amount. Only this system knows
  // that PLN_xyz means "Scout, founding, monthly", so the tier is resolved
  // two ways: from the plan-code registry, which is authoritative because
  // Paystack itself named the code, and from the payment attempt that
  // opened this checkout, which is the fallback when the registry has since
  // been rewritten.
  //
  // Never defaulted. A default of "scout, standard" would record a Partner
  // founding subscriber as a Scout on the standard price, which is wrong in
  // both directions at once and would be invisible until they complained.
  const planCode = payload?.plan?.plan_code;
  const attempt = await findAttemptForPlanCode(employerId, planCode, deps);
  const fromRegistry = planCode ? await resolvePlanKey(planCode, deps) : null;
  const resolved = fromRegistry ?? attemptTier(attempt);

  if (!resolved) {
    await deps.publishAlert(
      `Paystack subscription ${subscriptionCode} names plan code ${planCode ?? '(none)'}, which ` +
        'is not in the plan-code registry and matches no payment attempt for this organization. ' +
        'No subscription was recorded and no access was granted, because recording it would mean ' +
        'guessing which tier and which price they bought.',
    );
    return false;
  }

  const status = subscriptionStatusFromPaystack(payload?.status ?? '') ?? 'active';
  const amountKobo = Number(payload?.amount ?? payload?.plan?.amount ?? 0);

  const subscription: BillingSubscription = {
    employerId,
    subscriptionCode,
    customerCode,
    planCode: planCode ?? attempt?.planCode ?? '',
    plan: resolved.plan,
    interval: resolved.interval,
    priceTier: resolved.priceTier,
    // The amount actually charged, from the attempt when we have it and
    // from Paystack otherwise. Never from a price table: the whole point of
    // stamping it is that it survives a price change.
    priceNGN: attempt?.amountNGN ?? Math.round(amountKobo / 100),
    status,
    emailToken: payload?.email_token ?? existing?.emailToken ?? '',
    nextPaymentDate: toIso(payload?.next_payment_date),
    currentPeriodStart: eventAt,
    currentPeriodEnd: toIso(payload?.next_payment_date),
    graceEndsAt: null,
    lastFailureReason: null,
    card: toCardSummary(payload?.authorization),
    cancelRequestedAt: null,
    createdAt: existing?.createdAt ?? eventAt,
    updatedAt: now,
  };

  if (!subscription.emailToken) {
    // Recorded loudly rather than silently: everything else works, but
    // cancellation does not, and the employer must not discover that at
    // the moment they try to cancel.
    await deps.publishAlert(
      `Paystack subscription ${subscriptionCode} arrived without an email_token. Cancellation ` +
        'through the product will not work for it until the token is recovered from the ' +
        'Paystack dashboard or a Fetch Subscription call.',
    );
  }

  await deps.putBillingSubscription(subscription);

  if (subscription.priceTier === 'founding') {
    // The place is spent when the subscription actually exists, not when a
    // checkout was opened — an abandoned checkout must never consume one
    // of the twenty-five.
    await deps.recordFoundingPlaceTaken(employerId);
  }

  await deps.updateEntitlement(employerId, {
    plan: subscription.plan,
    status: 'active',
    subscriptionRenewsAt: subscription.nextPaymentDate,
    priceNGN: subscription.priceNGN,
    foundingMember: subscription.priceTier === 'founding',
  });

  await deps.appendAuditEvent({
    id: deps.generateId(),
    actorId: 'system:paystack-webhook',
    actorRole: 'admin',
    action: 'subscription_created',
    targetType: 'employer',
    targetId: employerId,
    reason: `${subscription.plan} ${subscription.interval} ${subscription.priceTier}`,
    createdAt: now,
  });
  return true;
}

interface ResolvedPlan {
  plan: SubscriptionPlan;
  priceTier: PriceTier;
  interval: BillingInterval;
}

/**
 * Reverses the plan-code registry: Paystack's `PLN_...` back to the tier,
 * price tier and interval it was created for.
 *
 * Authoritative, because Paystack is naming a code this system chose and
 * wrote down. Returns null when the code is not in the registry, which
 * happens if a Plan was created in the dashboard and never recorded, and
 * is a state worth an alert rather than a guess.
 */
async function resolvePlanKey(
  planCode: string,
  deps: Pick<PaystackWebhookDependencies, 'getPlanCodeRegistry'>,
): Promise<ResolvedPlan | null> {
  const registry = await deps.getPlanCodeRegistry();
  for (const plan of SUBSCRIPTION_PLANS) {
    for (const priceTier of PRICE_TIERS) {
      for (const interval of BILLING_INTERVALS) {
        if (registry[planKey(plan, priceTier, interval)] === planCode) {
          return { plan, priceTier, interval };
        }
      }
    }
  }
  return null;
}

/** The same three facts, taken from the checkout that opened this subscription. */
function attemptTier(attempt: PaymentAttempt | null): ResolvedPlan | null {
  if (!attempt?.plan || !attempt.priceTier || !attempt.interval) return null;
  return { plan: attempt.plan, priceTier: attempt.priceTier, interval: attempt.interval };
}

/**
 * Finds the checkout that bought this plan code, so the subscription can
 * be labelled with the tier and price tier the employer was actually
 * quoted rather than with a guess from the amount.
 */
async function findAttemptForPlanCode(
  employerId: string,
  planCode: string | undefined,
  deps: Pick<PaystackWebhookDependencies, 'listPaymentAttempts'>,
): Promise<PaymentAttempt | null> {
  if (!planCode) return null;
  const attempts = await deps.listPaymentAttempts(employerId);
  return (
    attempts.find((a) => a.planCode === planCode && a.status === 'success') ??
    attempts.find((a) => a.planCode === planCode) ??
    null
  );
}

/**
 * Apply a patch only while the event still describes the subscription the
 * employer actually has.
 *
 * Paystack addresses these events by subscription code, and an employer
 * can hold more than one over time: cancelling leaves the old
 * subscription running to the end of the period it was paid for, so
 * somebody who cancels and then takes a different plan has an old code
 * that Paystack goes on talking about for weeks. Both codes point at the
 * same employer, and only one of them is current.
 *
 * Returning null here is not a failure. It is the right outcome for an
 * event about a subscription that has been superseded, and the caller's
 * job is then to change nothing.
 */
async function patchCurrentSubscription(
  employerId: string,
  subscriptionCode: string,
  patch: Partial<BillingSubscription>,
  event: string,
  now: string,
  deps: PaystackWebhookDependencies,
): Promise<BillingSubscription | null> {
  const updated = await deps.updateBillingSubscription(employerId, patch, now, subscriptionCode);
  if (!updated) {
    billingLog.info('paystack event names a subscription that is no longer current', {
      event,
      employerId,
      subscriptionCode,
    });
  }
  return updated;
}

async function handleSubscriptionStatusEvent(
  data: unknown,
  status: SubscriptionStatus,
  now: string,
  deps: PaystackWebhookDependencies,
): Promise<boolean> {
  const payload = readSubscriptionPayload(data);
  const subscriptionCode = payload?.subscription_code;
  if (!subscriptionCode) return false;

  const employerId = await deps.employerIdForSubscriptionCode(subscriptionCode);
  if (!employerId) return false;

  const updated = await patchCurrentSubscription(
    employerId,
    subscriptionCode,
    {
      status,
      nextPaymentDate: toIso(payload?.next_payment_date),
      // Cancelling does not open a grace window: nothing failed, and the
      // paid period runs to its end either way.
      graceEndsAt: null,
    },
    'subscription.not_renew',
    now,
    deps,
  );
  if (!updated) return false;

  await deps.appendAuditEvent({
    id: deps.generateId(),
    actorId: 'system:paystack-webhook',
    actorRole: 'admin',
    action: 'subscription_status_changed',
    targetType: 'employer',
    targetId: employerId,
    reason: status,
    createdAt: now,
  });
  return true;
}

/**
 * The end of a subscription. Paystack sends this both for a cancellation
 * that has reached its next payment date and for a plan that has run all
 * its billing cycles (`status: "complete"`).
 */
async function handleSubscriptionDisable(
  data: unknown,
  now: string,
  deps: PaystackWebhookDependencies,
): Promise<boolean> {
  const payload = readSubscriptionPayload(data);
  const subscriptionCode = payload?.subscription_code;
  if (!subscriptionCode) return false;

  const employerId = await deps.employerIdForSubscriptionCode(subscriptionCode);
  if (!employerId) return false;

  const status = subscriptionStatusFromPaystack(payload?.status ?? '') ?? 'cancelled';
  const updated = await patchCurrentSubscription(
    employerId,
    subscriptionCode,
    { status, nextPaymentDate: null, graceEndsAt: null },
    'subscription.disable',
    now,
    deps,
  );
  // Disabling a superseded subscription means nothing here: it is
  // Paystack closing out the plan this employer already cancelled. Taking
  // access away for it would take away access they are paying for on the
  // plan they moved to.
  if (!updated) return false;

  // The subscription is over, so marketplace access ends. A Kit already
  // bought is untouched: it was a separate, one-time purchase and is not
  // rented.
  const entitlement = await deps.getEntitlement(employerId);
  await deps.updateEntitlement(employerId, {
    plan: entitlement?.kitPurchasedAt ? 'kit' : 'none',
    status: entitlement?.kitPurchasedAt ? 'active' : 'canceled',
    subscriptionRenewsAt: null,
  });

  await deps.appendAuditEvent({
    id: deps.generateId(),
    actorId: 'system:paystack-webhook',
    actorRole: 'admin',
    action: 'subscription_ended',
    targetType: 'employer',
    targetId: employerId,
    reason: status,
    createdAt: now,
  });
  return true;
}

/**
 * The three invoice events, which between them are the whole renewal
 * story.
 *
 * `invoice.create` three days ahead, then either a `charge.success` or an
 * `invoice.payment_failed` on the day, then `invoice.update` with the
 * final outcome. The failure is the one that matters most here: it is the
 * only notification that a renewal did not collect, and Paystack will not
 * try again until next month.
 */
async function handleInvoiceEvent(
  event: string,
  data: unknown,
  now: string,
  deps: PaystackWebhookDependencies,
): Promise<boolean> {
  const payload = asRecord(data) as PaystackInvoicePayload | null;
  const invoiceCode = payload?.invoice_code;
  const subscriptionCode = payload?.subscription?.subscription_code;
  if (!invoiceCode || !subscriptionCode) return false;

  const employerId = await deps.employerIdForSubscriptionCode(subscriptionCode);
  if (!employerId) return false;

  const amountKobo = Number(payload?.amount ?? 0);
  await deps.putBillingInvoice({
    employerId,
    invoiceCode,
    subscriptionCode,
    // A zero-amount invoice is not a real invoice; the schema requires a
    // positive amount, and one kobo is the smallest honest placeholder for
    // a payload that arrived without one.
    amountNGN: Math.max(1, Math.round(amountKobo / 100)),
    periodStart: toIso(payload?.period_start),
    periodEnd: toIso(payload?.period_end),
    status: String(payload?.status ?? 'unknown'),
    paid: asBoolean(payload?.paid),
    paidAt: toIso(payload?.paid_at),
    description: payload?.description ?? null,
    transactionReference: payload?.transaction?.reference ?? null,
    createdAt: toIso(payload?.created_at) ?? now,
    updatedAt: now,
  });

  if (event === 'invoice.payment_failed') {
    const grace = graceDeadline(new Date(now)).toISOString();
    const updated = await patchCurrentSubscription(
      employerId,
      subscriptionCode,
      {
        status: 'attention',
        graceEndsAt: grace,
        lastFailureReason: payload?.description ?? 'The bank did not give a reason.',
        nextPaymentDate: toIso(payload?.subscription?.next_payment_date),
      },
      'invoice.payment_failed',
      now,
      deps,
    );
    if (!updated) {
      // The invoice above is kept either way, because it happened. What
      // is skipped is the grace window and the suspension it leads to,
      // both of which would fall on access the employer holds under a
      // different subscription.
      await deps.publishAlert(
        `Paystack reported a failed renewal (invoice ${invoiceCode}) on subscription ` +
          `${subscriptionCode}, which is not the current subscription for employer ` +
          `${employerId}. Their access was left alone. Nothing is owed on a subscription that ` +
          'has been replaced, so this needs no action unless it repeats.',
      );
      return true;
    }
    // Entitlement stays active: access follows `deriveAccess`, which keeps
    // it until the grace window closes. Writing `past_due` here would cut
    // an employer off the instant their card was declined.
    await deps.publishAlert(
      `A subscription renewal failed for employer ${employerId} (invoice ${invoiceCode}): ` +
        `${payload?.description ?? 'no reason given'}. Paystack does not retry; access ends ` +
        `at ${grace} unless the card is replaced.`,
    );
    await deps.appendAuditEvent({
      id: deps.generateId(),
      actorId: 'system:paystack-webhook',
      actorRole: 'admin',
      action: 'subscription_payment_failed',
      targetType: 'employer',
      targetId: employerId,
      reason: payload?.description ?? 'unknown',
      createdAt: now,
    });
    return true;
  }

  if (event === 'invoice.update' && asBoolean(payload?.paid)) {
    // Same reasoning as the renewal charge above: a paid invoice clears the
    // failure, and only moves the status back to `active` for a
    // subscription that was still trying to bill. A `non-renewing` or
    // `cancelled` subscription stays as it is.
    const subscription = await deps.getBillingSubscription(employerId);
    const revivable = subscription?.status === 'attention' || subscription?.status === 'active';
    const updated = await patchCurrentSubscription(
      employerId,
      subscriptionCode,
      {
        ...(revivable ? { status: 'active' as const } : {}),
        graceEndsAt: null,
        lastFailureReason: null,
        currentPeriodStart: toIso(payload?.period_start),
        currentPeriodEnd: toIso(payload?.period_end),
        nextPaymentDate: toIso(payload?.subscription?.next_payment_date),
        card: toCardSummary(payload?.authorization),
      },
      'invoice.update',
      now,
      deps,
    );
    // A paid invoice on a superseded subscription must not move the
    // renewal date of the current one, which bills on its own cycle.
    if (!updated) return true;
    await deps.updateEntitlement(employerId, {
      ...(revivable ? { status: 'active' as const } : {}),
      subscriptionRenewsAt: toIso(payload?.subscription?.next_payment_date),
    });
  }
  return true;
}

/**
 * `subscription.expiring_cards` — the one event whose `data` is an array.
 *
 * Sent once at the start of a month, listing every subscription whose card
 * expires that month. It is a warning, not a failure: nothing has gone
 * wrong yet, and the point is to reach the customer before it does.
 */
async function handleExpiringCards(
  data: unknown,
  now: string,
  deps: PaystackWebhookDependencies,
): Promise<boolean> {
  if (!Array.isArray(data)) return false;

  let touched = 0;
  for (const entry of data) {
    const record = asRecord(entry);
    const subscriptionCode = asRecord(record?.subscription)?.subscription_code;
    if (typeof subscriptionCode !== 'string') continue;

    const employerId = await deps.employerIdForSubscriptionCode(subscriptionCode);
    if (!employerId) continue;

    await deps.appendAuditEvent({
      id: deps.generateId(),
      actorId: 'system:paystack-webhook',
      actorRole: 'admin',
      action: 'subscription_card_expiring',
      targetType: 'employer',
      targetId: employerId,
      reason: typeof record?.expiry_date === 'string' ? record.expiry_date : 'this month',
      createdAt: now,
    });
    touched += 1;
  }

  if (touched > 0) {
    await deps.publishAlert(
      `${touched} subscription card(s) expire this month. Those employers need a card-update ` +
        'prompt before their next renewal date.',
    );
  }
  return touched > 0;
}

/** Exported for the tests that assert every documented event is accounted for. */
export const PAYSTACK_SUPPORTED_EVENTS = SUPPORTED_EVENTS;

/** Exported so reconciliation and tests agree on how a status maps. */
export { paymentStatusFromPaystack };
