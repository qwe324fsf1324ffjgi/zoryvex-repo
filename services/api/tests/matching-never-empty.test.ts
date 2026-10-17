import { describe, expect, it } from 'vitest';
import { DEFAULT_FEATURE_FLAGS } from '@zoryvex/config';
import type { Candidate, Evidence, LaunchTrack, Match, Role } from '@zoryvex/contracts';
import { recomputeMatchesForRole, type MatchingDependencies } from '../src/domain/matching-service';

/**
 * Nobody with verified proof is deleted from a shortlist any more.
 *
 * Three filters used to remove a candidate outright: backing none of the
 * written requirements, working in a neighbouring launch track, and living
 * outside the location. Each was defensible alone. Together they produced
 * empty searches, and an employer looking at an empty page could not tell
 * whether nobody qualified or their own filters had removed everyone.
 *
 * The rule now: verified evidence gets you onto the page, and how well you
 * answer the role decides where on the page you sit. The one thing that
 * still removes somebody is having nothing checked at all, which is the
 * product rather than a filter.
 */

const ROLE_ID = 'role_1';
const EMPLOYER_ID = 'emp_1';
const NOW = new Date('2026-09-06T00:00:00.000Z');

const role: Role = {
  id: ROLE_ID,
  employerId: EMPLOYER_ID,
  title: 'Platform Engineer',
  launchTrack: 'devops_platform',
  seniority: 'mid',
  outcomes: 'Ship and run the platform.',
  mustHaveWork: ['Terraform IaC on AWS'],
  constraints: '',
  status: 'active',
  createdAt: '2026-01-01T00:00:00.000Z',
};

