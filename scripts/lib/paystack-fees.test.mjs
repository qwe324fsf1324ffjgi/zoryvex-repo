import { describe, expect, it } from 'vitest';
import {
  INTERNATIONAL,
  LOCAL,
  STARTER_LIFETIME_COLLECTION_NGN,
  chargesBeforeLimit,
  feeNGN,
  internationalFeeNGN,
  isLocalFeeCapped,
  localFeeNGN,
  settlementRow,
} from './paystack-fees.mjs';

describe('local card fees', () => {
  it('charges 1.5% plus NGN 100 below the cap', () => {
    // The Kit at 95,000: 1,425 + 100.
    expect(localFeeNGN(95_000)).toBe(1_525);
    // Founding Scout at 79,000: 1,185 + 100.
    expect(localFeeNGN(79_000)).toBe(1_285);
  });

  it('caps at NGN 2,000', () => {
    expect(localFeeNGN(229_000)).toBe(2_000);
    expect(localFeeNGN(1_350_000)).toBe(2_000);
  });

  it('crosses the cap at the exact amount the formula does', () => {
    // 1.5% + 100 = 2,000 at 126,666.67, so 126,666 is under and 126,667 is on.
    expect(isLocalFeeCapped(126_666)).toBe(false);
    expect(isLocalFeeCapped(126_667)).toBe(true);
    expect(localFeeNGN(126_667)).toBe(2_000);
  });

  it('waives the flat NGN 100 below NGN 2,500', () => {
    // No Zoryvex SKU is this small. Encoded so the model stays true to
    // Paystack's published rule rather than to the prices that happen to
    // exist today.
    expect(localFeeNGN(2_000)).toBe(30);
    expect(localFeeNGN(2_500)).toBe(137.5);
  });
});

describe('international card fees', () => {
  it('charges 3.9% plus NGN 100 with no cap', () => {
    expect(internationalFeeNGN(95_000)).toBe(3_805);
    expect(internationalFeeNGN(1_350_000)).toBe(52_750);
  });

  it('is uncapped, unlike the local rate', () => {
    expect(INTERNATIONAL.cap).toBe(Infinity);
    expect(LOCAL.cap).toBe(2_000);
    // The gap the founder is actually exposed to: on the largest SKU an
    // international card costs over 25x what a local one does.
    expect(internationalFeeNGN(1_350_000) / localFeeNGN(1_350_000)).toBeGreaterThan(25);
  });
});

describe('settlementRow', () => {
  it('reproduces the founding rows that predate the price raise', () => {
    // These four were in docs/PRODUCT_SPEC.md before 2026-08-30 and were not
    // changed by it. Reproducing them exactly is what shows the formula here
    // is the one the table was originally built with, rather than a
    // plausible-looking formula fitted to the new numbers.
    expect(settlementRow(79_000)).toMatchObject({
      localFee: 1_285,
      localSettlement: 77_715,
      intlFee: 3_181,
      intlSettlement: 75_819,
    });
    expect(settlementRow(229_000)).toMatchObject({
      localFee: 2_000,
      localSettlement: 227_000,
      intlFee: 9_031,
      intlSettlement: 219_969,
    });
    expect(settlementRow(599_000)).toMatchObject({
      localFee: 2_000,
      localSettlement: 597_000,
      intlFee: 23_461,
      intlSettlement: 575_539,
    });
  });

  it('reports whether the local fee hit the cap', () => {
    expect(settlementRow(95_000).localCapped).toBe(false);
    expect(settlementRow(520_000).localCapped).toBe(true);
  });
});

describe('feeNGN', () => {
  it('takes the rate card as an argument rather than branching on a flag', () => {
    expect(feeNGN(95_000, LOCAL)).toBe(localFeeNGN(95_000));
    expect(feeNGN(95_000, INTERNATIONAL)).toBe(internationalFeeNGN(95_000));
  });
});

describe('chargesBeforeLimit', () => {
  it('uses the limit Paystack currently publishes for a Nigerian Starter Business', () => {
    expect(STARTER_LIFETIME_COLLECTION_NGN).toBe(8_000_000);
  });

  /**
   * The case that motivated this model. Standard Partner was raised to NGN
   * 5,000,000 on 2026-09-01, which is 62.5% of the entire lifetime limit in a
   * single charge. One fits; the first renewal does not. Nothing in the
   * product would have said so.
   */
  it('shows that one standard Partner charge exhausts most of the lifetime limit', () => {
    expect(chargesBeforeLimit(5_000_000)).toBe(1);
  });

  it('counts whole charges only, because a partial charge is a declined one', () => {
    expect(chargesBeforeLimit(3_000_000)).toBe(2);
    expect(chargesBeforeLimit(8_000_000)).toBe(1);
    expect(chargesBeforeLimit(8_000_001)).toBe(0);
  });

  it('accepts a different limit, so a registered business can be modelled too', () => {
    expect(chargesBeforeLimit(5_000_000, 100_000_000)).toBe(20);
  });
});
