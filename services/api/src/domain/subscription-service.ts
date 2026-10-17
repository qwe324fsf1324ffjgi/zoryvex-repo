import { randomUUID } from 'node:crypto';
import type { FeatureFlags } from '@zoryvex/config';
import {
  assertOfferedInterval,
  CONTACT_UNLOCK_ALLOWANCE,
  foundingPlacesRemaining,
  MARKETPLACE_GATE_MIN_MATCHES,
  isOfferedInterval,
  subscriptionPrice,
  type BillingInterval,
  type BillingInvoice,
  type BillingOverview,
  type BillingSubscription,
  type Entitlement,
  isDeadPayment,
  type PaymentAttempt,
  type PaymentHistoryEntry,
  type PlanCodeRegistry,
  type PriceTier,
  type SubscriptionPlan,
} from '@zoryvex/contracts';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  PaymentProviderError,
  ValidationError,
} from '../errors/typed-errors';
import { billingLog } from '../lib/billing-log';
import type { Clock } from '../repositories/clock-repository';
import { deriveAccess, entitlementStatusForAccess } from './billing-state';
import { buildSubscriptionReference, isValidPaystackReference } from './payment-reference';

/**
 * Everything an employer can do to their own subscription.
 *
 * Two rules run through all of it.
 *
 * Nothing here grants, changes or removes paid access on the strength of
 * anything a browser said. A checkout returns a redirect URL and nothing
 * else; access follows from a webhook or from a server-side verify, both
 * of which ask Paystack directly. The callback the buyer lands on after
 * paying is treated as a hint that it is worth asking, never as an answer.
 *
 * And nothing here invents a Paystack capability. Paystack cannot prorate,
 * cannot change the plan on an existing subscription, and does not retry a
 * failed renewal. Where a nicer behaviour would need one of those, the
 * product does the documented thing and says so plainly rather than
 * pretending.
 */

export interface SubscriptionDependencies {
  clock: Clock;
  getFeatureFlags(): Promise<FeatureFlags>;
  getPlanCodeRegistry(): Promise<PlanCodeRegistry>;
  getEmployerEmail(employerId: string): Promise<string>;
  getEntitlement(employerId: string): Promise<Entitlement | null>;
  updateEntitlement(
    employerId: string,
    patch: Partial<
      Pick<Entitlement, 'plan' | 'status' | 'subscriptionRenewsAt' | 'priceNGN' | 'foundingMember'>
    >,
  ): Promise<Entitlement>;
  countFoundingPlacesTaken(): Promise<number>;
  /**
   * Whether any role this organization owns has reached the marketplace
   * threshold.
   *
   * docs/PRODUCT_SPEC.md: "Monthly marketplace checkout stays disabled
   * until the saved role has at least five real, current, discovery-opted
   * matching profiles. This is a hard gate, not a soft nudge." Nothing
   * implemented it. The gate existed only on the unlock, which meant an
   * organization could be sold a subscription and then find that every
   * role it owned was below the threshold and no unlock could be spent on
   * any of them.
   *
   * The spec says "the saved role" and a subscription belongs to an
   * organization rather than to a role, so the faithful reading is: sell
   * marketplace access when there is marketplace access to sell. One
   * eligible role is enough, because one is enough to use it.
   */
  /**
   * How many discovery-opted candidates the organization's best role
   * currently matches.
   *
   * A count rather than the boolean it used to be, because the number is now
   * shown to the buyer. Selling into a thin marketplace is allowed; selling
   * into one without saying how thin it is, is not.
   */
  marketplaceCandidateCount(employerId: string): Promise<number>;
  holdsFoundingPlace(employerId: string): Promise<boolean>;
  getBillingSubscription(employerId: string): Promise<BillingSubscription | null>;
  /** Contact unlocks spent in the current calendar month. */
  countContactUnlocksThisPeriod(employerId: string): Promise<number>;
  updateBillingSubscription(
    employerId: string,
    patch: Partial<BillingSubscription>,
    expectedSubscriptionCode?: string,
  ): Promise<BillingSubscription | null>;
  listPaymentAttempts(employerId: string): Promise<PaymentAttempt[]>;
  listBillingInvoices(employerId: string): Promise<BillingInvoice[]>;
  /** Records where the buyer was sent, so a retry can return the same place. */
  /** Re-reads one attempt, for the concurrent-request case below. */
  getPaymentAttempt(employerId: string, attemptId: string): Promise<PaymentAttempt | null>;
  setPaymentAttemptCheckoutUrl(
    employerId: string,
    attemptId: string,
    checkoutUrl: string,
  ): Promise<PaymentAttempt | null>;
  createPaymentAttemptIfNotExists(
    attempt: PaymentAttempt,
    idempotencyKey: string,
  ): Promise<{ attempt: PaymentAttempt; created: boolean }>;
  initializeTransaction(input: {
    email: string;
    amountKobo: number;
    reference: string;
    callbackUrl: string;
    planCode?: string;
    metadata?: Record<string, string>;
    correlationId: string;
  }): Promise<{ authorizationUrl: string }>;
  /**
   * What Paystack will actually charge for a plan code.
   *
   * Needed because the amount sent to `/transaction/initialize` is not the
   * amount charged when a `plan` is attached. Paystack documents this, and
   * it was confirmed against the live TEST API on 2026-09-10: initializing
   * with `amount: 100` and the Scout plan produced a transaction for
   * 80,000,000 kobo, the plan's own price.
   *
   * So the figure on the pricing page and the figure the card is debited
   * come from two different systems, and nothing at request time compared
   * them. See the guard in `createSubscriptionCheckout`.
   */
  fetchPlan(planCode: string): Promise<{ amountKobo: number; currency: string }>;
  /** Tells a person when a plan price and the quoted price disagree. */
  publishAlert(message: string): Promise<void>;
  disableSubscription(subscriptionCode: string, emailToken: string): Promise<void>;
  generateManageLink(subscriptionCode: string): Promise<string>;
  appOrigin: string;
}

