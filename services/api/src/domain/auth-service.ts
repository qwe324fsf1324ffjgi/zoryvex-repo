import type { Account, AccountRole } from '@zoryvex/contracts';
import { TooManyRequestsError, UnauthorizedError } from '../errors/typed-errors';
import { generateRandomToken, hmacHash } from '../crypto/tokens';
import type { Clock } from '../repositories/clock-repository';
import type { AuthTokenRecord } from '../repositories/auth-token-repository';
import type { SessionRecord } from '../repositories/session-repository';

const TOKEN_TTL_MINUTES = 10; // ADR 0001 exact value

/**
 * How long a session lives, by who holds it.
 *
 * ADR 0001 requires an idle expiry and an absolute expiry, both enforced
 * server-side. It does not fix the durations, and the ones that shipped —
 * 30 minutes idle, 12 hours absolute, for everybody — turned out to be the
 * wrong trade for two of the three roles.
 *
 * Sign-in here is a link emailed to an address. That is a good property: no
 * password to leak, reuse or phish. It also means every expiry sends a
 * person back to their inbox, and a 12-hour absolute cap does that daily
 * however actively they are using the product. The cost is not only
 * annoyance. A candidate part-way through writing up evidence, or an
 * employer part-way through a shortlist, loses the thread; and a flow that
 * pushes somebody into their email several times a week trains exactly the
 * habit that makes a phishing link work.
 *
 * So the three self-serve roles get durations matched to how the product is
 * really used, picked up over weeks rather than lived in daily.
 *
 * `founder_admin` is deliberately unchanged, at the original 30 minutes and
 * 12 hours, and is the reason this is a table rather than one number. It is
 * a pre-provisioned account that can read the exception queue and act on
 * other people's records, it is never used from a phone on the move, and its
 * blast radius is the whole platform. Convenience is not worth anything
 * there, and ADR 0001's WebAuthn step-up sits behind it for the same reason.
 *
 * Written as a total Record rather than a default with an override, so a
 * role added later cannot silently inherit the long lifetime. It will not
 * compile until somebody decides.
 */
/**
 * A year, for the three roles a person signs into from their own phone.
 *
 * Founder instruction, 2026-09-09: "Make the sign in last 1 year." The
 * complaint behind it was concrete and had been made three times: going back
 * to Gmail for a link is the friction, and 30 days of idle still meant a
 * candidate who checked their profile once a month could be sent to their
 * inbox on the next visit.
 *
 * Idle and absolute are set to the same year on purpose. Setting only the
 * absolute cap to a year would have left the idle clock at 30 days, so
 * somebody who used the product twice a year would still be signed out, and
 * the instruction would have been honoured in the file and not on the
 * screen.
 *
 * ADR 0001 requires both clocks to exist and be enforced server-side, and
 * both still are. It does not name a number. This is the fourth time this
 * value has moved and every move has been in one direction, so the number
 * is the founder's to set and the shape is not.
 *
 * What this costs, said plainly rather than buried: a session cookie stolen
 * from a device stays valid for up to a year. Sign-out and revoke-all are
 * the answer to a lost device, and the shared-device answer is to sign out
 * rather than to rely on a clock nobody was watching.
 */
const ONE_YEAR_IN_MINUTES = 365 * 24 * 60;
const ONE_YEAR_IN_HOURS = 365 * 24;

const SESSION_LIFETIMES: Record<AccountRole, { idleMinutes: number; absoluteHours: number }> = {
  candidate: { idleMinutes: ONE_YEAR_IN_MINUTES, absoluteHours: ONE_YEAR_IN_HOURS },
  employer_admin: { idleMinutes: ONE_YEAR_IN_MINUTES, absoluteHours: ONE_YEAR_IN_HOURS },
  employer_member: { idleMinutes: ONE_YEAR_IN_MINUTES, absoluteHours: ONE_YEAR_IN_HOURS },
  founder_admin: { idleMinutes: 30, absoluteHours: 12 },
};
const REQUEST_CODE_PER_EMAIL_LIMIT = 5;
const REQUEST_CODE_PER_EMAIL_WINDOW_SECONDS = 15 * 60;
const REQUEST_CODE_PER_IP_LIMIT = 20;
const REQUEST_CODE_PER_IP_WINDOW_SECONDS = 15 * 60;

export type SelfServeRole = Extract<AccountRole, 'candidate' | 'employer_admin'>;

/**
 * Dependency-injected seam (same pattern as the existing Clock injection in
 * src/repositories/clock-repository.ts) so this security-critical branching
 * logic is unit-testable without hitting real AWS. The AWS-backed
 * implementation is assembled once per Lambda cold start in
 * src/composition/aws-auth-dependencies.ts.
 */
