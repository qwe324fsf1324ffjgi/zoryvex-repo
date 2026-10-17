import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BillingSubscription, Entitlement, PaymentAttempt } from '@zoryvex/contracts';
import {
  CONTACT_UNLOCK_ALLOWANCE,
  FOUNDING_SLOTS_TOTAL,
  SUBSCRIPTION_PRICES_NGN,
} from '@zoryvex/contracts';
import {
  cancelSubscription,
  getBillingOverview,
  getCardUpdateLink,
  listPaymentHistory,
  quoteSubscription,
  startSubscriptionCheckout,
  type SubscriptionDependencies,
} from '../src/domain/subscription-service';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  PaymentProviderError,
  ValidationError,
} from '../src/errors/typed-errors';

// A real employer id is a randomUUID (services/api/src/composition/
// aws-auth-dependencies.ts), so the fixture is one too. That matters here
// more than in most tests: the reference sent to Paystack is built from it,
// and Paystack accepts only alphanumerics plus `-`, `.` and `=`.
const EMPLOYER_ID = 'aa11bb22-cc33-dd44-ee55-ff6677889900';
const NOW = new Date('2026-09-01T12:00:00.000Z');
const PLAN_CODES = {
  scout_founding_monthly: 'PLN_scoutfounding',
  scout_standard_monthly: 'PLN_scoutstandard',
  team_founding_monthly: 'PLN_teamfounding',
  team_standard_monthly: 'PLN_teamstandard',
  partner_founding_monthly: 'PLN_partnerfounding',
  partner_standard_monthly: 'PLN_partnerstandard',
};

function createDeps(overrides: Partial<SubscriptionDependencies> = {}) {
  const state = {
    placesTaken: 0,
    holder: false,
    marketplaceCandidates: 7,
    contactUnlocksUsed: 0,
    subscription: null as BillingSubscription | null,
    attempts: [] as PaymentAttempt[],
    initializeCalls: [] as Record<string, unknown>[],
    disableCalls: [] as [string, string][],
    idempotencyKeys: new Map<string, PaymentAttempt>(),
    alerts: [] as string[],
    // null means "agree with the quote", which is the healthy case.
    planAmountKobo: null as number | null,
    planCurrency: 'NGN',
  };

  let entitlement: Entitlement = {
    employerId: EMPLOYER_ID,
    plan: 'none',
    status: 'none',
    kitPurchasedAt: null,
    subscriptionRenewsAt: null,
    priceNGN: null,
    foundingMember: false,
  };

  const deps: SubscriptionDependencies = {
    clock: { now: () => NOW },
    async getFeatureFlags() {
      return {
        payments: true,
        aiMatching: false,
        publicDiscovery: false,
        contactUnlocks: false,
        verificationReminders: false,
      };
    },
    async getPlanCodeRegistry() {
      return { ...PLAN_CODES };
    },
    async getEmployerEmail() {
      return 'ops@example.test';
    },
    async getEntitlement() {
      return entitlement;
    },
    async updateEntitlement(_employerId, patch) {
      entitlement = { ...entitlement, ...patch } as Entitlement;
      return entitlement;
    },
    async countFoundingPlacesTaken() {
      return state.placesTaken;
    },
    async holdsFoundingPlace() {
      return state.holder;
    },
    async marketplaceCandidateCount() {
      return state.marketplaceCandidates;
    },
    async getBillingSubscription() {
      return state.subscription;
    },
    async countContactUnlocksThisPeriod() {
      return state.contactUnlocksUsed;
    },
    async updateBillingSubscription(_employerId, patch) {
      if (!state.subscription) return null;
      state.subscription = { ...state.subscription, ...patch } as BillingSubscription;
      return state.subscription;
    },
    async listPaymentAttempts() {
      return state.attempts;
    },
    async listBillingInvoices() {
      return [];
    },
    async createPaymentAttemptIfNotExists(attempt, idempotencyKey) {
      const existing = state.idempotencyKeys.get(idempotencyKey);
      if (existing) return { attempt: existing, created: false };
      state.idempotencyKeys.set(idempotencyKey, attempt);
      state.attempts.push(attempt);
      return { attempt, created: true };
    },
    async initializeTransaction(input) {
      state.initializeCalls.push({ ...input });
      return { authorizationUrl: 'https://checkout.paystack.com/abc123' };
    },
    async getPaymentAttempt(_employerId, attemptId) {
      return state.attempts.find((a) => a.id === attemptId) ?? null;
    },
    async setPaymentAttemptCheckoutUrl(_employerId, attemptId, checkoutUrl) {
      const found = state.attempts.find((a) => a.id === attemptId);
      if (!found) return null;
      if (found.checkoutUrl) return found;
      found.checkoutUrl = checkoutUrl;
      // The idempotency map hands back the same object on a repeat, so the
      // stored URL is what the retry path reads.
      return found;
    },
    // Agrees with the quote unless a test says otherwise. Derived from the
    // plan-code name so it tracks a price change in contracts rather than
    // pinning a number that would silently stop matching.
    async fetchPlan(planCode: string) {
      if (state.planAmountKobo !== null) {
        return { amountKobo: state.planAmountKobo, currency: state.planCurrency };
      }
      const key = Object.entries(PLAN_CODES).find(([, code]) => code === planCode)?.[0] ?? '';
      const [plan, tier] = key.split('_') as [
        keyof typeof SUBSCRIPTION_PRICES_NGN,
        'founding' | 'standard',
      ];
      return { amountKobo: SUBSCRIPTION_PRICES_NGN[plan][tier] * 100, currency: 'NGN' };
    },
    async publishAlert(message: string) {
      state.alerts.push(message);
    },
    async disableSubscription(code, token) {
      state.disableCalls.push([code, token]);
    },
    async generateManageLink() {
      return 'https://paystack.com/manage/subscriptions/abc';
    },
    appOrigin: 'https://test.zoryvex.space',
    ...overrides,
  };

  return { deps, state, entitlement: () => entitlement };
}

