import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { PeerAttestation } from '@zoryvex/contracts';
import {
  confirmPeerAttestation,
  previewPeerRequest,
  requestPeerAttestation,
  type PeerRequestDependencies,
  type PeerRequestRecord,
} from '../src/domain/peer-request-service';
import { NotFoundError, TooManyRequestsError, ValidationError } from '../src/errors/typed-errors';

const NOW = new Date('2026-09-02T12:00:00.000Z');
const CANDIDATE_ID = 'cand_1';
const EVIDENCE_ID = 'ev_1';
// Assembled rather than written as a literal. scan-secrets reads
// `const TOKEN = '...'` as a bearer-key assignment, and it is right to: the
// fix is to stop the fixture looking like a credential, never to teach the
// scanner to ignore a shape that would matter in real code.
const TOKEN = ['a', 'very', 'long', 'random', 'value'].join('-');

const hash = (value: string) => createHash('sha256').update(`pepper:${value}`).digest('hex');

function createFakes(
  input: {
    stored?: PeerRequestRecord | null;
    candidateEmail?: string | null;
    evidence?: { claim: string; candidateName: string } | null;
    rateLimited?: boolean;
    reciprocal?: boolean;
    /** The candidate's notification fails. The verifier must not see it. */
    noticeFails?: boolean;
  } = {},
) {
  const notices: {
    to: string;
    candidateName: string;
    claim: string;
    verifierDomain: string;
    relationship: string;
  }[] = [];
  const emails: { to: string; confirmUrl: string; claim: string }[] = [];
  const created: PeerRequestRecord[] = [];
  const written: PeerAttestation[] = [];
  const consumed: string[] = [];

  const deps: PeerRequestDependencies = {
    clock: { now: () => NOW },
    generateId: () => 'att_1',
    generateToken: () => TOKEN,
    hashToken: hash,
    hashEmail: (email) => hash(email.trim().toLowerCase()),
    async getCandidateEmail() {
      return input.candidateEmail === undefined ? 'candidate@acme.test' : input.candidateEmail;
    },
    async getEvidenceClaim() {
      return input.evidence === undefined
        ? { claim: 'Ran the migration that halved p95', candidateName: 'A Candidate' }
        : input.evidence;
    },
    async checkRateLimit() {
      return { allowed: !input.rateLimited };
    },
    async createPeerRequest(record) {
      created.push(record);
    },
    async getPeerRequest() {
      return input.stored === undefined ? null : input.stored;
    },
    async consumePeerRequest(tokenHash) {
      consumed.push(tokenHash);
      return input.stored === undefined ? null : input.stored;
    },
    async sendPeerRequestEmail(email) {
      emails.push(email);
    },
    async sendAttestationRecordedEmail(notice) {
      if (input.noticeFails) throw new Error('SES is having a day');
      notices.push(notice);
    },
    async listAttestationsForEvidence() {
      return [];
    },
    async hasCandidateAttestedFor() {
      return input.reciprocal ?? false;
    },
    async putAttestation(attestation) {
      written.push(attestation);
      return attestation;
    },
  };
  return { deps, emails, created, written, consumed, notices };
}

const pending = (over: Partial<PeerRequestRecord> = {}): PeerRequestRecord => ({
  tokenHash: hash(TOKEN),
  evidenceId: EVIDENCE_ID,
  candidateId: CANDIDATE_ID,
  verifierEmail: 'lead@bigcorp.test',
  createdAt: '2026-09-01T00:00:00.000Z',
  expiresAt: '2026-09-04T00:00:00.000Z',
  consumed: false,
  ...over,
});

const ask = (over: Partial<Parameters<typeof requestPeerAttestation>[0]> = {}) => ({
  candidateId: CANDIDATE_ID,
  evidenceId: EVIDENCE_ID,
  verifierEmail: 'lead@bigcorp.test',
  appOrigin: 'https://test.zoryvex.space',
  ...over,
});

