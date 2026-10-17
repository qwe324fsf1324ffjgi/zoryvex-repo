import { toHttpResponse } from '../../src/adapter/http';
import { requireSessionContext, type AuthorizedEvent } from '../../src/http/session-context';
import { ForbiddenError } from '../../src/errors/typed-errors';
import { getOwnCandidateProfile } from '../../src/domain/candidate-profile-service';
import { createAwsCandidateProfileDependencies } from '../../src/composition/aws-candidate-profile-dependencies';

const deps = createAwsCandidateProfileDependencies();

export const handler = async (event: AuthorizedEvent) =>
  toHttpResponse(async () => {
    const session = requireSessionContext(event);
    if (session.role !== 'candidate' || !session.candidateId) {
      throw new ForbiddenError('candidate only');
    }
    return getOwnCandidateProfile(session.candidateId, deps);
  });
