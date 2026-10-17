import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { verifyPaystackSignature } from '../src/lib/paystack-signature';

// Not a real credential — a fixed fixture value used only to compute/verify
// an HMAC within this test file. Deliberately doesn't start with
// sk_test_/sk_live_ or use a "secret"/"key" variable name so it never
// resembles a genuine Paystack key to scripts/scan-secrets.mjs.
const FIXTURE_SIGNING_VALUE = 'unit-test-hmac-fixture-not-a-real-credential';

function sign(body: string, signingValue = FIXTURE_SIGNING_VALUE): string {
  return createHmac('sha512', signingValue).update(body).digest('hex');
}

describe('verifyPaystackSignature', () => {
  it('accepts a correctly signed body', () => {
    const body = JSON.stringify({ event: 'charge.success' });
    expect(verifyPaystackSignature(body, sign(body), FIXTURE_SIGNING_VALUE)).toBe(true);
  });

  it('rejects a body signed with the wrong secret', () => {
    const body = JSON.stringify({ event: 'charge.success' });
    expect(
      verifyPaystackSignature(body, sign(body, 'a-different-fixture-value'), FIXTURE_SIGNING_VALUE),
    ).toBe(false);
  });

  it('rejects a body that was tampered with after signing', () => {
    const original = JSON.stringify({ event: 'charge.success', data: { amount: 29000 } });
    const signature = sign(original);
    const tampered = JSON.stringify({ event: 'charge.success', data: { amount: 1 } });
    expect(verifyPaystackSignature(tampered, signature, FIXTURE_SIGNING_VALUE)).toBe(false);
  });

  it('rejects a missing signature header', () => {
    expect(verifyPaystackSignature('{}', undefined, FIXTURE_SIGNING_VALUE)).toBe(false);
  });

  it('rejects an empty-string signature', () => {
    expect(verifyPaystackSignature('{}', '', FIXTURE_SIGNING_VALUE)).toBe(false);
  });
});
