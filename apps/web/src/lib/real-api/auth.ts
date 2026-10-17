import type { AccountRole, SessionContext } from '@zoryvex/contracts';
import { apiRequest, RealApiError, setCsrfToken } from './client';

export interface RealAccount {
  id: string;
  email: string;
  role: AccountRole;
  candidateId?: string;
  employerId?: string;
}

/** ADR 0001: generic response either way — the caller cannot tell from this alone whether the email had an account. */
export async function requestSignIn(
  email: string,
  intendedRole: Extract<AccountRole, 'candidate' | 'employer_admin'>,
): Promise<void> {
  await apiRequest('/auth/request-code', { method: 'POST', body: { email, intendedRole } });
}

/**
 * Consumes the magic-link token (from the URL fragment, never a
 * path/query string — see /auth/callback). Captures the returned CSRF
 * token into client.ts's in-memory store so subsequent mutating calls in
 * this same page session can succeed.
 */
export async function consumeSignInToken(
  token: string,
): Promise<{ account: RealAccount; csrfToken: string }> {
  const result = await apiRequest<{ account: RealAccount; csrfToken: string }>(
    '/auth/consume-code',
    { method: 'POST', body: { token } },
  );
  setCsrfToken(result.csrfToken);
  return result;
}

/** Idempotent — always succeeds, matching the real handler's own behavior. */
export async function signOut(): Promise<void> {
  try {
    await apiRequest('/auth/sign-out', { method: 'POST' });
  } finally {
    setCsrfToken(null);
  }
}

/**
 * `GET /auth/session` (Phase 7 slice 8 part 1) is the one real round trip
 * "am I signed in, and as whom" has — a browser cannot introspect its own
 * httpOnly session cookie. Returns `null` for a signed-out caller (401),
 * never throws for that specific, expected case.
 *
 * Also re-establishes a working CSRF token for this page load: the
 * plaintext value is only ever handed to the client once per issuance,
 * and a full page navigation/reload discards whatever this module held in
 * memory (client.ts's csrfToken variable) — every real page calls this via
 * useSession(), so capturing it here is what actually keeps mutating
 * requests (saving a profile edit, adding evidence) working after the very
 * first page.
 */
export async function getSession(): Promise<SessionContext | null> {
  try {
    const result = await apiRequest<SessionContext & { csrfToken: string }>('/auth/session');
    setCsrfToken(result.csrfToken);
    return result;
  } catch (error) {
    if (error instanceof RealApiError && error.status === 401) return null;
    throw error;
  }
}
