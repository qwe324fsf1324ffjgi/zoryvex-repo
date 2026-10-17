import { describe, expect, it } from 'vitest';
import { expectedPlanKeys, reconcilePlanPrices } from './plan-price-reconciliation.mjs';

const prices = {
  scout: { founding: 300_000, standard: 500_000 },
  team: { founding: 800_000, standard: 1_400_000 },
  partner: { founding: 1_800_000, standard: 4_000_000 },
};

const codes = {
  scout_founding_monthly: 'PLN_sf',
  scout_standard_monthly: 'PLN_ss',
  team_founding_monthly: 'PLN_tf',
  team_standard_monthly: 'PLN_ts',
  partner_founding_monthly: 'PLN_pf',
  partner_standard_monthly: 'PLN_ps',
};

const live = {
  PLN_sf: 300_000,
  PLN_ss: 500_000,
  PLN_tf: 800_000,
  PLN_ts: 1_400_000,
  PLN_pf: 1_800_000,
  PLN_ps: 4_000_000,
};

describe('expectedPlanKeys', () => {
  it('covers every tier at both price tiers', () => {
    expect(expectedPlanKeys()).toHaveLength(6);
    expect(expectedPlanKeys()).toContain('partner_standard_monthly');
  });
});

describe('reconcilePlanPrices', () => {
  it('reports nothing when all three sources agree', () => {
    expect(reconcilePlanPrices({ prices, planCodes: codes, liveAmountsByCode: live })).toEqual([]);
  });

  /**
   * The exact situation this exists for, and the reason it is worth a gate
   * rather than a habit: nothing throws. The app shows the old price, the
   * attempt record stores the old price, and Paystack bills the new one.
   * It is only visible by comparing three places at once.
   */
  it('catches a plan billing more than the app advertises', () => {
    const stale = { ...live, PLN_sf: 600_000 };
    const problems = reconcilePlanPrices({
      prices,
      planCodes: codes,
      liveAmountsByCode: stale,
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('scout_founding_monthly');
    expect(problems[0]).toContain('300,000');
    expect(problems[0]).toContain('600,000');
    expect(problems[0]).toContain('more than they agreed to');
  });

  it('says which direction the error runs, because they are not equally bad', () => {
    const cheap = { ...live, PLN_ps: 2_000_000 };
    const [problem] = reconcilePlanPrices({
      prices,
      planCodes: codes,
      liveAmountsByCode: cheap,
    });
    expect(problem).toContain('less than they agreed to');
  });

  it('catches a plan code that does not exist in Paystack', () => {
    const missing = { ...codes, team_founding_monthly: 'PLN_deleted' };
    const [problem] = reconcilePlanPrices({
      prices,
      planCodes: missing,
      liveAmountsByCode: live,
    });
    expect(problem).toContain('does not exist in Paystack');
  });

  it('catches a tier with no plan code at all', () => {
    const partial = { ...codes };
    delete partial.partner_standard_monthly;
    const [problem] = reconcilePlanPrices({
      prices,
      planCodes: partial,
      liveAmountsByCode: live,
    });
    expect(problem).toContain('no plan code configured');
  });

  it('names a configured key the product does not sell', () => {
    const extra = { ...codes, scout_founding_yearly: 'PLN_year' };
    const problems = reconcilePlanPrices({
      prices,
      planCodes: extra,
      liveAmountsByCode: live,
    });
    expect(problems.some((p) => p.includes('is not a plan this product sells'))).toBe(true);
  });

  it('reports every disagreement rather than stopping at the first', () => {
    const broken = { ...live, PLN_sf: 1, PLN_ts: 2 };
    expect(
      reconcilePlanPrices({ prices, planCodes: codes, liveAmountsByCode: broken }),
    ).toHaveLength(2);
  });

  it('treats a completely empty parameter as six problems, not as agreement', () => {
    // An unset parameter must never read as "nothing to compare, so fine".
    expect(reconcilePlanPrices({ prices, planCodes: {}, liveAmountsByCode: live })).toHaveLength(6);
  });
});
