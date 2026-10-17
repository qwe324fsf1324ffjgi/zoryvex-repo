import { beforeEach, describe, expect, it } from 'vitest';
import type { Candidate, Employer } from '@zoryvex/contracts';
import { LocalDataAdapter } from '../src/local/local-data-adapter';

function makeCandidate(overrides: Partial<Candidate> = {}): Candidate {
  return {
    id: 'cand_x',
    email: 'x@example.com',
    displayName: 'X',
    launchTrack: 'aws_cloud',
    discoveryOptIn: false,
    onboardingComplete: true,
    summary: '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeEmployer(overrides: Partial<Employer> = {}): Employer {
  return {
    id: 'emp_x',
    organizationName: 'X Org',
    contactEmail: 'x@example.com',
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

beforeEach(() => {
  window.localStorage.clear();
});

describe('LocalDataAdapter candidate + discovery index', () => {
  it('round-trips a candidate', () => {
    const data = new LocalDataAdapter();
    data.upsertCandidate(makeCandidate());
    expect(data.getCandidate('cand_x')?.displayName).toBe('X');
  });

  it('only returns candidates currently opted into discovery for that track', () => {
    const data = new LocalDataAdapter();
    data.upsertCandidate(
      makeCandidate({ id: 'a', discoveryOptIn: true, launchTrack: 'aws_cloud' }),
    );
    data.upsertCandidate(
      makeCandidate({ id: 'b', discoveryOptIn: false, launchTrack: 'aws_cloud' }),
    );
    data.upsertCandidate(
      makeCandidate({ id: 'c', discoveryOptIn: true, launchTrack: 'devops_platform' }),
    );

    const opted = data.listDiscoveryOptedCandidates('aws_cloud');
    expect(opted.map((c) => c.id)).toEqual(['a']);
  });

  it('removes a candidate from the discovery index the moment they opt out', () => {
    const data = new LocalDataAdapter();
    data.upsertCandidate(makeCandidate({ id: 'a', discoveryOptIn: true }));
    expect(data.listDiscoveryOptedCandidates('aws_cloud').map((c) => c.id)).toEqual(['a']);

    data.upsertCandidate(makeCandidate({ id: 'a', discoveryOptIn: false }));
    expect(data.listDiscoveryOptedCandidates('aws_cloud')).toEqual([]);
  });

  it('deleteCandidate removes both the profile and the discovery index entry', () => {
    const data = new LocalDataAdapter();
    data.upsertCandidate(makeCandidate({ id: 'a', discoveryOptIn: true }));
    data.deleteCandidate('a');
    expect(data.getCandidate('a')).toBeNull();
    expect(data.listDiscoveryOptedCandidates('aws_cloud')).toEqual([]);
  });
});

describe('LocalDataAdapter admin enumeration (GSI3)', () => {
  it('listAllCandidates returns every candidate ever created, regardless of discovery opt-in', () => {
    const data = new LocalDataAdapter();
    data.upsertCandidate(makeCandidate({ id: 'a', discoveryOptIn: true }));
    data.upsertCandidate(makeCandidate({ id: 'b', discoveryOptIn: false }));
    expect(
      data
        .listAllCandidates()
        .map((c) => c.id)
        .sort(),
    ).toEqual(['a', 'b']);
  });

  it('an update to an existing candidate does not duplicate it in the enumeration index', () => {
    const data = new LocalDataAdapter();
    data.upsertCandidate(makeCandidate({ id: 'a', displayName: 'First' }));
    data.upsertCandidate(makeCandidate({ id: 'a', displayName: 'Updated' }));
    expect(data.listAllCandidates()).toHaveLength(1);
    expect(data.listAllCandidates()[0]?.displayName).toBe('Updated');
  });

  it('deleteCandidate removes them from the enumeration index too', () => {
    const data = new LocalDataAdapter();
    data.upsertCandidate(makeCandidate({ id: 'a' }));
    data.deleteCandidate('a');
    expect(data.listAllCandidates()).toEqual([]);
  });

  it('listAllEmployers returns every employer ever created', () => {
    const data = new LocalDataAdapter();
    data.upsertEmployer(makeEmployer({ id: 'emp_a' }));
    data.upsertEmployer(makeEmployer({ id: 'emp_b' }));
    expect(
      data
        .listAllEmployers()
        .map((e) => e.id)
        .sort(),
    ).toEqual(['emp_a', 'emp_b']);
  });

  it('an update to an existing employer does not duplicate it in the enumeration index', () => {
    const data = new LocalDataAdapter();
    data.upsertEmployer(makeEmployer({ id: 'emp_a', organizationName: 'First' }));
    data.upsertEmployer(makeEmployer({ id: 'emp_a', organizationName: 'Updated' }));
    expect(data.listAllEmployers()).toHaveLength(1);
    expect(data.listAllEmployers()[0]?.organizationName).toBe('Updated');
  });
});

describe('LocalDataAdapter evidence', () => {
  it('lists only the given candidate’s evidence, not another candidate’s', () => {
    const data = new LocalDataAdapter();
    data.upsertEvidence({
      id: 'ev1',
      candidateId: 'a',
      source: 'project',
      claim: 'c',
      context: 'c',
      actions: 'a',
      outcome: 'o',
      verificationState: 'self_attested',
      visibility: 'private',
      consentGiven: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    data.upsertEvidence({
      id: 'ev2',
      candidateId: 'b',
      source: 'project',
      claim: 'c',
      context: 'c',
      actions: 'a',
      outcome: 'o',
      verificationState: 'self_attested',
      visibility: 'private',
      consentGiven: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    expect(data.listCandidateEvidence('a').map((e) => e.id)).toEqual(['ev1']);
  });
});

describe('LocalDataAdapter webhook idempotency', () => {
  it('records an event exactly once', () => {
    const data = new LocalDataAdapter();
    expect(data.recordWebhookEventOnce('evt_1')).toBe(true);
    expect(data.recordWebhookEventOnce('evt_1')).toBe(false);
  });
});

describe('LocalDataAdapter export', () => {
  it("exports only the requested candidate's own data", () => {
    const data = new LocalDataAdapter();
    data.upsertCandidate(makeCandidate({ id: 'a' }));
    data.upsertCandidate(makeCandidate({ id: 'b' }));
    const exported = data.exportCandidateData('a');
    expect(exported?.candidate.id).toBe('a');
  });

  it('returns null for a candidate that does not exist', () => {
    const data = new LocalDataAdapter();
    expect(data.exportCandidateData('nope')).toBeNull();
  });
});

describe('LocalDataAdapter matches', () => {
  const baseMatch = {
    id: 'm1',
    matchScore: 0.5,
    status: 'suggested' as const,
    contactUnlocked: false,
    createdAt: '2026-01-01T00:00:00.000Z',
  };

  it('lists matches for a role via listMatchesForRole', () => {
    const data = new LocalDataAdapter();
    data.upsertMatch({ ...baseMatch, roleId: 'role_a', candidateId: 'cand_1' });
    data.upsertMatch({ ...baseMatch, id: 'm2', roleId: 'role_a', candidateId: 'cand_2' });
    expect(data.listMatchesForRole('role_a')).toHaveLength(2);
  });

  it('lists matches for a candidate across multiple roles via a maintained index, not a scan', () => {
    const data = new LocalDataAdapter();
    data.upsertMatch({ ...baseMatch, roleId: 'role_a', candidateId: 'cand_1' });
    data.upsertMatch({ ...baseMatch, id: 'm2', roleId: 'role_b', candidateId: 'cand_1' });
    data.upsertMatch({ ...baseMatch, id: 'm3', roleId: 'role_a', candidateId: 'cand_2' });

    const forCand1 = data.listMatchesForCandidate('cand_1');
    expect(forCand1.map((m) => m.roleId).sort()).toEqual(['role_a', 'role_b']);
  });

  it('getMatch returns the current stored record by direct key, not null for an existing match', () => {
    const data = new LocalDataAdapter();
    data.upsertMatch({ ...baseMatch, roleId: 'role_a', candidateId: 'cand_1' });
    expect(data.getMatch('role_a', 'cand_1')).toMatchObject({ contactUnlocked: false });

    data.upsertMatch({
      ...baseMatch,
      roleId: 'role_a',
      candidateId: 'cand_1',
      contactUnlocked: true,
    });
    expect(data.getMatch('role_a', 'cand_1')).toMatchObject({ contactUnlocked: true });
  });

  it('getMatch returns null for a match that was never created', () => {
    const data = new LocalDataAdapter();
    expect(data.getMatch('role_never', 'cand_never')).toBeNull();
  });
});
