import { toHttpResponse } from '../../src/adapter/http';
import { requireSessionContext, type AuthorizedEvent } from '../../src/http/session-context';
import { ForbiddenError, ValidationError } from '../../src/errors/typed-errors';
import { getKitOrderStatus } from '../../src/domain/kit-service';
import { createAwsKitDependencies } from '../../src/composition/aws-kit-dependencies';

const deps = createAwsKitDependencies();

/** employer only, own role only. */
export const handler = async (event: AuthorizedEvent) =>
  toHttpResponse(async () => {
    const session = requireSessionContext(event);
    if (session.role !== 'employer_admin' && session.role !== 'employer_member') {
      throw new ForbiddenError('employer only');
    }
    if (!session.employerId) throw new ForbiddenError('employer only');
    const roleId = event.pathParameters?.roleId;
    if (!roleId) throw new ValidationError('roleId is required');
    return getKitOrderStatus(session.employerId, roleId, deps);
  });
