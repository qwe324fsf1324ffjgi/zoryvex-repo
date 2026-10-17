import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Paystack signs every webhook with HMAC-SHA512 of the exact raw request
 * body, hex-encoded, in the x-paystack-signature header (verified live via
 * WebSearch against Paystack's own docs, not guessed). Must run against
 * the raw body string, before any JSON.parse — a re-serialized body can
 * byte-for-byte differ from what was signed.
 */
export function verifyPaystackSignature(
  rawBody: string,
  signatureHeader: string | undefined,
  secretKey: string,
): boolean {
  if (!signatureHeader) return false;
  const expectedHex = createHmac('sha512', secretKey).update(rawBody).digest('hex');
  const expected = Buffer.from(expectedHex);
  const provided = Buffer.from(signatureHeader);
  if (expected.length !== provided.length) return false;
  return timingSafeEqual(expected, provided);
}
