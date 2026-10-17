import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { PeerAttestation } from '@zoryvex/contracts';
import {
  emailDomain,
  hasPeerAttestation,
  isAnonymousDomain,
  recordPeerAttestation,
  type PeerAttestationDependencies,
  type RecordAttestationInput,
} from '../src/domain/peer-attestation-service';
import { ConflictError, ValidationError } from '../src/errors/typed-errors';

const hashFor = (email: string) =>
  createHash('sha256').update(`test-pepper:${email.trim().toLowerCase()}`).digest('hex');

const NOW = new Date('2026-09-02T12:00:00.000Z');
const CANDIDATE_ID = 'cand_1';
const EVIDENCE_ID = 'ev_1';

function createFakes(
  input: {
    candidateEmail?: string | null;
    existing?: PeerAttestation[];
    reciprocal?: boolean;
  } = {},
) {
  const written: PeerAttestation[] = [];
  const deps: PeerAttestationDependencies = {
    clock: { now: () => NOW },
    generateId: () => 'att_1',
    // A real one-way hash rather than a readable stand-in. The first version
    // of this fake returned `h:${email}`, which failed the test asserting the
    // address is never stored — correctly, because a hash that contains its
    // input is not a hash, and a fake that lacks the property under test
    // proves nothing.
    hashEmail: (email) =>
      createHash('sha256').update(`test-pepper:${email.trim().toLowerCase()}`).digest('hex'),
    async getCandidateEmail() {
      return input.candidateEmail === undefined ? 'candidate@acme.test' : input.candidateEmail;
    },
    async listAttestationsForEvidence() {
      return input.existing ?? [];
    },
    async hasCandidateAttestedFor() {
      return input.reciprocal ?? false;
    },
    async putAttestation(attestation) {
      written.push(attestation);
      return attestation;
    },
  };
  return { deps, written };
}

const request = (over: Partial<RecordAttestationInput> = {}): RecordAttestationInput => ({
  evidenceId: EVIDENCE_ID,
  candidateId: CANDIDATE_ID,
  confirmedVerifierEmail: 'lead@bigcorp.test',
  relationship: 'managed_them',
  statement: 'I was their team lead. They did the migration described here.',
  ...over,
});

describe('recording an attestation', () => {
  it('stores the domain and the relationship, and never the address', async () => {
    const { deps, written } = createFakes();
    const saved = await recordPeerAttestation(request(), deps);

    expect(saved.verifierDomain).toBe('bigcorp.test');
    expect(saved.relationship).toBe('managed_them');
    // The address itself must not survive anywhere in the record. The
    // verifier agreed to confirm a claim, not to have their email stored.
    expect(JSON.stringify(written[0])).not.toContain('lead@bigcorp.test');
  });

  it('keeps a hash only so the rules below can be enforced', async () => {
    const { deps } = createFakes();
    const saved = await recordPeerAttestation(request(), deps);
    expect(saved.verifierEmailHash).toBeTruthy();
    expect(saved.verifierEmailHash).not.toContain('@');
  });

  it('records when the address was confirmed, not when the form was filled in', async () => {
    const { deps } = createFakes();
    const saved = await recordPeerAttestation(request(), deps);
    expect(saved.confirmedAt).toBe(NOW.toISOString());
  });
});

