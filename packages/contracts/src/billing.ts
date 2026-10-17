import { z } from 'zod';
import { SUBSCRIPTION_PLANS, type SubscriptionPlan } from './domain';

/**
 * Recurring billing, as Paystack actually implements it.
 *
 * Every fact encoded here was read from Paystack's own current
 * documentation on 2026-09-01, not from memory (docs/PAYMENTS.md records
 * the pages and what each one settled). The three that shape this file
 * most:
 *
 * 1. Paystack sends a webhook for successful transactions only. There is
 *    no `charge.failed` event and no `charge.abandoned` event. A card that
 *    is declined at the hosted checkout, or a buyer who closes the tab,
 *    produces silence. Anything that must know about those outcomes has to
 *    ask (`/transaction/verify`, `/transaction?status=`), which is why
 *    reconciliation is a required component here rather than a nicety.
 * 2. "Subscriptions aren't retried" — a failed renewal is not re-attempted
 *    until the next payment date, a month later. The subscription sits at
 *    status `attention` in the meantime.
 * 3. A subscription is disabled with the pair (`subscription_code`,
 *    `email_token`). The token arrives once, on the events that create the
 *    subscription, and there is no endpoint that returns it again without
 *    the code. Losing it means losing the ability to cancel on the
 *    employer's behalf.
 */

/**
 * How often a plan bills.
 *
 * Paystack's own accepted values are `daily`, `weekly`, `monthly`,
 * `quarterly`, `biannually` and `annually` (plus `hourly`, which the
 * Create Plan reference omits and the Update Plan reference lists — used
 * by neither). Only the two this product could ever sell are modelled;
 * a value Paystack accepts but the founder has not priced is not a
 * capability, it is a way to charge somebody the wrong amount.
 */
export const BILLING_INTERVALS = ['monthly', 'annually'] as const;
export const BillingIntervalSchema = z.enum(BILLING_INTERVALS);
export type BillingInterval = z.infer<typeof BillingIntervalSchema>;

/** The Paystack `interval` string each of ours maps to, verbatim. */
export const PAYSTACK_INTERVAL: Record<BillingInterval, string> = {
  monthly: 'monthly',
  annually: 'annually',
};

/**
 * What an employer can actually choose today.
 *
 * CLAUDE.md's fixed-product section says "monthly; ... no annual plans",
 * and no annual amount has ever been founder-approved. The annual interval
 * is modelled end to end anyway — schema, plan registry, state machine,
 * reconciliation — because the cost of retrofitting an interval into a
 * billing system later is far higher than the cost of carrying one now.
 * Turning it on is two changes: an approved price in
 * SUBSCRIPTION_PRICES_NGN's shape, and this array.
 *
 * Until then nothing offers it, and `assertOfferedInterval` refuses it at
 * the one place money would move.
 */
export const OFFERED_BILLING_INTERVALS: readonly BillingInterval[] = ['monthly'];

export function isOfferedInterval(interval: BillingInterval): boolean {
  return OFFERED_BILLING_INTERVALS.includes(interval);
}

/** Which price a subscription is billed at, for its whole life. */
export const PRICE_TIERS = ['founding', 'standard'] as const;
export const PriceTierSchema = z.enum(PRICE_TIERS);
export type PriceTier = z.infer<typeof PriceTierSchema>;

/**
 * One Paystack Plan object per (tier, price tier, interval).
 *
 * Paystack has no notion of "the same plan at a different price for
 * different customers": a Plan carries a single amount and a single
 * interval, and a subscription inherits both. Founding and standard are
 * different amounts, so they are different Plans — which is also what
 * keeps the founding promise honest, since a founding subscriber stays
 * attached to a Plan object whose amount cannot drift when the standard
 * price is raised.
 */
export type PlanKey = `${SubscriptionPlan}_${PriceTier}_${BillingInterval}`;

export function planKey(
  plan: SubscriptionPlan,
  priceTier: PriceTier,
  interval: BillingInterval,
): PlanKey {
  return `${plan}_${priceTier}_${interval}`;
}