function candidate(id: string, launchTrack: LaunchTrack): Candidate {
  return {
    id,
    email: `${id}@example.com`,
    displayName: id,
    launchTrack,
    discoveryOptIn: true,
    onboardingComplete: true,
    summary: '',
    // Findable means reachable since 2026-09-14: matching skips a candidate
    // an employer could not act on, so the fixture is somebody reachable.
    phone: '+2348012345678',
    websiteUrl: 'https://candidate.example',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function evidence(id: string, claim: string, verified = true): Evidence {
  return {
    id,
    candidateId: 'unused',
    source: 'project',
    claim,
    context: claim,
    actions: claim,
    outcome: claim,
    verificationState: verified ? 'verified' : 'unverified',
    ...(verified ? { verificationMethod: 'repo_ownership' as const } : {}),
    visibility: 'discovery',
    consentGiven: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function fakes(people: Array<{ candidate: Candidate; evidence: Evidence[] }>) {
  const putCalls: Match[] = [];
  const deleted: string[] = [];
  const deps: MatchingDependencies = {
    clock: { now: () => NOW },
    async getRole(id) {
      return id === ROLE_ID ? { role, version: 1 } : null;
    },
    // Keyed by track, the way GSI1 really is, so a cross-track sweep is
    // exercised rather than simulated by returning everybody every time.
    async listDiscoveryOptedCandidates(track) {
      return people.filter((p) => p.candidate.launchTrack === track).map((p) => p.candidate);
    },
    async listCandidateEvidence(candidateId) {
      return people.find((p) => p.candidate.id === candidateId)?.evidence ?? [];
    },
    async getMatch() {
      return null;
    },
    async putMatch(match) {
      putCalls.push(match);
      return match;
    },
    async listMatchesForRole() {
      return [];
    },
    async deleteMatch(_roleId, candidateId) {
      deleted.push(candidateId);
    },
    async getFeatureFlags() {
      return DEFAULT_FEATURE_FLAGS;
    },
    generateId: () => `m_${putCalls.length}`,
  };
  return { deps, putCalls, deleted };
}

describe('a candidate whose proof backs no stated requirement', () => {
  it('is shown rather than deleted', async () => {
    const { deps, putCalls } = fakes([
      {
        candidate: candidate('cand_far', 'devops_platform'),
        evidence: [evidence('ev_1', 'Ran incident response for a payments platform')],
      },
    ]);

    const { matches } = await recomputeMatchesForRole(EMPLOYER_ID, ROLE_ID, deps);

    expect(matches).toHaveLength(1);
    expect(putCalls[0]?.fit).toBe('adjacent');
  });

  it('scores zero, so nothing claims they answer the role', async () => {
    const { deps, putCalls } = fakes([
      {
        candidate: candidate('cand_far', 'devops_platform'),
        evidence: [evidence('ev_1', 'Ran incident response for a payments platform')],
      },
    ]);

    await recomputeMatchesForRole(EMPLOYER_ID, ROLE_ID, deps);

    expect(putCalls[0]?.matchScore).toBe(0);
  });

  it('cites the evidence they do have, so the card has something to check', async () => {
    const { deps, putCalls } = fakes([
      {
        candidate: candidate('cand_far', 'devops_platform'),
        evidence: [evidence('ev_1', 'Ran incident response for a payments platform')],
      },
    ]);

    await recomputeMatchesForRole(EMPLOYER_ID, ROLE_ID, deps);

    expect(putCalls[0]?.matchedEvidenceIds).toEqual(['ev_1']);
    expect(putCalls[0]?.strongestEvidence).toBeDefined();
  });

  it('says why they are here, in a sentence rather than a code', async () => {
    const { deps, putCalls } = fakes([
      {
        candidate: candidate('cand_far', 'devops_platform'),
        evidence: [evidence('ev_1', 'Ran incident response for a payments platform')],
      },
    ]);

    await recomputeMatchesForRole(EMPLOYER_ID, ROLE_ID, deps);

    expect(putCalls[0]?.fitReason).toContain('must-haves');
  });
});

describe('a candidate with nothing verified', () => {
  it('is still kept off the list entirely', async () => {
    // The one remaining hard gate, and the reason the product is worth
    // anything. An unchecked claim never reaches an employer.
    const { deps, putCalls } = fakes([
      {
        candidate: candidate('cand_unchecked', 'devops_platform'),
        evidence: [evidence('ev_1', 'Terraform IaC on AWS', false)],
      },
    ]);

    const { matches } = await recomputeMatchesForRole(EMPLOYER_ID, ROLE_ID, deps);

    expect(matches).toHaveLength(0);
    expect(putCalls).toHaveLength(0);
  });
});

describe('candidates in a neighbouring track', () => {
  it('are reached at all, which they were not before', async () => {
    const { deps } = fakes([
      {
        candidate: candidate('cand_security', 'cloud_security'),
        evidence: [evidence('ev_1', 'Terraform IaC on AWS')],
      },
    ]);

    const { matches } = await recomputeMatchesForRole(EMPLOYER_ID, ROLE_ID, deps);

    expect(matches).toHaveLength(1);
  });

  it('are marked partial and name the track they came from', async () => {
    const { deps, putCalls } = fakes([
      {
        candidate: candidate('cand_security', 'cloud_security'),
        evidence: [evidence('ev_1', 'Terraform IaC on AWS')],
      },
    ]);

    await recomputeMatchesForRole(EMPLOYER_ID, ROLE_ID, deps);

    expect(putCalls[0]?.fit).toBe('partial');
    expect(putCalls[0]?.fitReason).toContain('Cloud-security/DevSecOps');
  });

  it('never appear twice, however many track queries ran', async () => {
    const { deps, putCalls } = fakes([
      {
        candidate: candidate('cand_security', 'cloud_security'),
        evidence: [evidence('ev_1', 'Terraform IaC on AWS')],
      },
    ]);

    await recomputeMatchesForRole(EMPLOYER_ID, ROLE_ID, deps);

    expect(putCalls).toHaveLength(1);
  });
});

describe('an exact answer', () => {
  it('is still marked as meeting the role, with no explaining to do', async () => {
    const { deps, putCalls } = fakes([
      {
        candidate: candidate('cand_exact', 'devops_platform'),
        evidence: [evidence('ev_1', 'Terraform IaC on AWS')],
      },
    ]);

    await recomputeMatchesForRole(EMPLOYER_ID, ROLE_ID, deps);

    expect(putCalls[0]?.fit).toBe('meets');
    expect(putCalls[0]?.fitReason).toBeUndefined();
    expect(putCalls[0]?.matchScore).toBe(1);
  });

  it('outranks the near misses it is listed beside', async () => {
    const { deps } = fakes([
      {
        candidate: candidate('cand_exact', 'devops_platform'),
        evidence: [evidence('ev_1', 'Terraform IaC on AWS')],
      },
      {
        candidate: candidate('cand_adjacent', 'mlops'),
        evidence: [evidence('ev_2', 'Ran incident response for a payments platform')],
      },
    ]);

    const { matches } = await recomputeMatchesForRole(EMPLOYER_ID, ROLE_ID, deps);

    expect(matches).toHaveLength(2);
    expect(matches[0]?.matchScore).toBeGreaterThan(matches[1]!.matchScore);
  });
});

describe('what the employer is told about their own filters', () => {
  it('counts the people their requirements are talking past', async () => {
    const { deps } = fakes([
      {
        candidate: candidate('cand_adjacent', 'devops_platform'),
        evidence: [evidence('ev_1', 'Ran incident response for a payments platform')],
      },
    ]);

    const { beyondRequirements } = await recomputeMatchesForRole(EMPLOYER_ID, ROLE_ID, deps);

    expect(beyondRequirements).toBe(1);
  });
});
