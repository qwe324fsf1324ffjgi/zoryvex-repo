import { describe, expect, it } from 'vitest';
import type { Match, Role } from '@zoryvex/contracts';
import type { DataAdapter } from '@zoryvex/local-adapters';
import { CONTACT_UNLOCK_ALLOWANCE, countContactUnlocksUsed } from '../src/lib/entitlements';

function fakeDataAdapter(
  rolesByEmployer: Role[],
  matchesByRole: Record<string, Match[]>,
): DataAdapter {
  return {
    listRolesByEmployer: (employerId: string) =>
      rolesByEmployer.filter((r) => r.employerId === employerId),
    listMatchesForRole: (roleId: string) => matchesByRole[roleId] ?? [],
  } as unknown as DataAdapter;
}

const role = (id: string, employerId: string): Role => ({
  id,
  employerId,
  launchTrack: 'aws_cloud',
  title: 'Test role',
  seniority: 'mid',
  outcomes: 'x',
  mustHaveWork: ['x'],
  constraints: '',
  status: 'active',
  createdAt: '2026-01-01T00:00:00.000Z',
});

const match = (roleId: string, candidateId: string, contactUnlocked: boolean): Match => ({
  id: `${roleId}_${candidateId}`,
  roleId,
  candidateId,
  matchScore: 0.7,
  status: contactUnlocked ? 'contacted' : 'suggested',
  contactUnlocked,
  createdAt: '2026-01-01T00:00:00.000Z',
});

describe('CONTACT_UNLOCK_ALLOWANCE', () => {
  it('grants zero allowance for none and kit plans — the Kit never includes marketplace access', () => {
    expect(CONTACT_UNLOCK_ALLOWANCE.none).toBe(0);
    expect(CONTACT_UNLOCK_ALLOWANCE.kit).toBe(0);
  });

  it('grants an increasing allowance for each founding subscription tier', () => {
    expect(CONTACT_UNLOCK_ALLOWANCE.scout).toBe(5);
    expect(CONTACT_UNLOCK_ALLOWANCE.team).toBe(15);
    expect(CONTACT_UNLOCK_ALLOWANCE.partner).toBe(50);
  });
});

describe('countContactUnlocksUsed', () => {
  it('sums unlocked matches across every role owned by the employer', () => {
    const data = fakeDataAdapter([role('role_a', 'emp_1'), role('role_b', 'emp_1')], {
      role_a: [match('role_a', 'cand_1', true), match('role_a', 'cand_2', false)],
      role_b: [match('role_b', 'cand_3', true)],
    });
    expect(countContactUnlocksUsed(data, 'emp_1')).toBe(2);
  });

  it('never counts another employer’s roles', () => {
    const data = fakeDataAdapter([role('role_a', 'emp_1'), role('role_b', 'emp_2')], {
      role_a: [match('role_a', 'cand_1', true)],
      role_b: [match('role_b', 'cand_2', true)],
    });
    expect(countContactUnlocksUsed(data, 'emp_1')).toBe(1);
  });

  it('is zero for an employer with no roles', () => {
    const data = fakeDataAdapter([], {});
    expect(countContactUnlocksUsed(data, 'emp_none')).toBe(0);
  });
});
