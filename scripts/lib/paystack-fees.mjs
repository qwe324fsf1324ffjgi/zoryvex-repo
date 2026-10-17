// Paystack's Nigerian card fees, as arithmetic rather than as fourteen
// numbers typed into a markdown table.
//
// docs/PRODUCT_SPEC.md carries a settlement table so the founder can see what
// actually lands in the bank per sale. Every figure in it is derived from a
// price, and the prices changed on 2026-08-30. A derived table maintained by
// hand goes wrong silently: nothing about a stale settlement figure looks
// wrong on the page, and the first time anyone finds out is when the money
// does not match.
//
// Rates checked 2026-08-04 and recorded in docs/PRODUCT_SPEC.md. They are
// Paystack's published Nigerian rates, not a negotiated rate, and they must
// be rechecked before live activation — this module encodes the arithmetic,
// not a promise that the rates are still current.

/** Local (Nigerian) cards: 1.5% + NGN 100, capped at NGN 2,000. */
export const LOCAL = { rate: 0.015, flat: 100, cap: 2000, flatWaivedBelow: 2500 };

/** International cards (Mastercard/Visa/Verve): 3.9% + NGN 100, no cap. */
export const INTERNATIONAL = { rate: 0.039, flat: 100, cap: Infinity, flatWaivedBelow: 2500 };

/**
 * Fee for one charge under one rate card. Paystack waives the flat NGN 100 on
 * transactions below NGN 2,500; no Zoryvex price is anywhere near that, but
 * encoding the rule keeps the model honest if a small SKU ever appears.
 */
export function feeNGN(amountNGN, card) {
  const flat = amountNGN < card.flatWaivedBelow ? 0 : card.flat;
  return Math.min(amountNGN * card.rate + flat, card.cap);
}

export function localFeeNGN(amountNGN) {
  return feeNGN(amountNGN, LOCAL);
}

export function internationalFeeNGN(amountNGN) {
  return feeNGN(amountNGN, INTERNATIONAL);
}

/** Whether the local fee landed on the NGN 2,000 cap rather than the formula. */
export function isLocalFeeCapped(amountNGN) {
  return amountNGN * LOCAL.rate + LOCAL.flat > LOCAL.cap;
}

/** Everything one row of the settlement table states, computed. */
export function settlementRow(amountNGN) {
  const localFee = localFeeNGN(amountNGN);
  const intlFee = internationalFeeNGN(amountNGN);
  return {
    amountNGN,
    localFee,
    localCapped: isLocalFeeCapped(amountNGN),
    localSettlement: amountNGN - localFee,
    intlFee,
    intlSettlement: amountNGN - intlFee,
  };
}

/**
 * Paystack's lifetime collection limit for a Nigerian Starter Business.
 *
 * Re-verified 2026-09-01 against support.paystack.com/en/articles/2128898,
 * which is the current article; a legacy support2 page still says NGN
 * 2,000,000 and is wrong. Paystack enforces this on its side and disables
 * collection at the ceiling. Zoryvex must never implement a control that
 * stops, throttles, or pretends to change it (docs/PRODUCT_SPEC.md) — this
 * constant exists so the founder can see, in figures, what a price does to
 * the runway before the business has to be registered.
 */
export const STARTER_LIFETIME_COLLECTION_NGN = 8_000_000;

/**
 * How many charges of one amount fit inside the lifetime limit.
 *
 * Worth computing rather than asserting, because it is the number that
 * changes silently when a price is raised. A monthly subscription priced so
 * that fewer than two charges fit cannot take its own first renewal: the
 * charge is declined at the provider, and Paystack does not retry a failed
 * subscription charge, so the subscription simply stops without an event.
 */
export function chargesBeforeLimit(amountNGN, limitNGN = STARTER_LIFETIME_COLLECTION_NGN) {
  return Math.floor(limitNGN / amountNGN);
}
