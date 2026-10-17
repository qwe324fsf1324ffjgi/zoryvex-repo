import {
  CONTACT_UNLOCK_ALLOWANCE,
  FOUNDING_SLOTS_TOTAL,
  KIT_PRICE_NGN,
  SUBSCRIPTION_PRICES_NGN,
} from '@zoryvex/contracts';

/**
 * Single source of truth for every price shown across the marketing site —
 * fixed per CLAUDE.md, never invented or rounded differently on different
 * pages.
 */
/**
 * The name that appears on the customer's bank statement, so it has to match
 * the Paystack account exactly. It did not: the account reads "Abba's
 * Solutions" and every surface here said "Abbas Solution" from 2026-08-15,
 * when the dashboard was misread during the Phase 1 survey, until the founder
 * spotted it on 2026-09-01.
 *
 * It lives on its own line because the footer needs the name inside a
 * different sentence, and a second copy of it is how a name drifts.
 */
export const PAYSTACK_BUSINESS_NAME = "Abba's Solutions";

export const PAYSTACK_DISCLOSURE = `Payments are securely processed by Paystack under our business name, ${PAYSTACK_BUSINESS_NAME}.`;

/**
 * Re-exported, not redeclared. The numbers live in packages/contracts so the
 * prices this page shows and the prices actually charged cannot drift.
 *
 * The Kit was moved there first. The three subscription prices were left
 * behind, and the payments adapter kept its own copy of them — so the page
 * and the charge were two numbers that had to agree, with nothing able to
 * notice when they stopped.
 */
export { KIT_PRICE_NGN, FOUNDING_SLOTS_TOTAL };

/**
 * What each tier actually buys, in the buyer's own terms.
 *
 * `includes` is the exchange: every line is something the platform really
 * does today, phrased as what the employer gets rather than what the system
 * has. `notIncluded` is deliberate — a tier page that only lists upsides
 * makes a buyer work out the limits after paying, and the limit is usually
 * the thing they most needed to know.
 *
 * TWO PRICES, ONE TIER. Founding pricing is capped at the first
 * FOUNDING_SLOTS_TOTAL organizations; the standard price is what everyone
 * after them pays, and it is always available. Before this, the cap was the
 * whole offer, so the twenty-sixth organization to arrive wanting to hire
 * had nothing at all it could buy.
 *
 * The founding benefit is a permanently lower price, not a better product.
 * Feature-gating early adopters would mean building and maintaining two
 * versions of the same marketplace and would make the standard tier feel
 * like a punishment; a locked price rewards them for arriving early without
 * making anyone else a second-class customer.
 *
 * Both prices live on one object so they cannot drift apart, and so a tier
 * can never advertise an allowance under one price and enforce another.
 */
/**
 * Standard prices are FIXED, and currently NGN 500,000 / 1,400,000 /
 * 10,000,000 monthly. They carry the same weight as the founding prices:
 * pinned by an exact-value test, and not changed without a founder decision
 * recorded in docs/DECISIONS.md.
 *
 * Five founder decisions so far, and the dates matter because the log is the
 * only record of what was charged when: introduced 2026-08-27 at 119,000 /
 * 345,000 / 899,000, raised 2026-08-30 to 185,000 / 520,000 / 1,350,000,
 * raised 2026-09-01 to 250,000 / 700,000 / 5,000,000, doubled on 2026-09-04,
 * and raised again 2026-09-09 to the figures above.
 *
 * The 2026-09-09 raise came from one instruction, a floor of 800,000 on the
 * cheapest founding tier, and the ladder had to be compressed rather than
 * scaled to honour it. Paystack's 8,000,000 lifetime limit puts a hard
 * ceiling of 4,000,000 on any single charge, so the six numbers are what
 * fits between a floor the founder set and a ceiling Paystack sets. Founding
 * discounts are now 33% on Scout, 30% on Team and 40% on Partner.
 *
 * A consequence worth knowing before writing any copy about the ladder: the
 * two price sets interleave. A founding Team subscriber pays 1,400,000 and a
 * standard Scout one pays 1,200,000, so the cheaper tier at standard costs
 * less than the middle tier at founding while the founding Scout price sits
 * below both. Nothing is wrong with that, and copy should not make a claim
 * about the spacing of the three tiers in either direction.
 *
 * "Could be" was the accurate word for a while. This module described the
 * cap and the standard prices, and nothing anywhere selected between them:
 * the payments adapter charged the founding price to every buyer, with no
 * standard-price path at all, so the twenty-sixth organization would have
 * paid founding rates for the life of its subscription while the page it
 * bought from said it would pay standard. Selection now happens in
 * packages/contracts' subscriptionPrice(), against a counter of places
 * actually taken.
 */

