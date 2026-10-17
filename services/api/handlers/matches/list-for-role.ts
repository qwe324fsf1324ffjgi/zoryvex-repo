import { toHttpResponse } from '../../src/adapter/http';
import { requireSessionContext, type AuthorizedEvent } from '../../src/http/session-context';
import { ForbiddenError, ValidationError } from '../../src/errors/typed-errors';
import { getMatchesForRole } from '../../src/domain/matching-service';
import { createAwsMatchingDependencies } from '../../src/composition/aws-matching-dependencies';

const deps = createAwsMatchingDependencies();

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
    return getMatchesForRole(session.employerId, roleId, deps);
  });
