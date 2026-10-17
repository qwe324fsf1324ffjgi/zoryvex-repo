import { z } from 'zod';
import { InterestStateSchema } from '@zoryvex/contracts';
import { toHttpResponse } from '../../src/adapter/http';
import { requireSessionContext, type AuthorizedEvent } from '../../src/http/session-context';
import { ForbiddenError, ValidationError } from '../../src/errors/typed-errors';
import { parseJsonBody } from '../../src/http/request';
import { validateRequest } from '../../src/validation/validate-request';
import { setEmployerInterest } from '../../src/domain/interest-service';
import { createAwsInterestDependencies } from '../../src/composition/aws-interest-dependencies';

/** Exported so the accepted values are covered by a real test. */
export const SetInterestSchema = z.object({ interest: InterestStateSchema });

const deps = createAwsInterestDependencies();

/**
 * An employer saying yes or no to one candidate on one of their roles.
 *
 * `employer_member` may do this as well as `employer_admin`: it is a
 * hiring judgement, not a billing action, and matches how role authoring
 * is already scoped. The domain checks that the role belongs to this
 * employer, so a guessed roleId reaches nothing.
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

    const body = validateRequest(SetInterestSchema, parseJsonBody(event.body));
    return setEmployerInterest(session.employerId, roleId, candidateId, body.interest, deps);
  });
