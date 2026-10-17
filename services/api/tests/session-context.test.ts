import { describe, expect, it } from 'vitest';
import type { SessionContext } from '@zoryvex/contracts';
import { requireFounderStepUp } from '../src/http/session-context';
import { ForbiddenError } from '../src/errors/typed-errors';

const NOW = new Date('2026-08-19T00:20:00.000Z');

function session(overrides: Partial<SessionContext> = {}): SessionContext {
  return {
    accountId: 'acct_1',
    email: 'founder@example.com',
    role: 'founder_admin',
    ...overrides,
  };
}

describe('requireFounderStepUp', () => {
  it('throws for a non-founder_admin role, even with a recent stepUpVerifiedAt', () => {
    expect(() =>
      requireFounderStepUp(
        session({ role: 'employer_admin', stepUpVerifiedAt: NOW.toISOString() }),
        NOW,
      ),
    ).toThrow(ForbiddenError);
  });

  it('throws when the session has never stepped up', () => {
    expect(() => requireFounderStepUp(session(), NOW)).toThrow(ForbiddenError);
  });

  it('allows a founder_admin session stepped up 1 minute ago', () => {
    const verifiedAt = new Date(NOW.getTime() - 60_000).toISOString();
    expect(() =>
      requireFounderStepUp(session({ stepUpVerifiedAt: verifiedAt }), NOW),
    ).not.toThrow();
  });

  it('throws once the step-up window (15 minutes) has elapsed', () => {
    const verifiedAt = new Date(NOW.getTime() - 16 * 60_000).toISOString();
    expect(() => requireFounderStepUp(session({ stepUpVerifiedAt: verifiedAt }), NOW)).toThrow(
      ForbiddenError,
    );
  });

  it('throws for a stepUpVerifiedAt in the future (clock-skew/tamper defensive check)', () => {
    const verifiedAt = new Date(NOW.getTime() + 60_000).toISOString();
    expect(() => requireFounderStepUp(session({ stepUpVerifiedAt: verifiedAt }), NOW)).toThrow(
      ForbiddenError,
    );
  });
});
