import { describe, expect, it } from 'vitest';
import {
  buildKitReference,
  buildSubscriptionReference,
  isValidPaystackReference,
  parsePaymentReference,
} from '../src/domain/payment-reference';

const ROLE_ID = '2f1a7c34-1b6e-4d0a-9f2c-5c9a1b2d3e4f';
const KIT_ORDER_ID = '9b8c7d6e-5f4a-3b2c-1d0e-9f8a7b6c5d4e';
const EMPLOYER_ID = 'aa11bb22-cc33-dd44-ee55-ff6677889900';
const ATTEMPT_ID = '00112233-4455-6677-8899-aabbccddeeff';

describe('isValidPaystackReference', () => {
  /**
   * Paystack rejects anything outside alphanumerics plus `-`, `.` and `=`.
   * A `:` separator was tried on 2026-08-26 and came back "Invalid
   * character in transaction reference", which is why every reference here
   * uses `.`.
   */
  it('accepts the characters Paystack accepts', () => {
    expect(isValidPaystackReference('abc-123.def=456')).toBe(true);
  });

  it.each([':', '#', ' ', '/', '@'])('rejects %s', (character) => {
    expect(isValidPaystackReference(`abc${character}123`)).toBe(false);
  });

  it('rejects an empty reference', () => {
    expect(isValidPaystackReference('')).toBe(false);
  });

  it('accepts both reference shapes this service builds', () => {
    expect(isValidPaystackReference(buildKitReference(ROLE_ID, KIT_ORDER_ID))).toBe(true);
    expect(isValidPaystackReference(buildSubscriptionReference(EMPLOYER_ID, ATTEMPT_ID))).toBe(
      true,
    );
  });
});

describe('parsePaymentReference', () => {
  it('reads a subscription reference back to its employer and attempt', () => {
    const reference = buildSubscriptionReference(EMPLOYER_ID, ATTEMPT_ID);
    expect(parsePaymentReference(reference)).toEqual({
      kind: 'subscription',
      employerId: EMPLOYER_ID,
      attemptId: ATTEMPT_ID,
    });
  });

  /**
   * The Kit form predates the subscription one and has real transactions
   * against it, including a live TEST purchase from 2026-08-26. It must
   * keep parsing exactly as it did.
   */
  it('still reads the original two-part Kit reference', () => {
    expect(parsePaymentReference(buildKitReference(ROLE_ID, KIT_ORDER_ID))).toEqual({
      kind: 'kit',
      roleId: ROLE_ID,
      kitOrderId: KIT_ORDER_ID,
    });
  });

  /**
   * Every subscription renewal charge carries a reference Paystack
   * generated, not ours. Returning null is the correct answer and the
   * caller attributes it through the customer code instead.
   */
  it('returns null for a reference Paystack generated', () => {
    expect(parsePaymentReference('9cfbae6e-bbf3-5b41-8aef-d72c1a17650g')).toBeNull();
  });

  it('returns null rather than salvaging a longer subscription reference', () => {
    // Salvaging the first three segments of something else is exactly how a
    // payment gets attributed to the wrong organization.
    expect(parsePaymentReference(`sub.${EMPLOYER_ID}.${ATTEMPT_ID}.extra`)).toBeNull();
  });

  it('returns null for a three-part reference that is not a subscription', () => {
    expect(parsePaymentReference('a.b.c')).toBeNull();
  });

  it.each(['', 'sub..attempt', 'sub.employer.', '.kit', 'role.'])(
    'returns null for the malformed reference %j',
    (reference) => {
      expect(parsePaymentReference(reference)).toBeNull();
    },
  );

  it('never mistakes a role id for the subscription prefix', () => {
    // A roleId is a UUID and can never be the literal "sub", which is what
    // makes the two shapes unambiguous without a version marker.
    const parsed = parsePaymentReference(buildKitReference(ROLE_ID, KIT_ORDER_ID));
    expect(parsed?.kind).toBe('kit');
  });
});
