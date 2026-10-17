import { z } from 'zod';
import {
  LaunchTrackSchema,
  RoleIntentSchema,
  RoleLocationRequirementSchema,
  SenioritySchema,
  TEXT_LIMITS,
} from '@zoryvex/contracts';
import { toHttpResponse } from '../../src/adapter/http';
import { requireSessionContext, type AuthorizedEvent } from '../../src/http/session-context';
import { ForbiddenError } from '../../src/errors/typed-errors';
import { parseJsonBody } from '../../src/http/request';
import { validateRequest } from '../../src/validation/validate-request';
import { createOwnRole } from '../../src/domain/role-service';
import { createAwsRoleDependencies } from '../../src/composition/aws-role-dependencies';

/** Exported so the input bounds below are covered by a real test. */
export const CreateRoleSchema = z.object({
  launchTrack: LaunchTrackSchema,
  title: z.string().min(1).max(TEXT_LIMITS.roleTitle),
  seniority: SenioritySchema,
  outcomes: z.string().min(1).max(TEXT_LIMITS.roleOutcomes),
  mustHaveWork: z
    .array(z.string().min(1).max(TEXT_LIMITS.mustHaveWorkItem))
    .min(1)
    .max(TEXT_LIMITS.mustHaveWorkCount),
  constraints: z.string().max(TEXT_LIMITS.roleConstraints).optional(),
  locationRequirement: RoleLocationRequirementSchema.optional(),
  /**
   * What this role is and what it pays. Optional, so a role can still be
   * saved before the employer has decided, and absent stays absent rather
   * than becoming a default that speaks for them about their own money.
   */
  intent: RoleIntentSchema.optional(),
});

const deps = createAwsRoleDependencies();

/** employer_admin or employer_member — role authoring is not a billing action. */
export const handler = async (event: AuthorizedEvent) =>
  toHttpResponse(async () => {
    const session = requireSessionContext(event);
    if (session.role !== 'employer_admin' && session.role !== 'employer_member') {
      throw new ForbiddenError('employer only');
    }
    if (!session.employerId) throw new ForbiddenError('employer only');
    const body = validateRequest(CreateRoleSchema, parseJsonBody(event.body));
    return createOwnRole(session.employerId, body, deps);
  });
