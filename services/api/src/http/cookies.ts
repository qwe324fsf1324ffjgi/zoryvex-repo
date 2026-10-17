/**
 * __Host- prefix requires: Secure, Path=/, no Domain attribute — enforced by
 * browsers, which is exactly the shape ADR 0001 requires.
 */
const SESSION_COOKIE_NAME = '__Host-zoryvex_session';

export function buildSessionCookie(sessionId: string, maxAgeSeconds: number): string {
  return `${SESSION_COOKIE_NAME}=${sessionId}; Secure; HttpOnly; Path=/; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
}

export function buildExpiredSessionCookie(): string {
  return `${SESSION_COOKIE_NAME}=; Secure; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`;
}

export function readSessionCookie(cookies: string[] | undefined): string | null {
  if (!cookies) return null;
  for (const cookie of cookies) {
    const separatorIndex = cookie.indexOf('=');
    if (separatorIndex === -1) continue;
    const name = cookie.slice(0, separatorIndex);
    if (name === SESSION_COOKIE_NAME) return cookie.slice(separatorIndex + 1);
  }
  return null;
}