/** Every plan key, in a stable order. Used by the plan-code registry check. */
export function allPlanKeys(intervals: readonly BillingInterval[] = BILLING_INTERVALS): PlanKey[] {
  const keys: PlanKey[] = [];
  for (const plan of SUBSCRIPTION_PLANS) {
    for (const priceTier of PRICE_TIERS) {
      for (const interval of intervals) {
        keys.push(planKey(plan, priceTier, interval));
      }
    }
  }
  return keys;
}

/** `PLN_` + Paystack's own identifier alphabet. */
export const PlanCodeSchema = z.string().regex(/^PLN_[a-zA-Z0-9]+$/, 'not a Paystack plan code');
export const SubscriptionCodeSchema = z
  .string()
  .regex(/^SUB_[a-zA-Z0-9]+$/, 'not a Paystack subscription code');
export const CustomerCodeSchema = z
  .string()
  .regex(/^CUS_[a-zA-Z0-9]+$/, 'not a Paystack customer code');
export const InvoiceCodeSchema = z
  .string()
  .regex(/^INV_[a-zA-Z0-9]+$/, 'not a Paystack invoice code');

/**
 * Which Paystack Plan object each of our plan keys refers to.
 *
 * Deliberately configuration, never a literal in this repository. Plan
 * codes are per-integration: the codes in Paystack test mode and the codes
 * in live mode are different strings for the same product, and a code
 * committed here would be one more thing that has to be remembered at the
 * live switchover. It is read from Parameter Store at runtime, keyed by
 * environment, exactly as the feature flags are.
 */
export const PlanCodeRegistrySchema = z.record(z.string(), PlanCodeSchema);
export type PlanCodeRegistry = z.infer<typeof PlanCodeRegistrySchema>;

/**
 * What Paystack says a transaction is, verbatim, plus the one state that
 * exists before Paystack has an opinion.
 *
 * `initialized` is ours: the moment we have created a reference and an
 * authorization URL but nobody has been to the checkout page yet. Paystack
 * has no record it would call by that name; a reference that is never paid
 * eventually reads as `abandoned` there.
 */
export const PAYMENT_STATUSES = [
  'initialized',
  'pending',
  'ongoing',
  'processing',
  'queued',
  'success',
  'failed',
  'abandoned',
  'reversed',
] as const;
export const PaymentStatusSchema = z.enum(PAYMENT_STATUSES);
export type PaymentStatus = z.infer<typeof PaymentStatusSchema>;

/**
 * A payment that has reached an outcome nothing further will change on its
 * own. Everything else is worth asking Paystack about again.
 *
 * `reversed` is terminal but is not a success: it means refunded or
 * charged back, and whatever it paid for has to be taken away.
 */
export const TERMINAL_PAYMENT_STATUSES: readonly PaymentStatus[] = [
  'success',
  'failed',
  'abandoned',
  'reversed',
];

export function isTerminalPayment(status: PaymentStatus): boolean {
  return TERMINAL_PAYMENT_STATUSES.includes(status);
}

/**
 * Whether the checkout behind this attempt can still be paid.
 *
 * Paystack pins an outcome to a reference: a reference that declined
 * stays declined, and re-opening its checkout URL can only decline again.
 * Observed against the live test API — one reference, three attempts, all
 * "Insufficient Funds", with `Success` deliberately selected on the last
 * two.
 *
 * This is what tells a resumable checkout from a dead one. Returning a
 * dead URL to somebody pressing Subscribe a second time leaves them
 * permanently unable to buy, which is worse than the duplicate attempt it
 * was meant to prevent: a duplicate costs an extra row, this costs the
 * sale and the customer.
 *
 * `success` is deliberately not resumable and not dead either. It needs
 * its own answer, because minting a fresh reference for somebody who has
 * already paid is how a customer gets charged twice.
 */
export function isResumablePayment(status: PaymentStatus): boolean {
  return !isTerminalPayment(status);
}

/** A checkout that can never be completed, so a new one has to be opened. */
export function isDeadPayment(status: PaymentStatus): boolean {
  return status === 'failed' || status === 'abandoned' || status === 'reversed';
}

/**
 * Maps a raw Paystack transaction status onto ours, refusing anything
 * unrecognized rather than guessing.
 *
 * Returning null (and letting the caller record the raw string and alert)
 * is the only safe handling of a status Paystack adds later: a default
 * branch that folded an unknown value into `failed` would revoke paid
 * access on a status change we had not read about yet, and one that folded
 * it into `success` would give access away.
 */
