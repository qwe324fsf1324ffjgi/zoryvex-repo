import { SystemClock } from '../repositories/clock-repository';
import {
  createRole,
  getRole,
  listRolesByEmployer,
  updateRole,
} from '../repositories/role-repository';
import type { RoleDependencies } from '../domain/role-service';

export function createAwsRoleDependencies(): RoleDependencies {
  return { clock: new SystemClock(), createRole, getRole, listRolesByEmployer, updateRole };
}
