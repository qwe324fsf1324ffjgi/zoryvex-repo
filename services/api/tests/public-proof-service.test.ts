import { describe, expect, it } from 'vitest';
import {
  PublicProofSchema,
  type Candidate,
  type Evidence,
  type PeerAttestation,
} from '@zoryvex/contracts';
import {
  disablePublicProofPage,
  enablePublicProofPage,
  getPublicProof,
  type PublicProofConsentDependencies,
  type PublicProofDependencies,
} from '../src/domain/public-proof-service';
import { NotFoundError } from '../src/errors/typed-errors';

const NOW = new Date('2026-09-01T12:00:00.000Z');
const CANDIDATE_ID = 'cand_1';
const PUBLIC_ID = 'pub_abc';

function candidate(overrides: Partial<Candidate> = {}): Candidate {
  return {
    id: CANDIDATE_ID,
    email: 'private@example.com',
    displayName: 'A Candidate',
    launchTrack: 'aws_cloud',
    discoveryOptIn: true,
    onboardingComplete: true,
    summary: '',
    publicProofId: PUBLIC_ID,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function evidence(overrides: Partial<Evidence> = {}): Evidence {
  return {
    id: 'ev_1',
    candidateId: CANDIDATE_ID,
    source: 'certification',
    claim: 'Ran the migration that halved p95 latency',
    context: 'A payments service under load',
    actions: 'I rewrote the query path and added an index',
    outcome: 'p95 fell from 800ms to 380ms',
    verificationState: 'verified',
    verificationMethod: 'issuer_badge',
    verificationDetail: 'AWS Certified Solutions Architect, confirmed with AWS Training',
    verifiedAt: '2026-08-01T00:00:00.000Z',
    visibility: 'discovery',
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  } as Evidence;
}

function readFakes(
  input: {
    stored?: Candidate | null;
    evidence?: Evidence[];
    pointer?: string | null;
    attestations?: PeerAttestation[];
  } = {},
) {
  const stored = input.stored === undefined ? candidate() : input.stored;
  const deps: PublicProofDependencies = {
    clock: { now: () => NOW },
    async getCandidateIdByPublicProofId(id) {
      if (input.pointer === null) return null;
      return id === PUBLIC_ID ? (input.pointer ?? CANDIDATE_ID) : null;
    },
    async getCandidate(id) {
      if (!stored || stored.id !== id) return null;
      return { candidate: stored, version: 1 };
    },
    async listAttestationsForEvidence() {
      return input.attestations ?? [];
    },
    async listCandidateEvidence() {
      return input.evidence ?? [evidence()];
    },
  };
  return { deps };
}

describe('getPublicProof', () => {
  it('returns a page that matches the public contract', async () => {
    const { deps } = readFakes();
    const page = await getPublicProof(PUBLIC_ID, deps);
    expect(PublicProofSchema.safeParse(page).success).toBe(true);
    expect(page.displayName).toBe('A Candidate');
    expect(page.proofs).toHaveLength(1);
  });

  /**
   * The single most important assertion in this file. Everything else is a
   * feature; this is the promise. A public URL must never carry the email
   * address, the internal id, the candidate's own narrative, or anything
   * else that was never agreed to be published.
   */
  it('carries nothing beyond proof', async () => {
    const { deps } = readFakes();
    const serialized = JSON.stringify(await getPublicProof(PUBLIC_ID, deps));
    for (const secret of [
      'private@example.com',
      CANDIDATE_ID,
      'A payments service under load', // context
      'I rewrote the query path', // actions
      'ev_1', // internal evidence id
    ]) {
      expect(serialized, `public page leaked: ${secret}`).not.toContain(secret);
    }
  });

  describe('what it refuses to show', () => {
    it('is not found when no pointer resolves the id', async () => {
      const { deps } = readFakes({ pointer: null });
      await expect(getPublicProof(PUBLIC_ID, deps)).rejects.toThrow(NotFoundError);
    });

    /**
     * The pointer is deleted on opt-out, so a stale pointer should be
     * impossible. It is checked anyway, because the thing it guards against
     * is publishing somebody who withdrew consent.
     */
    it('is not found when the candidate no longer holds that public id', async () => {
      const { deps } = readFakes({ stored: candidate({ publicProofId: undefined }) });
      await expect(getPublicProof(PUBLIC_ID, deps)).rejects.toThrow(NotFoundError);
    });

    it('is not found when the id belongs to a different candidate now', async () => {
      const { deps } = readFakes({ stored: candidate({ publicProofId: 'pub_something_else' }) });
      await expect(getPublicProof(PUBLIC_ID, deps)).rejects.toThrow(NotFoundError);
    });

    it('is not found when the candidate is gone', async () => {
      const { deps } = readFakes({ stored: null });
      await expect(getPublicProof(PUBLIC_ID, deps)).rejects.toThrow(NotFoundError);
    });

    /**
     * Every refusal above says the same thing. A URL that answered "no such
     * page" differently from "that person turned this off" would be a way to
     * ask questions about people who did not agree to answer any.
     */
    it('says the same thing for every refusal', async () => {
      const messages: string[] = [];
      for (const fakes of [
        readFakes({ pointer: null }),
        readFakes({ stored: null }),
        readFakes({ stored: candidate({ publicProofId: undefined }) }),
      ]) {
        await getPublicProof(PUBLIC_ID, fakes.deps).catch((e: Error) => messages.push(e.message));
      }
      expect(messages).toHaveLength(3);
      expect(new Set(messages).size).toBe(1);
    });
  });

  describe('what counts as a proof', () => {
    it('omits unverified and self-attested claims entirely', async () => {
      const { deps } = readFakes({
        evidence: [
          evidence({ id: 'a', verificationState: 'unverified', claim: 'unchecked claim' }),
          evidence({ id: 'b', verificationState: 'self_attested', claim: 'self reported' }),
          evidence({ id: 'c', claim: 'a real proof' }),
        ],
      });
      const page = await getPublicProof(PUBLIC_ID, deps);
      expect(page.proofs.map((p) => p.claim)).toEqual(['a real proof']);
    });

    it('omits private evidence even when it is verified', async () => {
      const { deps } = readFakes({
        evidence: [evidence({ visibility: 'private', claim: 'kept back' })],
      });
      expect((await getPublicProof(PUBLIC_ID, deps)).proofs).toHaveLength(0);
    });

    /**
     * Re-checked against the clock at read time rather than trusted from
     * storage, on the same isVerified the marketplace uses. A public page
     * that outlived its own proof is the thing this product argues against.
     */
    it('drops a proof whose credential lapsed, on the day it lapsed', async () => {
      const lapsed = evidence({
        claim: 'lapsed cert',
        verificationExpiresAt: '2026-08-31T00:00:00.000Z',
      });
      const live = evidence({
        id: 'ev_2',
        claim: 'still valid',
        verificationExpiresAt: '2027-01-01T00:00:00.000Z',
      });
      const { deps } = readFakes({ evidence: [lapsed, live] });
      const page = await getPublicProof(PUBLIC_ID, deps);
      expect(page.proofs.map((p) => p.claim)).toEqual(['still valid']);
    });

    it('omits a verified item with no readable account of what was checked', async () => {
      // Rendering it would be a proof nobody can check, which is a "trust
      // me" with better typography.
      const { deps } = readFakes({
        evidence: [evidence({ verificationDetail: undefined, claim: 'unexplained' })],
      });
      expect((await getPublicProof(PUBLIC_ID, deps)).proofs).toHaveLength(0);
    });

    it('puts the freshest check first, so a stale page is obvious', async () => {
      const { deps } = readFakes({
        evidence: [
          evidence({ id: 'old', claim: 'older', verifiedAt: '2026-02-01T00:00:00.000Z' }),
          evidence({ id: 'new', claim: 'newer', verifiedAt: '2026-08-20T00:00:00.000Z' }),
        ],
      });
      const page = await getPublicProof(PUBLIC_ID, deps);
      expect(page.proofs.map((p) => p.claim)).toEqual(['newer', 'older']);
    });

    it('returns an empty page rather than an error when nothing is proved yet', async () => {
      const { deps } = readFakes({ evidence: [] });
      const page = await getPublicProof(PUBLIC_ID, deps);
      expect(page.proofs).toEqual([]);
      expect(page.displayName).toBe('A Candidate');
    });
  });
});

function consentFakes(input: { stored?: Candidate | null } = {}) {
  let stored = input.stored === undefined ? candidate({ publicProofId: undefined }) : input.stored;
  const enabled: { candidateId: string; publicProofId: string }[] = [];
  const disabled: { candidateId: string; publicProofId: string }[] = [];
  const audit: string[] = [];
  let minted = 0;

  const deps: PublicProofConsentDependencies = {
    clock: { now: () => NOW },
    async getCandidate(id) {
      if (!stored || stored.id !== id) return null;
      return { candidate: stored, version: 1 };
    },
    async enablePublicProof(candidateId, publicProofId) {
      enabled.push({ candidateId, publicProofId });
      if (stored) stored = { ...stored, publicProofId };
    },
    async disablePublicProof(candidateId, publicProofId) {
      disabled.push({ candidateId, publicProofId });
      if (stored) {
        const next = { ...stored };
        delete next.publicProofId;
        stored = next;
      }
    },
    async appendAuditEvent(event) {
      audit.push(event.action);
      return event;
    },
    generateId: () => `generated_${(minted += 1)}`,
  };
  return { deps, enabled, disabled, audit, current: () => stored };
}

describe('enabling and revoking the page', () => {
  it('mints an id, writes the pointer, and records the consent', async () => {
    const { deps, enabled, audit } = consentFakes();
    const { publicProofId } = await enablePublicProofPage(CANDIDATE_ID, deps);
    expect(publicProofId).toBe('generated_1');
    expect(enabled).toEqual([{ candidateId: CANDIDATE_ID, publicProofId: 'generated_1' }]);
    expect(audit).toEqual(['public_proof_opt_in']);
  });

  /**
   * Minting a second id would leave the first live and unreachable from the
   * candidate's own settings — a URL about them that they cannot revoke.
   */
  it('returns the existing id rather than minting a second live URL', async () => {
    const { deps, enabled } = consentFakes({
      stored: candidate({ publicProofId: 'pub_existing' }),
    });
    const { publicProofId } = await enablePublicProofPage(CANDIDATE_ID, deps);
    expect(publicProofId).toBe('pub_existing');
    expect(enabled).toEqual([]);
  });

  /**
   * Revocation has to break links people already saved. Parking the id, or
   * hiding the page behind a flag while keeping the pointer, would leave
   * every shared URL resolving.
   */
  it('destroys the pointer on revocation, so a saved link stops resolving', async () => {
    const { deps, disabled, audit, current } = consentFakes({
      stored: candidate({ publicProofId: 'pub_live' }),
    });
    await disablePublicProofPage(CANDIDATE_ID, deps);
    expect(disabled).toEqual([{ candidateId: CANDIDATE_ID, publicProofId: 'pub_live' }]);
    expect(current()?.publicProofId).toBeUndefined();
    expect(audit).toEqual(['public_proof_opt_out']);
  });

  it('re-enabling issues a different id, so the revoked link stays dead', async () => {
    const { deps } = consentFakes({ stored: candidate({ publicProofId: 'pub_live' }) });
    await disablePublicProofPage(CANDIDATE_ID, deps);
    const { publicProofId } = await enablePublicProofPage(CANDIDATE_ID, deps);
    expect(publicProofId).not.toBe('pub_live');
  });

  it('is a no-op when revoking something never enabled', async () => {
    const { deps, disabled, audit } = consentFakes();
    await expect(disablePublicProofPage(CANDIDATE_ID, deps)).resolves.toBeUndefined();
    expect(disabled).toEqual([]);
    expect(audit).toEqual([]);
  });

  it('refuses for a candidate that does not exist', async () => {
    const { deps } = consentFakes({ stored: null });
    await expect(enablePublicProofPage(CANDIDATE_ID, deps)).rejects.toThrow(NotFoundError);
    await expect(disablePublicProofPage(CANDIDATE_ID, deps)).rejects.toThrow(NotFoundError);
  });
});

describe('confirmations on the public page', () => {
  const attestation: PeerAttestation = {
    id: 'att_1',
    evidenceId: 'ev_1',
    candidateId: CANDIDATE_ID,
    verifierDomain: 'bigcorp.test',
    verifierEmailHash: 'must-never-travel',
    relationship: 'managed_them',
    statement: 'I was their lead. The migration happened as described.',
    confirmedAt: '2026-08-25T00:00:00.000Z',
  };

  it('carries the words and the organisation, and raises the strength', async () => {
    const { deps } = readFakes({ attestations: [attestation] });
    const page = await getPublicProof(PUBLIC_ID, deps);

    expect(page.proofs[0]?.peerAttestations).toEqual([
      {
        verifierDomain: 'bigcorp.test',
        relationship: 'managed_them',
        statement: 'I was their lead. The migration happened as described.',
        confirmedAt: '2026-08-25T00:00:00.000Z',
      },
    ]);
    expect(page.proofs[0]?.strength.attained).toContain('peer_verified');
  });

  /**
   * The verifier's address is theirs. They agreed to confirm a claim, and on
   * the confirm page they are told before writing that the organisation
   * appears and the address does not. The hash must not leak either: it is
   * keyed, but a value that never needs to travel should never travel.
   */
  it('never lets the address or its hash reach a public page', async () => {
    const { deps } = readFakes({ attestations: [attestation] });
    const serialized = JSON.stringify(await getPublicProof(PUBLIC_ID, deps));
    expect(serialized).not.toContain('must-never-travel');
    expect(serialized).not.toContain('@');
  });

  it('is empty rather than absent when nobody confirmed anything', async () => {
    const { deps } = readFakes();
    const page = await getPublicProof(PUBLIC_ID, deps);
    // An empty list says "nobody confirmed this". A missing key says nothing
    // at all, and a reader cannot tell that from "we did not look".
    expect(page.proofs[0]?.peerAttestations).toEqual([]);
    expect(page.proofs[0]?.strength.attained).not.toContain('peer_verified');
  });

  it('still matches the published contract with confirmations on it', async () => {
    const { deps } = readFakes({ attestations: [attestation] });
    const page = await getPublicProof(PUBLIC_ID, deps);
    expect(PublicProofSchema.safeParse(page).success).toBe(true);
  });
});
