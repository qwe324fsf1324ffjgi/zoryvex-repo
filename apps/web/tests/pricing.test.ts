import { CONTACT_UNLOCK_ALLOWANCE, LAUNCH_TRACK_LABELS } from '@zoryvex/contracts';
import { describe, expect, it } from 'vitest';
import {
  FOUNDING_TERMS,
  FOUNDING_SLOTS_TOTAL,
  FOUNDING_TIERS,
  KIT_DELIVERABLES,
  KIT_NOT_INCLUDED,
  KIT_PRICE_NGN,
  KIT_REFUND_TERMS,
  KIT_STAKES,
  formatNGN,
  foundingSavingNGN,
} from '../src/lib/pricing';

describe('pricing constants', () => {
  it('the Kit is exactly NGN 95,000', () => {
    // Founder-approved 2026-08-30, raised from 29,000. Pinned here and
    // declared once in packages/contracts, so the price this site shows and
    // the price services/api charges cannot drift apart.
    expect(KIT_PRICE_NGN).toBe(95_000);
  });

  it('founding tiers match the fixed prices and plan keys exactly, in order', () => {
    // CLAUDE.md fixes these three numbers. Asserted field by field rather
    // than with a whole-object toEqual, so describing what a tier buys never
    // requires touching the prices.
    expect(
      FOUNDING_TIERS.map((tier) => ({
        name: tier.name,
        plan: tier.plan,
        priceNGN: tier.priceNGN,
        cadence: tier.cadence,
        contactUnlocksPerMonth: tier.contactUnlocksPerMonth,
      })),
    ).toEqual([
      {
        name: 'Scout',
        plan: 'scout',
        priceNGN: 800_000,
        cadence: 'month',
        contactUnlocksPerMonth: CONTACT_UNLOCK_ALLOWANCE.scout,
      },
      {
        name: 'Team',
        plan: 'team',
        priceNGN: 1_400_000,
        cadence: 'month',
        contactUnlocksPerMonth: CONTACT_UNLOCK_ALLOWANCE.team,
      },
      {
        name: 'Partner',
        plan: 'partner',
        priceNGN: 2_400_000,
        cadence: 'month',
        contactUnlocksPerMonth: CONTACT_UNLOCK_ALLOWANCE.partner,
      },
    ]);
  });

  it('every tier says what it buys, who it is for, and what it does not cover', () => {
    // A buyer should never have to work out the limits after paying, so the
    // limits are part of the data, not an afterthought in one page's markup.
    for (const tier of FOUNDING_TIERS) {
      expect(tier.bestFor.length, `${tier.name} has no "best for"`).toBeGreaterThan(0);
      expect(tier.includes.length, `${tier.name} lists nothing it includes`).toBeGreaterThan(0);
      expect(tier.notIncluded.length, `${tier.name} lists no limits`).toBeGreaterThan(0);
    }
  });

  /**
   * The gap this closes: founding pricing was capped at 25 organizations and
   * nothing existed after it, so the twenty-sixth organization arriving to
   * hire had nothing at all it could buy.
   */
  it('every tier stays purchasable after the founding places are gone', () => {
    // Founder-approved 2026-08-27, raised 2026-08-30, and pinned exactly the
    // way the founding prices are. They are what an employer is charged, so
    // they should not be able to drift in a refactor.
    expect(FOUNDING_TIERS.map((tier) => [tier.plan, tier.standardPriceNGN])).toEqual([
      ['scout', 1_200_000],
      ['team', 2_000_000],
      ['partner', 4_000_000],
    ]);
  });

  it('founding pricing is genuinely cheaper, or it is not a benefit', () => {
    for (const tier of FOUNDING_TIERS) {
      expect(tier.standardPriceNGN).toBeGreaterThan(tier.priceNGN);
    }
  });

  it('keeps the same allowance at both prices, so the tier is one product', () => {
    // The early-adopter benefit is a lower price, not a better product.
    // Feature-gating would mean maintaining two marketplaces and would make
    // the standard tier read as a punishment.
    for (const tier of FOUNDING_TIERS) {
      expect(tier.contactUnlocksPerMonth).toBe(CONTACT_UNLOCK_ALLOWANCE[tier.plan]);
    }
  });

  /**
   * Both halves of the founding offer have to be unmissable, and each is
   * easy to state in a way that misleads. An earlier card read "founding
   * price then NGN 119,000", which describes an introductory rate that
   * expires — the exact opposite of the deal.
   */
  it('says a founding price is kept, and is not an introductory rate', () => {
    expect(FOUNDING_TERMS.kept).toContain('as long as the subscription runs');
    expect(FOUNDING_TERMS.kept).toContain('not an introductory rate');
    expect(FOUNDING_TERMS.kept).toContain('never rises');
  });

  it('says the places run out for good, with nothing replacing them', () => {
    expect(FOUNDING_TERMS.gone).toContain('gone for good');
    expect(FOUNDING_TERMS.gone).toContain('no second round');
    expect(FOUNDING_TERMS.gone).toContain('pays the standard price');
  });

  it('names the exact cap in the copy, not just in a constant', () => {
    expect(FOUNDING_TERMS.cap).toContain(String(FOUNDING_SLOTS_TOTAL));
    // Was 'twenty-fifth' while the cap was 25. The ordinal is derived from
    // the constant now, so this asserts the relationship rather than a word
    // that has to be hand-edited every time the founder changes the cap.
    expect(FOUNDING_TERMS.gone).toContain(`${FOUNDING_SLOTS_TOTAL}th`);
  });

  it('the tiers are named as plans, not as a founding-only product', () => {
    // "Founding Scout" implied the tier itself was the offer, which made the
    // standard price look like a different, lesser product.
    expect(FOUNDING_TIERS.map((t) => t.name)).toEqual(['Scout', 'Team', 'Partner']);
  });

  it('states the contact allowance in the tier copy, not only as a number', () => {
    // The allowance is the metered thing. If the copy and the number ever
    // drift apart, a buyer is being told one thing and charged another.
    for (const tier of FOUNDING_TIERS) {
      const mentions = tier.includes.some((line) =>
        line.includes(String(tier.contactUnlocksPerMonth)),
      );
      expect(mentions, `${tier.name} never states its allowance in words`).toBe(true);
    }
  });

  it("each tier's advertised contact-unlock allowance matches the real entitlement allowance", () => {
    for (const tier of FOUNDING_TIERS) {
      expect(tier.contactUnlocksPerMonth).toBe(CONTACT_UNLOCK_ALLOWANCE[tier.plan]);
    }
  });

  it('never counts the launch tracks in words that can go stale', () => {
    /**
     * Partner's copy read "Hiring continuously across all three tracks" long
     * after `mlops` made it four. It shipped, it was wrong on the most
     * expensive tier on the page, and nothing could have caught it because
     * the number was written out rather than derived.
     *
     * The fix is not to write "four". It is to stop stating a count that a
     * taxonomy change can falsify.
     */
    const trackCount = Object.keys(LAUNCH_TRACK_LABELS).length;
    expect(trackCount).toBeGreaterThan(0);

    const everyLine = FOUNDING_TIERS.flatMap((tier) => [
      tier.bestFor,
      ...tier.includes,
      ...tier.notIncluded,
    ]).join(' ');
    expect(everyLine).not.toMatch(/\b(two|three|four|five|six)\s+(launch\s+)?tracks\b/i);
    expect(everyLine).not.toMatch(/\b\d+\s+(launch\s+)?tracks\b/i);
  });

  it('founding access is capped at the first few organizations', () => {
    expect(FOUNDING_SLOTS_TOTAL).toBe(5);
  });
});

