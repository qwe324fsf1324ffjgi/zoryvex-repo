import { timingSafeStringEqual } from '../crypto/tokens';

/**
 * ADR 0001: CSRF defense is an exact Origin check plus a session-bound
 * token — never Referer-only, never cookie-presence-alone.
 */
export function originAllowed(originHeader: string | undefined, allowedOrigin: string): boolean {
  return typeof originHeader === 'string' && originHeader === allowedOrigin;
}

export function csrfTokenMatches(
  providedToken: string | undefined,
  sessionCsrfToken: string,
): boolean {
  return (
    typeof providedToken === 'string' && timingSafeStringEqual(providedToken, sessionCsrfToken)
  );
}
