import { z } from 'zod';
import { toHttpResponse } from '../../src/adapter/http';
import { requireSessionContext, type AuthorizedEvent } from '../../src/http/session-context';
import { ForbiddenError, ValidationError } from '../../src/errors/typed-errors';
import { parseJsonBody } from '../../src/http/request';
import { validateRequest } from '../../src/validation/validate-request';
import { verifyEvidence } from '../../src/domain/verification-service';
import { createAwsVerificationDependencies } from '../../src/composition/aws-verification-dependencies';

/**
 * A discriminated union, so a repo proof can never arrive missing its gist
 * and be treated as a badge proof. URLs are bounded in length here because
 * the domain parser is the thing that decides they are safe, and it should
 * never be handed an unbounded string to run a regular expression over.
 */
const VerifyEvidenceSchema = z.discriminatedUnion('method', [
  z.object({ method: z.literal('issuer_badge'), badgeUrl: z.string().min(1).max(2048) }),
  z.object({
    method: z.literal('repo_ownership'),
    gistUrl: z.string().min(1).max(2048),
    repoUrl: z.string().min(1).max(2048),
  }),
  z.object({
    method: z.literal('graded_task'),
    taskId: z.string().min(1).max(128),
    // Bounded here as well as in the parser: the domain should never be
    // handed an unbounded string to scan, and a body this size is already
    // far more than any task asks for.
    submission: z
      .string()
      .min(1)
      .max(64 * 1024),
  }),
]);

const deps = createAwsVerificationDependencies();

/**
 * Runs an autonomous check against the evidence item. Always resolves with a
 * result, never a bare error, because a check that did not pass is a normal
 * outcome the candidate needs to read: it carries the reason and what to do
 * next (CLAUDE.md forbids a silent rejection).
 */
export const handler = async (event: AuthorizedEvent) =>
  toHttpResponse(async () => {
    const session = requireSessionContext(event);
    if (session.role !== 'candidate' || !session.candidateId) {
      throw new ForbiddenError('candidate only');
    }
    const evidenceId = event.pathParameters?.evidenceId;
    if (!evidenceId) throw new ValidationError('evidenceId is required');

    const proof = validateRequest(VerifyEvidenceSchema, parseJsonBody(event.body));
    return verifyEvidence(session.candidateId, evidenceId, proof, deps);
  });
