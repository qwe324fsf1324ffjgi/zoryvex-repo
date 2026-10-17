import { toHttpResponse } from '../../src/adapter/http';
import { requireSessionContext, type AuthorizedEvent } from '../../src/http/session-context';
import { ForbiddenError, ValidationError } from '../../src/errors/typed-errors';
import { getMatchEvidence } from '../../src/domain/match-evidence-service';
import { notifyCandidateOfProfileView } from '../../src/domain/profile-view-service';
import {
  createAwsMatchEvidenceDependencies,
  createAwsProfileViewDependencies,
} from '../../src/composition/aws-matching-dependencies';

const deps = createAwsMatchEvidenceDependencies();
const viewDeps = createAwsProfileViewDependencies();

/**
 * What was actually checked about this candidate, for this role.
 *
 * Employer only, own role only. What was checked, by whom and when is shown
 * to any employer who owns the role, because a buyer who cannot see that has
 * no way to judge whether a subscription is worth buying. The address of the
 * independent record is the part the subscription releases, and for a
 * repository the identity is redacted from the words as well. Contact details
 * stay behind their own paid, separately-consented unlock on top of that.
 */
export const handler = async (event: AuthorizedEvent) =>
  toHttpResponse(async () => {
    const session = requireSessionContext(event);
    if (session.role !== 'employer_admin' && session.role !== 'employer_member') {
      throw new ForbiddenError('employer only');
    }
    if (!session.employerId) throw new ForbiddenError('employer only');
    const roleId = event.pathParameters?.roleId;
    const candidateId = event.pathParameters?.candidateId;
    if (!roleId || !candidateId) throw new ValidationError('roleId and candidateId are required');

    const summaries = await getMatchEvidence(session.employerId, roleId, candidateId, deps);

    // Told after the read succeeded, so a candidate is never notified about a
    // look that was refused for ownership or that found nothing.
    //
    // Deliberately not fatal. The evidence is what the employer is paying
    // for; the notice is a courtesy attached to it, and an unreachable
    // mailbox or a throttled SES must not turn a successful read into a 500.
    // Logged rather than swallowed, because a notice that silently stopped
    // going out would leave candidates believing nobody had looked.
    try {
      const roleTitle = (await deps.getRole(roleId))?.role.title ?? 'a role';
      await notifyCandidateOfProfileView(
        { employerId: session.employerId, roleId, roleTitle, candidateId },
        viewDeps,
      );
    } catch (error) {
      console.error('Could not tell the candidate their proof was viewed', {
        roleId,
        candidateId,
        name: error instanceof Error ? error.name : 'UnknownError',
        message: error instanceof Error ? error.message : String(error),
      });
    }

    return summaries;
  });