/**
 * Which price this employer buys at.
 *
 * An employer who already holds a founding place keeps the founding price
 * even after the twenty-five are gone: their place is still counted
 * against the cap, so quoting them the standard price would spend a place
 * and lose the founding member sitting in it. Otherwise it is simply
 * whether any place is left.
 */
async function priceTierFor(
  employerId: string,
  deps: Pick<SubscriptionDependencies, 'holdsFoundingPlace' | 'countFoundingPlacesTaken'>,
): Promise<PriceTier> {
  if (await deps.holdsFoundingPlace(employerId)) return 'founding';
  const taken = await deps.countFoundingPlacesTaken();
  return foundingPlacesRemaining(taken) > 0 ? 'founding' : 'standard';
}

export interface SubscriptionQuote {
  plan: SubscriptionPlan;
  interval: BillingInterval;
  priceTier: PriceTier;
  amountNGN: number;
  /** Null when the founder has not created the matching Paystack Plan yet. */
  planCode: string | null;
  foundingPlacesLeft: number;
  /**
   * Candidates the organization's best role matches right now.
   *
   * On the quote because it belongs in front of the buyer before they pay,
   * not in a support conversation afterwards. A marketplace of one is a
   * legitimate thing to sell to somebody who knows it is a marketplace of
   * one.
   */
  marketplaceCandidates: number;
}

/**
 * What this employer would pay for a plan today, and whether it can
 * actually be bought.
 *
 * Quoting and charging read the same two functions, in the same order, so
 * the page cannot show one number while the checkout sends another. That
 * failure has already happened once here: the billing page showed founding
 * prices to everyone while the adapter charged founding prices to
 * everyone, on a page promising that the twenty-sixth organization pays
 * standard.
 */
