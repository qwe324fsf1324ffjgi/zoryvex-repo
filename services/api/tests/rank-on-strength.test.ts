import { describe, expect, it } from 'vitest';
import type { Evidence, Match } from '@zoryvex/contracts';
import { byStrongestMatch } from '../src/domain/matching-service';
import { strongestAcross } from '../src/domain/evidence-strength-service';

const NOW = new Date('2026-09-02T12:00:00.000Z');

function match(over: Partial<Match>): Match {
  return {
    id: 'm',
    roleId: 'role_1',
    candidateId: 'cand',
    matchScore: 0.5,
    status: 'suggested',
    contactUnlocked: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...over,
  } as Match;
}

function evidence(over: Partial<Evidence> = {}): Evidence {
  return {
    id: 'ev',
    candidateId: 'cand',
    source: 'certification',
    claim: 'c',
    context: 'x',
    actions: 'y',
    outcome: 'z',
    verificationState: 'verified',
    verifiedAt: '2026-08-01T00:00:00.000Z',
    verificationDetail: 'checked',
    visibility: 'discovery',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  } as Evidence;
}

/**
 * Ranking on strength, built as a second axis rather than a multiplier folded
 * into matchScore.
 *
 * This file already removed a weight table once, on the reasoning that a
 * weaker weight does not make an unchecked claim honest, it just prices it.
 * Multiplying strength into the score would repeat that mistake in a nicer
 * costume: matchScore would stop meaning one checkable thing, and an employer
 * would be handed a number nobody could explain.
 */
describe('ranking', () => {
  it('still puts coverage first, because that is what the score means', () => {
    const weakerEvidenceButBetterCoverage = match({
      candidateId: 'a',
      matchScore: 0.9,
      strongestEvidence: 'knowledge_assessed',
    });
    const strongerEvidenceButWorseCoverage = match({
      candidateId: 'b',
      matchScore: 0.4,
      strongestEvidence: 'work_corroborated',
    });
    expect(
      byStrongestMatch([strongerEvidenceButWorseCoverage, weakerEvidenceButBetterCoverage]).map(
        (m) => m.candidateId,
      ),
    ).toEqual(['a', 'b']);
  });

  /**
   * The change the founder asked for, stated as a test. Two candidates whose
   * proof covers the same requirements used to be separated by candidate id,
   * which is alphabetical order wearing the clothes of a ranking.
   */
  it('separates equal coverage by how rigorously the evidence was checked', () => {
    const certificate = match({ candidateId: 'a', strongestEvidence: 'knowledge_assessed' });
    const corroboratedWork = match({ candidateId: 'z', strongestEvidence: 'work_corroborated' });
    expect(byStrongestMatch([certificate, corroboratedWork]).map((m) => m.candidateId)).toEqual([
      'z',
      'a',
    ]);
  });

  it('falls back to candidate id only when coverage and strength both tie', () => {
    const first = match({ candidateId: 'a', strongestEvidence: 'outcome_verified' });
    const second = match({ candidateId: 'b', strongestEvidence: 'outcome_verified' });
    expect(byStrongestMatch([second, first]).map((m) => m.candidateId)).toEqual(['a', 'b']);
  });

  /**
   * Matches written before ranking considered strength carry no level. They
   * must not leapfrog matches that do, and they must not disappear.
   */
  it('sorts a match with no recorded strength below its equals, not out of the list', () => {
    const old = match({ candidateId: 'a' });
    const scored = match({ candidateId: 'z', strongestEvidence: 'claimed' });
    const ranked = byStrongestMatch([old, scored]);
    expect(ranked.map((m) => m.candidateId)).toEqual(['z', 'a']);
    expect(ranked).toHaveLength(2);
  });

  it('does not change matchScore, which still means one checkable thing', () => {
    const ranked = byStrongestMatch([
      match({ candidateId: 'a', matchScore: 0.5, strongestEvidence: 'work_corroborated' }),
    ]);
    expect(ranked[0]?.matchScore).toBe(0.5);
  });
});

describe('strongestAcross', () => {
  it('reports the best single item, not a total', () => {
    // A sum would reward filing more claims rather than stronger ones.
    const level = strongestAcross(
      [
        evidence({ id: '1', verificationMethod: 'issuer_badge' }),
        evidence({ id: '2', verificationMethod: 'repo_ownership' }),
      ],
      NOW,
    );
    expect(level).toBe('work_corroborated');
  });

  it('is null when there is nothing to rank on', () => {
    expect(strongestAcross([], NOW)).toBeNull();
  });

  it('ignores a lapsed proof, which establishes nothing but a claim', () => {
    const level = strongestAcross(
      [
        evidence({
          verificationMethod: 'repo_ownership',
          verificationExpiresAt: '2026-09-01T00:00:00.000Z',
        }),
      ],
      NOW,
    );
    expect(level).toBe('claimed');
  });
});