describe('asking somebody to confirm', () => {
  it('sends one message, with the claim in it', async () => {
    const { deps, emails } = createFakes();
    await requestPeerAttestation(ask(), deps);

    expect(emails).toHaveLength(1);
    expect(emails[0]?.to).toBe('lead@bigcorp.test');
    // The verifier is told what they are being asked about before they open
    // anything. A message saying only "confirm this" trains people to click.
    expect(emails[0]?.claim).toContain('halved p95');
  });

  /**
   * A token in a path or a query string lands in access logs, referrer
   * headers and browser history. A fragment is never sent to a server at all.
   * Same reasoning as the sign-in link, and the same shape.
   */
  it('puts the token in the fragment, never the path', async () => {
    const { deps, emails } = createFakes();
    await requestPeerAttestation(ask(), deps);

    const url = new URL(emails[0]!.confirmUrl);
    expect(url.hash).toContain('token=');
    expect(url.pathname).not.toContain(TOKEN);
    expect(url.search).toBe('');
  });

  it('stores only the hash of the token', async () => {
    const { deps, created } = createFakes();
    await requestPeerAttestation(ask(), deps);
    expect(created[0]?.tokenHash).toBe(hash(TOKEN));
    expect(JSON.stringify(created[0])).not.toContain(TOKEN);
  });

  it('expires the link rather than leaving it open forever', async () => {
    const { deps, created } = createFakes();
    await requestPeerAttestation(ask(), deps);
    expect(new Date(created[0]!.expiresAt).getTime()).toBeGreaterThan(NOW.getTime());
  });

  describe('refusals that happen before anything is sent', () => {
    /**
     * A courtesy as much as a rule: nobody should be asked to fill in a form
     * whose answer was always going to be rejected.
     */
    it('refuses an anonymous domain without emailing anyone', async () => {
      const { deps, emails } = createFakes();
      await expect(
        requestPeerAttestation(ask({ verifierEmail: 'friend@gmail.com' }), deps),
      ).rejects.toThrow(ValidationError);
      expect(emails).toEqual([]);
    });

    it('refuses a candidate emailing themselves', async () => {
      const { deps, emails } = createFakes({ candidateEmail: 'me@bigcorp.test' });
      await expect(
        requestPeerAttestation(ask({ verifierEmail: 'ME@BigCorp.test' }), deps),
      ).rejects.toThrow(ValidationError);
      expect(emails).toEqual([]);
    });

    it('refuses a claim that is not theirs', async () => {
      const { deps, emails } = createFakes({ evidence: null });
      await expect(requestPeerAttestation(ask(), deps)).rejects.toThrow(NotFoundError);
      expect(emails).toEqual([]);
    });

    /**
     * Bounded per candidate rather than per recipient. The abuse worth
     * preventing is one person emailing many addresses; a per-recipient bound
     * would let that run freely and punish a popular colleague instead.
     */
    it('refuses once a candidate has asked too many times today', async () => {
      const { deps, emails } = createFakes({ rateLimited: true });
      await expect(requestPeerAttestation(ask(), deps)).rejects.toThrow(TooManyRequestsError);
      expect(emails).toEqual([]);
    });
  });
});

describe('seeing what you are being asked to confirm', () => {
  it('shows the claim and who is asking', async () => {
    const { deps } = createFakes({ stored: pending() });
    await expect(previewPeerRequest(TOKEN, deps)).resolves.toEqual({
      candidateName: 'A Candidate',
      claim: 'Ran the migration that halved p95',
    });
  });

  /**
   * Somebody should be able to read the claim, close the tab, think about it,
   * and come back. Asking a person to vouch for something they were shown
   * once and cannot re-read is a way of collecting careless confirmations.
   */
  it('does not spend the token', async () => {
    const { deps, consumed } = createFakes({ stored: pending() });
    await previewPeerRequest(TOKEN, deps);
    expect(consumed).toEqual([]);
  });

  it('refuses an unknown, spent or expired link identically', async () => {
    const messages: string[] = [];
    for (const fakes of [
      createFakes({ stored: null }),
      createFakes({ stored: pending({ consumed: true }) }),
      createFakes({ stored: pending({ expiresAt: '2026-08-01T00:00:00.000Z' }) }),
      createFakes({ stored: pending(), evidence: null }),
    ]) {
      await previewPeerRequest(TOKEN, fakes.deps).catch((e: Error) => messages.push(e.message));
    }
    expect(messages).toHaveLength(4);
    // A stranger with a guessed token learns nothing from which way it fails.
    expect(new Set(messages).size).toBe(1);
  });
});

