import { toHttpResponse } from '../../src/adapter/http';
import { requireSessionContext, type AuthorizedEvent } from '../../src/http/session-context';
import { ForbiddenError } from '../../src/errors/typed-errors';
import { listOwnEvidence } from '../../src/domain/evidence-claim-service';
import { createAwsEvidenceClaimDependencies } from '../../src/composition/aws-evidence-claim-dependencies';

const deps = createAwsEvidenceClaimDependencies();

export const handler = async (event: AuthorizedEvent) =>
  toHttpResponse(async () => {
    const session = requireSessionContext(event);
    if (session.role !== 'candidate' || !session.candidateId) {
      throw new ForbiddenError('candidate only');
    }
    return listOwnEvidence(session.candidateId, deps);
  });