describe('the Kit is sold on a reason, not only a feature list', () => {
  /**
   * At NGN 29,000 a list of deliverables was enough, because the price asked
   * almost nothing of the reader. At 95,000 a buyer needs to know what the
   * money is protecting them from, and every page describing the Kit used to
   * say only what was in it.
   */
  it('states what is at stake, not just what is included', () => {
    expect(KIT_STAKES).toContain('nobody has checked');
    expect(KIT_STAKES.length).toBeGreaterThan(60);
  });

  it('never sells with a statistic this repository cannot source', () => {
    // docs/COMMERCIAL_RUNBOOK.md forbids claims that outrun the evidence, and
    // that rule does not stop applying when the claim would favour us. There
    // is no sourced cost-of-a-bad-hire figure anywhere in this project, so
    // there must not be one in the copy either.
    expect(KIT_STAKES).not.toMatch(/\d+\s*%/);
    expect(KIT_STAKES).not.toMatch(/studies|research|average|industry/i);
  });

  it('states the limits, the same way every subscription tier does', () => {
    expect(KIT_NOT_INCLUDED.length).toBeGreaterThan(0);
    // The two a buyer is most likely to assume wrongly at this price.
    expect(KIT_NOT_INCLUDED.join(' ')).toContain('does not find you candidates');
    expect(KIT_NOT_INCLUDED.join(' ')).toContain('one role');
  });

  it('never claims the Kit decides anything, because it must not', () => {
    // CLAUDE.md: AI may summarize and explain, never make the final hiring
    // call. The copy has to agree with that, out loud.
    expect(KIT_NOT_INCLUDED.join(' ')).toContain('does not make the decision');
  });
});

