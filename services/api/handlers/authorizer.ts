import type {
  APIGatewayRequestAuthorizerEventV2,
  APIGatewaySimpleAuthorizerWithContextResult,
} from 'aws-lambda';
import { verifySession } from '../src/domain/auth-service';
import { createAwsAuthDependencies } from '../src/composition/aws-auth-dependencies';
import { readSessionCookie } from '../src/http/cookies';
import { hmacHash } from '../src/crypto/tokens';
import { csrfTokenMatches } from '../src/http/csrf';

/**
 * REQUEST authorizer per docs/adr/0001-no-cognito-passwordless-email-auth.md
 * — not Cognito, not a bare JWT-claims trust boundary. Real DynamoDB
 * GetItem lookup (infrastructure/modules/auth grants exactly this, nothing
 * else) with idle/absolute expiry re-checked in code even though the
 * item's `ttl` attribute will eventually also clean it up (ADR 0001: "TTL
 * is cleanup-only"). CSRF (exact-Origin + session-bound token) is checked
 * here, centrally, for every non-GET route — every downstream handler must
 * still perform its OWN server-side tenant/resource authorization; this
 * authorizer never substitutes for that.
 */

type Context = Record<string, string>;

const deps = createAwsAuthDependencies();

function deny(): APIGatewaySimpleAuthorizerWithContextResult<Context> {
  return { isAuthorized: false, context: {} };
}

export const handler = async (
  event: APIGatewayRequestAuthorizerEventV2,
): Promise<APIGatewaySimpleAuthorizerWithContextResult<Context>> => {
  const sessionId = readSessionCookie(event.cookies);
  if (!sessionId) return deny();

  const session = await verifySession(sessionId, deps);
  if (!session) return deny();

  const method = event.routeKey?.split(' ')[0]?.toUpperCase();
  const isMutating = method !== undefined && method !== 'GET' && method !== 'HEAD';
  if (isMutating) {
    const appOrigin = process.env.APP_ORIGIN;
    if (!appOrigin || event.headers?.origin !== appOrigin) return deny();

    const pepper = await deps.getAuthTokenPepper();
    const providedCsrf = event.headers?.['x-zoryvex-csrf'];
    const providedCsrfHash = providedCsrf ? hmacHash(pepper, providedCsrf) : undefined;
    if (!csrfTokenMatches(providedCsrfHash, session.csrfTokenHash)) return deny();
  }

  return {
    isAuthorized: true,
    context: {
      accountId: session.accountId,
      email: session.accountEmail,
      role: session.role,
      candidateId: session.candidateId ?? '',
      employerId: session.employerId ?? '',
      ...(session.stepUpVerifiedAt ? { stepUpVerifiedAt: session.stepUpVerifiedAt } : {}),
    },
  };
};
