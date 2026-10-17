import { z } from 'zod';
import {
  RoleIntentSchema,
  RoleLocationRequirementSchema,
  RoleStatusSchema,
  SenioritySchema,
  TEXT_LIMITS,
} from '@zoryvex/contracts';
import { toHttpResponse } from '../../src/adapter/http';
import { requireSessionContext, type AuthorizedEvent } from '../../src/http/session-context';
import { ForbiddenError, ValidationError } from '../../src/errors/typed-errors';
import { parseJsonBody } from '../../src/http/request';
import { validateRequest } from '../../src/validation/validate-request';
import { updateOwnRole } from '../../src/domain/role-service';
import { createAwsRoleDependencies } from '../../src/composition/aws-role-dependencies';

const UpdateRoleSchema = z.object({
  version: z.number().int().nonnegative(),
  title: z.string().min(1).max(TEXT_LIMITS.roleTitle).optional(),
  seniority: SenioritySchema.optional(),
  outcomes: z.string().min(1).max(TEXT_LIMITS.roleOutcomes).optional(),
  mustHaveWork: z.array(z.string().min(1)).min(1).optional(),
  constraints: z.string().max(TEXT_LIMITS.roleConstraints).optional(),
  locationRequirement: RoleLocationRequirementSchema.nullable().optional(),
  /**
   * Nullable as well as optional: an employer must be able to withdraw a
   * published pay range, and omitting the field has to keep meaning "leave
   * it as it is" rather than "delete it".
   */
  intent: RoleIntentSchema.nullable().optional(),
  status: RoleStatusSchema.optional(),
});

const deps = createAwsRoleDependencies();

export const handler = async (event: AuthorizedEvent) =>
  toHttpResponse(async () => {
    const session = requireSessionContext(event);
    if (session.role !== 'employer_admin' && session.role !== 'employer_member') {
      throw new ForbiddenError('employer only');
    }
    if (!session.employerId) throw new ForbiddenError('employer only');
    const roleId = event.pathParameters?.roleId;
    if (!roleId) throw new ValidationError('roleId is required');
    const { version, ...patch } = validateRequest(UpdateRoleSchema, parseJsonBody(event.body));
    return updateOwnRole(session.employerId, roleId, version, patch, deps);
  });