describe('what a buyer is shown before being charged', () => {
  /**
   * docs/PRODUCT_SPEC.md: "Before any charge, show: concrete deliverables,
   * exact limits, final price, seller disclosure, and cancellation/refund
   * behavior." docs/ACCEPTANCE_CRITERIA.md repeats it for Kit checkout. The
   * checkout screen showed the price and the disclosure and none of the rest.
   */
  it('names the six deliverables once, for every page that shows them', () => {
    expect(KIT_DELIVERABLES).toHaveLength(6);
    expect(KIT_DELIVERABLES).toContain('Claim-verification matrix');
    expect(KIT_DELIVERABLES).toContain('Decision scorecard');
  });

  it('states refund behaviour without promising a flow that does not exist', () => {
    // docs/PAYMENTS.md: refunds are handled by hand through the Paystack
    // dashboard, deliberately, with no self-service flow this phase. The
    // comfortable sentence here would be the false one.
    expect(KIT_REFUND_TERMS).toMatch(/by hand/i);
    expect(KIT_REFUND_TERMS).not.toMatch(/instant refund|automatic refund|refund button will/i);
  });

  it('says plainly that a one-time purchase has nothing to cancel', () => {
    expect(KIT_REFUND_TERMS).toMatch(/nothing to cancel/i);
    expect(KIT_REFUND_TERMS).toMatch(/not a subscription/i);
  });
});

describe('foundingSavingNGN', () => {
  it('is the real gap between the two prices, never a written-down number', () => {
    for (const tier of FOUNDING_TIERS) {
      expect(foundingSavingNGN(tier)).toBe(tier.standardPriceNGN - tier.priceNGN);
    }
  });

  it('is a real saving on every tier, which is the whole point of a founding price', () => {
    // This asserted a saving over half until 2026-09-02, when the founder
    // raised founding prices and narrowed it deliberately. A threshold that
    // has to be rewritten on every price change was describing one moment
    // rather than protecting a rule.
    //
    // The rule worth protecting is that the saving is real and worth naming.
    // If a founding price ever met its standard price, the banner would be
    // selling scarcity with nothing behind it.
    for (const tier of FOUNDING_TIERS) {
      expect(foundingSavingNGN(tier), `${tier.name} saving`).toBeGreaterThan(0);
    }
  });
});

describe('formatNGN', () => {
  it('formats with thousands separators and an NGN prefix', () => {
    expect(formatNGN(95_000)).toBe('NGN 95,000');
    expect(formatNGN(599_000)).toBe('NGN 599,000');
    // Two separators, which no price needed until Partner's standard price.
    expect(formatNGN(4_000_000)).toBe('NGN 4,000,000');
  });
});
