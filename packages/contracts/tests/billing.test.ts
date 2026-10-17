import { describe, expect, it } from 'vitest';
import {
  allPlanKeys,
  assertOfferedInterval,
  BILLING_INTERVALS,
  BillingSubscriptionSchema,
  isOfferedInterval,
  isTerminalPayment,
  OFFERED_BILLING_INTERVALS,
  PAYMENT_STATUSES,
  PaymentAttemptSchema,
  paymentStatusFromPaystack,
  PlanCodeRegistrySchema,
  PlanCodeSchema,
  planKey,
  SUBSCRIPTION_PLANS,
  SUBSCRIPTION_PRICES_NGN,
  SUBSCRIPTION_STATUSES,
  subscriptionStatusFromPaystack,
} from '../src/index';

describe('billing intervals', () => {
  /**
   * CLAUDE.md's fixed-product section says monthly, no annual plans, and
   * no annual amount has ever been founder-approved. The interval is
   * modelled anyway so it is not a retrofit later, but nothing may offer
   * it until there is a price.
   */
  it('models both intervals but offers only monthly', () => {
    expect(BILLING_INTERVALS).toEqual(['monthly', 'annually']);
    expect(OFFERED_BILLING_INTERVALS).toEqual(['monthly']);
    expect(isOfferedInterval('annually')).toBe(false);
  });

  it('refuses to sell an interval nobody has priced, and says why', () => {
    expect(() => assertOfferedInterval('annually')).toThrow(/not currently offered/);
    expect(() => assertOfferedInterval('annually')).toThrow(/no other amount has been/);
    expect(() => assertOfferedInterval('monthly')).not.toThrow();
  });

  it('keeps the founder-fixed monthly prices exactly as they are', () => {
    // Pinned here as well as in domain.test.ts, because this file is what a
    // reader lands on when asking what an interval costs.
    expect(SUBSCRIPTION_PRICES_NGN.scout.founding).toBe(800_000);
    expect(SUBSCRIPTION_PRICES_NGN.scout.standard).toBe(1_200_000);
  });
});

