import { describe, expect, it } from 'vitest';
import { MAX_EVIDENCE_PER_CANDIDATE, type Evidence } from '@zoryvex/contracts';
import {
  createOwnEvidence,
  editChangesSubstance,
  deleteOwnEvidence,
  getOwnEvidence,
  listOwnEvidence,
  updateOwnEvidence,
  type EvidenceClaimDependencies,
} from '../src/domain/evidence-claim-service';
import { NotFoundError, ValidationError } from '../src/errors/typed-errors';

function mergeDefined<T extends object>(base: T, patch: { [K in keyof T]?: T[K] | undefined }): T {
  const merged = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) (merged as Record<string, unknown>)[key] = value;
  }
  return merged;
}

const CANDIDATE_ID = 'cand_1';
const EVIDENCE_ID = 'ev_1';

function evidenceItem(overrides: Partial<Evidence> = {}): Evidence {
  return {
    id: EVIDENCE_ID,
    candidateId: CANDIDATE_ID,
    source: 'project',
    claim: 'Built a thing',
    context: 'Personal project',
    actions: 'Did the work',
    outcome: 'It shipped',
    verificationState: 'unverified',
    visibility: 'discovery',
    consentGiven: true,
    createdAt: '2026-08-19T00:00:00.000Z',
    updatedAt: '2026-08-19T00:00:00.000Z',
    ...overrides,
  };
}

function createFakes(input: { existing?: Evidence | null } = {}) {
  let stored: Evidence | null = input.existing === undefined ? evidenceItem() : input.existing;
  let version = 1;
  const createCalls: Evidence[] = [];
  const deleteCalls: Array<{ candidateId: string; evidenceId: string }> = [];

  const deps: EvidenceClaimDependencies = {
    clock: { now: () => new Date('2026-08-19T03:00:00.000Z') },
    async createEvidence(e) {
      createCalls.push(e);
      stored = e;
      version = 1;
      return { evidence: e, version };
    },
    async getEvidence(candidateId, evidenceId) {
      if (!stored || stored.candidateId !== candidateId || stored.id !== evidenceId) return null;
      return stored;
    },
    async listAttestationsForEvidence() {
      return [];
    },
    async getEvidenceWithVersion(candidateId, evidenceId) {
      if (!stored || stored.candidateId !== candidateId || stored.id !== evidenceId) return null;
      return { evidence: stored, version };
    },
    async listCandidateEvidence(candidateId) {
      return stored && stored.candidateId === candidateId ? [stored] : [];
    },
    async updateEvidence(candidateId, evidenceId, _expectedVersion, patch, updatedAt) {
      const current = stored;
      if (!current || current.candidateId !== candidateId || current.id !== evidenceId) {
        throw new NotFoundError('Evidence not found');
      }
      const updated = mergeDefined(current, { ...patch, updatedAt });
      stored = updated;
      version += 1;
      return { evidence: updated, version };
    },
    async deleteEvidence(candidateId, evidenceId) {
      deleteCalls.push({ candidateId, evidenceId });
      stored = null;
    },
  };

  return { deps, createCalls, deleteCalls };
}

/**
 * Unbounded until 2026-09-04, and storage was the least of it. Three things
 * multiply by the number of evidence items a candidate holds: matching
 * scores every role requirement against every one of them, verification
 * allows five attempts per item against an issuer's shared rate limit, and
 * the data export reads attempts per item. `mustHaveWork` was capped the
 * same day; capping one multiplicand and not the other leaves the product
 * unbounded.
 */