export async function quoteSubscription(
  employerId: string,
  plan: SubscriptionPlan,
  interval: BillingInterval,
  deps: Pick<
    SubscriptionDependencies,
    | 'holdsFoundingPlace'
    | 'countFoundingPlacesTaken'
    | 'getPlanCodeRegistry'
    | 'marketplaceCandidateCount'
  >,
): Promise<SubscriptionQuote> {
  const taken = await deps.countFoundingPlacesTaken();
  const priceTier = await priceTierFor(employerId, deps);
  // `subscriptionPrice` takes the count rather than the tier, and treats
  // "no places taken" as founding — which is how an existing founding
  // member is quoted their own price.
  const { amountNGN } = subscriptionPrice(plan, priceTier === 'founding' ? 0 : taken);
  const registry = await deps.getPlanCodeRegistry();
  const planCode = registry[`${plan}_${priceTier}_${interval}`] ?? null;

  return {
    plan,
    interval,
    priceTier,
    amountNGN,
    planCode,
    foundingPlacesLeft: foundingPlacesRemaining(taken),
    marketplaceCandidates: await deps.marketplaceCandidateCount(employerId),
  };
}

/**
 * Starts a subscription checkout and returns the Paystack URL to send the
 * buyer to.
 *
 * The payment attempt row is written before Paystack is contacted, and it
 * is written whether or not the buyer ever completes the checkout. That
 * ordering is the reason an abandoned checkout is visible at all: Paystack
 * sends no webhook when somebody closes the tab, so without a row written
 * up front there would be nothing anywhere to reconcile against.
 */
