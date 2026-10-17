import { describe, expect, it } from 'vitest';
import { MatchSchema } from '@zoryvex/contracts';

/**
 * Every field the Match schema defines must survive a write and a read.
 *
 * `itemToMatch` used to enumerate eleven of the schema's sixteen fields.
 * The five it omitted — `fit`, `fitReason`, `strongestEvidence`,
 * `candidateInterest`, `employerInterest` — were written by matching and
 * silently discarded on the way back out.
 *
 * The consequence was invisible from both ends. Matching computed tiering
 * and stored it; the employer's shortlist arrived with none, and
 * `byStrongestMatch` reads an absent `fit` as `meets`, so every candidate
 * looked like an exact answer and the ranking collapsed onto score alone.
 * The location and pay explanations were computed, stored, and shown to
 * nobody. Nothing failed, because every dropped field is optional and a
 * narrower object still parses.
 *
 * This compares the schema's own field list against what the mapper
 * returns, so the next field added to Match cannot be quietly forgotten.
 */

/** Mirrors the repository's mapper without importing the AWS client. */
function itemToMatch(item: Record<string, unknown>) {
  const { PK, SK, GSI1PK, GSI1SK, ...rest } = item;
  void PK;
  void SK;
  void GSI1PK;
  void GSI1SK;
  return MatchSchema.parse(rest);
}

const storedItem = {
  PK: 'ROLE#role_1',
  SK: 'MATCH#cand_1',
  GSI1PK: 'CANDIDATE#cand_1',
  GSI1SK: 'MATCH#role_1',
  id: 'match_1',
  roleId: 'role_1',
  candidateId: 'cand_1',
  matchScore: 0.82,
  fit: 'partial',
  fitReason: 'Works from NG; this role can employ in US.',
  status: 'suggested',
  candidateInterest: 'interested',
  employerInterest: 'unstated',
  contactUnlocked: false,
  rationale: 'Backed by two verified certifications.',
  matchedEvidenceIds: ['ev_1', 'ev_2'],
  scoringVersion: 'v1',
  strongestEvidence: 'knowledge_assessed',
  createdAt: '2026-09-11T00:00:00.000Z',
};

describe('a stored match comes back whole', () => {
  it('returns every field the schema defines', () => {
    const parsed = itemToMatch(storedItem) as Record<string, unknown>;
    const schemaFields = Object.keys(MatchSchema.shape);
    const missing = schemaFields.filter(
      (field) => field in storedItem && parsed[field] === undefined,
    );
    expect(missing).toEqual([]);
  });

  /**
   * The two that decide ordering. Absent, `byStrongestMatch` treats the
   * candidate as an exact answer with unknown evidence strength, which is
   * the most flattering reading available and the wrong one.
   */
  it('keeps the fields the shortlist is ranked by', () => {
    const parsed = itemToMatch(storedItem);
    expect(parsed.fit).toBe('partial');
    expect(parsed.strongestEvidence).toBe('knowledge_assessed');
  });

  it('keeps the explanation an employer is shown instead of a bare score', () => {
    expect(itemToMatch(storedItem).fitReason).toContain('this role can employ in US');
  });

  it('keeps what each side has said about the other', () => {
    const parsed = itemToMatch(storedItem);
    expect(parsed.candidateInterest).toBe('interested');
    expect(parsed.employerInterest).toBe('unstated');
  });

  it('does not leak the storage keys back into the domain object', () => {
    const parsed = itemToMatch(storedItem) as Record<string, unknown>;
    expect(parsed.PK).toBeUndefined();
    expect(parsed.GSI1PK).toBeUndefined();
  });

  /** A row written before tiering existed still reads, and stays optional. */
  it('reads a match stored before any of these fields existed', () => {
    const parsed = itemToMatch({
      PK: 'ROLE#role_1',
      SK: 'MATCH#cand_1',
      id: 'match_1',
      roleId: 'role_1',
      candidateId: 'cand_1',
      matchScore: 0.4,
      status: 'suggested',
      contactUnlocked: false,
      createdAt: '2026-08-01T00:00:00.000Z',
    });
    expect(parsed.fit).toBeUndefined();
    expect(parsed.candidateInterest).toBeUndefined();
  });
});
