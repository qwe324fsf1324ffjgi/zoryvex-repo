import { toHttpResponse } from '../../src/adapter/http';
import { requireSessionContext, type AuthorizedEvent } from '../../src/http/session-context';
import { readSessionCookie } from '../../src/http/cookies';
import { reissueCsrfToken } from '../../src/domain/auth-service';
import { createAwsAuthDependencies } from '../../src/composition/aws-auth-dependencies';
import { UnauthorizedError } from '../../src/errors/typed-errors';

const deps = createAwsAuthDependencies();

/**
 * Confirms "am I signed in, and as whom" for a browser SPA whose httpOnly
 * session cookie it cannot read directly (ADR 0001) — and also re-issues a
 * fresh, client-usable CSRF token bound to this same session every time.
 * The plaintext CSRF value is only ever handed to the client once per
 * issuance; a full page navigation/reload discards whatever the client held
 * in memory (apps/web/src/lib/real-api/client.ts), and every real page
 * mounts useSession(), which calls this — so this is what actually
 * re-establishes a working one, without a second sign-in.
 */
export const handler = async (event: AuthorizedEvent) =>
  toHttpResponse(async () => {
    const session = requireSessionContext(event);
    const sessionId = readSessionCookie(event.cookies);
    if (!sessionId) throw new UnauthorizedError('No session cookie');
    const reissued = await reissueCsrfToken(sessionId, deps);
    if (!reissued) throw new UnauthorizedError('Session no longer exists');
    return { ...session, csrfToken: reissued.csrfToken };
  });