export async function startSubscriptionCheckout(
  employerId: string,
  plan: SubscriptionPlan,
  interval: BillingInterval,
  idempotencyKey: string,
  deps: SubscriptionDependencies,
): Promise<{ authorizationUrl: string; attempt: PaymentAttempt; created: boolean }> {
  const flags = await deps.getFeatureFlags();
  if (!flags.payments) {
    throw new ForbiddenError('Subscriptions are currently unavailable. Nothing has been charged.');
  }

  // Checked here as well as inside `assertOfferedInterval` so the employer
  // gets a sentence rather than a stack trace. The assertion stays as the
  // backstop for any caller that reaches the charge without coming
  // through this route.
  if (!isOfferedInterval(interval)) {
    throw new ForbiddenError('We bill monthly only. Nothing has been charged.');
  }
  assertOfferedInterval(interval);

  // Checked before anything is created and before Paystack is contacted,
  // for the same reason the payments flag is. Selling access somebody
  // cannot use is the failure this gate exists to prevent, and it is worse
  // than refusing a sale: it is a refund, and a reason not to come back.
  // One is the floor, not five, since 2026-09-02. An employer may buy into a
  // thin marketplace with their eyes open; the count travels on the quote so
  // they can see exactly how thin. Zero is still refused: a marketplace with
  // nobody in it is not a product, and selling it is a refund with extra
  // steps.
  const marketplaceCandidates = await deps.marketplaceCandidateCount(employerId);
  if (marketplaceCandidates < MARKETPLACE_GATE_MIN_MATCHES) {
    throw new ForbiddenError(
      'No role of yours matches a single discovery-opted candidate yet, so a marketplace ' +
        'subscription would buy you nothing you can use. Nothing has been charged. Recompute ' +
        'matches after widening a role, and this opens on its own.',
    );
  }

  const existing = await deps.getBillingSubscription(employerId);
  if (existing && (existing.status === 'active' || existing.status === 'attention')) {
    throw new ConflictError(
      'This organization already has a subscription. Change or cancel it from the billing page ' +
        'rather than starting a second one.',
    );
  }

  const quote = await quoteSubscription(employerId, plan, interval, deps);
  if (!quote.planCode) {
    // Configuration, not a bug the employer caused, and not something to
    // paper over: without a plan code there is no Paystack Plan to bill
    // against, and initializing without one would take a single payment
    // and set nothing recurring up.
    throw new ForbiddenError(
      'That plan is not open for subscription yet. Nothing has been charged.',
    );
  }

  const attemptId = randomUUID();
  const correlationId = randomUUID();
  const now = deps.clock.now().toISOString();
  const reference = buildSubscriptionReference(employerId, attemptId);

  // Paystack rejects a reference containing anything outside alphanumerics
  // and `-`, `.`, `=`, and rejects it at initialize time — so the failure
  // would be an employer who pressed Subscribe and got a 502. Checked here
  // because the employer id comes from a session and this function should
  // not have to assume it will always be a UUID.
  if (!isValidPaystackReference(reference)) {
    throw new ValidationError('This organization id cannot be used as a payment reference.');
  }

  /*
    The price is confirmed with Paystack before the buyer is sent anywhere.

    Attaching a `plan` makes Paystack ignore the `amount` in the same
    request and charge the plan's own price instead. That is documented
    behaviour and was reproduced against the live TEST API on 2026-09-10.
    It means the number quoted on the page comes from packages/contracts
    while the number debited comes from the Paystack Plan, and until now
    nothing compared the two at the moment of sale.

    The webhook already refuses to grant access when the verified amount
    does not match the attempt, so a drift could never buy anything. But
    that check runs after the card has been charged, so its outcome is a
    customer who has paid the wrong amount and needs a refund. Checking
    here turns that into a sale that simply does not start.

    `plans:check` reconciles the same three sources, and is a script
    somebody has to remember to run. This is the same rule enforced where
    it actually matters.

    Fails closed. A plan Paystack cannot confirm is not a plan to sell:
    the read is retried inside the client, and if it still fails the sale
    stops rather than proceeding on an unverified price.
  */
  let livePlan: { amountKobo: number; currency: string };
  try {
    livePlan = await deps.fetchPlan(quote.planCode);
  } catch {
    throw new PaymentProviderError(
      'We could not confirm the price with our payment provider just now. Nothing has been ' +
        'charged. Try again in a moment.',
    );
  }

  const expectedKobo = quote.amountNGN * 100;
  if (livePlan.amountKobo !== expectedKobo || livePlan.currency !== 'NGN') {
    billingLog.error('paystack plan price disagrees with the quote', {
      employerId,
      plan,
      planCode: quote.planCode,
      expectedKobo,
      paystackKobo: livePlan.amountKobo,
      paystackCurrency: livePlan.currency,
    });
    await deps.publishAlert(
      `Subscription checkout blocked: Paystack plan ${quote.planCode} is priced at ` +
        `${livePlan.amountKobo} kobo ${livePlan.currency}, but this product quotes ` +
        `${expectedKobo} kobo NGN for ${plan}. Nobody was charged and no checkout was opened. ` +
        'Run npm run plans:check and reconcile before selling this tier.',
    );
    throw new ConflictError(
      'This plan is temporarily unavailable to buy. Nothing has been charged, and we have been ' +
        'told about it.',
    );
  }

  // Built per attempt rather than once, because a dead checkout needs a
  // genuinely new id and reference, not a reuse of the old one.
  const buildAttempt = (id: string): PaymentAttempt => ({
    id,
    employerId,
    purpose: 'subscription',
    reference: buildSubscriptionReference(employerId, id),
    paystackTransactionId: null,
    amountNGN: quote.amountNGN,
    currency: 'NGN',
    status: 'initialized',
    paystackStatus: null,
    channel: null,
    gatewayResponse: null,
    failureReason: null,
    planCode: quote.planCode,
    plan,
    interval,
    priceTier: quote.priceTier,
    roleId: null,
    subscriptionCode: null,
    customerCode: null,
    correlationId,
    verifiedAt: null,
    reconcileAttempts: 0,
    checkoutUrl: null,
    createdAt: now,
    updatedAt: now,
  });

  let { attempt, created } = await deps.createPaymentAttemptIfNotExists(
    buildAttempt(attemptId),
    idempotencyKey,
  );

  // A dead checkout cannot be resumed, so the next press opens a new one.
  //
  // Paystack pins an outcome to a reference: one that declined stays
  // declined, and its checkout URL can only decline again. Measured
  // against the live test API — one reference, three attempts, all
  // "Insufficient Funds", with Success deliberately chosen on the last
  // two. Handing that URL back to somebody pressing Subscribe again
  // leaves them permanently unable to buy, which is a worse failure than
  // the duplicate row the idempotency key exists to prevent: a duplicate
  // costs a row, this costs the sale and the customer.
  //
  // `success` is excluded on purpose. Minting a fresh reference for
  // somebody who has already paid is how a customer is charged twice, and
  // the guard above already refuses a second subscription outright.
  for (let round = 2; !created && isDeadPayment(attempt.status); round += 1) {
    if (round > MAX_CHECKOUT_ROUNDS) break;
    ({ attempt, created } = await deps.createPaymentAttemptIfNotExists(
      buildAttempt(randomUUID()),
      `${idempotencyKey}#${round}`,
    ));
  }

  // A repeat of the same idempotency key resumes the checkout it already
  // opened rather than asking Paystack for a second one.
  //
  // This used to initialize unconditionally, under a comment claiming a
  // retry was safe because Paystack would return a fresh URL for the same
  // reference. It does not: `POST /transaction/initialize` answers
  // "Duplicate Transaction Reference", measured against the real API. The
  // retry the Idempotency-Key header exists to make safe was the one
  // request certain to fail, and the buyer saw a 502 over a first click
  // that had worked.
  if (!created) {
    // Somebody else owns this reference, so this request must never
    // initialize it. Paystack allows one initialize per reference and
    // answers "Duplicate Transaction Reference" to a second, which
    // arrived at the buyer as a 502 over a click that had worked.
    //
    // Sequentially the URL is already stored and this returns it. The
    // interesting case is concurrent — a double click, or two tabs —
    // where the winner is still talking to Paystack and has not stored
    // it yet. Measured against the deployed API: two simultaneous
    // requests with one key produced one 200 and one 502.
    //
    // So the loser waits briefly for the winner rather than racing it to
    // the provider, and if the URL still is not there it says so plainly.
    // A 409 telling somebody to try again in a moment is worth far more
    // than a 502 that reads like the payment broke.
    const resumed = attempt.checkoutUrl
      ? attempt
      : await waitForCheckoutUrl(employerId, attempt.id, deps);

    if (resumed?.checkoutUrl) {
      return { authorizationUrl: resumed.checkoutUrl, attempt: resumed, created };
    }

    throw new ConflictError(
      'That checkout is still opening. Wait a moment and try again. Nothing has been charged.',
    );
  }

  const { authorizationUrl } = await deps.initializeTransaction({
    email: await deps.getEmployerEmail(employerId),
    amountKobo: attempt.amountNGN * 100,
    reference: attempt.reference,
    callbackUrl: `${deps.appOrigin}/employer/billing?ref=${encodeURIComponent(attempt.reference)}`,
    planCode: attempt.planCode ?? quote.planCode,
    // Only values already inside the reference. Paystack metadata is
    // visible on their dashboard and echoed back through webhooks, so
    // nothing private goes in it.
    metadata: { employerId, purpose: 'subscription' },
    correlationId: attempt.correlationId,
  });

  billingLog.info('subscription checkout started', {
    correlationId: attempt.correlationId,
    employerId,
    reference: attempt.reference,
    plan,
    interval,
    priceTier: quote.priceTier,
    amountNGN: attempt.amountNGN,
    idempotentReplay: !created,
  });

  // Recorded so the retry above has somewhere to send them back to.
  const withUrl = await deps.setPaymentAttemptCheckoutUrl(employerId, attempt.id, authorizationUrl);

  return { authorizationUrl, attempt: withUrl ?? attempt, created };
}

