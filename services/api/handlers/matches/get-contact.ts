import { toHttpResponse } from '../../src/adapter/http';
import { requireSessionContext, type AuthorizedEvent } from '../../src/http/session-context';
import { ForbiddenError, ValidationError } from '../../src/errors/typed-errors';
import { getUnlockedContactInfo } from '../../src/domain/contact-unlock-service';
import { createAwsContactUnlockDependencies } from '../../src/composition/aws-privacy-dependencies';

const deps = createAwsContactUnlockDependencies();

/** employer only, own role only, strictly requires a prior unlock. */
export const handler = async (event: AuthorizedEvent) =>
  toHttpResponse(async () => {
    const session = requireSessionContext(event);
    if (session.role !== 'employer_admin' && session.role !== 'employer_member') {
      throw new ForbiddenError('employer only');
    }
    if (!session.employerId) throw new ForbiddenError('employer only');
    const roleId = event.pathParameters?.roleId;
    const candidateId = event.pathParameters?.candidateId;
    if (!roleId || !candidateId) throw new ValidationError('roleId and candidateId are required');
    return getUnlockedContactInfo(session.employerId, roleId, candidateId, deps);
  });
