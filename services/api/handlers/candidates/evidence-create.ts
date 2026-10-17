import { z } from 'zod';
import { EvidenceVisibilitySchema, TEXT_LIMITS } from '@zoryvex/contracts';
import { toHttpResponse } from '../../src/adapter/http';
import { requireSessionContext, type AuthorizedEvent } from '../../src/http/session-context';
import { ForbiddenError } from '../../src/errors/typed-errors';
import { parseJsonBody } from '../../src/http/request';
import { validateRequest } from '../../src/validation/validate-request';
import { createOwnEvidence } from '../../src/domain/evidence-claim-service';
import { createAwsEvidenceClaimDependencies } from '../../src/composition/aws-evidence-claim-dependencies';

/** Exported so the input bounds below are covered by a real test. */
export const CreateEvidenceSchema = z.object({
  source: z.enum(['github', 'project', 'writeup', 'certification', 'other']),
  claim: z.string().min(1).max(TEXT_LIMITS.claim),
  context: z.string().min(1).max(TEXT_LIMITS.context),
  actions: z.string().min(1).max(TEXT_LIMITS.actions),
  outcome: z.string().min(1).max(TEXT_LIMITS.outcome),
  visibility: EvidenceVisibilitySchema,
  consentGiven: z.boolean(),
  sourceUrl: z.string().url().optional(),
  /**
   * An id from POST /evidence/upload-requests, never a storage key. Bounded
   * so an unbounded string never reaches a repository lookup, and checked
   * against the file record in the domain: it must be this candidate's, it
   * must have cleared the malware scan, and it must have been promoted out
   * of quarantine.
   */
  fileId: z.string().min(1).max(200).optional(),
});

const deps = createAwsEvidenceClaimDependencies();

export const handler = async (event: AuthorizedEvent) =>
  toHttpResponse(async () => {
    const session = requireSessionContext(event);
    if (session.role !== 'candidate' || !session.candidateId) {
      throw new ForbiddenError('candidate only');
    }
    const body = validateRequest(CreateEvidenceSchema, parseJsonBody(event.body));
    return createOwnEvidence(session.candidateId, body, deps);
  });
