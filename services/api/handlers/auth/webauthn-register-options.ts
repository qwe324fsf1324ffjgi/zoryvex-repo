import { toHttpResponse } from '../../src/adapter/http';
import { requireSessionContext, type AuthorizedEvent } from '../../src/http/session-context';
import { ForbiddenError } from '../../src/errors/typed-errors';
import { beginRegistration } from '../../src/domain/webauthn-service';
import { createAwsWebAuthnDependencies } from '../../src/composition/aws-webauthn-dependencies';

const deps = createAwsWebAuthnDependencies();

/** founder_admin only — WebAuthn credential registration per ADR 0001. */
export const handler = async (event: AuthorizedEvent) =>
  toHttpResponse(async () => {
    const session = requireSessionContext(event);
    if (session.role !== 'founder_admin') throw new ForbiddenError('founder_admin only');
    return beginRegistration(session.email, deps);
  });
