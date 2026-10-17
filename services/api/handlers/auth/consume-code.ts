import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { z } from 'zod';
import { TEXT_LIMITS } from '@zoryvex/contracts';
import { httpResult, toHttpResponse } from '../../src/adapter/http';
import { parseJsonBody } from '../../src/http/request';
import { validateRequest } from '../../src/validation/validate-request';
import { consumeSignInCode } from '../../src/domain/auth-service';
import { createAwsAuthDependencies } from '../../src/composition/aws-auth-dependencies';
import { buildSessionCookie } from '../../src/http/cookies';
import { ForbiddenError } from '../../src/errors/typed-errors';
import { originAllowed } from '../../src/http/csrf';

const ConsumeCodeSchema = z.object({
  token: z.string().min(1).max(TEXT_LIMITS.token),
});

const deps = createAwsAuthDependencies();

/**
 * Deliberate POST, not the GET the recipient's email link points at (ADR
 * 0001: "the email link is a GET that does not consume the token by
 * itself"). apps/web's /auth/callback page reads the token out of
 * location.hash, clears the hash, then POSTs here.
 */
export const handler: APIGatewayProxyHandlerV2 = async (event) =>
  toHttpResponse(async () => {
    const appOrigin = process.env.APP_ORIGIN;
    if (!appOrigin) throw new Error('APP_ORIGIN environment variable is not set');
    if (!originAllowed(event.headers.origin, appOrigin)) {
      throw new ForbiddenError('Origin not allowed');
    }

    const body = validateRequest(ConsumeCodeSchema, parseJsonBody(event.body));
    const issued = await consumeSignInCode(body, deps);

    return httpResult({
      statusCode: 200,
      body: {
        account: {
          id: issued.account.id,
          email: issued.account.email,
          role: issued.account.role,
          candidateId: issued.account.candidateId,
          employerId: issued.account.employerId,
        },
        csrfToken: issued.csrfToken,
      },
      cookies: [buildSessionCookie(issued.sessionId, issued.maxAgeSeconds)],
    });
  });
