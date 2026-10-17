import { toHttpResponse } from '../../src/adapter/http';
import { requireSessionContext, type AuthorizedEvent } from '../../src/http/session-context';
import { ForbiddenError, NotFoundError } from '../../src/errors/typed-errors';
import { gradedTasksFor } from '../../src/domain/verification-service';
import { getCandidate } from '../../src/repositories/candidate-repository';

/**
 * Every task a candidate can attempt on their track, each with its full
 * rubric.
 *
 * All of them rather than one: a track can offer several, and choosing on
 * their behalf would push somebody down a task that happens not to suit the
 * work they have done. The requirements are published rather than hidden,
 * because a secret rubric turns a practical task into a guessing game.
 */
export const handler = async (event: AuthorizedEvent) =>
  toHttpResponse(async () => {
    const session = requireSessionContext(event);
    if (session.role !== 'candidate' || !session.candidateId) {
      throw new ForbiddenError('candidate only');
    }

    const result = await getCandidate(session.candidateId);
    if (!result) throw new NotFoundError('Candidate not found');

    // An empty list is a real answer: a track ships without a task until one
    // is worth publishing, and saying so beats a rubric that does not
    // discriminate.
    return { tasks: gradedTasksFor(result.candidate) };
  });
