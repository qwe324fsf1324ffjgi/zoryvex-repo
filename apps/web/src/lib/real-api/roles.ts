import type {
  LaunchTrack,
  Role,
  RoleIntent,
  RoleLocationRequirement,
  Seniority,
} from '@zoryvex/contracts';
import { apiRequest } from './client';

export interface CreateRoleInput {
  launchTrack: LaunchTrack;
  title: string;
  seniority: Seniority;
  outcomes: string;
  mustHaveWork: string[];
  constraints?: string;
  locationRequirement?: RoleLocationRequirement;
  /** What the role is and what it pays. Absent means not published. */
  intent?: RoleIntent;
}

export async function createRole(input: CreateRoleInput): Promise<{ role: Role; version: number }> {
  return apiRequest('/roles', { method: 'POST', body: input });
}

export async function getRole(roleId: string): Promise<{ role: Role; version: number }> {
  return apiRequest(`/roles/${roleId}`);
}

export async function listRoles(): Promise<Role[]> {
  return apiRequest('/roles');
}

export interface UpdateRoleInput {
  title?: string;
  seniority?: Seniority;
  outcomes?: string;
  mustHaveWork?: string[];
  constraints?: string;
  status?: Role['status'];
  locationRequirement?: RoleLocationRequirement | null;
  /** Null withdraws a published range; undefined leaves it untouched. */
  intent?: RoleIntent | null;
}

export async function updateRole(
  roleId: string,
  version: number,
  patch: UpdateRoleInput,
): Promise<{ role: Role; version: number }> {
  return apiRequest(`/roles/${roleId}`, { method: 'PATCH', body: { version, ...patch } });
}