/**
 * Everything the billing page shows, assembled server-side.
 *
 * The access state is derived here rather than stored, so a grace window
 * that closed twenty minutes ago is closed the next time anybody looks,
 * with nothing having had to wake up and notice.
 */
export async function getBillingOverview(
  employerId: string,
  deps: Pick<
    SubscriptionDependencies,
    'clock' | 'getBillingSubscription' | 'getEntitlement' | 'countContactUnlocksThisPeriod'
  >,
): Promise<BillingOverview> {
  const [subscription, entitlement, unlocksUsed] = await Promise.all([
    deps.getBillingSubscription(employerId),
    deps.getEntitlement(employerId),
    deps.countContactUnlocksThisPeriod(employerId),
  ]);
  const access = deriveAccess(subscription, deps.clock.now());

  // From the subscription first, because that is what Paystack is
  // actually billing. The entitlement is the fallback for a Kit-only
  // organization, which has no subscription and no unlock allowance.
  const allowancePlan = subscription?.plan ?? entitlement?.plan ?? 'none';

  return {
    plan: subscription?.plan ?? null,
    interval: subscription?.interval ?? null,
    priceNGN: subscription?.priceNGN ?? entitlement?.priceNGN ?? null,
    foundingMember:
      subscription?.priceTier === 'founding' || (entitlement?.foundingMember ?? false),
    subscriptionStatus: subscription?.status ?? null,
    access,
    nextPaymentDate: subscription?.nextPaymentDate ?? null,
    currentPeriodEnd: subscription?.currentPeriodEnd ?? null,
    graceEndsAt: subscription?.graceEndsAt ?? null,
    lastFailureReason: subscription?.lastFailureReason ?? null,
    card: subscription?.card ?? null,
    cancelRequestedAt: subscription?.cancelRequestedAt ?? null,
    contactUnlockAllowance: CONTACT_UNLOCK_ALLOWANCE[allowancePlan] ?? 0,
    contactUnlocksUsedThisPeriod: unlocksUsed,
  };
}

