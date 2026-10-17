import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Account } from '@zoryvex/contracts';
import {
  consumeSignInCode,
  reissueCsrfToken,
  requestSignInCode,
  revokeAllSessionsForAccount,
  signOut,
  verifySession,
  type AuthDependencies,
  type SelfServeRole,
} from '../src/domain/auth-service';
import { hmacHash } from '../src/crypto/tokens';
import type { AuthTokenRecord } from '../src/repositories/auth-token-repository';
import type { SessionRecord } from '../src/repositories/session-repository';
import { TooManyRequestsError, UnauthorizedError } from '../src/errors/typed-errors';

const PEPPER = 'test-pepper';

/** Hand-written in-memory fake — same seam the real AWS repositories fill. */
function createFakeDeps(now: { value: Date }) {
  const accountsByEmail = new Map<string, Account>();
  const tokensByHash = new Map<string, AuthTokenRecord>();
  const sessionsByHash = new Map<string, SessionRecord>();
  const sessionsByEmail = new Map<string, Set<string>>();
  const rateLimitCounts = new Map<string, number>();
  const sentEmails: { to: string; magicLinkUrl: string }[] = [];

  const deps: AuthDependencies = {
    clock: { now: () => now.value },
    async getAuthTokenPepper() {
      return PEPPER;
    },
    async getAccountByEmail(email) {
      return accountsByEmail.get(email.toLowerCase()) ?? null;
    },
    async createCandidateAccountAndProfile({ email }) {
      const id = randomUUID();
      const account: Account = {
        id,
        email: email.toLowerCase(),
        role: 'candidate',
        candidateId: id,
        createdAt: now.value.toISOString(),
      };
      accountsByEmail.set(account.email, account);
      return account;
    },
    async createEmployerAdminAccountAndProfile({ email }) {
      const id = randomUUID();
      const account: Account = {
        id,
        email: email.toLowerCase(),
        role: 'employer_admin',
        employerId: id,
        createdAt: now.value.toISOString(),
      };
      accountsByEmail.set(account.email, account);
      return account;
    },
    async createAuthToken(input) {
      tokensByHash.set(input.tokenHash, { ...input, consumed: false });
    },
    async consumeAuthToken(tokenHash) {
      const record = tokensByHash.get(tokenHash);
      if (!record || record.consumed) return null;
      record.consumed = true;
      return record;
    },
    async createSession(record) {
      sessionsByHash.set(record.sessionIdHash, record);
      const set = sessionsByEmail.get(record.accountEmail) ?? new Set();
      set.add(record.sessionIdHash);
      sessionsByEmail.set(record.accountEmail, set);
    },
    async getSession(sessionIdHash, at) {
      const record = sessionsByHash.get(sessionIdHash);
      if (!record) return null;
      if (new Date(record.idleExpiresAt) < at || new Date(record.absoluteExpiresAt) < at)
        return null;
      return record;
    },
    async rotateSessionCsrfToken(sessionIdHash, csrfTokenHash, idleExpiresAt) {
      const record = sessionsByHash.get(sessionIdHash);
      if (!record) throw new Error('session not found');
      sessionsByHash.set(sessionIdHash, {
        ...record,
        csrfTokenHash,
        ...(idleExpiresAt !== undefined ? { idleExpiresAt } : {}),
      });
    },
    async deleteSession(sessionIdHash, accountEmail) {
      sessionsByHash.delete(sessionIdHash);
      sessionsByEmail.get(accountEmail)?.delete(sessionIdHash);
    },
    async revokeAllSessions(accountEmail) {
      const set = sessionsByEmail.get(accountEmail) ?? new Set();
      for (const hash of set) sessionsByHash.delete(hash);
      const count = set.size;
      sessionsByEmail.set(accountEmail, new Set());
      return count;
    },
    async checkRateLimit({ kind, key, limit }) {
      const mapKey = `${kind}#${key}`;
      const count = (rateLimitCounts.get(mapKey) ?? 0) + 1;
      rateLimitCounts.set(mapKey, count);
      return { allowed: count <= limit };
    },
    async sendSignInEmail(input) {
      sentEmails.push(input);
    },
  };

  return { deps, accountsByEmail, tokensByHash, sessionsByHash, sentEmails };
}

