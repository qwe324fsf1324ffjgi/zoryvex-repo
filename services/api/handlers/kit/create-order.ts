import { toHttpResponse } from '../../src/adapter/http';
import { requireSessionContext, type AuthorizedEvent } from '../../src/http/session-context';
import { ForbiddenError, ValidationError } from '../../src/errors/typed-errors';
import { requestKitOrder } from '../../src/domain/kit-service';
import { createAwsKitDependencies } from '../../src/composition/aws-kit-dependencies';

const deps = createAwsKitDependencies();

/**
 * employer_admin only — a billing action, per docs/adr entry on role
 * permissions (packages/contracts' AccountRole comment). Requires a
 * client-supplied Idempotency-Key header (Prompt 7: "idempotency keys
 * for ... billing event application") so a double-click/retry never
 * creates a second pending order.
 */
export const handler = async (event: AuthorizedEvent) =>
  toHttpResponse(async () => {
    const session = requireSessionContext(event);
    if (session.role !== 'employer_admin') throw new ForbiddenError('employer_admin only');
    if (!session.employerId) throw new ForbiddenError('employer_admin only');
    const roleId = event.pathParameters?.roleId;
    if (!roleId) throw new ValidationError('roleId is required');
    const idempotencyKey = event.headers['idempotency-key'];
    if (!idempotencyKey) throw new ValidationError('Idempotency-Key header is required');
    return requestKitOrder(session.employerId, roleId, idempotencyKey, deps);
  });