/**
 * The employer's own payment history, reduced to what they may see.
 *
 * Gateway responses, Paystack transaction ids, plan codes and correlation
 * ids are all deliberately dropped. They are for the founder's diagnostic
 * view, where they are useful, rather than for a customer-facing list,
 * where they are noise at best and an information leak at worst.
 */
export async function listPaymentHistory(
  employerId: string,
  deps: Pick<SubscriptionDependencies, 'listPaymentAttempts'>,
): Promise<PaymentHistoryEntry[]> {
  const attempts = await deps.listPaymentAttempts(employerId);
  return (
    attempts
      // An `initialized` row is a checkout page that was opened. Until
      // Paystack has an opinion about it, it is not yet a payment and
      // showing it as one would tell an employer they had tried to pay when
      // they had only looked at a page.
      .filter((attempt) => attempt.status !== 'initialized')
      .map((attempt) => ({
        id: attempt.id,
        purpose: attempt.purpose,
        amountNGN: attempt.amountNGN,
        status: attempt.status,
        createdAt: attempt.createdAt,
      }))
  );
}

/**
 * Cancels at Paystack first, and only then records it.
 *
 * The order is the guarantee. If the local record moved first and the
 * Paystack call then failed, the employer would see "cancelled" and keep
 * being billed — the single worst way for these two systems to disagree.
 * This way the only possible disagreement is the harmless direction: money
 * has stopped and the page has not caught up yet, which the next webhook
 * or reconciliation pass fixes.
 *
 * Paystack's disable is not an immediate termination. It sends
 * `subscription.not_renew` now and `subscription.disable` on the next
 * payment date, so the period already paid for is still served. The copy
 * on the cancel dialog says exactly that.
 */
export async function cancelSubscription(
  employerId: string,
  deps: Pick<
    SubscriptionDependencies,
    'clock' | 'getBillingSubscription' | 'updateBillingSubscription' | 'disableSubscription'
  >,
): Promise<BillingSubscription> {
  const subscription = await deps.getBillingSubscription(employerId);
  if (!subscription) throw new NotFoundError('No subscription to cancel');
  if (subscription.status === 'cancelled' || subscription.status === 'completed') {
    return subscription;
  }

  await deps.disableSubscription(subscription.subscriptionCode, subscription.emailToken);

  const now = deps.clock.now().toISOString();
  const updated = await deps.updateBillingSubscription(
    employerId,
    {
      // Recorded as our own expectation, not as a claim about Paystack's
      // state: the authoritative move to `non-renewing` comes from the
      // `subscription.not_renew` webhook. Writing it here as well means
      // the page is correct in the seconds before that webhook lands.
      status: 'non-renewing',
      cancelRequestedAt: now,
    },
    // Only if this is still the subscription that was read above and
    // disabled at Paystack a moment ago. Two tabs, one cancelling and one
    // starting a new plan, is all it takes to make these different.
    subscription.subscriptionCode,
  );

  billingLog.info('subscription cancellation requested', {
    employerId,
    subscriptionCode: subscription.subscriptionCode,
  });

  return updated ?? { ...subscription, status: 'non-renewing', cancelRequestedAt: now };
}