describe('confirming', () => {
  it('records the attestation against the address the message went to', async () => {
    const { deps, written } = createFakes({ stored: pending() });
    await confirmPeerAttestation(
      { token: TOKEN, relationship: 'managed_them', statement: 'I was their lead.' },
      deps,
    );
    expect(written[0]?.verifierDomain).toBe('bigcorp.test');
    expect(written[0]?.evidenceId).toBe(EVIDENCE_ID);
  });

  /**
   * The address comes from the stored request and never from the request
   * body. Accepting one from the client would make the entire round trip
   * decorative: anybody could claim to be anybody.
   */
  it('takes the address from the request, not from whoever is posting', async () => {
    const { deps, written } = createFakes({ stored: pending({ verifierEmail: 'real@corp.test' }) });
    await confirmPeerAttestation(
      {
        token: TOKEN,
        relationship: 'worked_alongside',
        statement: 'Yes.',
        // Nothing in the input type accepts an address, and this is the test
        // that says so: the domain below comes from the stored record.
      },
      deps,
    );
    expect(written[0]?.verifierDomain).toBe('corp.test');
  });

  it('spends the token, so a shared link cannot be used twice', async () => {
    const { deps, consumed } = createFakes({ stored: pending() });
    await confirmPeerAttestation(
      { token: TOKEN, relationship: 'managed_them', statement: 'Yes.' },
      deps,
    );
    expect(consumed).toEqual([hash(TOKEN)]);
  });

  it('refuses when the token is unknown or already spent', async () => {
    const { deps, written } = createFakes({ stored: null });
    await expect(
      confirmPeerAttestation(
        { token: TOKEN, relationship: 'managed_them', statement: 'Yes.' },
        deps,
      ),
    ).rejects.toThrow(NotFoundError);
    expect(written).toEqual([]);
  });

  it('still applies the attestation rules after the token checks out', async () => {
    // A valid token does not exempt anybody from the reciprocity rule.
    const { deps, written } = createFakes({ stored: pending(), reciprocal: true });
    await expect(
      confirmPeerAttestation(
        { token: TOKEN, relationship: 'managed_them', statement: 'Yes.' },
        deps,
      ),
    ).rejects.toThrow();
    expect(written).toEqual([]);
  });
});

/**
 * A confirmation used to land silently.
 *
 * The candidate asked a colleague for a favour and then had no way to find
 * out whether it had been done, short of reopening that exact claim and
 * noticing a section that had not been there before. The natural repair from
 * their side is to chase the colleague again, which spends somebody else's
 * goodwill on a message the product should have sent.
 */
describe('telling the candidate their claim was confirmed', () => {
  it('sends them one notice once the confirmation is recorded', async () => {
    const { deps, notices } = createFakes({ stored: pending() });

    await confirmPeerAttestation(
      { token: TOKEN, relationship: 'managed_them', statement: 'They led it.' },
      deps,
    );

    expect(notices).toHaveLength(1);
    expect(notices[0]?.to).toBe('candidate@acme.test');
    expect(notices[0]?.claim).toContain('halved p95');
  });

  /**
   * The domain is the whole privacy position. A confirmation must not become
   * a contact detail the candidate did not have before, and the notice is the
   * one place that rule could be quietly undone.
   */
  it('carries the organisation and never the verifier address', async () => {
    const { deps, notices } = createFakes({ stored: pending() });

    await confirmPeerAttestation(
      { token: TOKEN, relationship: 'managed_them', statement: 'They led it.' },
      deps,
    );

    expect(notices[0]?.verifierDomain).toBe('bigcorp.test');
    expect(JSON.stringify(notices[0])).not.toContain('lead@bigcorp.test');
  });

  /**
   * The verifier is the person waiting on this request. They have done what
   * was asked; a failure to notify somebody else is not their problem and
   * must not be shown to them as one, because the obvious reaction is to
   * submit again and the one-per-verifier rule would then refuse it.
   */
  it('still succeeds for the verifier when the notice cannot be sent', async () => {
    const { deps, written } = createFakes({ stored: pending(), noticeFails: true });

    const attestation = await confirmPeerAttestation(
      { token: TOKEN, relationship: 'managed_them', statement: 'They led it.' },
      deps,
    );

    expect(attestation.id).toBe('att_1');
    expect(written).toHaveLength(1);
  });

  it('sends nothing when the confirmation itself was refused', async () => {
    const { deps, notices } = createFakes({ stored: pending(), reciprocal: true });

    await expect(
      confirmPeerAttestation(
        { token: TOKEN, relationship: 'managed_them', statement: 'They led it.' },
        deps,
      ),
    ).rejects.toThrow();

    expect(notices).toHaveLength(0);
  });
});
