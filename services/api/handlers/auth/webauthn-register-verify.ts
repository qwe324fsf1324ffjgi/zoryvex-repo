import type { RegistrationResponseJSON } from '@simplewebauthn/server';
import { toHttpResponse } from '../../src/adapter/http';
import { parseJsonBody } from '../../src/http/request';
import { requireSessionContext, type AuthorizedEvent } from '../../src/http/session-context';
import { ForbiddenError } from '../../src/errors/typed-errors';
import { finishRegistration } from '../../src/domain/webauthn-service';
import { createAwsWebAuthnDependencies } from '../../src/composition/aws-webauthn-dependencies';

const deps = createAwsWebAuthnDependencies();

/** founder_admin only — WebAuthn credential registration per ADR 0001. */
export const handler = async (event: AuthorizedEvent) =>
  toHttpResponse(async () => {
    const session = requireSessionContext(event);
    if (session.role !== 'founder_admin') throw new ForbiddenError('founder_admin only');
    const response = parseJsonBody(event.body) as RegistrationResponseJSON;
    await finishRegistration(session.email, response, deps);
    return { registered: true };
  });
