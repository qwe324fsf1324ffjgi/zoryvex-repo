import { toHttpResponse } from '../../src/adapter/http';
import {
  requireSessionContext,
  requireFounderStepUp,
  type AuthorizedEvent,
} from '../../src/http/session-context';
import { getExceptionQueue } from '../../src/domain/admin-service';
import { createAwsAdminDependencies } from '../../src/composition/aws-admin-dependencies';

const deps = createAwsAdminDependencies();

/**
 * founder_admin only, and only within a recent WebAuthn step-up window
 * (requireFounderStepUp) — the first real admin action this codebase has,
 * so it is what actually exercises ADR 0001's "not hidden behind an
 * obscure URL, MFA-ready" requirement rather than leaving it theoretical.
 */
export const handler = async (event: AuthorizedEvent) =>
  toHttpResponse(async () => {
    const session = requireSessionContext(event);
    requireFounderStepUp(session, new Date());
    return getExceptionQueue(deps);
  });
