import { describe, expect, it } from 'vitest';
import type { Role } from '@zoryvex/contracts';
import {
  createOwnRole,
  getOwnRole,
  listOwnRoles,
  updateOwnRole,
  type RoleDependencies,
} from '../src/domain/role-service';
import { NotFoundError } from '../src/errors/typed-errors';

function mergeDefined<T extends object>(base: T, patch: { [K in keyof T]?: T[K] | undefined }): T {
  const merged = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) (merged as Record<string, unknown>)[key] = value;
  }
  return merged;
}

const OWNER_EMPLOYER_ID = 'emp_owner';
const OTHER_EMPLOYER_ID = 'emp_other';
const ROLE_ID = 'role_1';

function role(overrides: Partial<Role> = {}): Role {
  return {
    id: ROLE_ID,
    employerId: OWNER_EMPLOYER_ID,
    launchTrack: 'aws_cloud',
    title: 'Cloud Engineer',
    seniority: 'mid',
    outcomes: 'Ship infra reliably',
    mustHaveWork: ['Terraform'],
    constraints: '',
    status: 'draft',
    createdAt: '2026-08-19T00:00:00.000Z',
    ...overrides,
  };
}

function createFakes(input: { existing?: Role | null } = {}) {
  let stored: Role | null = input.existing === undefined ? role() : input.existing;
  let version = 1;
  const createCalls: Role[] = [];
  const updateCalls: Array<{ roleId: string; expectedVersion: number; patch: unknown }> = [];

  const deps: RoleDependencies = {
    clock: { now: () => new Date('2026-08-19T00:00:00.000Z') },
    async createRole(r) {
      createCalls.push(r);
      stored = r;
      version = 1;
      return { role: r, version };
    },
    async getRole(roleId) {
      if (!stored || stored.id !== roleId) return null;
      return { role: stored, version };
    },
    async listRolesByEmployer(employerId) {
      return stored && stored.employerId === employerId ? [stored] : [];
    },
    async updateRole(roleId, expectedVersion, patch) {
      updateCalls.push({ roleId, expectedVersion, patch });
      const current = stored;
      if (!current) throw new NotFoundError('Role not found');
      // Mirrors the repository: null clears the field rather than storing a
      // null, which DynamoDB does with REMOVE and RoleSchema would reject.
      const { locationRequirement, intent, ...rest } = patch;
      const updated = mergeDefined(current, rest) as Role;
      if (locationRequirement === null) delete updated.locationRequirement;
      else if (locationRequirement !== undefined) updated.locationRequirement = locationRequirement;
      // Same null-clears rule for intent, so an employer withdrawing a
      // published pay range behaves here exactly as it does in DynamoDB.
      if (intent === null) delete updated.intent;
      else if (intent !== undefined) updated.intent = intent;
      stored = updated;
      version += 1;
      return { role: updated, version };
    },
  };

  return { deps, createCalls, updateCalls };
}

describe('createOwnRole', () => {
  it("creates a draft role owned by the caller's employer", async () => {
    const { deps, createCalls } = createFakes({ existing: null });
    const result = await createOwnRole(
      OWNER_EMPLOYER_ID,
      {
        launchTrack: 'aws_cloud',
        title: 'Cloud Engineer',
        seniority: 'mid',
        outcomes: 'Ship infra reliably',
        mustHaveWork: ['Terraform'],
      },
      deps,
    );
    expect(result.role.employerId).toBe(OWNER_EMPLOYER_ID);
    expect(result.role.status).toBe('draft');
    expect(createCalls).toHaveLength(1);
  });

  it('defaults constraints to an empty string when omitted', async () => {
    const { deps } = createFakes({ existing: null });
    const result = await createOwnRole(
      OWNER_EMPLOYER_ID,
      {
        launchTrack: 'aws_cloud',
        title: 'Cloud Engineer',
        seniority: 'mid',
        outcomes: 'Ship infra reliably',
        mustHaveWork: ['Terraform'],
      },
      deps,
    );
    expect(result.role.constraints).toBe('');
  });
});

describe('getOwnRole', () => {
  it("throws NotFoundError for another employer's role", async () => {
    const { deps } = createFakes();
    await expect(getOwnRole(OTHER_EMPLOYER_ID, ROLE_ID, deps)).rejects.toThrow(NotFoundError);
  });

  it('returns the role for its own employer', async () => {
    const { deps } = createFakes();
    const result = await getOwnRole(OWNER_EMPLOYER_ID, ROLE_ID, deps);
    expect(result.role.id).toBe(ROLE_ID);
  });

  it('throws NotFoundError for a role that does not exist', async () => {
    const { deps } = createFakes({ existing: null });
    await expect(getOwnRole(OWNER_EMPLOYER_ID, 'missing', deps)).rejects.toThrow(NotFoundError);
  });
});

describe('listOwnRoles', () => {
  it("returns only the caller's own roles", async () => {
    const { deps } = createFakes();
    expect(await listOwnRoles(OWNER_EMPLOYER_ID, deps)).toHaveLength(1);
    expect(await listOwnRoles(OTHER_EMPLOYER_ID, deps)).toHaveLength(0);
  });
});

describe('updateOwnRole', () => {
  it("throws NotFoundError for another employer's role, without calling updateRole", async () => {
    const { deps, updateCalls } = createFakes();
    await expect(
      updateOwnRole(OTHER_EMPLOYER_ID, ROLE_ID, 1, { title: 'New title' }, deps),
    ).rejects.toThrow(NotFoundError);
    expect(updateCalls).toHaveLength(0);
  });

  it('updates the role for its own employer', async () => {
    const { deps, updateCalls } = createFakes();
    const result = await updateOwnRole(OWNER_EMPLOYER_ID, ROLE_ID, 1, { title: 'New title' }, deps);
    expect(result.role.title).toBe('New title');
    expect(updateCalls).toHaveLength(1);
  });
});
