import { toHttpResponse } from '../../src/adapter/http';
import { requireSessionContext, type AuthorizedEvent } from '../../src/http/session-context';
import { ForbiddenError, ValidationError } from '../../src/errors/typed-errors';
import { beginRepoVerification } from '../../src/domain/verification-service';
import { createAwsVerificationDependencies } from '../../src/composition/aws-verification-dependencies';

const deps = createAwsVerificationDependencies();

/**
 * Issues the one-time code for repository verification. Candidate only, and
 * only for their own evidence — the candidateId comes from the session, never
 * from the request, so an evidenceId belonging to someone else simply is not
 * found.
 */
export const handler = async (event: AuthorizedEvent) =>
  toHttpResponse(async () => {
    const session = requireSessionContext(event);
    if (session.role !== 'candidate' || !session.candidateId) {
      throw new ForbiddenError('candidate only');
    }
    const evidenceId = event.pathParameters?.evidenceId;
    if (!evidenceId) throw new ValidationError('evidenceId is required');

    return beginRepoVerification(session.candidateId, evidenceId, deps);
  });