export interface AuthDependencies {
  clock: Clock;
  getAuthTokenPepper(): Promise<string>;
  getAccountByEmail(email: string): Promise<Account | null>;
  createCandidateAccountAndProfile(input: { email: string }): Promise<Account>;
  createEmployerAdminAccountAndProfile(input: { email: string }): Promise<Account>;
  createAuthToken(input: {
    tokenHash: string;
    email: string;
    intendedRole: SelfServeRole;
    existingAccountId: string | null;
    createdAt: string;
    expiresAt: string;
    ttlEpochSeconds: number;
  }): Promise<void>;
  consumeAuthToken(tokenHash: string): Promise<AuthTokenRecord | null>;
  createSession(record: SessionRecord, ttlEpochSeconds: number): Promise<void>;
  getSession(sessionIdHash: string, now: Date): Promise<SessionRecord | null>;
  rotateSessionCsrfToken(
    sessionIdHash: string,
    csrfTokenHash: string,
    idleExpiresAt?: string,
  ): Promise<void>;
  deleteSession(sessionIdHash: string, accountEmail: string): Promise<void>;
  revokeAllSessions(accountEmail: string): Promise<number>;
  checkRateLimit(input: {
    kind: string;
    key: string;
    windowSeconds: number;
    limit: number;
    now: Date;
  }): Promise<{ allowed: boolean }>;
  sendSignInEmail(input: { to: string; magicLinkUrl: string }): Promise<void>;
}

export interface IssuedSession {
  sessionId: string;
  csrfToken: string;
  account: Account;
  maxAgeSeconds: number;
}

/**
 * ADR 0001: generic response to every request regardless of whether the
 * email matches an account, bounded per-email/per-IP abuse controls, a
 * single-purpose >=256-bit token, 10-minute expiry, keyed hash at rest.
 * `appOrigin` is used only to build the link the recipient clicks — the
 * token itself travels in the URL fragment, which the client clears on
 * load, never in the path/query (never logged by API Gateway/CloudFront as
 * a result).
 */
export async function requestSignInCode(
  input: { email: string; intendedRole: SelfServeRole; sourceIp: string; appOrigin: string },
  deps: AuthDependencies,
): Promise<{ requested: true }> {
  const now = deps.clock.now();
  const email = input.email.toLowerCase();

  const [emailLimit, ipLimit] = await Promise.all([
    deps.checkRateLimit({
      kind: 'request-code-email',
      key: email,
      windowSeconds: REQUEST_CODE_PER_EMAIL_WINDOW_SECONDS,
      limit: REQUEST_CODE_PER_EMAIL_LIMIT,
      now,
    }),
    deps.checkRateLimit({
      kind: 'request-code-ip',
      key: input.sourceIp,
      windowSeconds: REQUEST_CODE_PER_IP_WINDOW_SECONDS,
      limit: REQUEST_CODE_PER_IP_LIMIT,
      now,
    }),
  ]);
  if (!emailLimit.allowed || !ipLimit.allowed) {
    // Still a generic error — does not reveal which bound was hit.
    throw new TooManyRequestsError('Too many sign-in requests. Try again later.');
  }

  const pepper = await deps.getAuthTokenPepper();
  const token = generateRandomToken();
  const tokenHash = hmacHash(pepper, token);
  const expiresAt = new Date(now.getTime() + TOKEN_TTL_MINUTES * 60_000);

  const existingAccount = await deps.getAccountByEmail(email);

  await deps.createAuthToken({
    tokenHash,
    email,
    intendedRole: input.intendedRole,
    existingAccountId: existingAccount?.id ?? null,
    createdAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    ttlEpochSeconds: Math.floor(expiresAt.getTime() / 1000) + 60,
  });

  // Fragment delivery: the client-side callback page reads
  // `location.hash`, clears it immediately, then POSTs the token to
  // consume-code — the token itself never appears in a request path/query
  // string that could be logged.
  const magicLinkUrl = `${input.appOrigin}/auth/callback#token=${token}`;
  await deps.sendSignInEmail({ to: email, magicLinkUrl });

  return { requested: true };
}

/**
 * Atomic conditional consume (docs/DATA_MODEL.md access pattern #14), then
 * resolves or creates the account, then issues a session. Every failure
 * mode (not found, already consumed, expired) throws the identical generic
 * UnauthorizedError — never distinguishing which case occurred.
 */
export async function consumeSignInCode(
  input: { token: string },
  deps: AuthDependencies,
): Promise<IssuedSession> {
  const now = deps.clock.now();
  const pepper = await deps.getAuthTokenPepper();
  const tokenHash = hmacHash(pepper, input.token);

  const record = await deps.consumeAuthToken(tokenHash);
  if (!record) throw new UnauthorizedError('Invalid or expired code');
  if (new Date(record.expiresAt) < now) throw new UnauthorizedError('Invalid or expired code');

  const account = await resolveOrCreateAccount(record, deps);
  return issueSession(account, deps);
}