describe('evidence quota', () => {
  const validInput = () => ({
    source: 'project' as const,
    claim: 'Built a thing',
    context: 'Personal project',
    actions: 'Did the work',
    outcome: 'It shipped',
    visibility: 'discovery' as const,
    consentGiven: true,
  });

  function depsHolding(count: number) {
    const { deps } = createFakes();
    deps.listCandidateEvidence = async () =>
      Array.from({ length: count }, (_unused, index) => ({ id: `ev_${index}` }) as Evidence);
    return deps;
  }

  it('files evidence while the candidate is under the limit', async () => {
    const deps = depsHolding(MAX_EVIDENCE_PER_CANDIDATE - 1);
    await expect(createOwnEvidence(CANDIDATE_ID, validInput(), deps)).resolves.toBeDefined();
  });

  it('refuses the one that would exceed the limit', async () => {
    const deps = depsHolding(MAX_EVIDENCE_PER_CANDIDATE);
    await expect(createOwnEvidence(CANDIDATE_ID, validInput(), deps)).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it('tells the candidate what to do about it', async () => {
    // A quota refusal has an action behind it - delete something - which is
    // different from a validation refusal telling somebody to write less.
    const deps = depsHolding(MAX_EVIDENCE_PER_CANDIDATE);
    await expect(createOwnEvidence(CANDIDATE_ID, validInput(), deps)).rejects.toThrow(
      'Delete one you no longer need',
    );
    await expect(createOwnEvidence(CANDIDATE_ID, validInput(), deps)).rejects.toThrow(
      String(MAX_EVIDENCE_PER_CANDIDATE),
    );
  });

  it('counts before writing, so a refused attempt stores nothing', async () => {
    const { deps, createCalls } = createFakes();
    deps.listCandidateEvidence = async () =>
      Array.from(
        { length: MAX_EVIDENCE_PER_CANDIDATE },
        (_unused, index) => ({ id: `ev_${index}` }) as Evidence,
      );
    await createOwnEvidence(CANDIDATE_ID, validInput(), deps).catch(() => undefined);
    expect(createCalls).toHaveLength(0);
  });
});

describe('createOwnEvidence', () => {
  it('always starts unverified, regardless of what the caller might try to imply', async () => {
    const { deps, createCalls } = createFakes({ existing: null });
    const result = await createOwnEvidence(
      CANDIDATE_ID,
      {
        source: 'project',
        claim: 'Built a thing',
        context: 'Personal project',
        actions: 'Did the work',
        outcome: 'It shipped',
        visibility: 'discovery',
        consentGiven: true,
      },
      deps,
    );
    expect(result.evidence.verificationState).toBe('unverified');
    expect(result.evidence.candidateId).toBe(CANDIDATE_ID);
    expect(createCalls).toHaveLength(1);
  });

  it('omits sourceUrl entirely when not provided', async () => {
    const { deps } = createFakes({ existing: null });
    const result = await createOwnEvidence(
      CANDIDATE_ID,
      {
        source: 'project',
        claim: 'x',
        context: 'y',
        actions: 'z',
        outcome: 'w',
        visibility: 'private',
        consentGiven: true,
      },
      deps,
    );
    expect(result.evidence.sourceUrl).toBeUndefined();
  });
});

describe('listOwnEvidence', () => {
  it("returns only the caller's own evidence", async () => {
    const { deps } = createFakes();
    expect(await listOwnEvidence(CANDIDATE_ID, deps)).toHaveLength(1);
    expect(await listOwnEvidence('cand_other', deps)).toHaveLength(0);
  });
});

describe('getOwnEvidence', () => {
  it('returns the item and its current version for the owning candidate', async () => {
    const { deps } = createFakes();
    const result = await getOwnEvidence(CANDIDATE_ID, EVIDENCE_ID, deps);
    expect(result.evidence.id).toBe(EVIDENCE_ID);
    expect(result.version).toBe(1);
  });

  it("throws NotFoundError for another candidate's evidence id", async () => {
    const { deps } = createFakes();
    await expect(getOwnEvidence('cand_other', EVIDENCE_ID, deps)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it('throws NotFoundError for an evidence id that never existed', async () => {
    const { deps } = createFakes({ existing: null });
    await expect(getOwnEvidence(CANDIDATE_ID, 'missing', deps)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});

describe('updateOwnEvidence', () => {
  it('updates an existing item', async () => {
    const { deps } = createFakes();
    const result = await updateOwnEvidence(
      CANDIDATE_ID,
      EVIDENCE_ID,
      1,
      { claim: 'New claim' },
      deps,
    );
    expect(result.evidence.claim).toBe('New claim');
  });
});

describe('deleteOwnEvidence', () => {
  it("throws NotFoundError for another candidate's evidence id, without deleting anything", async () => {
    const { deps, deleteCalls } = createFakes();
    await expect(deleteOwnEvidence('cand_other', EVIDENCE_ID, deps)).rejects.toThrow(NotFoundError);
    expect(deleteCalls).toHaveLength(0);
  });

  it('deletes an item the caller owns', async () => {
    const { deps, deleteCalls } = createFakes();
    await deleteOwnEvidence(CANDIDATE_ID, EVIDENCE_ID, deps);
    expect(deleteCalls).toEqual([{ candidateId: CANDIDATE_ID, evidenceId: EVIDENCE_ID }]);
  });

  it('throws NotFoundError for an evidence id that never existed', async () => {
    const { deps } = createFakes({ existing: null });
    await expect(deleteOwnEvidence(CANDIDATE_ID, 'missing', deps)).rejects.toThrow(NotFoundError);
  });
});

/**
 * Closes a verification-laundering hole.
 *
 * Without this rule a candidate gets one real credential verified, then
 * rewrites claim/context/actions/outcome into whatever an employer's role
 * asks for and keeps the "Verified" badge. The badge would then attest to
 * text nobody ever checked — worse than no badge, since an employer is
 * paying precisely for the promise that it means something.
 */
describe('editing a verified claim resets its verification', () => {
  it('flags a reset when the substance of a verified item changes', () => {
    const verified = evidenceItem({ verificationState: 'verified' });
    expect(editChangesSubstance({ claim: 'Something completely different' }, verified)).toBe(true);
    expect(editChangesSubstance({ outcome: 'A different outcome' }, verified)).toBe(true);
  });

  it('does not flag a reset for a no-op edit that resubmits the same text', () => {
    const verified = evidenceItem({ verificationState: 'verified' });
    expect(editChangesSubstance({ claim: verified.claim }, verified)).toBe(false);
  });

  it('does not cost a candidate their verification for hiding the item', () => {
    // Visibility and consent change who can see the claim, not what it says.
    const verified = evidenceItem({ verificationState: 'verified' });
    expect(editChangesSubstance({ visibility: 'private' }, verified)).toBe(false);
    expect(editChangesSubstance({ consentGiven: false }, verified)).toBe(false);
  });
});