describe('plan keys', () => {
  /**
   * Paystack Plans carry one amount and one interval each, so founding and
   * standard are different Plan objects rather than one Plan priced two
   * ways. That is also what keeps the founding promise honest: a founding
   * subscriber stays attached to a Plan whose amount cannot move when the
   * standard price is raised.
   */
  it('needs one plan per tier, price tier and interval', () => {
    const keys = allPlanKeys();
    expect(keys).toHaveLength(SUBSCRIPTION_PLANS.length * 2 * BILLING_INTERVALS.length);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('needs only six while annual billing is not offered', () => {
    expect(allPlanKeys(OFFERED_BILLING_INTERVALS)).toEqual([
      'scout_founding_monthly',
      'scout_standard_monthly',
      'team_founding_monthly',
      'team_standard_monthly',
      'partner_founding_monthly',
      'partner_standard_monthly',
    ]);
  });

  it('builds a key the registry can be read with', () => {
    expect(planKey('team', 'standard', 'monthly')).toBe('team_standard_monthly');
  });
});

describe('PlanCodeSchema', () => {
  it('accepts a real Paystack plan code', () => {
    expect(PlanCodeSchema.safeParse('PLN_gx2wn530m0i3w3m').success).toBe(true);
  });

  it.each(['SUB_abc123', 'gx2wn530m0i3w3m', 'PLN_', 'PLN_has-a-dash', ''])(
    'rejects %j',
    (value) => {
      expect(PlanCodeSchema.safeParse(value).success).toBe(false);
    },
  );

  it('rejects a whole registry if any one code is malformed', () => {
    const result = PlanCodeRegistrySchema.safeParse({
      scout_founding_monthly: 'PLN_ok',
      team_founding_monthly: 'not-a-plan-code',
    });
    // Failing whole rather than partially is deliberate: a half-loaded
    // registry would let some plans be bought and silently refuse others.
    expect(result.success).toBe(false);
  });
});

describe('paymentStatusFromPaystack', () => {
  it.each([
    'abandoned',
    'failed',
    'ongoing',
    'pending',
    'processing',
    'queued',
    'reversed',
    'success',
  ])('maps Paystack status %j', (status) => {
    expect(paymentStatusFromPaystack(status)).toBe(status);
  });

  it('tolerates casing and surrounding whitespace', () => {
    expect(paymentStatusFromPaystack('  Success ')).toBe('success');
  });

  /**
   * Returning null rather than a default is the whole point. The only two
   * available guesses for an unrecognized status are "revoke paid access"
   * and "grant paid access", and both are wrong more often than a report.
   */
  it('refuses a status it has not read about, rather than guessing', () => {
    expect(paymentStatusFromPaystack('held_for_review')).toBeNull();
    expect(paymentStatusFromPaystack('')).toBeNull();
  });

  it('will not accept our own internal status from a Paystack payload', () => {
    // `initialized` exists only on this side. Accepting it from a payload
    // would let a caller move a transaction backwards.
    expect(PAYMENT_STATUSES).toContain('initialized');
    expect(paymentStatusFromPaystack('initialized')).toBeNull();
  });
});

describe('isTerminalPayment', () => {
  it('treats a reversal as terminal but never as a success', () => {
    expect(isTerminalPayment('reversed')).toBe(true);
    expect(isTerminalPayment('success')).toBe(true);
    expect(isTerminalPayment('pending')).toBe(false);
    expect(isTerminalPayment('initialized')).toBe(false);
  });
});

describe('subscriptionStatusFromPaystack', () => {
  it.each(SUBSCRIPTION_STATUSES)('maps %j', (status) => {
    expect(subscriptionStatusFromPaystack(status)).toBe(status);
  });

  it('keeps the hyphen in non-renewing, because Paystack does', () => {
    expect(subscriptionStatusFromPaystack('non-renewing')).toBe('non-renewing');
  });

  /**
   * Paystack's statuses table says `completed`; the `subscription.disable`
   * payload says `complete` when all billing cycles have run. Both are
   * real, and both mean ended.
   */
  it('accepts the disable payload spelling of completed', () => {
    expect(subscriptionStatusFromPaystack('complete')).toBe('completed');
  });

  it('refuses an unknown status', () => {
    expect(subscriptionStatusFromPaystack('paused')).toBeNull();
  });
});

describe('PaymentAttemptSchema', () => {
  const base = {
    id: 'a1',
    employerId: 'emp_1',
    purpose: 'subscription',
    reference: 'sub.emp_1.a1',
    amountNGN: 79_000,
    currency: 'NGN',
    status: 'initialized',
    correlationId: 'corr',
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
  };

  it('fills the optional Paystack fields with nulls rather than leaving them absent', () => {
    const parsed = PaymentAttemptSchema.parse(base);
    expect(parsed.paystackTransactionId).toBeNull();
    expect(parsed.gatewayResponse).toBeNull();
    expect(parsed.reconcileAttempts).toBe(0);
  });

  it('refuses a currency this product does not charge in', () => {
    expect(PaymentAttemptSchema.safeParse({ ...base, currency: 'USD' }).success).toBe(false);
  });

  it('refuses a zero or negative amount', () => {
    expect(PaymentAttemptSchema.safeParse({ ...base, amountNGN: 0 }).success).toBe(false);
    expect(PaymentAttemptSchema.safeParse({ ...base, amountNGN: -1 }).success).toBe(false);
  });
});

describe('BillingSubscriptionSchema', () => {
  const base = {
    employerId: 'emp_1',
    subscriptionCode: 'SUB_abc123',
    customerCode: 'CUS_abc123',
    planCode: 'PLN_abc123',
    plan: 'scout',
    interval: 'monthly',
    priceTier: 'founding',
    priceNGN: 79_000,
    status: 'active',
    emailToken: 'tok',
    nextPaymentDate: null,
    currentPeriodStart: null,
    currentPeriodEnd: null,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
  };

  it('accepts a subscription with no dates yet', () => {
    expect(BillingSubscriptionSchema.safeParse(base).success).toBe(true);
  });

  it('rejects a code from the wrong Paystack namespace', () => {
    expect(
      BillingSubscriptionSchema.safeParse({ ...base, subscriptionCode: 'CUS_abc123' }).success,
    ).toBe(false);
  });
});
