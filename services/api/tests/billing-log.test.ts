import { describe, expect, it } from 'vitest';
import { redactForLog, safeFailureMessage } from '../src/lib/billing-log';

describe('redactForLog', () => {
  /**
   * CLAUDE.md's rule is absolute: never print, log, commit or send a
   * secret. Billing is where that rule is hardest to keep, because the
   * fields most worth logging are the ones that can charge a card or
   * cancel a subscription.
   */
  it.each([
    'authorization',
    'authorization_code',
    'email_token',
    'token',
    'secret_key',
    'signature',
    'cvv',
    'bvn',
    'account_number',
  ])('removes the value of %s', (key) => {
    expect(redactForLog({ [key]: 'sensitive' })).toEqual({ [key]: '[redacted]' });
  });

  it('matches the key regardless of case', () => {
    expect(redactForLog({ Authorization: 'Bearer x' })).toEqual({ Authorization: '[redacted]' });
  });

  it('redacts nested values, not just top-level ones', () => {
    const payload = { data: { subscription: { email_token: 'tok', status: 'active' } } };
    expect(redactForLog(payload)).toEqual({
      data: { subscription: { email_token: '[redacted]', status: 'active' } },
    });
  });

  /**
   * The key-name rules cannot catch a key that reached a log through an
   * error message or a URL, so the string scrub runs over every value.
   */
  it.each(['sk_test_', 'sk_live_', 'pk_test_', 'pk_live_'])(
    'scrubs a %s key found inside prose',
    (prefix) => {
      const line = redactForLog({
        message: `Paystack rejected the call with ${prefix}abc123XYZ in the header`,
      }) as { message: string };
      expect(line.message).not.toContain(`${prefix}abc123XYZ`);
      expect(line.message).toContain('REDACTED');
    },
  );

  it('leaves the ordinary fields alone, so a log stays useful', () => {
    expect(
      redactForLog({ reference: 'sub.emp_1.a1', amountNGN: 79_000, status: 'success' }),
    ).toEqual({ reference: 'sub.emp_1.a1', amountNGN: 79_000, status: 'success' });
  });

  it('handles arrays without losing their shape', () => {
    expect(redactForLog([{ token: 'x' }, { status: 'ok' }])).toEqual([
      { token: '[redacted]' },
      { status: 'ok' },
    ]);
  });

  /**
   * A webhook payload is attacker-influenced input. A deeply nested body
   * should cost a truncated log line, never a stack overflow inside the
   * logger of the handler that was trying to report the problem.
   */
  it('stops at a depth limit instead of recursing without bound', () => {
    let deep: Record<string, unknown> = { end: 'value' };
    for (let i = 0; i < 30; i += 1) deep = { nested: deep };
    expect(() => redactForLog(deep)).not.toThrow();
    expect(JSON.stringify(redactForLog(deep))).toContain('depth limit');
  });

  it('truncates a very long array rather than logging all of it', () => {
    const long = Array.from({ length: 500 }, (_, i) => i);
    expect((redactForLog(long) as unknown[]).length).toBe(50);
  });

  it('passes null and primitives straight through', () => {
    expect(redactForLog(null)).toBeNull();
    expect(redactForLog(42)).toBe(42);
    expect(redactForLog(true)).toBe(true);
  });
});

describe('safeFailureMessage', () => {
  /**
   * Paystack's `gateway_response` is written for a merchant. It names
   * banks and processor codes, and repeating it to whoever holds the
   * session is an information leak dressed up as helpfulness.
   */
  it.each([
    ['Insufficient Funds', 'insufficient funds'],
    ['Card expired', 'expired'],
    ['Declined by issuer', 'declined the payment'],
    ['Invalid card number', 'not accepted'],
    ['Transaction timed out', 'timed out'],
  ])('turns %j into something the customer can act on', (raw, expected) => {
    expect(safeFailureMessage(raw).toLowerCase()).toContain(expected);
  });

  it('falls back to a neutral sentence for anything it does not recognize', () => {
    const message = safeFailureMessage('ERR_49123 acquirer route unavailable [GTB-NIP]');
    expect(message).not.toContain('GTB');
    expect(message).not.toContain('ERR_49123');
    expect(message).toContain('Nothing was charged');
  });

  it('says something true when Paystack gave no reason at all', () => {
    expect(safeFailureMessage(null)).toContain('Nothing was charged');
    expect(safeFailureMessage(undefined)).toContain('Nothing was charged');
  });
});