export function paymentStatusFromPaystack(raw: string): PaymentStatus | null {
  const normalized = raw.trim().toLowerCase();
  const found = PAYMENT_STATUSES.find((status) => status === normalized);
  // `initialized` is ours alone — Paystack never reports it, and accepting
  // it from a payload would let a caller move a transaction backwards.
  return found && found !== 'initialized' ? found : null;
}

/**
 * Paystack's five subscription statuses, spelled as Paystack spells them.
 *
 * `non-renewing` keeps its hyphen on purpose. Renaming it here would mean
 * a translation layer in every direction, and a translation layer is where
 * a status silently becomes a different status.
 */
export const SUBSCRIPTION_STATUSES = [
  'active',
  'non-renewing',
  'attention',
  'completed',
  'cancelled',
] as const;
export const SubscriptionStatusSchema = z.enum(SUBSCRIPTION_STATUSES);
export type SubscriptionStatus = z.infer<typeof SubscriptionStatusSchema>;

export function subscriptionStatusFromPaystack(raw: string): SubscriptionStatus | null {
  const normalized = raw.trim().toLowerCase();
  // Paystack's own docs use both `cancelled` (statuses table) and
  // `complete` (the subscription.disable payload's `status` when all
  // billing cycles have run) for states this product treats as ended.
  // Both are accepted; `complete` is normalized to the documented
  // `completed`.
  if (normalized === 'complete') return 'completed';
  return SUBSCRIPTION_STATUSES.find((status) => status === normalized) ?? null;
}

/**
 * What the employer may actually do right now.
 *
 * Kept separate from both statuses above because it answers a different
 * question and changes for different reasons. A subscription at
 * `attention` (Paystack could not charge the card) still grants access for
 * the length of the grace window; a subscription at `non-renewing` grants
 * access until the period it was already paid for runs out. Collapsing the
 * three into one field is how billing systems end up either locking out
 * paying customers or serving unpaid ones.
 */
export const ACCESS_STATES = ['none', 'active', 'grace', 'suspended'] as const;
export const AccessStateSchema = z.enum(ACCESS_STATES);
export type AccessState = z.infer<typeof AccessStateSchema>;

/**
 * How long paid access survives a renewal Paystack could not collect.
 *
 * Paystack does not retry a failed subscription charge; it waits for the
 * next payment date, which for a monthly plan is a month away. Cutting
 * access the instant a charge fails punishes an employer whose card
 * expired over a weekend. Leaving it for the full month gives a month of
 * the product away and calls it dunning. Seven days is long enough to read
 * an email, find a card and use the Paystack-hosted update page, and short
 * enough that it cannot be used as a way to not pay.
 *
 * A founder decision, recorded in docs/DECISIONS.md.
 */
export const PAYMENT_FAILURE_GRACE_DAYS = 7;

export const BillingCustomerSchema = z.object({
  employerId: z.string(),
  customerCode: CustomerCodeSchema,
  email: z.string().email(),
  createdAt: z.string().datetime(),
});
export type BillingCustomer = z.infer<typeof BillingCustomerSchema>;

/**
 * The card (or bank) Paystack will charge on renewal, reduced to what can
 * safely be shown back to the employer and what the expiring-card flow
 * needs.
 *
 * No PAN, no CVV, no `authorization_code` — the authorization code is the
 * credential that can charge the card, so it stays in Paystack. `bin` is
 * omitted for the same reason `last4` is kept: four digits identify the
 * card to its owner, six identify the issuing range to anyone.
 */
export const CardSummarySchema = z.object({
  last4: z.string().length(4),
  brand: z.string(),
  expMonth: z.string(),
  expYear: z.string(),
  channel: z.string(),
});
export type CardSummary = z.infer<typeof CardSummarySchema>;

