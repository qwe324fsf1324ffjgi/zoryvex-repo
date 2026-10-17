import { z } from 'zod';
import { EvidenceVisibilitySchema, TEXT_LIMITS } from '@zoryvex/contracts';
import { toHttpResponse } from '../../src/adapter/http';
import { requireSessionContext, type AuthorizedEvent } from '../../src/http/session-context';
import { ForbiddenError, ValidationError } from '../../src/errors/typed-errors';
import { parseJsonBody } from '../../src/http/request';
import { validateRequest } from '../../src/validation/validate-request';
import { updateOwnEvidence } from '../../src/domain/evidence-claim-service';
import { createAwsEvidenceClaimDependencies } from '../../src/composition/aws-evidence-claim-dependencies';

const UpdateEvidenceSchema = z.object({
  version: z.number().int().nonnegative(),
  claim: z.string().min(1).max(TEXT_LIMITS.claim).optional(),
  context: z.string().min(1).max(TEXT_LIMITS.context).optional(),
  actions: z.string().min(1).max(TEXT_LIMITS.actions).optional(),
  outcome: z.string().min(1).max(TEXT_LIMITS.outcome).optional(),
  visibility: EvidenceVisibilitySchema.optional(),
  consentGiven: z.boolean().optional(),
});

const deps = createAwsEvidenceClaimDependencies();

/** verificationState is never client-settable — see evidence-claim-service.ts. */
export const handler = async (event: AuthorizedEvent) =>
  toHttpResponse(async () => {
    const session = requireSessionContext(event);
    if (session.role !== 'candidate' || !session.candidateId) {
      throw new ForbiddenError('candidate only');
    }
    const evidenceId = event.pathParameters?.evidenceId;
    if (!evidenceId) throw new ValidationError('evidenceId is required');
    const { version, ...patch } = validateRequest(UpdateEvidenceSchema, parseJsonBody(event.body));
    return updateOwnEvidence(session.candidateId, evidenceId, version, patch, deps);
  });
