import type { AuthenticationResponseJSON } from '@simplewebauthn/server';
import { toHttpResponse } from '../../src/adapter/http';
import { parseJsonBody } from '../../src/http/request';
import { requireSessionContext, type AuthorizedEvent } from '../../src/http/session-context';
import { readSessionCookie } from '../../src/http/cookies';
import { ForbiddenError, UnauthorizedError } from '../../src/errors/typed-errors';
import { finishStepUp } from '../../src/domain/webauthn-service';
import { createAwsWebAuthnDependencies } from '../../src/composition/aws-webauthn-dependencies';

const deps = createAwsWebAuthnDependencies();

/**
 * founder_admin only — verifies the WebAuthn assertion and marks *this*
 * session as stepped-up (services/api/src/repositories/session-repository.ts's
 * markSessionSteppedUp) so a subsequent sensitive admin request in the same
 * session can pass requireFounderStepUp without repeating the ceremony —
 * bounded to a short window there, not the full 12-hour session.
 */
export const handler = async (event: AuthorizedEvent) =>
  toHttpResponse(async () => {
    const session = requireSessionContext(event);
    if (session.role !== 'founder_admin') throw new ForbiddenError('founder_admin only');
    const sessionId = readSessionCookie(event.cookies);
    if (!sessionId) throw new UnauthorizedError('No session cookie');
    const response = parseJsonBody(event.body) as AuthenticationResponseJSON;
    await finishStepUp(session.email, response, sessionId, deps);
    return { steppedUp: true };
  });
