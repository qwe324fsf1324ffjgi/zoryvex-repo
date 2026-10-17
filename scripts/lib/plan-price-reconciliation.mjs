// Pure logic behind scripts/check-plan-prices.mjs.
//
// Three things have to agree about what a subscription costs, and they live
// in three different places:
//
//   1. SUBSCRIPTION_PRICES_NGN in packages/contracts - what the site shows
//      and what the API records on the attempt.
//   2. The plan codes in /zoryvex/<env>/paystack/plan-codes.
//   3. The amount on each of those Plan objects inside Paystack.
//
// `initializeTransaction` sends the amount from (1) and the plan code from
// (2), and Paystack bills the amount from (3). So a disagreement does not
// throw anywhere: the app displays one number, stores that same number, and
// the customer is charged a different one.
//
// This is not hypothetical. A Paystack Plan's amount is immutable, so every
// price change creates new Plans and repoints (2) - and (1) and (2) are
// updated by different mechanisms at different moments. Between those
// moments the environment is quietly wrong.

/**
 * Every plan key that must exist, derived from the tiers and price tiers
 * rather than listed, so a new tier cannot be added and silently skipped.
 */
export function expectedPlanKeys(tiers = ['scout', 'team', 'partner'], interval = 'monthly') {
  const keys = [];
  for (const tier of tiers) {
    for (const priceTier of ['founding', 'standard']) {
      keys.push(`${tier}_${priceTier}_${interval}`);
    }
  }
  return keys;
}

/**
 * Compare the three sources and describe every disagreement in the terms an
 * operator needs: which key, what the app would show, what Paystack would
 * charge.
 *
 * `prices` is { tier: { founding, standard } } from contracts.
 * `planCodes` is the parsed Parameter Store JSON.
 * `liveAmountsByCode` maps a plan code to the NGN amount Paystack holds.
 */
export function reconcilePlanPrices({
  prices,
  planCodes,
  liveAmountsByCode,
  interval = 'monthly',
}) {
  const problems = [];
  const tiers = Object.keys(prices ?? {});

  for (const key of expectedPlanKeys(tiers, interval)) {
    const [tier, priceTier] = key.split('_');
    const expected = prices?.[tier]?.[priceTier];
    const code = planCodes?.[key];

    if (expected === undefined) {
      problems.push(`${key}: no price in contracts.`);
      continue;
    }
    if (!code) {
      problems.push(
        `${key}: no plan code configured, so subscription checkout for this tier refuses.`,
      );
      continue;
    }
    if (!(code in (liveAmountsByCode ?? {}))) {
      problems.push(
        `${key}: plan code ${code} is configured but does not exist in Paystack. Checkout would fail.`,
      );
      continue;
    }
    const live = liveAmountsByCode[code];
    if (live !== expected) {
      problems.push(
        `${key}: the app shows and records NGN ${expected.toLocaleString('en-US')}, ` +
          `but plan ${code} bills NGN ${live.toLocaleString('en-US')}. ` +
          `A buyer would be charged ${live > expected ? 'more' : 'less'} than they agreed to.`,
      );
    }
  }

  // A configured key nobody expects is worth naming too: it means a tier was
  // renamed or removed and the parameter still points somewhere.
  for (const key of Object.keys(planCodes ?? {})) {
    if (!expectedPlanKeys(tiers, interval).includes(key)) {
      problems.push(`${key}: configured but is not a plan this product sells.`);
    }
  }

  return problems;
}
