import { describe, expect, it } from 'vitest';
import type { Evidence, Role } from '@zoryvex/contracts';
import { isVerified, scoreCandidateAgainstRole } from '../src/domain/matching-service';

/**
 * Capability matching is retired, and this file records the reversal rather
 * than vanishing with it.
 *
 * What it used to assert: a requirement was credited in full when a graded
 * task the candidate passed tested the matching capability, even with zero
 * keyword overlap. That was the strongest signal the platform had, because a
 * rubric it published and machine-checked said nothing about whether the
 * candidate happened to use the employer's vocabulary.
 *
 * Why it is gone: the rubric was solvable from the published brief by a
 * language model, so a pass established that a passing file was submitted
 * and not that the person could do the work. Once the check stopped meaning
 * anything, a match rationale reading "supported by a graded task this
 * candidate passed" was selling an employer a result the platform no longer
 * stands behind.
 *
 * What is asserted now is the consequence, in both directions: a graded task
 * supports nothing, and everything else scores exactly as it did.
 */

const NOW = new Date('2026-09-06T00:00:00.000Z');

function role(mustHaveWork: string[]): Role {
  return {
    id: 'role_1',
    employerId: 'emp_1',
    title: 'Platform Engineer',
    launchTrack: 'devops_platform',
    seniority: 'mid',
    outcomes: 'Run the platform.',
    mustHaveWork,
    constraints: '',
    status: 'active',
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

function evidence(overrides: Partial<Evidence> = {}): Evidence {
  return {
    id: 'ev_graded',
    candidateId: 'cand_1',
    source: 'project',
    claim: 'Built a multi-account AWS landing zone with Terraform',
    context: 'At a fintech',
    actions: 'Wrote the modules',
    outcome: 'It shipped',
    verificationState: 'verified',
    verificationMethod: 'graded_task',
    verificationRef: 'task_least_privilege_role_v1',
    verifiedAt: '2026-01-02T00:00:00.000Z',
    visibility: 'discovery',
    consentGiven: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('a graded task no longer supports anything', () => {
  it('is not treated as verified, however it is stored', () => {
    // Stored as verified, because it was, at a time when that meant
    // something. The gate refuses the method rather than rewriting history.
    expect(isVerified(evidence(), NOW)).toBe(false);
  });

  it('supports no requirement, even one it words identically', () => {
    // The wording path would have matched this on overlap alone. It does not,
    // because the item never reaches the scorer.
    const result = scoreCandidateAgainstRole(
      role(['Built a multi-account AWS landing zone with Terraform']),
      [evidence()],
      NOW,
    );
    expect(result.matchScore).toBe(0);
    expect(result.matchedEvidenceIds).toEqual([]);
  });

  it('never puts a graded task in a rationale an employer reads', () => {
    const result = scoreCandidateAgainstRole(
      role(['Set up IAM roles with least privilege']),
      [evidence()],
      NOW,
    );
    expect(result.rationale).not.toContain('graded task');
    expect(result.rationale).not.toContain('rubric');
  });
});

describe('the checks that remain are untouched', () => {
  it('still credits a certification on wording overlap', () => {
    const result = scoreCandidateAgainstRole(
      role(['Built a multi-account AWS landing zone with Terraform']),
      [
        evidence({
          id: 'ev_badge',
          verificationMethod: 'issuer_badge',
          verificationRef: 'badge_1',
        }),
      ],
      NOW,
    );
    expect(result.matchScore).toBeGreaterThan(0);
    expect(result.matchedEvidenceIds).toEqual(['ev_badge']);
    expect(result.rationale).toContain('keyword overlap');
  });

  it('still credits proven repository ownership', () => {
    const result = scoreCandidateAgainstRole(
      role(['Built a multi-account AWS landing zone with Terraform']),
      [evidence({ id: 'ev_repo', verificationMethod: 'repo_ownership', verificationRef: 'a/b' })],
      NOW,
    );
    expect(result.matchScore).toBeGreaterThan(0);
    expect(result.matchedEvidenceIds).toEqual(['ev_repo']);
  });

  it('leaves an unverified claim counting for nothing, as before', () => {
    const result = scoreCandidateAgainstRole(
      role(['Built a multi-account AWS landing zone with Terraform']),
      [evidence({ verificationState: 'unverified', verificationMethod: undefined })],
      NOW,
    );
    expect(result.matchScore).toBe(0);
  });

  it('still says plainly when nothing supports a requirement', () => {
    const result = scoreCandidateAgainstRole(role(['Run Kubernetes in anger']), [evidence()], NOW);
    expect(result.rationale).toContain('no verified evidence supports this');
  });
});
