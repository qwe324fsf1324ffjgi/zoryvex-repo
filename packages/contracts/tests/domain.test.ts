import { describe, expect, it } from 'vitest';
import {
  EntitlementSchema,
  FOUNDING_SLOTS_TOTAL,
  KIT_PRICE_NGN,
  KitOrderSchema,
  MatchSchema,
  LaunchTrackSchema,
  CandidateSchema,
  RoleSchema,
  SUBSCRIPTION_PLANS,
  SUBSCRIPTION_PRICES_NGN,
  foundingPlacesRemaining,
  subscriptionPrice,
} from '../src/domain';

describe('KitOrderSchema', () => {
  const order = (amountNGN: unknown) => ({
    id: 'kit_1',
    employerId: 'emp_1',
    roleId: 'role_1',
    amountNGN,
    status: 'pending' as const,
    paystackReference: 'ref_1',
    createdAt: new Date().toISOString(),
  });

  it('accepts an order at the current price', () => {
    expect(KitOrderSchema.safeParse(order(KIT_PRICE_NGN)).success).toBe(true);
  });

  /**
   * This assertion used to be its exact opposite. `amountNGN` was
   * `z.literal(29000)`, so the schema rejected every amount that was not the
   * then-current price — which meant the first price change would have made
   * every historical order unreadable, including refunded ones and the real
   * TEST purchase from 2026-08-26.
   *
   * An order records a transaction that already happened. What it charged is
   * a fact about the past, not a constraint the present price gets to
   * impose.
   */
  it('accepts an order at a price the Kit no longer costs', () => {
    expect(KIT_PRICE_NGN).not.toBe(29_000);
    expect(KitOrderSchema.safeParse(order(29_000)).success).toBe(true);
  });

  it('still rejects an amount that could not have been charged', () => {
    for (const amount of [0, -1, 29_000.5, '29000', null, undefined]) {
      expect(KitOrderSchema.safeParse(order(amount)).success, `accepted ${String(amount)}`).toBe(
        false,
      );
    }
  });
});

describe('MatchSchema', () => {
  it('rejects a match score outside [0, 1]', () => {
    const base = {
      id: 'match_1',
      roleId: 'role_1',
      candidateId: 'cand_1',
      status: 'suggested' as const,
      contactUnlocked: false,
      createdAt: new Date().toISOString(),
    };
    expect(MatchSchema.safeParse({ ...base, matchScore: 1.5 }).success).toBe(false);
    expect(MatchSchema.safeParse({ ...base, matchScore: -0.1 }).success).toBe(false);
    expect(MatchSchema.safeParse({ ...base, matchScore: 0.8 }).success).toBe(true);
  });

  it('accepts a match with no rationale/citations/aiExplanation (pre-slice-6 shape)', () => {
    const result = MatchSchema.safeParse({
      id: 'match_1',
      roleId: 'role_1',
      candidateId: 'cand_1',
      matchScore: 0.5,
      status: 'suggested',
      contactUnlocked: false,
      createdAt: new Date().toISOString(),
    });
    expect(result.success).toBe(true);
  });

  it('accepts a match with rationale/citations/scoringVersion/aiExplanation set', () => {
    const result = MatchSchema.safeParse({
      id: 'match_1',
      roleId: 'role_1',
      candidateId: 'cand_1',
      matchScore: 0.5,
      status: 'suggested',
      contactUnlocked: false,
      rationale: 'Matched 2 of 3 must-have items.',
      matchedEvidenceIds: ['ev_1', 'ev_2'],
      scoringVersion: 'v1',
      aiExplanation: 'AI-generated summary.',
      createdAt: new Date().toISOString(),
    });
    expect(result.success).toBe(true);
  });
});

describe('LaunchTrackSchema', () => {
  it('accepts only the four fixed launch tracks', () => {
    expect(LaunchTrackSchema.safeParse('aws_cloud').success).toBe(true);
    expect(LaunchTrackSchema.safeParse('devops_platform').success).toBe(true);
    expect(LaunchTrackSchema.safeParse('cloud_security').success).toBe(true);
    expect(LaunchTrackSchema.safeParse('mlops').success).toBe(true);
    expect(LaunchTrackSchema.safeParse('frontend').success).toBe(false);
  });
});