function activeSubscription(overrides: Partial<BillingSubscription> = {}): BillingSubscription {
  return {
    employerId: EMPLOYER_ID,
    subscriptionCode: 'SUB_abc123',
    customerCode: 'CUS_abc123',
    planCode: 'PLN_scoutfounding',
    plan: 'scout',
    interval: 'monthly',
    priceTier: 'founding',
    priceNGN: SUBSCRIPTION_PRICES_NGN.scout.founding,
    status: 'active',
    emailToken: 'tok_abc',
    nextPaymentDate: '2026-10-01T00:00:00.000Z',
    currentPeriodStart: '2026-09-01T00:00:00.000Z',
    currentPeriodEnd: '2026-10-01T00:00:00.000Z',
    graceEndsAt: null,
    lastFailureReason: null,
    card: null,
    cancelRequestedAt: null,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('quoteSubscription', () => {
  it('quotes the founding price while places remain', async () => {
    const { deps } = createDeps();
    const quote = await quoteSubscription(EMPLOYER_ID, 'scout', 'monthly', deps);
    expect(quote.amountNGN).toBe(SUBSCRIPTION_PRICES_NGN.scout.founding);
    expect(quote.priceTier).toBe('founding');
    expect(quote.foundingPlacesLeft).toBe(FOUNDING_SLOTS_TOTAL);
  });

  it('quotes the standard price once every founding place is gone', async () => {
    const { deps, state } = createDeps();
    state.placesTaken = FOUNDING_SLOTS_TOTAL;
    const quote = await quoteSubscription(EMPLOYER_ID, 'scout', 'monthly', deps);
    expect(quote.amountNGN).toBe(SUBSCRIPTION_PRICES_NGN.scout.standard);
    expect(quote.priceTier).toBe('standard');
    expect(quote.foundingPlacesLeft).toBe(0);
  });

  /**
   * A founding member's own place is counted against the cap, so quoting
   * them the standard price once the cap is reached would spend a place
   * and lose the member sitting in it.
   */
  it('keeps quoting the founding price to an existing founding member', async () => {
    const { deps, state } = createDeps();
    state.placesTaken = FOUNDING_SLOTS_TOTAL;
    state.holder = true;
    const quote = await quoteSubscription(EMPLOYER_ID, 'scout', 'monthly', deps);
    expect(quote.amountNGN).toBe(SUBSCRIPTION_PRICES_NGN.scout.founding);
  });

  it('reports a plan as unavailable when no Paystack plan has been created for it', async () => {
    const { deps } = createDeps({ getPlanCodeRegistry: async () => ({}) });
    const quote = await quoteSubscription(EMPLOYER_ID, 'team', 'monthly', deps);
    expect(quote.planCode).toBeNull();
  });
});

describe('startSubscriptionCheckout', () => {
  it('sends the plan code, so Paystack creates a subscription rather than one charge', async () => {
    const { deps, state } = createDeps();
    const result = await startSubscriptionCheckout(EMPLOYER_ID, 'scout', 'monthly', 'key-1', deps);

    expect(result.authorizationUrl).toBe('https://checkout.paystack.com/abc123');
    expect(state.initializeCalls[0]).toMatchObject({
      planCode: 'PLN_scoutfounding',
      amountKobo: SUBSCRIPTION_PRICES_NGN.scout.founding * 100,
      email: 'ops@example.test',
    });
  });

  it('checks the plan price first, then writes the attempt, then calls Paystack', async () => {
    const order: string[] = [];
    const base = createDeps();
    const deps: SubscriptionDependencies = {
      ...base.deps,
      async createPaymentAttemptIfNotExists(attempt) {
        order.push('attempt');
        return { attempt, created: true };
      },
      async initializeTransaction() {
        order.push('paystack');
        return { authorizationUrl: 'https://checkout.paystack.com/abc123' };
      },
      async fetchPlan() {
        order.push('plan-price-check');
        return { amountKobo: SUBSCRIPTION_PRICES_NGN.scout.founding * 100, currency: 'NGN' };
      },
    };

    await startSubscriptionCheckout(EMPLOYER_ID, 'scout', 'monthly', 'key-1', deps);
    // The price check comes first so a mispriced plan never leaves a payment
    // attempt row behind for a sale that was refused. The attempt still
    // precedes Paystack, which is what makes an abandoned checkout visible.
    expect(order).toEqual(['plan-price-check', 'attempt', 'paystack']);
  });

  it('starts the attempt as initialized, never as paid', async () => {
    const { deps, state } = createDeps();
    await startSubscriptionCheckout(EMPLOYER_ID, 'scout', 'monthly', 'key-1', deps);
    expect(state.attempts[0]?.status).toBe('initialized');
  });

  /** A double click, a refresh, or a client retry must produce one checkout. */
  it('returns the same attempt for a repeated idempotency key', async () => {
    const { deps, state } = createDeps();
    const first = await startSubscriptionCheckout(EMPLOYER_ID, 'scout', 'monthly', 'key-1', deps);
    const second = await startSubscriptionCheckout(EMPLOYER_ID, 'scout', 'monthly', 'key-1', deps);

    expect(second.created).toBe(false);
    expect(second.attempt.id).toBe(first.attempt.id);
    expect(state.attempts).toHaveLength(1);
  });

  /**
   * This replaces a test that asserted the opposite, and the reason is a
   * measurement rather than a preference.
   *
   * It read "re-initializes the same reference on a retry rather than
   * minting a new one" and expected two calls to Paystack, matching a
   * comment beside the code claiming a retry was safe because Paystack
   * would return a fresh authorization URL for the same reference.
   * Paystack does not. `POST /transaction/initialize` answers "Duplicate
   * Transaction Reference" on the second call — observed against the real
   * API with a real test key, twice, on both the Kit and subscription
   * routes.
   *
   * So the old test passed against a fake that was wrong about the
   * provider, and the behaviour it pinned produced a 502 for any buyer who
   * retried. The fake now refuses a second initialize the way Paystack
   * does, and the assertion is that we never make one.
   */
  it('resumes the checkout on a retry instead of asking Paystack for a second one', async () => {
    const { deps, state } = createDeps();
    const first = await startSubscriptionCheckout(EMPLOYER_ID, 'scout', 'monthly', 'key-1', deps);
    const second = await startSubscriptionCheckout(EMPLOYER_ID, 'scout', 'monthly', 'key-1', deps);

    expect(state.initializeCalls).toHaveLength(1);
    expect(second.authorizationUrl).toBe(first.authorizationUrl);
    expect(second.created).toBe(false);
  });

  /**
   * The double click, as it actually happens: both requests in flight at
   * once rather than one after the other.
   *
   * Measured against the deployed API before this was fixed — two
   * simultaneous requests with one idempotency key returned one 200 and
   * one 502. The loser saw `created: false` but no stored checkout URL,
   * because the winner was still talking to Paystack, so it initialized
   * the same reference and Paystack refused it.
   *
   * The loser must never reach the provider. Here it waits for the
   * winner and returns the same URL.
   */
  it('two concurrent requests with one key open one checkout', async () => {
    const { deps, state } = createDeps();
    const [first, second] = await Promise.all([
      startSubscriptionCheckout(EMPLOYER_ID, 'scout', 'monthly', 'key-1', deps),
      startSubscriptionCheckout(EMPLOYER_ID, 'scout', 'monthly', 'key-1', deps),
    ]);

    expect(state.initializeCalls).toHaveLength(1);
    expect(state.attempts).toHaveLength(1);
    expect(first.authorizationUrl).toBe(second.authorizationUrl);
    expect(first.attempt.reference).toBe(second.attempt.reference);
  });

  it('tells the buyer to wait rather than showing a provider error', async () => {
    // The winner never stores a URL, so the loser's wait times out. That
    // must read as "try again in a moment", not as a payment failure.
    const { deps } = createDeps({
      setPaymentAttemptCheckoutUrl: async () => null,
      getPaymentAttempt: async () => null,
    });

    await startSubscriptionCheckout(EMPLOYER_ID, 'scout', 'monthly', 'key-1', deps);
    await expect(
      startSubscriptionCheckout(EMPLOYER_ID, 'scout', 'monthly', 'key-1', deps),
    ).rejects.toThrow(/still opening[\s\S]*Nothing has been charged/);
  });

  /**
   * The defect the previous fix introduced, and the reason it matters
   * more than the one it replaced.
   *
   * Paystack pins an outcome to a reference: one that declined stays
   * declined. Measured against the live test API — a single reference,
   * three attempts, all "Insufficient Funds", with Success deliberately
   * chosen on the last two. So returning the stored checkout URL to
   * somebody whose card was declined sends them back to a checkout that
   * can only decline again, forever. A duplicate attempt costs a row;
   * this costs the sale and the customer.
   */
  it('opens a fresh checkout after the previous one declined', async () => {
    const { deps, state } = createDeps();
    const first = await startSubscriptionCheckout(EMPLOYER_ID, 'scout', 'monthly', 'key-1', deps);

    // The card is declined. Paystack sends no webhook for this; it is
    // reconciliation or the callback that settles it.
    const attempt = state.attempts.find((a) => a.id === first.attempt.id);
    if (attempt) attempt.status = 'failed';

    const second = await startSubscriptionCheckout(EMPLOYER_ID, 'scout', 'monthly', 'key-1', deps);

    expect(second.created).toBe(true);
    expect(second.attempt.reference).not.toBe(first.attempt.reference);
    expect(state.initializeCalls).toHaveLength(2);
  });

  it('does the same for an abandoned checkout', async () => {
    const { deps, state } = createDeps();
    const first = await startSubscriptionCheckout(EMPLOYER_ID, 'scout', 'monthly', 'key-1', deps);
    const attempt = state.attempts.find((a) => a.id === first.attempt.id);
    if (attempt) attempt.status = 'abandoned';

    const second = await startSubscriptionCheckout(EMPLOYER_ID, 'scout', 'monthly', 'key-1', deps);
    expect(second.attempt.reference).not.toBe(first.attempt.reference);
  });

  /**
   * The other half, and the one that must never bend: a paid attempt is
   * not a dead one. Minting a fresh reference for somebody who has
   * already paid is how a customer is charged twice.
   */
  it('never opens a second checkout after one has succeeded', async () => {
    const { deps, state } = createDeps();
    const first = await startSubscriptionCheckout(EMPLOYER_ID, 'scout', 'monthly', 'key-1', deps);
    const attempt = state.attempts.find((a) => a.id === first.attempt.id);
    if (attempt) {
      attempt.status = 'success';
      attempt.checkoutUrl = 'https://checkout.paystack.com/abc123';
    }

    const second = await startSubscriptionCheckout(EMPLOYER_ID, 'scout', 'monthly', 'key-1', deps);

    expect(second.created).toBe(false);
    expect(second.attempt.reference).toBe(first.attempt.reference);
    expect(state.initializeCalls).toHaveLength(1);
    expect(state.attempts).toHaveLength(1);
  });

  it('stops opening checkouts for a card that simply keeps declining', async () => {
    const { deps, state } = createDeps();
    for (let i = 0; i < 8; i += 1) {
      await startSubscriptionCheckout(EMPLOYER_ID, 'scout', 'monthly', 'key-1', deps).catch(
        () => undefined,
      );
      for (const a of state.attempts) a.status = 'failed';
    }
    // Bounded: a declining card cannot open references without limit.
    expect(state.attempts.length).toBeLessThanOrEqual(4);
  });

  it('refuses a second initialize the way Paystack does, and still resumes', async () => {
    const seen = new Set<string>();
    const { deps } = createDeps({
      async initializeTransaction(input: { reference: string }) {
        if (seen.has(input.reference)) {
          throw new Error(
            'Paystack POST /transaction/initialize failed: Duplicate Transaction Reference',
          );
        }
        seen.add(input.reference);
        return { authorizationUrl: 'https://checkout.paystack.com/abc123' };
      },
    });

    const first = await startSubscriptionCheckout(EMPLOYER_ID, 'scout', 'monthly', 'key-1', deps);
    // Would throw if the retry path called Paystack again.
    const second = await startSubscriptionCheckout(EMPLOYER_ID, 'scout', 'monthly', 'key-1', deps);
    expect(second.authorizationUrl).toBe(first.authorizationUrl);
  });

  it('refuses while the payments kill switch is off, and charges nothing', async () => {
    const { deps, state } = createDeps({
      getFeatureFlags: async () => ({
        payments: false,
        aiMatching: false,
        publicDiscovery: false,
        contactUnlocks: false,
        verificationReminders: false,
      }),
    });

    await expect(
      startSubscriptionCheckout(EMPLOYER_ID, 'scout', 'monthly', 'key-1', deps),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(state.initializeCalls).toEqual([]);
    expect(state.attempts).toEqual([]);
  });

  it('refuses an interval that is not on sale', async () => {
    const { deps, state } = createDeps();
    await expect(
      startSubscriptionCheckout(EMPLOYER_ID, 'scout', 'annually', 'key-1', deps),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(state.initializeCalls).toEqual([]);
  });

  /**
   * docs/PRODUCT_SPEC.md: "Monthly marketplace checkout stays disabled
   * until the saved role has at least five real, current, discovery-opted
   * matching profiles. This is a hard gate, not a soft nudge." Nothing
   * implemented it: the gate existed only on the unlock, so an
   * organization could be sold a subscription and then find every role it
   * owned was below the threshold and no unlock could be spent anywhere.
   * Selling access somebody cannot use is worse than refusing the sale.
   */
  /**
   * The founder lowered the floor from five matches to one on 2026-09-02,
   * with the honesty requirement moved rather than dropped. A thin
   * marketplace is a legitimate thing to sell to somebody who knows it is
   * thin; the count on the quote is what makes it knowable, so these two
   * tests are a pair and neither means much alone.
   */
  it('sells to an organization whose best role matches a single candidate', async () => {
    const { deps, state } = createDeps();
    state.marketplaceCandidates = 1;

    const result = await startSubscriptionCheckout(
      EMPLOYER_ID,
      'scout',
      'monthly',
      'key-thin-marketplace',
      deps,
    );

    expect(result.authorizationUrl).toBeTruthy();
    expect(state.initializeCalls.length).toBe(1);
  });

  it('puts the real candidate count on the quote, so the buyer sees how thin it is', async () => {
    const { deps, state } = createDeps();
    state.marketplaceCandidates = 1;

    const quote = await quoteSubscription(EMPLOYER_ID, 'scout', 'monthly', deps);

    expect(quote.marketplaceCandidates).toBe(1);
  });

  it('never overstates the marketplace on the quote', async () => {
    // The number shown must be the number the gate used. A quote that
    // rounded up, defaulted, or reported a stale value would be the
    // misrepresentation this whole design exists to avoid.
    for (const count of [1, 3, 9]) {
      const { deps, state } = createDeps();
      state.marketplaceCandidates = count;
      const quote = await quoteSubscription(EMPLOYER_ID, 'scout', 'monthly', deps);
      expect(quote.marketplaceCandidates).toBe(count);
    }
  });

  it('refuses to sell marketplace access to an organization that cannot use it', async () => {
    const { deps, state } = createDeps();
    state.marketplaceCandidates = 0;

    await expect(
      startSubscriptionCheckout(EMPLOYER_ID, 'scout', 'monthly', 'key-1', deps),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(state.initializeCalls).toEqual([]);
    expect(state.attempts).toEqual([]);
  });

  it('says what would open the gate, rather than only that it is shut', async () => {
    const { deps, state } = createDeps();
    state.marketplaceCandidates = 0;
    await expect(
      startSubscriptionCheckout(EMPLOYER_ID, 'scout', 'monthly', 'key-1', deps),
    ).rejects.toThrow(/Recompute matches/);
  });

  it('checks eligibility before contacting Paystack at all', async () => {
    const { deps, state } = createDeps();
    state.marketplaceCandidates = 0;
    await expect(
      startSubscriptionCheckout(EMPLOYER_ID, 'scout', 'monthly', 'key-1', deps),
    ).rejects.toThrow(/Nothing has been charged/);
  });

  it('refuses a plan with no Paystack plan behind it rather than taking a one-off payment', async () => {
    const { deps, state } = createDeps({ getPlanCodeRegistry: async () => ({}) });
    await expect(
      startSubscriptionCheckout(EMPLOYER_ID, 'scout', 'monthly', 'key-1', deps),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(state.initializeCalls).toEqual([]);
  });

  it.each(['active', 'attention'] as const)(
    'refuses a second checkout while a %s subscription exists',
    async (status) => {
      const { deps, state } = createDeps();
      state.subscription = activeSubscription({ status });
      await expect(
        startSubscriptionCheckout(EMPLOYER_ID, 'team', 'monthly', 'key-1', deps),
      ).rejects.toBeInstanceOf(ConflictError);
    },
  );

  it('allows resubscribing after a cancellation has completed', async () => {
    const { deps, state } = createDeps();
    state.subscription = activeSubscription({ status: 'cancelled' });
    await expect(
      startSubscriptionCheckout(EMPLOYER_ID, 'scout', 'monthly', 'key-1', deps),
    ).resolves.toBeDefined();
  });

  /**
   * Paystack rejects a reference containing anything outside alphanumerics
   * and `-`, `.`, `=`, at initialize time. Without this the failure would
   * be an employer who pressed Subscribe and got a 502 from a provider
   * error.
   */
  it('refuses an organization id that cannot be a Paystack reference', async () => {
    const { deps, state } = createDeps();
    await expect(
      startSubscriptionCheckout('emp/with/slashes', 'scout', 'monthly', 'key-1', deps),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(state.initializeCalls).toEqual([]);
  });

  it('puts nothing private in the Paystack metadata', async () => {
    const { deps, state } = createDeps();
    await startSubscriptionCheckout(EMPLOYER_ID, 'scout', 'monthly', 'key-1', deps);
    const metadata = state.initializeCalls[0]?.metadata as Record<string, string>;
    // Metadata is visible on Paystack's dashboard and echoed back through
    // webhooks, so it may only carry values already in the reference.
    expect(Object.keys(metadata).sort()).toEqual(['employerId', 'purpose']);
  });
});

describe('getBillingOverview', () => {
  /**
   * The allowance numbers are served rather than derived in the browser
   * because the browser cannot derive them: the count lives in a
   * period-keyed ledger only the server reads. The employer's role page
   * tried anyway, from the local demo store, so every real subscriber saw
   * "0 / 0 contact unlocks used this period" on the page they pay for,
   * whatever their plan and however many they had spent.
   */
  it('reports the allowance the current plan includes', async () => {
    const { deps, state } = createDeps();
    state.subscription = activeSubscription({ plan: 'team' });

    const overview = await getBillingOverview(EMPLOYER_ID, deps);
    expect(overview.contactUnlockAllowance).toBe(CONTACT_UNLOCK_ALLOWANCE.team);
  });

  it('reports how many of them this month has spent', async () => {
    const { deps, state } = createDeps();
    state.subscription = activeSubscription({ plan: 'scout' });
    state.contactUnlocksUsed = 3;

    const overview = await getBillingOverview(EMPLOYER_ID, deps);
    expect(overview).toMatchObject({
      contactUnlockAllowance: CONTACT_UNLOCK_ALLOWANCE.scout,
      contactUnlocksUsedThisPeriod: 3,
    });
  });

  it('reports a zero allowance for an organization with no subscription', async () => {
    const { deps } = createDeps();
    const overview = await getBillingOverview(EMPLOYER_ID, deps);

    // Zero is the true answer here, and the page reads it as "you need a
    // subscription" rather than printing it as a used-count.
    expect(overview.contactUnlockAllowance).toBe(0);
    expect(overview.contactUnlocksUsedThisPeriod).toBe(0);
  });

  it('reports no plan and no access for an employer who never subscribed', async () => {
    const { deps } = createDeps();
    const overview = await getBillingOverview(EMPLOYER_ID, deps);
    expect(overview).toMatchObject({ plan: null, access: 'none', foundingMember: false });
  });

  it('reports the price actually held, not the current list price', async () => {
    const { deps, state } = createDeps();
    state.subscription = activeSubscription({ priceNGN: 79_000, priceTier: 'founding' });
    state.placesTaken = FOUNDING_SLOTS_TOTAL;

    const overview = await getBillingOverview(EMPLOYER_ID, deps);
    expect(overview.priceNGN).toBe(79_000);
    expect(overview.foundingMember).toBe(true);
  });

  it('shows grace rather than active while a failed renewal is unresolved', async () => {
    const { deps, state } = createDeps();
    state.subscription = activeSubscription({
      status: 'attention',
      graceEndsAt: '2026-09-05T00:00:00.000Z',
      lastFailureReason: 'Insufficient Funds',
    });

    const overview = await getBillingOverview(EMPLOYER_ID, deps);
    expect(overview.access).toBe('grace');
    expect(overview.lastFailureReason).toBe('Insufficient Funds');
  });
});

describe('listPaymentHistory', () => {
  function attempt(overrides: Partial<PaymentAttempt>): PaymentAttempt {
    return {
      id: 'a1',
      employerId: EMPLOYER_ID,
      purpose: 'subscription',
      reference: `sub.${EMPLOYER_ID}.a1`,
      checkoutUrl: null,
      paystackTransactionId: null,
      amountNGN: 79_000,
      currency: 'NGN',
      status: 'success',
      paystackStatus: 'success',
      channel: 'card',
      gatewayResponse: 'Successful',
      failureReason: null,
      planCode: null,
      plan: 'scout',
      interval: 'monthly',
      priceTier: 'founding',
      roleId: null,
      subscriptionCode: null,
      customerCode: null,
      correlationId: 'corr',
      verifiedAt: null,
      reconcileAttempts: 0,
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z',
      ...overrides,
    };
  }

  it('hides a checkout that was only ever opened', async () => {
    const { deps, state } = createDeps();
    state.attempts = [attempt({ id: 'a1', status: 'initialized' })];
    expect(await listPaymentHistory(EMPLOYER_ID, deps)).toEqual([]);
  });

  it('shows failed and abandoned payments, because they are what the employer asks about', async () => {
    const { deps, state } = createDeps();
    state.attempts = [
      attempt({ id: 'a1', status: 'failed' }),
      attempt({ id: 'a2', status: 'abandoned' }),
    ];
    expect(await listPaymentHistory(EMPLOYER_ID, deps)).toHaveLength(2);
  });

  /**
   * The gateway response can name the issuing bank and occasionally the
   * last four digits of a card. It belongs in the founder's diagnostic
   * view, not in a list served to whoever holds the session.
   */
  it('never returns gateway strings or Paystack identifiers', async () => {
    const { deps, state } = createDeps();
    state.attempts = [attempt({ paystackTransactionId: '4099260516' })];
    const [entry] = await listPaymentHistory(EMPLOYER_ID, deps);

    expect(Object.keys(entry ?? {}).sort()).toEqual([
      'amountNGN',
      'createdAt',
      'id',
      'purpose',
      'status',
    ]);
  });
});

describe('cancelSubscription', () => {
  let fixture: ReturnType<typeof createDeps>;

  beforeEach(() => {
    fixture = createDeps();
    fixture.state.subscription = activeSubscription();
  });

  it('calls Paystack with the code and the email token', async () => {
    await cancelSubscription(EMPLOYER_ID, fixture.deps);
    expect(fixture.state.disableCalls).toEqual([['SUB_abc123', 'tok_abc']]);
  });

  it('records non-renewing, not cancelled: the paid period is still served', async () => {
    const result = await cancelSubscription(EMPLOYER_ID, fixture.deps);
    expect(result.status).toBe('non-renewing');
    expect(result.cancelRequestedAt).toBe(NOW.toISOString());
  });

  /**
   * The ordering guarantee. If the local record moved first and Paystack
   * then refused, the employer would read "cancelled" while the charges
   * carried on, which is the single worst way for the two to disagree.
   */
  it('leaves the local record untouched when Paystack refuses', async () => {
    const deps: SubscriptionDependencies = {
      ...fixture.deps,
      disableSubscription: vi.fn().mockRejectedValue(new Error('paystack down')),
    };

    await expect(cancelSubscription(EMPLOYER_ID, deps)).rejects.toThrow('paystack down');
    expect(fixture.state.subscription?.status).toBe('active');
    expect(fixture.state.subscription?.cancelRequestedAt).toBeNull();
  });

  it('is a no-op for a subscription that has already ended', async () => {
    fixture.state.subscription = activeSubscription({ status: 'cancelled' });
    await cancelSubscription(EMPLOYER_ID, fixture.deps);
    expect(fixture.state.disableCalls).toEqual([]);
  });

  it('refuses when there is nothing to cancel', async () => {
    fixture.state.subscription = null;
    await expect(cancelSubscription(EMPLOYER_ID, fixture.deps)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});

describe('getCardUpdateLink', () => {
  it('returns a Paystack-hosted link, so no card detail ever reaches this service', async () => {
    const { deps, state } = createDeps();
    state.subscription = activeSubscription();
    const link = await getCardUpdateLink(EMPLOYER_ID, deps);
    expect(link).toContain('paystack.com/manage/subscriptions');
  });

  it('refuses when there is no subscription to update', async () => {
    const { deps } = createDeps();
    await expect(getCardUpdateLink(EMPLOYER_ID, deps)).rejects.toBeInstanceOf(NotFoundError);
  });
});

/**
 * The gap between the price on the page and the price on the card.
 *
 * Attaching a `plan` to `/transaction/initialize` makes Paystack ignore the
 * `amount` in the same request and charge the plan's own price. Confirmed
 * against the live TEST API on 2026-09-10: `amount: 100` plus the Scout plan
 * produced a transaction for 80,000,000 kobo.
 *
 * So the quote comes from packages/contracts and the debit comes from a
 * Paystack Plan, and the two can drift. The webhook already refuses to grant
 * access on a mismatch, but only after the card has been charged. These tests
 * pin the earlier refusal: no checkout at all.
 */
describe('a plan whose Paystack price disagrees with the quote', () => {
  it('refuses the checkout instead of charging the wrong amount', async () => {
    const { deps, state } = createDeps();
    state.planAmountKobo = SUBSCRIPTION_PRICES_NGN.scout.founding * 100 + 5000;

    await expect(
      startSubscriptionCheckout(EMPLOYER_ID, 'scout', 'monthly', 'key-1', deps),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('opens no checkout and records no payment attempt', async () => {
    const { deps, state } = createDeps();
    state.planAmountKobo = 1;

    await expect(
      startSubscriptionCheckout(EMPLOYER_ID, 'scout', 'monthly', 'key-1', deps),
    ).rejects.toThrow();

    expect(state.initializeCalls).toEqual([]);
    expect(state.attempts).toEqual([]);
  });

  it('tells a person, with both numbers in the message', async () => {
    const { deps, state } = createDeps();
    state.planAmountKobo = 12_345;

    await expect(
      startSubscriptionCheckout(EMPLOYER_ID, 'scout', 'monthly', 'key-1', deps),
    ).rejects.toThrow();

    expect(state.alerts).toHaveLength(1);
    expect(state.alerts[0]).toContain('12345');
    expect(state.alerts[0]).toContain(String(SUBSCRIPTION_PRICES_NGN.scout.founding * 100));
  });

  it('refuses a plan priced in another currency, even at the right number', async () => {
    const { deps, state } = createDeps();
    state.planAmountKobo = SUBSCRIPTION_PRICES_NGN.scout.founding * 100;
    state.planCurrency = 'GHS';

    await expect(
      startSubscriptionCheckout(EMPLOYER_ID, 'scout', 'monthly', 'key-1', deps),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(state.initializeCalls).toEqual([]);
  });

  /**
   * Fails closed. A price we could not confirm is not a price to charge, and
   * the buyer is told nothing was taken.
   */
  it('refuses when Paystack cannot be reached to confirm the price', async () => {
    const base = createDeps();
    const deps: SubscriptionDependencies = {
      ...base.deps,
      async fetchPlan() {
        throw new Error('paystack unreachable');
      },
    };

    await expect(
      startSubscriptionCheckout(EMPLOYER_ID, 'scout', 'monthly', 'key-1', deps),
    ).rejects.toBeInstanceOf(PaymentProviderError);
    expect(base.state.initializeCalls).toEqual([]);
  });

  it('lets a correctly priced plan through untouched', async () => {
    const { deps, state } = createDeps();

    await startSubscriptionCheckout(EMPLOYER_ID, 'scout', 'monthly', 'key-1', deps);

    expect(state.initializeCalls).toHaveLength(1);
    expect(state.alerts).toEqual([]);
  });
});