function extractToken(magicLinkUrl: string): string {
  const fragment = magicLinkUrl.split('#token=')[1];
  if (!fragment) throw new Error('no token in magic link');
  return fragment;
}

function lastMagicLinkToken(sentEmails: { magicLinkUrl: string }[]): string {
  const last = sentEmails.at(-1);
  if (!last) throw new Error('no email was sent');
  return extractToken(last.magicLinkUrl);
}

async function seedFounderAdmin(accountsByEmail: Map<string, Account>) {
  const account: Account = {
    id: randomUUID(),
    email: 'founder@zoryvex.space',
    role: 'founder_admin',
    createdAt: new Date().toISOString(),
  };
  accountsByEmail.set(account.email, account);
  return account;
}

describe('requestSignInCode', () => {
  let now: { value: Date };

  beforeEach(() => {
    now = { value: new Date('2026-08-19T00:00:00.000Z') };
  });

  it('always returns the same generic response for a new email', async () => {
    const { deps } = createFakeDeps(now);
    const result = await requestSignInCode(
      {
        email: 'new@example.com',
        intendedRole: 'candidate',
        sourceIp: '1.2.3.4',
        appOrigin: 'https://app',
      },
      deps,
    );
    expect(result).toEqual({ requested: true });
  });

  it('returns the identical generic response for an existing account (no enumeration signal)', async () => {
    const { deps, accountsByEmail } = createFakeDeps(now);
    accountsByEmail.set('existing@example.com', {
      id: 'acct_1',
      email: 'existing@example.com',
      role: 'candidate',
      candidateId: 'acct_1',
      createdAt: now.value.toISOString(),
    });
    const result = await requestSignInCode(
      {
        email: 'existing@example.com',
        intendedRole: 'candidate',
        sourceIp: '1.2.3.4',
        appOrigin: 'https://app',
      },
      deps,
    );
    expect(result).toEqual({ requested: true });
  });

  it('sends an email containing a fragment-delivered token, never a query/path token', async () => {
    const { deps, sentEmails } = createFakeDeps(now);
    await requestSignInCode(
      {
        email: 'a@example.com',
        intendedRole: 'candidate',
        sourceIp: '1.2.3.4',
        appOrigin: 'https://app',
      },
      deps,
    );
    expect(sentEmails).toHaveLength(1);
    expect(sentEmails[0]?.magicLinkUrl).toMatch(/^https:\/\/app\/auth\/callback#token=/);
  });

  it('throws TooManyRequestsError once the per-email limit is exceeded', async () => {
    const { deps } = createFakeDeps(now);
    for (let i = 0; i < 5; i += 1) {
      await requestSignInCode(
        {
          email: 'x@example.com',
          intendedRole: 'candidate',
          sourceIp: `1.2.3.${i}`,
          appOrigin: 'https://app',
        },
        deps,
      );
    }
    await expect(
      requestSignInCode(
        {
          email: 'x@example.com',
          intendedRole: 'candidate',
          sourceIp: '1.2.3.99',
          appOrigin: 'https://app',
        },
        deps,
      ),
    ).rejects.toBeInstanceOf(TooManyRequestsError);
  });
});

describe('consumeSignInCode', () => {
  let now: { value: Date };

  beforeEach(() => {
    now = { value: new Date('2026-08-19T00:00:00.000Z') };
  });

  async function requestAndExtractToken(
    deps: AuthDependencies,
    sentEmails: { magicLinkUrl: string }[],
    input: { email: string; intendedRole: SelfServeRole },
  ) {
    await requestSignInCode({ ...input, sourceIp: '1.2.3.4', appOrigin: 'https://app' }, deps);
    const last = sentEmails.at(-1);
    if (!last) throw new Error('no email was sent');
    return extractToken(last.magicLinkUrl);
  }

  it('creates a new candidate account and issues a session on first sign-in', async () => {
    const { deps, sentEmails } = createFakeDeps(now);
    const token = await requestAndExtractToken(deps, sentEmails, {
      email: 'new-candidate@example.com',
      intendedRole: 'candidate',
    });
    const issued = await consumeSignInCode({ token }, deps);
    expect(issued.account.role).toBe('candidate');
    expect(issued.account.candidateId).toBeDefined();
    expect(issued.sessionId).toBeTruthy();
    expect(issued.csrfToken).toBeTruthy();
  });

  it('resolves an existing account by its real stored role, ignoring the request-time intendedRole', async () => {
    const { deps, accountsByEmail, sentEmails } = createFakeDeps(now);
    const founder = await seedFounderAdmin(accountsByEmail);
    // Founder requests a code using one of the two self-serve enum values —
    // the account already exists, so the stored role always wins (server-
    // issued, never client-selected).
    const token = await requestAndExtractToken(deps, sentEmails, {
      email: founder.email,
      intendedRole: 'candidate',
    });
    const issued = await consumeSignInCode({ token }, deps);
    expect(issued.account.role).toBe('founder_admin');
  });

  it('rejects a token that was never issued (wrong code)', async () => {
    const { deps } = createFakeDeps(now);
    await expect(consumeSignInCode({ token: 'not-a-real-token' }, deps)).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
  });

  it('rejects a token twice (replay after consumption)', async () => {
    const { deps, sentEmails } = createFakeDeps(now);
    const token = await requestAndExtractToken(deps, sentEmails, {
      email: 'replay@example.com',
      intendedRole: 'candidate',
    });
    await consumeSignInCode({ token }, deps);
    await expect(consumeSignInCode({ token }, deps)).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('rejects an expired token even though it was never explicitly consumed before', async () => {
    const { deps, sentEmails } = createFakeDeps(now);
    const token = await requestAndExtractToken(deps, sentEmails, {
      email: 'expired@example.com',
      intendedRole: 'candidate',
    });
    now.value = new Date(now.value.getTime() + 11 * 60_000); // past the 10-minute TTL
    await expect(consumeSignInCode({ token }, deps)).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('produces the identical error for wrong/expired/replayed tokens (no distinguishing signal)', async () => {
    const { deps, sentEmails } = createFakeDeps(now);
    const token = await requestAndExtractToken(deps, sentEmails, {
      email: 'generic-error@example.com',
      intendedRole: 'candidate',
    });
    await consumeSignInCode({ token }, deps); // consume it once, legitimately

    let replayedMessage: string | undefined;
    try {
      await consumeSignInCode({ token }, deps);
    } catch (error) {
      replayedMessage = error instanceof Error ? error.message : undefined;
    }

    let neverIssuedMessage: string | undefined;
    try {
      await consumeSignInCode({ token: 'totally-invented-token' }, deps);
    } catch (error) {
      neverIssuedMessage = error instanceof Error ? error.message : undefined;
    }

    expect(replayedMessage).toBe(neverIssuedMessage);
  });
});

describe('session lifecycle', () => {
  let now: { value: Date };

  beforeEach(() => {
    now = { value: new Date('2026-08-19T00:00:00.000Z') };
  });

  async function signInFreshCandidate(
    deps: AuthDependencies,
    sentEmails: { magicLinkUrl: string }[],
  ) {
    await requestSignInCode(
      {
        email: 'session-test@example.com',
        intendedRole: 'candidate',
        sourceIp: '1.2.3.4',
        appOrigin: 'https://app',
      },
      deps,
    );
    const token = lastMagicLinkToken(sentEmails);
    return consumeSignInCode({ token }, deps);
  }

  it('verifySession succeeds for a freshly issued session', async () => {
    const { deps, sentEmails } = createFakeDeps(now);
    const issued = await signInFreshCandidate(deps, sentEmails);
    const session = await verifySession(issued.sessionId, deps);
    expect(session).not.toBeNull();
    expect(session?.accountId).toBe(issued.account.id);
  });

  it('verifySession fails for a session id that was never issued (cross-tenant/forged session reuse)', async () => {
    const { deps } = createFakeDeps(now);
    const session = await verifySession('a-forged-session-id-nobody-issued', deps);
    expect(session).toBeNull();
  });

  /**
   * The duration itself, pinned.
   *
   * This number has moved four times and always in one direction, because
   * every expiry on a magic-link product sends somebody back to their inbox.
   * The founder set it to a year on 2026-09-09. The tests either side of this
   * one prove the clock still ends a session; this one proves it ends it when
   * it was asked to, so a future edit cannot quietly shorten it and still go
   * green.
   *
   * Asserted through the cookie's own Max-Age, which is what the browser
   * actually obeys, rather than by reading the table back.
   */
  it('gives a candidate a session that lasts a year, per the founder instruction', async () => {
    const { deps, sentEmails } = createFakeDeps(now);
    const issued = await signInFreshCandidate(deps, sentEmails);

    expect(issued.maxAgeSeconds).toBe(365 * 24 * 60 * 60);

    // A day short of the year still works; a day past it does not.
    now.value = new Date(now.value.getTime() + 364 * 24 * 60 * 60_000);
    expect(await verifySession(issued.sessionId, deps)).not.toBeNull();

    now.value = new Date(now.value.getTime() + 2 * 24 * 60 * 60_000);
    expect(await verifySession(issued.sessionId, deps)).toBeNull();
  });

  it('verifySession fails once the idle expiry has passed', async () => {
    const { deps, sentEmails } = createFakeDeps(now);
    const issued = await signInFreshCandidate(deps, sentEmails);
    // Past the candidate idle window, which is a year (founder instruction,
    // 2026-09-09). A magic-link product sends every expiry back to the inbox,
    // and the complaint that set this number was having to go there at all.
    // The clock still exists and still ends the session; it is the duration
    // that moved, not the rule.
    now.value = new Date(now.value.getTime() + 366 * 24 * 60 * 60_000);
    const session = await verifySession(issued.sessionId, deps);
    expect(session).toBeNull();
  });

  it('reissueCsrfToken returns a new plaintext token that verifies against the rotated hash', async () => {
    const { deps, sentEmails } = createFakeDeps(now);
    const issued = await signInFreshCandidate(deps, sentEmails);
    const reissued = await reissueCsrfToken(issued.sessionId, deps);
    expect(reissued).not.toBeNull();
    expect(reissued?.csrfToken).toBeTruthy();
    expect(reissued?.csrfToken).not.toBe(issued.csrfToken);
    const pepper = await deps.getAuthTokenPepper();
    const refreshed = await verifySession(issued.sessionId, deps);
    expect(refreshed?.csrfTokenHash).toBe(hmacHash(pepper, reissued!.csrfToken));
  });

  it('reissueCsrfToken returns null for a session that was never issued', async () => {
    const { deps } = createFakeDeps(now);
    const reissued = await reissueCsrfToken('a-forged-session-id-nobody-issued', deps);
    expect(reissued).toBeNull();
  });

  it('reissueCsrfToken returns null once the idle expiry has passed', async () => {
    const { deps, sentEmails } = createFakeDeps(now);
    const issued = await signInFreshCandidate(deps, sentEmails);
    now.value = new Date(now.value.getTime() + 366 * 24 * 60 * 60_000);
    const reissued = await reissueCsrfToken(issued.sessionId, deps);
    expect(reissued).toBeNull();
  });

  /**
   * ADR 0001 requires an IDLE expiry, not a second absolute one. Before this
   * was fixed, `idleExpiresAt` was written once at sign-in and never moved,
   * so a continuously active user was still signed out 30 minutes after
   * signing in and the 12-hour absolute deadline could never bind.
   */
  it('keeps a continuously active session alive well past the 30-minute idle window', async () => {
    const { deps, sentEmails } = createFakeDeps(now);
    const issued = await signInFreshCandidate(deps, sentEmails);

    // Simulate a user working for two hours, with a page load (which is what
    // calls GET /auth/session) every 20 minutes — always inside the idle
    // window, so the session should never lapse.
    for (let elapsed = 20; elapsed <= 120; elapsed += 20) {
      now.value = new Date(now.value.getTime() + 20 * 60_000);
      const reissued = await reissueCsrfToken(issued.sessionId, deps);
      expect(
        reissued,
        `session died after ${elapsed} minutes of continuous activity`,
      ).not.toBeNull();
    }

    expect(await verifySession(issued.sessionId, deps)).not.toBeNull();
  });

  it('still expires an active session at the absolute deadline', async () => {
    const { deps, sentEmails } = createFakeDeps(now);
    const issued = await signInFreshCandidate(deps, sentEmails);

    // A page load a day for longer than the absolute cap, which is a year.
    // Sliding the idle window must never carry a session past it, or
    // "absolute" would mean nothing whatever the durations are. This is the
    // test that keeps ADR 0001's second clock real: the duration is the
    // founder's to set, the existence of the cap is not.
    for (let i = 0; i < 370; i += 1) {
      now.value = new Date(now.value.getTime() + 24 * 60 * 60_000);
      await reissueCsrfToken(issued.sessionId, deps);
    }

    expect(await verifySession(issued.sessionId, deps)).toBeNull();
  });

  it('still expires a session that goes idle for longer than the idle window', async () => {
    const { deps, sentEmails } = createFakeDeps(now);
    const issued = await signInFreshCandidate(deps, sentEmails);

    // Active, then walks away. Refreshing on activity must not weaken the
    // idle rule itself.
    now.value = new Date(now.value.getTime() + 20 * 60_000);
    expect(await reissueCsrfToken(issued.sessionId, deps)).not.toBeNull();

    now.value = new Date(now.value.getTime() + 366 * 24 * 60 * 60_000);
    expect(await verifySession(issued.sessionId, deps)).toBeNull();
  });

  it('signOut invalidates the session (verifySession then fails)', async () => {
    const { deps, sentEmails } = createFakeDeps(now);
    const issued = await signInFreshCandidate(deps, sentEmails);
    await signOut(issued.sessionId, deps);
    const session = await verifySession(issued.sessionId, deps);
    expect(session).toBeNull();
  });

  it('signOut is idempotent for an already-invalid session id', async () => {
    const { deps } = createFakeDeps(now);
    await expect(signOut('never-issued', deps)).resolves.toBeUndefined();
  });

  it('revokeAllSessionsForAccount invalidates every session for that account', async () => {
    const { deps, sentEmails } = createFakeDeps(now);
    const issuedA = await signInFreshCandidate(deps, sentEmails);
    // A second sign-in for the same now-existing account issues a second session.
    await requestSignInCode(
      {
        email: 'session-test@example.com',
        intendedRole: 'candidate',
        sourceIp: '5.6.7.8',
        appOrigin: 'https://app',
      },
      deps,
    );
    const secondToken = lastMagicLinkToken(sentEmails);
    const issuedB = await consumeSignInCode({ token: secondToken }, deps);

    const revokedCount = await revokeAllSessionsForAccount('session-test@example.com', deps);
    expect(revokedCount).toBe(2);
    expect(await verifySession(issuedA.sessionId, deps)).toBeNull();
    expect(await verifySession(issuedB.sessionId, deps)).toBeNull();
  });
});

describe('hmacHash keying (defense-in-depth sanity check)', () => {
  it('a session id hashed with a different pepper never matches the stored hash', () => {
    const stored = hmacHash(PEPPER, 'some-session-id');
    const attacker = hmacHash('attacker-guessed-pepper', 'some-session-id');
    expect(stored).not.toBe(attacker);
  });
});
