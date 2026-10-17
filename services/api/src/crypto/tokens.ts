import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** 256 bits of randomness, URL-safe, per ADR 0001's token-strength requirement. */
export function generateRandomToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Keyed hash (HMAC-SHA256) — never store a raw token/session id, only this. */
export function hmacHash(pepper: string, value: string): string {
  return createHmac('sha256', pepper).update(value).digest('base64url');
}

/** Constant-time comparison for secrets that are compared directly (e.g. CSRF tokens). */
export function timingSafeStringEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
