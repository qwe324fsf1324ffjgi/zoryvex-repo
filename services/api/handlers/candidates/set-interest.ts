import { z } from 'zod';
import { InterestStateSchema } from '@zoryvex/contracts';
import { toHttpResponse } from '../../src/adapter/http';
import { requireSessionContext, type AuthorizedEvent } from '../../src/http/session-context';
import { ForbiddenError, ValidationError } from '../../src/errors/typed-errors';
import { parseJsonBody } from '../../src/http/request';
import { validateRequest } from '../../src/validation/validate-request';
import { setCandidateInterest } from '../../src/domain/interest-service';
import { createAwsInterestDependencies } from '../../src/composition/aws-interest-dependencies';

export const SetCandidateInterestSchema = z.object({ interest: InterestStateSchema });

const deps = createAwsInterestDependencies();

/**
 * A candidate saying yes or no to a role they were matched to.
 *
 * Only the role id is in the path. The candidate id comes from the
 * session, so this can only ever write to the caller's own match: there is
 * no id to substitute, and the match is read by the composite key
 * (candidate + role) before anything is written, so a role the caller was
 * never matched to is not found rather than silently created.
 */
export const handler = async (event: AuthorizedEvent) =>
  toHttpResponse(async () => {
    const session = requireSessionContext(event);
    if (session.role !== 'candidate') throw new ForbiddenError('candidate only');
    if (!session.candidateId) throw new ForbiddenError('candidate only');

    const roleId = event.pathParameters?.roleId;
    if (!roleId) throw new ValidationError('roleId is required');

    const body = validateRequest(SetCandidateInterestSchema, parseJsonBody(event.body));
    return setCandidateInterest(session.candidateId, roleId, body.interest, deps);
  });
