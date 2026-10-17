import type { APIGatewayProxyEventV2WithLambdaAuthorizer } from 'aws-lambda';
import { SessionContextSchema, type SessionContext } from '@zoryvex/contracts';
import { ForbiddenError, UnauthorizedError } from '../errors/typed-errors';

type AuthorizerContext = Record<string, string>;
export type AuthorizedEvent = APIGatewayProxyEventV2WithLambdaAuthorizer<AuthorizerContext>;

/**
 * Reads the context the REQUEST authorizer (handlers/authorizer.ts)
 * attached to this request. A successful parse here proves a valid session
 * existed at authorizer-cache time — it is NOT, by itself, proof this
 * handler's specific resource/tenant access is allowed (ADR 0001: "every
 * handler performs its own server-side tenant/resource authorization").
 */
export function requireSessionContext(event: AuthorizedEvent): SessionContext {
  const raw = event.requestContext.authorizer?.lambda;
  if (!raw) throw new UnauthorizedError('No session context');
  return SessionContextSchema.parse({
    accountId: raw.accountId,
    email: raw.email,
    role: raw.role,
    candidateId: raw.candidateId || undefined,
    employerId: raw.employerId || undefined,
    stepUpVerifiedAt: raw.stepUpVerifiedAt || undefined,
  });
}

/**
 * founder_admin only, and only within a short window of a real WebAuthn
 * step-up ceremony (handlers/auth/webauthn-step-up-verify.ts) — not just
 * "this session is founder_admin," and not "stepped up at any point in the
 * last 12 hours." An expired step-up is treated identically to no step-up
 * at all: the caller must complete the ceremony again, never silently
 * extended by continued API use.
 */
const STEP_UP_WINDOW_MINUTES = 15;

export function requireFounderStepUp(session: SessionContext, now: Date): void {
  if (session.role !== 'founder_admin') throw new ForbiddenError('founder_admin only');
  if (!session.stepUpVerifiedAt) throw new ForbiddenError('WebAuthn step-up required');
  const verifiedAt = new Date(session.stepUpVerifiedAt);
  const ageMinutes = (now.getTime() - verifiedAt.getTime()) / 60_000;
  if (ageMinutes > STEP_UP_WINDOW_MINUTES || ageMinutes < 0) {
    throw new ForbiddenError('WebAuthn step-up expired — verify again');
  }
}