describe('the rules that stop it being worthless', () => {
  /**
   * The single most important refusal. An attestation from a free webmail
   * address establishes that a human exists, which was never in question.
   */
  it('refuses an anonymous address, however sincere', async () => {
    for (const address of [
      'a.friend@gmail.com',
      'someone@outlook.com',
      'x@proton.me',
      'Y@YAHOO.COM',
    ]) {
      const { deps, written } = createFakes();
      await expect(
        recordPeerAttestation(request({ confirmedVerifierEmail: address }), deps),
      ).rejects.toThrow(ValidationError);
      expect(written).toEqual([]);
    }
  });

  it('accepts an address at a real organisation', async () => {
    const { deps } = createFakes();
    await expect(
      recordPeerAttestation(request({ confirmedVerifierEmail: 'cto@some-startup.io' }), deps),
    ).resolves.toMatchObject({ verifierDomain: 'some-startup.io' });
  });

  it('refuses a candidate confirming their own claim', async () => {
    const { deps } = createFakes({ candidateEmail: 'me@bigcorp.test' });
    await expect(
      recordPeerAttestation(request({ confirmedVerifierEmail: 'me@bigcorp.test' }), deps),
    ).rejects.toThrow(ValidationError);
  });

  it('refuses it however the address is spelled', async () => {
    // Compared on the hash, which normalises case and whitespace, so a
    // candidate cannot slip past on presentation.
    const { deps } = createFakes({ candidateEmail: 'me@bigcorp.test' });
    await expect(
      recordPeerAttestation(request({ confirmedVerifierEmail: '  ME@BigCorp.TEST ' }), deps),
    ).rejects.toThrow(ValidationError);
  });

  /**
   * The cheapest attack available and the one nobody would notice: two
   * candidates confirming each other. Refused rather than flagged, because a
   * flag is something a human has to read and act on.
   */
  it('refuses a reciprocity ring', async () => {
    const { deps, written } = createFakes({ reciprocal: true });
    await expect(recordPeerAttestation(request(), deps)).rejects.toThrow(ConflictError);
    expect(written).toEqual([]);
  });

  it('refuses the same person confirming the same claim twice', async () => {
    const already: PeerAttestation = {
      id: 'att_0',
      evidenceId: EVIDENCE_ID,
      candidateId: CANDIDATE_ID,
      verifierDomain: 'bigcorp.test',
      verifierEmailHash: hashFor('lead@bigcorp.test'),
      relationship: 'managed_them',
      statement: 'Confirmed once already.',
      confirmedAt: '2026-08-01T00:00:00.000Z',
    };
    const { deps } = createFakes({ existing: [already] });
    await expect(recordPeerAttestation(request(), deps)).rejects.toThrow(ConflictError);
  });

  it('lets a different colleague confirm the same claim', async () => {
    const already: PeerAttestation = {
      id: 'att_0',
      evidenceId: EVIDENCE_ID,
      candidateId: CANDIDATE_ID,
      verifierDomain: 'bigcorp.test',
      verifierEmailHash: hashFor('someone-else@bigcorp.test'),
      relationship: 'worked_alongside',
      statement: 'Also there.',
      confirmedAt: '2026-08-01T00:00:00.000Z',
    };
    const { deps } = createFakes({ existing: [already] });
    await expect(recordPeerAttestation(request(), deps)).resolves.toBeTruthy();
  });

  it('refuses an empty or oversized statement', async () => {
    const { deps } = createFakes();
    await expect(recordPeerAttestation(request({ statement: '   ' }), deps)).rejects.toThrow(
      ValidationError,
    );
    await expect(
      recordPeerAttestation(request({ statement: 'x'.repeat(601) }), deps),
    ).rejects.toThrow(ValidationError);
  });

  it('refuses something that is not an address at all', async () => {
    const { deps } = createFakes();
    for (const bad of ['not-an-email', 'a@localhost', '']) {
      await expect(
        recordPeerAttestation(request({ confirmedVerifierEmail: bad }), deps),
      ).rejects.toThrow(ValidationError);
    }
  });
});

describe('helpers', () => {
  it('reads the domain after the last @', () => {
    expect(emailDomain('a.b@sub.example.co.uk')).toBe('sub.example.co.uk');
    expect(emailDomain('weird@name@example.test')).toBe('example.test');
    expect(emailDomain('nope')).toBe('');
  });

  it('knows the anonymous providers regardless of case', () => {
    expect(isAnonymousDomain('GMAIL.COM')).toBe(true);
    expect(isAnonymousDomain('bigcorp.test')).toBe(false);
  });

  /**
   * Deliberately not a count. Three colleagues at one company agreeing is
   * one organisation's opinion however many people typed it, and a number
   * invites an employer to read agreement as strength.
   */
  it('reports whether there is an attestation, not how many', () => {
    expect(hasPeerAttestation([])).toBe(false);
    expect(typeof hasPeerAttestation([{} as PeerAttestation])).toBe('boolean');
  });
});

describe('the reciprocity rule, in the direction that makes it a ring', () => {
  /**
   * The first version of the storage behind this was written the wrong way
   * round: it recorded "this candidate was vouched for by this verifier" and
   * then asked the same question back, which detects a second vouch from the
   * same person — already refused by the one-per-verifier rule — and never
   * detects a ring at all.
   *
   * These tests state the direction in the assertions so it cannot be
   * rewritten backwards without one of them failing.
   */
  it('refuses when the candidate previously vouched for this verifier', async () => {
    // A vouched for B. Now B is vouching for A. That is the ring.
    const { deps, written } = createFakes({ reciprocal: true });
    await expect(recordPeerAttestation(request(), deps)).rejects.toThrow(ConflictError);
    expect(written).toEqual([]);
  });

  it('allows it when no vouch has gone the other way', async () => {
    // B vouching for A, with A having vouched for nobody, is the ordinary
    // case and must not be caught by the ring rule.
    const { deps } = createFakes({ reciprocal: false });
    await expect(recordPeerAttestation(request(), deps)).resolves.toBeTruthy();
  });

  it('asks the question with the candidate as the voucher, not the vouched-for', async () => {
    // Guards the direction at the call site: the service must ask "has this
    // CANDIDATE vouched for this VERIFIER", and a swap here is the bug the
    // storage layer already had once.
    const asked: { candidateId: string; verifierEmailHash: string }[] = [];
    const { deps } = createFakes();
    const spied: typeof deps = {
      ...deps,
      async hasCandidateAttestedFor(candidateId, verifierEmailHash) {
        asked.push({ candidateId, verifierEmailHash });
        return false;
      },
    };
    await recordPeerAttestation(request(), spied);

    expect(asked).toHaveLength(1);
    expect(asked[0]?.candidateId).toBe(CANDIDATE_ID);
    // The hash asked about is the VERIFIER's, never the candidate's.
    expect(asked[0]?.verifierEmailHash).toBe(hashFor('lead@bigcorp.test'));
    expect(asked[0]?.verifierEmailHash).not.toBe(hashFor('candidate@acme.test'));
  });
});
