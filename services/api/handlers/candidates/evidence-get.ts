import { toHttpResponse } from '../../src/adapter/http';
import { requireSessionContext, type AuthorizedEvent } from '../../src/http/session-context';
import { ForbiddenError, ValidationError } from '../../src/errors/typed-errors';
import { getOwnEvidence } from '../../src/domain/evidence-claim-service';
import { createAwsEvidenceClaimDependencies } from '../../src/composition/aws-evidence-claim-dependencies';

const deps = createAwsEvidenceClaimDependencies();

/**
 * candidate only, own record only. The prerequisite for updateEvidence's
 * caller to know the current version — see evidence-claim-service.ts's
 * getOwnEvidence.
 */
export const handler = async (event: AuthorizedEvent) =>
  toHttpResponse(async () => {
    const session = requireSessionContext(event);
    if (session.role !== 'candidate' || !session.candidateId) {
      throw new ForbiddenError('candidate only');
    }
    const evidenceId = event.pathParameters?.evidenceId;
    if (!evidenceId) throw new ValidationError('evidenceId is required');
    return getOwnEvidence(session.candidateId, evidenceId, deps);
  });