export const FOUNDING_TIERS = [
  {
    name: 'Scout',
    plan: 'scout' as const,
    priceNGN: SUBSCRIPTION_PRICES_NGN.scout.founding,
    standardPriceNGN: SUBSCRIPTION_PRICES_NGN.scout.standard,
    cadence: 'month' as const,
    contactUnlocksPerMonth: CONTACT_UNLOCK_ALLOWANCE.scout,
    bestFor: 'One open role at a time.',
    includes: [
      `Reach out to ${CONTACT_UNLOCK_ALLOWANCE.scout} candidates a month. Only their contact details are metered; browsing matches is not.`,
      // Was "at least one credential Zoryvex checked with the issuer", which
      // described one of the verification methods and sold them all. A
      // candidate who proved control of a repository has no issuer and no
      // credential, and this line is attached to a subscription costing
      // hundreds of thousands a month. The lapse guarantee is kept because it
      // is real, but scoped: a repository does not expire, so claiming every
      // check lapses was the same mistake in the other direction.
      //
      // The third method, a practical task scored against a published rubric,
      // was removed on 2026-09-06 and is removed from this sentence with it.
      // Selling a check the platform no longer runs is the exact failure this
      // line has already been corrected for once.
      'Every candidate you see has passed at least one independent check: a certification confirmed with the body that issued it, or proven control of a public repository with commits credited to them. Where a credential can lapse, the check stops counting the day it does.',
      'Match rankings show which verified evidence supports each requirement, so you can judge the reasoning.',
      'Unlimited roles, and unlimited match recomputes as your requirements change.',
    ],
    notIncluded: [
      'The Proof Hiring Kit is bought separately, per role.',
      'Unused contact reaches do not roll over into the next month.',
    ],
  },
  {
    name: 'Team',
    plan: 'team' as const,
    priceNGN: SUBSCRIPTION_PRICES_NGN.team.founding,
    standardPriceNGN: SUBSCRIPTION_PRICES_NGN.team.standard,
    cadence: 'month' as const,
    contactUnlocksPerMonth: CONTACT_UNLOCK_ALLOWANCE.team,
    bestFor: 'Several roles running at once.',
    includes: [
      `Reach out to ${CONTACT_UNLOCK_ALLOWANCE.team} candidates a month across every role you run.`,
      'Everything in Scout.',
      'Your whole hiring team works from one account and one shared allowance.',
    ],
    notIncluded: [
      'The Proof Hiring Kit is bought separately, per role.',
      'Unused contact reaches do not roll over into the next month.',
    ],
  },
  {
    name: 'Partner',
    plan: 'partner' as const,
    priceNGN: SUBSCRIPTION_PRICES_NGN.partner.founding,
    standardPriceNGN: SUBSCRIPTION_PRICES_NGN.partner.standard,
    cadence: 'month' as const,
    contactUnlocksPerMonth: CONTACT_UNLOCK_ALLOWANCE.partner,
    bestFor: 'Hiring continuously across every track.',
    includes: [
      `Reach out to ${CONTACT_UNLOCK_ALLOWANCE.partner} candidates a month, enough to run continuous hiring rather than one search at a time.`,
      'Everything in Team.',
    ],
    notIncluded: [
      'The Proof Hiring Kit is bought separately, per role.',
      'Unused contact reaches do not roll over into the next month.',
    ],
  },
];

