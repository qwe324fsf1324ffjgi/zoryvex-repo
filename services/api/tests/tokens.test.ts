import { describe, expect, it } from 'vitest';
import { generateRandomToken, hmacHash, timingSafeStringEqual } from '../src/crypto/tokens';

describe('generateRandomToken', () => {
  it('produces at least 256 bits of randomness (32+ raw bytes)', () => {
    const token = generateRandomToken();
    const decoded = Buffer.from(token, 'base64url');
    expect(decoded.length).toBeGreaterThanOrEqual(32);
  });

  it('never repeats across calls', () => {
    const tokens = new Set(Array.from({ length: 100 }, () => generateRandomToken()));
    expect(tokens.size).toBe(100);
  });
});

describe('hmacHash', () => {
  it('is deterministic for the same pepper and value', () => {
    expect(hmacHash('pepper', 'value')).toBe(hmacHash('pepper', 'value'));
  });

  it('differs for a different pepper (keyed, not a bare hash)', () => {
    expect(hmacHash('pepper-a', 'value')).not.toBe(hmacHash('pepper-b', 'value'));
  });

  it('differs for a different value', () => {
    expect(hmacHash('pepper', 'value-a')).not.toBe(hmacHash('pepper', 'value-b'));
  });
});

describe('timingSafeStringEqual', () => {
  it('returns true for equal strings', () => {
    expect(timingSafeStringEqual('abc123', 'abc123')).toBe(true);
  });

  it('returns false for different strings of the same length', () => {
    expect(timingSafeStringEqual('abc123', 'abc124')).toBe(false);
  });

  it('returns false for different-length strings without throwing', () => {
    expect(timingSafeStringEqual('short', 'a-much-longer-string')).toBe(false);
  });
});
