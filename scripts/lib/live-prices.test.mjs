import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { extractPrices, forbiddenPricePatterns, pricePattern } from './live-prices.mjs';

const root = join(import.meta.dirname, '../..');
const pricingSource = readFileSync(join(root, 'apps/web/src/lib/pricing.ts'), 'utf8');
const contractsSource = readFileSync(join(root, 'packages/contracts/src/domain.ts'), 'utf8');

describe('extractPrices', () => {
  it('reads every price the product currently charges', () => {
    // The whole point is that this is not a hand-written list: if a founder
    // price change lands and this assertion still passes, the extraction is
    // reading the source. If the change breaks it, the guard tells you.
    expect(extractPrices(pricingSource + contractsSource)).toEqual([
      95_000, // Proof Hiring Kit, one-time
      800_000, // founding Scout
      1_200_000, // standard Scout
      1_400_000, // founding Team
      2_000_000, // standard Team
      2_400_000, // founding Partner
      4_000_000, // standard Partner
    ]);
    // Ascending, and the two price sets interleave: a founding Team
    // subscriber pays 800,000 while a standard Scout one pays 500,000, so
    // the middle tier at founding costs more than the cheapest at standard.
    // The 2026-09-04 doubling moved both sets by the same factor, so this
    // ordering is exactly the one the previous raise produced rather than a
    // new consequence - and it is still the clearest argument for taking
    // one of the five founding places.
  });

  it('reads every price from contracts alone', () => {
    // packages/contracts is the single source of truth: apps/web's
    // FOUNDING_TIERS now reads its prices from SUBSCRIPTION_PRICES_NGN
    // rather than restating them, and so does the payments adapter.
    expect(extractPrices(contractsSource)).toEqual([
      95_000, 800_000, 1_200_000, 1_400_000, 2_000_000, 2_400_000, 4_000_000,
    ]);
  });

  it('finds the Kit price, which is declared as a bare constant', () => {
    // `KIT_PRICE_NGN = 95_000` does not look like `priceNGN: 95_000`. The
    // first draft of this extractor missed it, and the smoke test caught it
    // only because the expected count was written down.
    expect(extractPrices('export const KIT_PRICE_NGN = 95_000;')).toEqual([95_000]);
  });

  it('finds prices declared as founding/standard pairs', () => {
    // The shape SUBSCRIPTION_PRICES_NGN uses. Widening the extractor to see
    // it was forced by this suite: moving the tier prices into contracts
    // made the safe-shell guard stop knowing about six of the seven, and
    // the count assertion above is what said so.
    expect(extractPrices('scout: { founding: 79_000, standard: 250_000 },')).toEqual([
      79_000, 250_000,
    ]);
  });

  it('handles both underscore-separated and plain literals', () => {
    expect(extractPrices('priceNGN: 79_000\nstandardPriceNGN: 250000')).toEqual([79_000, 250_000]);
  });

  it('ignores zero and non-price numbers', () => {
    expect(extractPrices('const FOUNDING_SLOTS_TOTAL = 25; priceNGN: 0')).toEqual([]);
  });

  it('deduplicates a price that appears in more than one module', () => {
    expect(extractPrices('priceNGN: 95_000\nKIT_PRICE_NGN = 95_000')).toEqual([95_000]);
  });
});

describe('pricePattern', () => {
  it('matches the formatted and the raw form of the same amount', () => {
    // The site renders through Intl.NumberFormat, but a build artifact can
    // carry the unformatted number, and either one leaking is a leak.
    expect(pricePattern(95_000).test('NGN 95,000 one-time')).toBe(true);
    expect(pricePattern(95_000).test('{"amountNGN":95000}')).toBe(true);
  });

  it('groups a seven-figure price correctly', () => {
    expect(pricePattern(5_000_000).test('NGN 5,000,000')).toBe(true);
    expect(pricePattern(5_000_000).test('5000000')).toBe(true);
  });

  it('does not match a different amount', () => {
    expect(pricePattern(95_000).test('NGN 96,000')).toBe(false);
    expect(pricePattern(700_000).test('NGN 70,000')).toBe(false);
  });
});

describe('forbiddenPricePatterns', () => {
  it('produces one named rule per live price', () => {
    const rules = forbiddenPricePatterns([95_000, 5_000_000]);
    expect(rules.map((rule) => rule.name)).toEqual(['Price (95,000)', 'Price (5,000,000)']);
  });

  it('catches a standard-tier price, which the old hand-written list did not', () => {
    // This is the regression the change exists for. Before it, the safe-shell
    // guard forbade a hand-written list of founding prices and nothing else,
    // so a page showing a standard price passed. Reading the prices out of
    // contracts means the guard follows every raise on its own, including
    // the 2026-09-04 doubling.
    const rules = forbiddenPricePatterns(extractPrices(contractsSource));
    const leak = '<p>Team, NGN 1,400,000 a month</p>';
    expect(rules.some((rule) => rule.pattern.test(leak))).toBe(true);
  });
});

describe('pricePattern boundaries', () => {
  it('does not match a price inside a longer number', () => {
    // A price used to match inside a longer run of digits: 185,000, the
    // standard Scout price at the time, matched the "185" then the "000"
    // inside 1850000, so a build-artifact hash could fail the safe-shell
    // guard for a price nobody had written. The assertion below is the same
    // shape against whatever the current price is; the 185,000 case is kept
    // beside it because it is the one that actually happened.
    expect(pricePattern(250_000).test('chunk-2500000.js')).toBe(false);
    expect(pricePattern(185_000).test('chunk-1850000.js')).toBe(false);
    expect(pricePattern(95_000).test('9950001')).toBe(false);
  });

  /**
   * The second time this guard misfired, and the digit boundary above could
   * not have caught it: `x` is not a digit, so 10000000 sat inside
   * `0x10000000` with a non-digit on each side and matched cleanly.
   *
   * React's scheduler ships exactly that constant, so on 2026-09-04, while
   * standard Partner was briefly NGN 10,000,000, the safe-shell build
   * started failing on a price nobody had written. That price has since come
   * down to 4,000,000 to fit Paystack's collection limit, and the case is
   * kept at 10,000,000 because that is the amount that actually collided -
   * rewriting it to the current price would test a coincidence instead of
   * the bug. A run of digits inside a hex literal is a number in another
   * base and is never a price a person reads.
   */
  it('does not match a price inside a hexadecimal literal', () => {
    expect(pricePattern(10_000_000).test('case 0x10000000:return 0x10000000;')).toBe(false);
    expect(pricePattern(10_000_000).test('e.pendingLanes|=t,0x10000000!==t')).toBe(false);
    expect(pricePattern(10_000_000).test('0X10000000')).toBe(false);
    // And the price the product actually charges today, against the same
    // constant family.
    expect(pricePattern(4_000_000).test('case 0x4000000:return 0x4000000;')).toBe(false);
  });

  it('still matches the same price when it is genuinely a price', () => {
    // The other half of the fix: narrowing the pattern must not blind it.
    expect(pricePattern(10_000_000).test('NGN 10,000,000/month')).toBe(true);
    expect(pricePattern(4_000_000).test('NGN 4,000,000/month')).toBe(true);
    expect(pricePattern(4_000_000).test('"amountNGN":4000000,')).toBe(true);
  });

  it('still matches a price next to punctuation and words', () => {
    expect(pricePattern(250_000).test('NGN 250,000/month')).toBe(true);
    expect(pricePattern(250_000).test('"amountNGN":250000,')).toBe(true);
    expect(pricePattern(5_000_000).test('(5,000,000)')).toBe(true);
  });
});
