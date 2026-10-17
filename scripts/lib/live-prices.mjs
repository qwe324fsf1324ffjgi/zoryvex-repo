// Every price the product currently charges, read out of the modules that
// declare them rather than typed again here.
//
// This exists because `assert-safe-shell.mjs` used to carry a hand-written
// list of price literals to forbid, and that list went stale the moment the
// founder raised prices on 2026-08-30. A guard whose job is "the safe shell
// must show no pricing" that only knows last month's prices is worse than no
// guard: it still reports PASS, so it reads as evidence.
//
// Parsing the TypeScript source with a regex, rather than importing it, is
// deliberate. `scripts/` has no build step and no TS loader, and adding one
// so a grep can learn five numbers is a poor trade. The shapes matched here
// are pinned by `live-prices.test.mjs`, so a refactor that renames the field
// or changes the literal style fails loudly instead of silently returning an
// empty list.

// Two shapes, because prices are declared two ways: `KIT_PRICE_NGN = 95_000`
// as a bare constant, and `{ founding: 79_000, standard: 250_000 }` inside
// SUBSCRIPTION_PRICES_NGN. `…priceNGN:` is matched too, because apps/web's
// FOUNDING_TIERS re-expresses both under those names.
const PRICE_FIELDS = [
  /\b[A-Za-z_]*(?:[Pp]riceNGN|PRICE_NGN)\s*[:=]\s*([\d_]+)/g,
  /\b(?:founding|standard)\s*:\s*([\d_]+)/g,
];

/** Numeric-literal text (`95_000`) to a number. */
function parseLiteral(raw) {
  return Number(raw.replace(/_/g, ''));
}

/**
 * Pull every price literal out of a TypeScript source string.
 */
export function extractPrices(source) {
  const found = new Set();
  for (const field of PRICE_FIELDS) {
    for (const match of source.matchAll(field)) {
      const value = parseLiteral(match[1] ?? '');
      if (Number.isFinite(value) && value > 0) found.add(value);
    }
  }
  return [...found].sort((a, b) => a - b);
}

/**
 * A price as it can appear in rendered output: `95000` or `95,000`. Grouped
 * with an optional comma because the site formats with `Intl.NumberFormat`
 * but a build artifact may carry the raw number.
 */
export function pricePattern(amount) {
  const digits = String(amount);
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',?');
  // Bounded by non-digits on both sides. Without that, 250,000 matches inside
  // 2500000 — the "185" then "000" of a longer number — so a build-artifact
  // hash could fail the safe-shell guard for a price nobody had written.
  // Failing closed is the safe direction for a guard, but not on something
  // that is not a price.
  //
  // Hex literals need the same treatment and the digit boundary does not
  // give it, because `x` is not a digit. React's scheduler ships lane
  // constants like `0x10000000`, and when standard Partner became NGN
  // 10,000,000 on 2026-09-04 that constant immediately failed the
  // safe-shell guard as a leaked price. A run of digits sitting inside a
  // `0x...` literal is a number in another base and cannot be a price
  // anybody reads.
  return new RegExp(`(?<!0[xX][0-9a-fA-F]*)(?<!\\d)${grouped}(?!\\d)`);
}

/**
 * Forbidden-pattern entries for every live price, in the shape
 * `assert-safe-shell.mjs` already uses.
 */
export function forbiddenPricePatterns(prices) {
  return prices.map((amount) => ({
    name: `Price (${amount.toLocaleString('en-NG')})`,
    pattern: pricePattern(amount),
  }));
}