/**
 * A link to Paystack's own hosted page for replacing the card on a
 * subscription.
 *
 * This is the entire card-update story, on purpose. No card number, expiry
 * or CVV is ever collected by, posted to, or logged in this product; the
 * page is Paystack's, on Paystack's domain, and Paystack tokenizes the new
 * card with a small charge it refunds immediately. The link is
 * short-lived, which is why it is generated on demand rather than stored.
 */
export async function getCardUpdateLink(
  employerId: string,
  deps: Pick<SubscriptionDependencies, 'getBillingSubscription' | 'generateManageLink'>,
): Promise<string> {
  const subscription = await deps.getBillingSubscription(employerId);
  if (!subscription) throw new NotFoundError('No subscription to update');
  return deps.generateManageLink(subscription.subscriptionCode);
}

/**
 * How many checkouts one idempotency key may open.
 *
 * Each round happens only because the previous checkout died, so this
 * bounds a card that keeps declining rather than a buyer who is trying
 * honestly. Three is enough for a decline, a retry and a third go; past
 * that the answer is a different card, not another reference.
 */
const MAX_CHECKOUT_ROUNDS = 4;

/**
 * Waits out the window where a concurrent request has created the attempt
 * but has not finished storing where it sent the buyer.
 *
 * Bounded deliberately. The gap is one Paystack initialize, measured at
 * 200ms to 2s against the live API, and a Lambda that waits longer than
 * this is worse than one that asks the buyer to press the button again.
 */
async function waitForCheckoutUrl(
  employerId: string,
  attemptId: string,
  deps: Pick<SubscriptionDependencies, 'getPaymentAttempt'>,
): Promise<PaymentAttempt | null> {
  for (const delayMs of [250, 500, 1000]) {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    const latest = await deps.getPaymentAttempt(employerId, attemptId);
    if (latest?.checkoutUrl) return latest;
  }
  return null;
}

/**
 * Whether a plan change is a step up or down, and when it can take effect.
 *
 * Paystack has no proration and no way to move an existing subscription to
 * a different plan. What it does have is `POST /subscription/disable`
 * (which lets the current period finish) and `POST /subscription` with a
 * `start_date`, which its own documentation names as the way "to switch a
 * customer to a different plan".
 *
 * So both directions take effect on the next payment date, and neither is
 * charged twice. Making an upgrade immediate would mean charging a full
 * new period on top of one already paid for, with no mechanism to credit
 * the remainder — a worse deal, dressed up as a faster one.
 */
export function planChangeEffectiveDate(subscription: BillingSubscription): string | null {
  return subscription.nextPaymentDate ?? subscription.currentPeriodEnd;
}

/**
 * The entitlement patch that matches a subscription's current state.
 *
 * `Entitlement` is what the rest of the product reads to decide whether an
 * employer has marketplace access, and it long predates this module.
 * Rather than teaching every reader about subscriptions, the subscription
 * state is projected onto it here, in one place, every time it changes.
 */
export function entitlementPatchFor(
  subscription: BillingSubscription,
  now: Date,
): {
  plan: Entitlement['plan'];
  status: Entitlement['status'];
  subscriptionRenewsAt: string | null;
  priceNGN: number;
  foundingMember: boolean;
} {
  const access = deriveAccess(subscription, now);
  return {
    // The plan stays named even while suspended: an employer whose card
    // failed is a Scout subscriber with a problem, not a stranger, and
    // downgrading the name would lose which plan to restore them to.
    plan: subscription.plan,
    status: entitlementStatusForAccess(access),
    subscriptionRenewsAt: subscription.nextPaymentDate,
    priceNGN: subscription.priceNGN,
    foundingMember: subscription.priceTier === 'founding',
  };
}
