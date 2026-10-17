// The six Paystack Plan objects this product needs, derived from the prices
// in packages/contracts rather than typed again here.
//
// Same reasoning as scripts/lib/live-prices.mjs, which this sits beside: a
// script that creates billing objects must never carry its own copy of an
// amount. The whole point of the script is that six Plan objects get created
// with exactly the right amounts, and a second copy of those amounts in the
// tool that creates them is the one place a typo would be invisible — the
// Plan would be created, look correct, and bill the wrong number every month
// for the life of every subscription attached to it.
//
// Parsing the TypeScript with a regex rather than importing it is the same
// trade the prices module already made: scripts/ has no build step and no TS
// loader, and the shapes matched here are pinned by plan-catalog.test.mjs so
// a rename fails loudly instead of silently returning nothing.

/**
 * `scout: { founding: 79_000, standard: 250_000 },` and its two siblings,
 * inside SUBSCRIPTION_PRICES_NGN.
 */
const TIER_ENTRY =
  /(\w+)\s*:\s*\{\s*founding\s*:\s*([\d_]+)\s*,\s*standard\s*:\s*([\d_]+)\s*,?\s*\}/g;

/** Only the interval that is actually on sale. See OFFERED_BILLING_INTERVALS. */
export const OFFERED_INTERVAL = 'monthly';

const TIER_LABELS = {
  scout: 'Scout',
  team: 'Team',
  partner: 'Partner',
};

const PRICE_TIER_LABELS = {
  founding: 'Founding',
  standard: 'Standard',
};

function parseLiteral(raw) {
  return Number(String(raw).replace(/_/g, ''));
}

/**
 * Every Plan object that has to exist in Paystack, read out of the contracts
 * source.
 *
 * Returns one entry per (tier, price tier), because a Paystack Plan carries
 * one amount and one interval each — founding and standard are different
 * amounts and therefore different Plans.
 */
export function planCatalog(contractsSource) {
  const plans = [];
  for (const match of contractsSource.matchAll(TIER_ENTRY)) {
    const tier = match[1];
    if (!TIER_LABELS[tier]) continue;
    for (const [priceTier, raw] of [
      ['founding', match[2]],
      ['standard', match[3]],
    ]) {
      const amountNGN = parseLiteral(raw);
      if (!Number.isFinite(amountNGN) || amountNGN <= 0) continue;
      plans.push({
        planKey: `${tier}_${priceTier}_${OFFERED_INTERVAL}`,
        // The name a person reads in the Paystack dashboard. It has to say
        // which price tier it is, because the dashboard shows a list of
        // plans whose only other difference is the amount.
        //
        // The amount is part of the name deliberately. A Paystack Plan's
        // amount is immutable, so raising a price means creating new Plans
        // beside the old ones - and this script matches an existing Plan by
        // name, then refuses to reuse one whose amount disagrees. With a
        // name that omitted the price, every raise deadlocked: the name was
        // taken by a Plan charging the old amount, and the script could
        // neither reuse nor replace it. The 2026-09-02 raise was unstuck by
        // hand-appending the amount to three names, which left the six
        // plans inconsistently named.
        //
        // Putting the amount in the name makes a price change produce a
        // genuinely new name, so creation succeeds, and re-running with
        // prices unchanged still finds the same name at the same amount and
        // reuses it. Idempotent across raises rather than only within one.
        name: `Zoryvex ${TIER_LABELS[tier]} (${PRICE_TIER_LABELS[priceTier]}, monthly, NGN ${amountNGN.toLocaleString('en-US')})`,
        amountNGN,
        // Paystack takes the amount in the currency's subunit.
        amountKobo: amountNGN * 100,
        interval: OFFERED_INTERVAL,
        currency: 'NGN',
      });
    }
  }
  return plans;
}

/**
 * How many plans there must be. A guard on the guard: if the parse silently
 * matched nothing, a script that creates "all the plans" would create none
 * and report success.
 */
export const EXPECTED_PLAN_COUNT = 6;
