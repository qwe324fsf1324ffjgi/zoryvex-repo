import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { httpResult, toHttpResponse } from '../../src/adapter/http';
import { signOut } from '../../src/domain/auth-service';
import { createAwsAuthDependencies } from '../../src/composition/aws-auth-dependencies';
import { buildExpiredSessionCookie, readSessionCookie } from '../../src/http/cookies';
import { ForbiddenError } from '../../src/errors/typed-errors';
import { originAllowed } from '../../src/http/csrf';

const deps = createAwsAuthDependencies();

/** Idempotent: signing out with no/an already-invalid session still succeeds. */
export const handler: APIGatewayProxyHandlerV2 = async (event) =>
  toHttpResponse(async () => {
    const appOrigin = process.env.APP_ORIGIN;
    if (!appOrigin) throw new Error('APP_ORIGIN environment variable is not set');
    if (!originAllowed(event.headers.origin, appOrigin)) {
      throw new ForbiddenError('Origin not allowed');
    }

    const sessionId = readSessionCookie(event.cookies);
    if (sessionId) await signOut(sessionId, deps);

    return httpResult({
      statusCode: 200,
      body: { signedOut: true },
      cookies: [buildExpiredSessionCookie()],
    });
  });