async function resolveOrCreateAccount(
  record: AuthTokenRecord,
  deps: AuthDependencies,
): Promise<Account> {
  if (record.existingAccountId) {
    const account = await deps.getAccountByEmail(record.email);
    if (account) return account;
    // Extremely unlikely (account deleted between request and consume) —
    // still generic, never a distinct error message.
    throw new UnauthorizedError('Invalid or expired code');
  }
  if (record.intendedRole === 'candidate') {
    return deps.createCandidateAccountAndProfile({ email: record.email });
  }
  return deps.createEmployerAdminAccountAndProfile({ email: record.email });
}

async function issueSession(account: Account, deps: AuthDependencies): Promise<IssuedSession> {
  const now = deps.clock.now();
  const pepper = await deps.getAuthTokenPepper();
  const sessionId = generateRandomToken();
  const csrfToken = generateRandomToken();
  const lifetime = SESSION_LIFETIMES[account.role];
  const idleExpiresAt = new Date(now.getTime() + lifetime.idleMinutes * 60_000);
  const absoluteExpiresAt = new Date(now.getTime() + lifetime.absoluteHours * 60 * 60_000);

  const record: SessionRecord = {
    sessionIdHash: hmacHash(pepper, sessionId),
    accountId: account.id,
    accountEmail: account.email,
    role: account.role,
    candidateId: account.candidateId,
    employerId: account.employerId,
    csrfTokenHash: hmacHash(pepper, csrfToken),
    issuedAt: now.toISOString(),
    idleExpiresAt: idleExpiresAt.toISOString(),
    absoluteExpiresAt: absoluteExpiresAt.toISOString(),
  };

  await deps.createSession(record, Math.floor(absoluteExpiresAt.getTime() / 1000) + 60);

  return {
    sessionId,
    csrfToken,
    account,
    maxAgeSeconds: lifetime.absoluteHours * 60 * 60,
  };
}

export async function verifySession(
  sessionId: string,
  deps: AuthDependencies,
): Promise<SessionRecord | null> {
  const now = deps.clock.now();
  const pepper = await deps.getAuthTokenPepper();
  const sessionIdHash = hmacHash(pepper, sessionId);
  return deps.getSession(sessionIdHash, now);
}

/**
 * The new idle deadline for a session that just showed activity, never
 * beyond its absolute deadline.
 *
 * ADR 0001 requires "idle expiry and absolute expiry, both enforced
 * server-side", but `idleExpiresAt` was previously written once at sign-in
 * and never moved. That made it a second, shorter ABSOLUTE cap rather than
 * an idle one: every session died 30 minutes after sign-in no matter how
 * actively it was being used, and the 12-hour absolute deadline could never
 * be the binding constraint. An employer half-way through evaluating
 * candidates, or a candidate writing up evidence, was simply signed out
 * (found in a 2026-08-27 audit).
 *
 * The refresh rides on the CSRF-rotation write that GET /auth/session
 * already performs on every page mount, so it costs no extra write and
 * needs no IAM change. Deliberately NOT done in the authorizer: that Lambda
 * is granted `dynamodb:GetItem` and nothing else (infrastructure/modules/
 * auth's `ReadSessionItemOnly`), and widening the most exposed, pre-auth
 * Lambda to a writer to save a few minutes of session life is a bad trade.
 */
export function refreshedIdleExpiry(session: SessionRecord, now: Date): string {
  const proposed = now.getTime() + SESSION_LIFETIMES[session.role].idleMinutes * 60_000;
  const absolute = new Date(session.absoluteExpiresAt).getTime();
  return new Date(Math.min(proposed, absolute)).toISOString();
}

/**
 * Called from GET /auth/session on every real page load (useSession()) —
 * re-establishes a fresh, client-usable plaintext CSRF token bound to this
 * existing session, since the client's copy is lost on any full page
 * navigation/reload and there is otherwise no way to recover it short of
 * signing in again. Returns null exactly when verifySession would (session
 * gone, expired, or never issued) — never issues a token for a session
 * that isn't actually valid right now.
 *
 * Also slides the idle deadline forward, since reaching here IS activity.
 */
export async function reissueCsrfToken(
  sessionId: string,
  deps: AuthDependencies,
): Promise<{ session: SessionRecord; csrfToken: string } | null> {
  const session = await verifySession(sessionId, deps);
  if (!session) return null;
  const pepper = await deps.getAuthTokenPepper();
  const csrfToken = generateRandomToken();
  await deps.rotateSessionCsrfToken(
    session.sessionIdHash,
    hmacHash(pepper, csrfToken),
    refreshedIdleExpiry(session, deps.clock.now()),
  );
  return { session, csrfToken };
}

export async function signOut(sessionId: string, deps: AuthDependencies): Promise<void> {
  const pepper = await deps.getAuthTokenPepper();
  const sessionIdHash = hmacHash(pepper, sessionId);
  const now = deps.clock.now();
  const session = await deps.getSession(sessionIdHash, now);
  if (!session) return; // already gone — sign-out is idempotent
  await deps.deleteSession(sessionIdHash, session.accountEmail);
}

export async function revokeAllSessionsForAccount(
  accountEmail: string,
  deps: AuthDependencies,
): Promise<number> {
  return deps.revokeAllSessions(accountEmail);
}