/**
 * Why the Kit is worth buying, in one place.
 *
 * Every page describing the Kit listed what is in it and nothing about why
 * anyone would want it. At NGN 29,000 a feature list was enough, because the
 * price asked almost nothing of the reader. It is not enough now.
 *
 * Deliberately not a statistic. There is no sourced figure in this repository
 * for the cost of a bad hire in this market, and inventing one to sell with
 * would be the same failure as a candidate inventing evidence.
 * `docs/COMMERCIAL_RUNBOOK.md` forbids traction claims that outrun what can
 * be shown, and that rule does not stop applying when the claim happens to
 * favour us. What is left is the thing that is simply true: the buyer is
 * making an expensive, slow-to-reverse decision on claims nobody checked.
 */
export const KIT_STAKES =
  'You are about to decide on claims nobody has checked, and that decision costs months of salary to get wrong. The Kit is how you check them first.';

/**
 * The six things a Kit contains, in one place.
 *
 * These were written out as literal list items on the pricing page and again
 * on the employer page, and the checkout screen listed none of them at all
 * while asking for the money. Three copies of a list is two too many, and the
 * one place it needed to appear was the one place it did not.
 */
export const KIT_DELIVERABLES = [
  'Role success profile',
  'Evidence checklist',
  'Claim-verification matrix',
  'Practical assessment rubric',
  'Structured interview guide',
  'Decision scorecard',
];

/**
 * What happens if a buyer wants their money back.
 *
 * `docs/PRODUCT_SPEC.md` requires cancellation and refund behaviour to be
 * shown before any charge, and the checkout screen did not show it. Says the
 * true thing rather than a comfortable one: refunds are handled by hand,
 * because `docs/PAYMENTS.md` records that there is deliberately no
 * self-service refund flow in this phase. Promising a button that does not
 * exist would be the more attractive sentence and the wrong one.
 */
export const KIT_REFUND_TERMS =
  'There is nothing to cancel: the Kit is a one-time purchase, not a subscription. If something is wrong with it, contact us and a refund is arranged by hand through Paystack. There is no automated refund button.';

/**
 * What the Kit is not, stated as plainly as what it is.
 *
 * Every subscription tier already lists its limits, on the reasoning that a
 * buyer should never have to work them out after paying. The Kit card was the
 * one place that listed only upsides, which mattered less when it cost 29,000
 * and matters a lot more now.
 */
export const KIT_NOT_INCLUDED = [
  'It does not find you candidates. That is the marketplace, and it is a separate monthly subscription.',
  'It covers one role. A second role needs its own Kit.',
  'It does not make the decision for you. It gives you the evidence to check and the rubric to judge against.',
];

/**
 * What a founding place saves each month, computed rather than written down,
 * so it can never disagree with the two prices it sits between.
 */
export function foundingSavingNGN(tier: { priceNGN: number; standardPriceNGN: number }): number {
  return tier.standardPriceNGN - tier.priceNGN;
}

/** True of every tier, so it is stated once rather than repeated three times. */
export const EVERY_TIER_INCLUDES = [
  'Cancel whenever you want. There is no notice period and no annual contract.',
  'Every tier is the same product at either price. A founding place changes what you pay, never what you get.',
  'A candidate can withdraw consent at any time, and their contact details stop being shown. Nothing is charged for that.',
];

/**
 * The founding offer, in the two sentences that actually matter, stated once
 * and reused everywhere it appears.
 *
 * Both halves are load-bearing and each is easy to get wrong in the reader's
 * favour or against it. An earlier version of the card said "founding price
 * then NGN 119,000", which reads as an introductory rate that expires —
 * exactly backwards. A founding member is never moved onto the standard
 * price, and nobody outside the founding places ever reaches the founding one.
 */
export const FOUNDING_TERMS = {
  cap: `Founding places are limited to the first ${FOUNDING_SLOTS_TOTAL} organizations to subscribe.`,
  kept: 'A founding member keeps that price for as long as the subscription runs. It is not an introductory rate and it never rises to the standard price.',
  gone: `Once those ${FOUNDING_SLOTS_TOTAL} places are taken they are gone for good. There is no second round and no discount replaces them: every organization after the ${FOUNDING_SLOTS_TOTAL}th pays the standard price.`,
} as const;

export function formatNGN(amount: number): string {
  return `NGN ${amount.toLocaleString('en-NG')}`;
}
