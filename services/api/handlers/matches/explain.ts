import { toHttpResponse } from '../../src/adapter/http';
import { requireSessionContext, type AuthorizedEvent } from '../../src/http/session-context';
import { ForbiddenError, ValidationError } from '../../src/errors/typed-errors';
import { requestMatchExplanation } from '../../src/domain/bedrock-explain-service';
import { createAwsMatchExplanationDependencies } from '../../src/composition/aws-matching-dependencies';

const deps = createAwsMatchExplanationDependencies();

/**
 * employer only, own role only. Returns `{available: false, reason: ...}`
 * (200, not an error) whenever aiMatching is off or the model call fails —
 * this is a normal, expected response, not a failure (Prompt 7: "say AI is
 * unavailable — hiring/visibility keep working").
 */
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
    return requestMatchExplanation(session.employerId, roleId, candidateId, deps);
  });
