import { toHttpResponse } from '../../src/adapter/http';
import { requireSessionContext, type AuthorizedEvent } from '../../src/http/session-context';
import { ForbiddenError, ValidationError } from '../../src/errors/typed-errors';
import { deleteOwnEvidence } from '../../src/domain/evidence-claim-service';
import { createAwsEvidenceClaimDependencies } from '../../src/composition/aws-evidence-claim-dependencies';

const deps = createAwsEvidenceClaimDependencies();

export const handler = async (event: AuthorizedEvent) =>
  toHttpResponse(async () => {
    const session = requireSessionContext(event);
    if (session.role !== 'candidate' || !session.candidateId) {
      throw new ForbiddenError('candidate only');
    }
    const evidenceId = event.pathParameters?.evidenceId;
    if (!evidenceId) throw new ValidationError('evidenceId is required');
    await deleteOwnEvidence(session.candidateId, evidenceId, deps);
    return { deleted: true };
  });
