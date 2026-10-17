import { toHttpResponse } from '../../src/adapter/http';
import { requireSessionContext, type AuthorizedEvent } from '../../src/http/session-context';
import { ForbiddenError } from '../../src/errors/typed-errors';
import { listRolesForCandidate } from '../../src/domain/interest-service';
import { createAwsInterestDependencies } from '../../src/composition/aws-interest-dependencies';

const deps = createAwsInterestDependencies();

/**
 * The roles this candidate has been matched to.
 *
 * There was no such route. Matching wrote rows keyed by candidate that no
 * candidate could ever read, so half of "mutual matching" was structurally
 * impossible: one side had nothing to answer.
 *
 * The candidate id comes from the session and appears nowhere in the path,
 * which is what makes this safe without an ownership comparison — there is
 * no id for a caller to substitute.
 */
export const handler = async (event: AuthorizedEvent) =>
  toHttpResponse(async () => {
    const session = requireSessionContext(event);
    if (session.role !== 'candidate') throw new ForbiddenError('candidate only');
    if (!session.candidateId) throw new ForbiddenError('candidate only');
    return { matches: await listRolesForCandidate(session.candidateId, deps) };
  });
