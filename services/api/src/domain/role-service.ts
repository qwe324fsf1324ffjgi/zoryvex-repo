import { randomUUID } from 'node:crypto';
import type {
  LaunchTrack,
  Role,
  RoleIntent,
  RoleLocationRequirement,
  Seniority,
} from '@zoryvex/contracts';

type RoleStatus = Role['status'];
import { NotFoundError } from '../errors/typed-errors';
import type { Clock } from '../repositories/clock-repository';

export interface RoleDependencies {
  clock: Clock;
  createRole(role: Role): Promise<{ role: Role; version: number }>;
  getRole(roleId: string): Promise<{ role: Role; version: number } | null>;
  listRolesByEmployer(employerId: string): Promise<Role[]>;
  updateRole(
    roleId: string,
    expectedVersion: number,
    patch: UpdateRoleInput,
  ): Promise<{ role: Role; version: number }>;
}

export interface CreateRoleInput {
  launchTrack: LaunchTrack;
  title: string;
  seniority: Seniority;
  outcomes: string;
  mustHaveWork: string[];
  constraints?: string | undefined;
  locationRequirement?: RoleLocationRequirement | undefined;
  intent?: RoleIntent | undefined;
}

export async function createOwnRole(
  employerId: string,
  input: CreateRoleInput,
  deps: RoleDependencies,
): Promise<{ role: Role; version: number }> {
  const role: Role = {
    id: randomUUID(),
    employerId,
    launchTrack: input.launchTrack,
    title: input.title,
    seniority: input.seniority,
    outcomes: input.outcomes,
    mustHaveWork: input.mustHaveWork,
    constraints: input.constraints ?? '',
    ...(input.locationRequirement ? { locationRequirement: input.locationRequirement } : {}),
    // Spread rather than assigned, so a role created without one has no
    // intent key at all rather than an explicit undefined. The difference
    // matters at the storage layer, where an undefined attribute and an
    // absent one are not the same thing.
    ...(input.intent ? { intent: input.intent } : {}),
    status: 'draft',
    createdAt: deps.clock.now().toISOString(),
  };
  return deps.createRole(role);
}

/** Identical NotFoundError for "not found" and "not yours" — never confirms/denies another employer's role. */
export async function getOwnRole(
  employerId: string,
  roleId: string,
  deps: Pick<RoleDependencies, 'getRole'>,
): Promise<{ role: Role; version: number }> {
  const result = await deps.getRole(roleId);
  if (!result || result.role.employerId !== employerId) throw new NotFoundError('Role not found');
  return result;
}

export async function listOwnRoles(
  employerId: string,
  deps: Pick<RoleDependencies, 'listRolesByEmployer'>,
): Promise<Role[]> {
  return deps.listRolesByEmployer(employerId);
}

export interface UpdateRoleInput {
  title?: string | undefined;
  seniority?: Seniority | undefined;
  outcomes?: string | undefined;
  mustHaveWork?: string[] | undefined;
  constraints?: string | undefined;
  locationRequirement?: RoleLocationRequirement | null | undefined;
  /** Null withdraws a published range; undefined leaves it untouched. */
  intent?: RoleIntent | null | undefined;
  status?: RoleStatus | undefined;
}

export async function updateOwnRole(
  employerId: string,
  roleId: string,
  expectedVersion: number,
  patch: UpdateRoleInput,
  deps: RoleDependencies,
): Promise<{ role: Role; version: number }> {
  const existing = await deps.getRole(roleId);
  if (!existing || existing.role.employerId !== employerId)
    throw new NotFoundError('Role not found');
  return deps.updateRole(roleId, expectedVersion, patch);
}