export const BillingSubscriptionSchema = z.object({
  employerId: z.string(),
  subscriptionCode: SubscriptionCodeSchema,
  customerCode: CustomerCodeSchema,
  planCode: PlanCodeSchema,
  plan: z.enum(SUBSCRIPTION_PLANS),
  interval: BillingIntervalSchema,
  priceTier: PriceTierSchema,
  /** What this subscription bills, in naira. Stamped once; never recomputed. */
  priceNGN: z.number().int().positive(),
  status: SubscriptionStatusSchema,
  /**
   * Paystack's `email_token`, required alongside the subscription code by
   * `POST /subscription/disable` and `/enable`. Never returned by any API
   * response this service serves, never logged, never sent to a browser:
   * it is the thing that can cancel somebody's subscription.
   */
  emailToken: z.string(),
  nextPaymentDate: z.string().datetime().nullable(),
  currentPeriodStart: z.string().datetime().nullable(),
  currentPeriodEnd: z.string().datetime().nullable(),
  /**
   * When the current payment failure's grace window closes. Set from an
   * `invoice.payment_failed`, cleared by the next successful charge.
   */
  graceEndsAt: z.string().datetime().nullable().default(null),
  lastFailureReason: z.string().nullable().default(null),
  card: CardSummarySchema.nullable().default(null),
  cancelRequestedAt: z.string().datetime().nullable().default(null),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type BillingSubscription = z.infer<typeof BillingSubscriptionSchema>;

/**
 * Why a payment was attempted. The Kit is a one-time transaction; a
 * subscription attempt is a transaction that carries a `plan` and creates
 * a Paystack subscription when it succeeds.
 */
export const PaymentPurposeSchema = z.enum(['kit', 'subscription']);
export type PaymentPurpose = z.infer<typeof PaymentPurposeSchema>;

/**
 * One row per attempt to take money, written before Paystack is contacted.
 *
 * This is the record that was missing. A KitOrder describes a thing that
 * was bought; it cannot describe a checkout that was opened and abandoned,
 * a card that was declined, or the same button pressed twice. Those are
 * exactly the events a billing system has to be able to explain, and
 * Paystack sends no webhook for any of them.
 */
export const PaymentAttemptSchema = z.object({
  id: z.string(),
  employerId: z.string(),
  purpose: PaymentPurposeSchema,
  /** The reference given to Paystack. Unique, and parseable back to this row. */
  reference: z.string().min(1),
  /**
   * Where this buyer was sent to pay.
   *
   * A reference can be initialized once: Paystack answers "Duplicate
   * Transaction Reference" on the second call. So a retry returns this
   * rather than initializing again, which is what makes retrying the same
   * idempotency key resume the checkout instead of failing it. Null on
   * attempts written before this existed.
   */
  checkoutUrl: z.string().url().nullable().default(null),
  /** Paystack's own transaction id, once known. Unsigned 64-bit; kept as a string. */
  paystackTransactionId: z.string().nullable().default(null),
  amountNGN: z.number().int().positive(),
  currency: z.literal('NGN'),
  status: PaymentStatusSchema,
  /** Exactly what Paystack last called it, even when we could not map it. */
  paystackStatus: z.string().nullable().default(null),
  channel: z.string().nullable().default(null),
  /** Paystack's `gateway_response`, shown to nobody but the founder. */
  gatewayResponse: z.string().nullable().default(null),
  failureReason: z.string().nullable().default(null),
  /** Set for `purpose: 'subscription'` — which plan this attempt was buying. */
  planCode: PlanCodeSchema.nullable().default(null),
  plan: z.enum(SUBSCRIPTION_PLANS).nullable().default(null),
  interval: BillingIntervalSchema.nullable().default(null),
  priceTier: PriceTierSchema.nullable().default(null),
  /** Set for `purpose: 'kit'` — which role's Kit was being bought. */
  roleId: z.string().nullable().default(null),
  subscriptionCode: SubscriptionCodeSchema.nullable().default(null),
  customerCode: CustomerCodeSchema.nullable().default(null),
  /**
   * Ties every log line, audit row and Paystack call for one attempt
   * together, including across the webhook that arrives minutes later on a
   * different Lambda.
   */
  correlationId: z.string(),
  /** When an independent server-side verify last confirmed this row. */
  verifiedAt: z.string().datetime().nullable().default(null),
  /** How many times reconciliation has looked at this row. */
  reconcileAttempts: z.number().int().min(0).default(0),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type PaymentAttempt = z.infer<typeof PaymentAttemptSchema>;

/**
 * A Paystack invoice: one billing period of one subscription.
 *
 * Paystack raises one three days before each payment date and updates it
 * afterwards with the outcome, so this is the only record that can answer
 * "was August paid, and if not, why not".
 */
export const BillingInvoiceSchema = z.object({
  employerId: z.string(),
  invoiceCode: InvoiceCodeSchema,
  subscriptionCode: SubscriptionCodeSchema,
  amountNGN: z.number().int().positive(),
  periodStart: z.string().datetime().nullable(),
  periodEnd: z.string().datetime().nullable(),
  /** Paystack's own invoice status string (`pending`, `success`, `attention`, ...). */
  status: z.string(),
  paid: z.boolean(),
  paidAt: z.string().datetime().nullable().default(null),
  /** Paystack's `description` on a failure — "Insufficient Funds" and the like. */
  description: z.string().nullable().default(null),
  transactionReference: z.string().nullable().default(null),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type BillingInvoice = z.infer<typeof BillingInvoiceSchema>;

/**
 * The employer-facing view. Deliberately assembled server-side: every
 * number on the billing page has to come from stored, verified state, not
 * from anything the browser was told during a checkout redirect.
 */
export const BillingOverviewSchema = z.object({
  plan: z.enum(SUBSCRIPTION_PLANS).nullable(),
  interval: BillingIntervalSchema.nullable(),
  priceNGN: z.number().int().positive().nullable(),
  foundingMember: z.boolean(),
  subscriptionStatus: SubscriptionStatusSchema.nullable(),
  access: AccessStateSchema,
  nextPaymentDate: z.string().datetime().nullable(),
  currentPeriodEnd: z.string().datetime().nullable(),
  graceEndsAt: z.string().datetime().nullable(),
  lastFailureReason: z.string().nullable(),
  card: CardSummarySchema.nullable(),
  cancelRequestedAt: z.string().datetime().nullable(),
  /**
   * Contact unlocks included each calendar month by the current plan, and
   * how many of them this month has used.
   *
   * Here rather than computed in the browser because the browser cannot
   * compute it. The count lives in a period-keyed ledger that only the
   * server can read, and the employer's role page was showing a number it
   * had derived from the local demo store: every real subscriber saw
   * "0 / 0 contact unlocks used this period" on the page they pay to use,
   * whatever their plan and however many they had spent.
   *
   * Zero allowance is a real answer (no subscription), so these are plain
   * numbers rather than nullables.
   */
  contactUnlockAllowance: z.number().int().min(0),
  contactUnlocksUsedThisPeriod: z.number().int().min(0),
});
export type BillingOverview = z.infer<typeof BillingOverviewSchema>;

/**
 * A payment as the employer is allowed to see it: no gateway strings, no
 * Paystack ids, no failure text written for an engineer.
 */
export const PaymentHistoryEntrySchema = z.object({
  id: z.string(),
  purpose: PaymentPurposeSchema,
  amountNGN: z.number().int().positive(),
  status: PaymentStatusSchema,
  createdAt: z.string().datetime(),
});
export type PaymentHistoryEntry = z.infer<typeof PaymentHistoryEntrySchema>;

/**
 * The one guard between an unpriced interval and a charge.
 *
 * Deliberately the only one. An earlier version of this file also carried a
 * price lookup that threw for a non-monthly interval, which sounded like
 * defence in depth and was not: nothing on the paying path called it, so it
 * was a guard that guarded a test. One guard, called at the one place money
 * moves, is worth more than two where one is decorative.
 *
 * Annual amounts are absent rather than derived. A twelve-times multiple of
 * the monthly price is not an annual price — nobody prepays a year for no
 * discount — and inventing a discount would be setting a price, which is a
 * founder decision under CLAUDE.md's fixed-product section rather than a
 * rounding choice for this module to make.
 */
export function assertOfferedInterval(interval: BillingInterval): void {
  if (!isOfferedInterval(interval)) {
    throw new Error(
      `The ${interval} billing interval is not currently offered: CLAUDE.md fixes the ` +
        'subscription prices as monthly only, and no other amount has been founder-approved.',
    );
  }
}