describe('CandidateSchema', () => {
  it('rejects a malformed email', () => {
    const result = CandidateSchema.safeParse({
      id: 'cand_1',
      email: 'not-an-email',
      displayName: 'Test',
      launchTrack: 'aws_cloud',
      discoveryOptIn: false,
      onboardingComplete: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    expect(result.success).toBe(false);
  });
});

describe('RoleSchema', () => {
  it('requires at least one must-have work item', () => {
    const result = RoleSchema.safeParse({
      id: 'role_1',
      employerId: 'emp_1',
      launchTrack: 'devops_platform',
      title: 'Platform Engineer',
      seniority: 'mid',
      outcomes: 'Ship CI/CD improvements',
      mustHaveWork: [],
      status: 'draft',
      createdAt: new Date().toISOString(),
    });
    expect(result.success).toBe(false);
  });
});

describe('subscription pricing', () => {
  /**
   * Until this existed, `subscriptionPrice` did not: the three founding
   * prices were typed into `local-payments-adapter`, the three standard
   * prices were typed into `apps/web`, and nothing selected between them.
   * Every organization was charged founding rates, forever, on a page that
   * said the twenty-sixth onwards would pay standard.
   */
  it('charges the founding price while a place remains', () => {
    // Both halves of the conflict were right about different things: this
    // branch moved the founding cap to 5, main raised the founding prices.
    // The resolution takes the new prices at the new boundary.
    expect(subscriptionPrice('scout', 0)).toEqual({ amountNGN: 800_000, founding: true });
    expect(subscriptionPrice('team', 3)).toEqual({ amountNGN: 1_400_000, founding: true });
    // The fifth buyer arrives with 4 places gone and takes the last one.
    expect(subscriptionPrice('partner', 4)).toEqual({ amountNGN: 2_400_000, founding: true });
  });

  it('charges the standard price to the organization after the last founding place', () => {
    expect(subscriptionPrice('scout', 5)).toEqual({ amountNGN: 1_200_000, founding: false });
    expect(subscriptionPrice('team', 5)).toEqual({ amountNGN: 2_000_000, founding: false });
    expect(subscriptionPrice('partner', 5)).toEqual({ amountNGN: 4_000_000, founding: false });
  });

  it('does not resurrect founding places if the count somehow overshoots', () => {
    // Concurrent checkouts can over-issue founding places by the number in
    // flight (see local-payments-adapter). The counter passing 25 must keep
    // charging standard, not wrap or go negative.
    expect(foundingPlacesRemaining(30)).toBe(0);
    expect(subscriptionPrice('scout', 30).founding).toBe(false);
  });

  it('pins both price sets, which are founder-fixed', () => {
    // CLAUDE.md fixes these. Changing one without a founder decision
    // recorded in docs/DECISIONS.md should fail here first.
    expect(SUBSCRIPTION_PRICES_NGN).toEqual({
      scout: { founding: 800_000, standard: 1_200_000 },
      team: { founding: 1_400_000, standard: 2_000_000 },
      partner: { founding: 2_400_000, standard: 4_000_000 },
    });
    // Reduced from 25 to 5 on 2026-09-02 by founder decision, recorded in
    // docs/DECISIONS.md. Pinned here so the next change is also a decision
    // rather than a drift.
    expect(FOUNDING_SLOTS_TOTAL).toBe(5);
  });

  it('makes founding a lower price and never a different product', () => {
    // "Both price sets are the same product — founding buys a lower price,
    // never extra features" (CLAUDE.md). The only thing the plan key selects
    // is a number.
    for (const plan of SUBSCRIPTION_PLANS) {
      const prices = SUBSCRIPTION_PRICES_NGN[plan];
      expect(Object.keys(prices).sort()).toEqual(['founding', 'standard']);
      expect(prices.founding).toBeLessThan(prices.standard);
    }
  });

  it('keeps founding genuinely cheaper than standard, on every tier', () => {
    // This asserted a discount over half until 2026-09-02, when the founder
    // raised founding prices and deliberately narrowed it: Scout and Team sit
    // near two fifths now, Partner near four fifths. The old threshold
    // described one moment's pricing rather than a rule worth holding, and a
    // test that has to be rewritten on every price change is not protecting
    // anything.
    //
    // What is worth holding is the relationship. Founding must be a real
    // discount on every tier, because "founding buys a lower price, never
    // extra features" is the promise, and a founding price that met or
    // exceeded standard would make that promise false.
    for (const plan of SUBSCRIPTION_PLANS) {
      const { founding, standard } = SUBSCRIPTION_PRICES_NGN[plan];
      expect(founding, `${plan} founding must be below standard`).toBeLessThan(standard);
    }
  });
});

describe('EntitlementSchema price fields', () => {
  const base = {
    employerId: 'emp_1',
    plan: 'scout' as const,
    status: 'active' as const,
    kitPurchasedAt: null,
    subscriptionRenewsAt: '2026-09-01T00:00:00.000Z',
  };

  it('reads an entitlement written before the price fields existed', () => {
    // Records already in localStorage and DynamoDB have neither field. A
    // required field here would have made every existing subscriber
    // unreadable, which is the mistake `amountNGN: z.literal(29000)` made
    // for Kit orders.
    const parsed = EntitlementSchema.parse(base);
    expect(parsed.priceNGN).toBeNull();
    expect(parsed.foundingMember).toBe(false);
  });

  it('records what the member actually pays', () => {
    const parsed = EntitlementSchema.parse({ ...base, priceNGN: 79_000, foundingMember: true });
    expect(parsed.priceNGN).toBe(79_000);
    expect(parsed.foundingMember).toBe(true);
  });

  it('rejects a price that is not a positive whole number of naira', () => {
    for (const priceNGN of [0, -1, 79_000.5, '79000']) {
      expect(EntitlementSchema.safeParse({ ...base, priceNGN }).success).toBe(false);
    }
  });
});
