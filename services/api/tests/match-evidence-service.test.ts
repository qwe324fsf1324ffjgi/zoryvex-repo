import { describe, expect, it } from 'vitest';
import type {
  AccessState,
  Evidence,
  GradedAttemptRecord,
  Match,
  PeerAttestation,
  Role,
} from '@zoryvex/contracts';
import {
  getMatchEvidence,
  type MatchEvidenceDependencies,
} from '../src/domain/match-evidence-service';
import { redactSourceIdentity } from '../src/domain/verification-source';
import { NotFoundError } from '../src/errors/typed-errors';

const OWNER = 'emp_owner';
const OTHER = 'emp_other';
const ROLE_ID = 'role_1';
const CANDIDATE_ID = 'cand_1';

const role: Role = {
  id: ROLE_ID,
  employerId: OWNER,
  launchTrack: 'aws_cloud',
  title: 'Cloud Engineer',
  seniority: 'mid',
  outcomes: 'Ship infra reliably',
  mustHaveWork: ['Terraform IaC on AWS'],
  constraints: '',
  status: 'active',
  createdAt: '2026-08-19T00:00:00.000Z',
};

function evidenceItem(overrides: Partial<Evidence> = {}): Evidence {
  return {
    id: 'ev_1',
    candidateId: CANDIDATE_ID,
    source: 'certification',
    claim: 'Built Terraform IaC for a multi-account AWS setup',
    context: 'Personal project',
    actions: 'Wrote modules, wired CI/CD',
    outcome: 'Deployed reliably for a year',
    verificationState: 'verified',
    verificationMethod: 'issuer_badge',
    verificationRef: '11111111-2222-4333-8444-555555555555',
    verificationDetail: 'AWS Certified Solutions Architect, confirmed with AWS.',
    verifiedAt: '2026-08-20T00:00:00.000Z',
    visibility: 'discovery',
    consentGiven: true,
    createdAt: '2026-08-19T00:00:00.000Z',
    updatedAt: '2026-08-20T00:00:00.000Z',
    ...overrides,
  };
}

function match(overrides: Partial<Match> = {}): Match {
  return {
    id: 'm1',
    roleId: ROLE_ID,
    candidateId: CANDIDATE_ID,
    matchScore: 0.8,
    status: 'suggested',
    contactUnlocked: false,
    matchedEvidenceIds: ['ev_1'],
    createdAt: '2026-08-19T00:00:00.000Z',
    ...overrides,
  };
}

function createFakes(
  input: {
    evidence?: Evidence[];
    match?: Match | null;
    role?: Role | null;
    now?: Date;
    attestations?: PeerAttestation[];
    gradedAttempts?: GradedAttemptRecord[];
    access?: AccessState;
  } = {},
) {
  const deps: MatchEvidenceDependencies = {
    clock: { now: () => input.now ?? new Date('2026-08-21T00:00:00.000Z') },
    // Defaults to a paying organization, so every assertion written before
    // the gate existed keeps describing the surface it was written for.
    async getMarketplaceAccess() {
      return input.access ?? 'active';
    },
    async getRole(roleId) {
      const r = input.role === undefined ? role : input.role;
      return r && roleId === ROLE_ID ? { role: r, version: 1 } : null;
    },
    async getMatch() {
      return input.match === undefined ? match() : input.match;
    },
    async listGradedAttempts() {
      return input.gradedAttempts ?? [];
    },
    async listAttestationsForEvidence() {
      return input.attestations ?? [];
    },
    async listCandidateEvidence() {
      return input.evidence ?? [evidenceItem()];
    },
  };
  return { deps };
}

describe('getMatchEvidence', () => {
  it('tells the employer what was checked, not just that something was', () => {
    // The rationale says "supported by verified evidence ev_1", which is a
    // database key. This is the same fact in a form worth paying for.
    const { deps } = createFakes();
    return expect(getMatchEvidence(OWNER, ROLE_ID, CANDIDATE_ID, deps)).resolves.toEqual([
      {
        evidenceId: 'ev_1',
        claim: 'Built Terraform IaC for a multi-account AWS setup',
        context: 'Personal project',
        actions: 'Wrote modules, wired CI/CD',
        outcome: 'Deployed reliably for a year',
        method: 'issuer_badge',
        detail: 'AWS Certified Solutions Architect, confirmed with AWS.',
        // The employer can re-run the check at the issuer themselves.
        sourceAvailable: true,
        sourceUrl: 'https://www.credly.com/badges/11111111-2222-4333-8444-555555555555',
        verifiedAt: '2026-08-20T00:00:00.000Z',
        strength: {
          attained: ['claimed', 'knowledge_assessed'],
          basis: {
            claimed: expect.stringContaining('themselves'),
            knowledge_assessed: expect.stringContaining('issued it'),
          },
          unsupported: ['process_observed'],
        },
        // Empty rather than absent: an employer should be able to tell "nobody
        // confirmed this" from "we did not look".
        peerAttestations: [],
        // Null rather than an empty history, because this is a certification.
        // An issuer badge has no rubric and no attempts, and showing "no
        // graded attempt recorded" against one would read as something
        // missing rather than something that never applied.
        attempts: null,
        attemptSummary: null,
      },
    ]);
  });

  /**
   * A peer confirmation only becomes visible because somebody wrote words. An
   * employer shown "peer verified" without who said it, from where, and in
   * what terms is being asked to take a badge on trust — the one thing this
   * product refuses to do anywhere else.
   */
  it('shows what the person actually said, not just that somebody did', async () => {
    const attestation: PeerAttestation = {
      id: 'att_1',
      evidenceId: 'ev_1',
      candidateId: CANDIDATE_ID,
      verifierDomain: 'bigcorp.test',
      verifierEmailHash: 'never-rendered',
      relationship: 'managed_them',
      statement: 'I was their lead on that migration. The numbers are right.',
      confirmedAt: '2026-08-25T00:00:00.000Z',
    };
    const { deps } = createFakes({ attestations: [attestation] });
    const [item] = await getMatchEvidence(OWNER, ROLE_ID, CANDIDATE_ID, deps);

    expect(item?.peerAttestations).toEqual([
      {
        verifierDomain: 'bigcorp.test',
        relationship: 'managed_them',
        statement: 'I was their lead on that migration. The numbers are right.',
        confirmedAt: '2026-08-25T00:00:00.000Z',
      },
    ]);
    // And the strength rises to match, from the same read.
    expect(item?.strength.attained).toContain('peer_verified');
  });

  it('never lets the email hash out, however the record is shaped', async () => {
    const { deps } = createFakes({
      attestations: [
        {
          id: 'att_1',
          evidenceId: 'ev_1',
          candidateId: CANDIDATE_ID,
          verifierDomain: 'bigcorp.test',
          verifierEmailHash: 'a-hash-that-must-not-travel',
          relationship: 'managed_them',
          statement: 'Yes.',
          confirmedAt: '2026-08-25T00:00:00.000Z',
        },
      ],
    });
    const result = await getMatchEvidence(OWNER, ROLE_ID, CANDIDATE_ID, deps);
    expect(JSON.stringify(result)).not.toContain('a-hash-that-must-not-travel');
  });

  /**
   * Kept exhaustive rather than switched to toMatchObject. This is the payload
   * somebody pays to read, and a field appearing on it without anybody
   * deciding to put it there is exactly what a strict assertion is for.
   */
  it('tells the employer what a credential does not establish, not only what it does', () => {
    // A confirmed certification means somebody else tested their knowledge.
    // It is not evidence their work was corroborated, and the employer is
    // told which of the two they are looking at.
    const { deps } = createFakes();
    return getMatchEvidence(OWNER, ROLE_ID, CANDIDATE_ID, deps).then(([item]) => {
      expect(item?.strength.attained).toContain('knowledge_assessed');
      expect(item?.strength.attained).not.toContain('work_corroborated');
      expect(item?.strength.attained).not.toContain('outcome_verified');
      // And that two levels are nobody's failing, they are simply not offered.
      // peer_verified became reachable on 2026-09-02, so it left this list.
      expect(item?.strength.unsupported).toEqual(['process_observed']);
    });
  });

  it("never returns another employer's role, and does not confirm it exists", async () => {
    const { deps } = createFakes();
    await expect(getMatchEvidence(OTHER, ROLE_ID, CANDIDATE_ID, deps)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it('excludes an item the candidate has since made private', async () => {
    // Checked at read time, so hiding an item takes effect immediately
    // rather than waiting for the employer to recompute matches.
    const { deps } = createFakes({ evidence: [evidenceItem({ visibility: 'private' })] });
    await expect(getMatchEvidence(OWNER, ROLE_ID, CANDIDATE_ID, deps)).resolves.toEqual([]);
  });

  it('excludes an item that has since lost its verification', async () => {
    // Editing a verified claim resets it. The employer must stop seeing it
    // as proof the moment that happens.
    const { deps } = createFakes({ evidence: [evidenceItem({ verificationState: 'unverified' })] });
    await expect(getMatchEvidence(OWNER, ROLE_ID, CANDIDATE_ID, deps)).resolves.toEqual([]);
  });

  it('excludes verified evidence that does not support this particular role', async () => {
    const { deps } = createFakes({
      evidence: [evidenceItem(), evidenceItem({ id: 'ev_unrelated' })],
    });
    const result = await getMatchEvidence(OWNER, ROLE_ID, CANDIDATE_ID, deps);
    expect(result.map((e) => e.evidenceId)).toEqual(['ev_1']);
  });

  it('never carries a contact detail in its shape', async () => {
    const { deps } = createFakes();
    const [first] = await getMatchEvidence(OWNER, ROLE_ID, CANDIDATE_ID, deps);
    // Contact is a separate, paid, separately-consented transaction. Nothing
    // resembling one may leak through the free evidence view.
    expect(Object.keys(first!)).not.toContain('email');
    expect(JSON.stringify(first)).not.toContain('@');
  });

  it('returns nothing for a match with no supporting evidence', async () => {
    const { deps } = createFakes({ match: match({ matchedEvidenceIds: [] }) });
    await expect(getMatchEvidence(OWNER, ROLE_ID, CANDIDATE_ID, deps)).resolves.toEqual([]);
  });

  it('throws for a candidate with no match on this role', async () => {
    const { deps } = createFakes({ match: null });
    await expect(getMatchEvidence(OWNER, ROLE_ID, CANDIDATE_ID, deps)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it('offers no source link when the reference cannot produce one', async () => {
    // Better no link than a plausible-looking dead one on the page an
    // employer opens specifically to check somebody's honesty.
    const { deps } = createFakes({ evidence: [evidenceItem({ verificationRef: 'malformed' })] });
    const [first] = await getMatchEvidence(OWNER, ROLE_ID, CANDIDATE_ID, deps);
    expect(first!.sourceUrl).toBeNull();
  });

  it('does not crash on a row verified before detail was recorded', async () => {
    // Older rows predate verificationDetail. An employer page must degrade,
    // not fail, and must not claim more than it knows.
    const { deps } = createFakes({
      evidence: [
        evidenceItem({
          verificationDetail: undefined,
          verificationMethod: undefined,
          verifiedAt: undefined,
        }),
      ],
    });
    const [first] = await getMatchEvidence(OWNER, ROLE_ID, CANDIDATE_ID, deps);
    expect(first!.detail).toBe('Checked by Zoryvex.');
    expect(first!.verifiedAt).toBe('2026-08-20T00:00:00.000Z');
  });
});

/**
 * The address of the independent record is the thing the marketplace
 * subscription actually sells.
 *
 * Zoryvex's whole argument is that its checks are reproducible by the person
 * paying: an employer who doubts a badge can open Credly or GitHub and see it
 * without us in the middle. That address was served to any authenticated
 * employer who owned the role, with no entitlement consulted anywhere on the
 * path — `MatchEvidenceDependencies` had no way to ask. An organization that
 * never subscribed, or whose card failed eleven days ago, received the same
 * `https://www.credly.com/badges/...` as a paying one.
 *
 * `grantsMarketplaceAccess` existed and was correct. It was consulted in
 * exactly one place in the entire API, `contact-unlock-service`, so contact
 * details were metered and the proof behind them was not.
 *
 * The gate reuses that same derivation rather than introducing a second idea
 * of who has paid, and withholds the value on the server. Hiding the link in
 * the markup would have left the URL sitting in the JSON.
 */
describe('the source address is released only to a paying organization', () => {
  const CREDLY = 'https://www.credly.com/badges/11111111-2222-4333-8444-555555555555';

  it('gives the address to an organization with an active subscription', async () => {
    const { deps } = createFakes({ access: 'active' });
    const [item] = await getMatchEvidence(OWNER, ROLE_ID, CANDIDATE_ID, deps);
    expect(item!.sourceUrl).toBe(CREDLY);
    expect(item!.sourceAvailable).toBe(true);
  });

  it('gives it during the grace window after a failed renewal', async () => {
    // A card that expired on a Friday is not a decision to stop paying, and
    // deriveAccess already says so. This must agree with contact unlock,
    // which uses the same predicate.
    const { deps } = createFakes({ access: 'grace' });
    const [item] = await getMatchEvidence(OWNER, ROLE_ID, CANDIDATE_ID, deps);
    expect(item!.sourceUrl).toBe(CREDLY);
  });

  for (const access of ['none', 'suspended'] as const) {
    it(`withholds the address when access is ${access}`, async () => {
      const { deps } = createFakes({ access });
      const [item] = await getMatchEvidence(OWNER, ROLE_ID, CANDIDATE_ID, deps);
      expect(item!.sourceUrl).toBeNull();
    });
  }

  it('never leaves the address anywhere else in the payload', async () => {
    // The point of withholding on the server. A page that hid the link while
    // the JSON still carried the URL would have changed nothing: the
    // response is readable in the browser's own network tab.
    const { deps } = createFakes({ access: 'none' });
    const summaries = await getMatchEvidence(OWNER, ROLE_ID, CANDIDATE_ID, deps);
    expect(JSON.stringify(summaries)).not.toContain('credly.com');
    expect(JSON.stringify(summaries)).not.toContain('11111111-2222-4333-8444-555555555555');
  });

  it('still shows what was checked, so the buyer can judge before paying', async () => {
    // Refusing the whole read was tried and made the product unsellable:
    // all an unpaid employer could see was a score and an evidence id. The
    // pricing page promises they can judge the reasoning, so the claim, the
    // method and the date stay visible to anyone who owns the role.
    const { deps } = createFakes({ access: 'none' });
    const [item] = await getMatchEvidence(OWNER, ROLE_ID, CANDIDATE_ID, deps);
    expect(item!.claim).toBe('Built Terraform IaC for a multi-account AWS setup');
    expect(item!.detail).toBe('AWS Certified Solutions Architect, confirmed with AWS.');
    expect(item!.method).toBe('issuer_badge');
    expect(item!.verifiedAt).toBe('2026-08-20T00:00:00.000Z');
    expect(item!.strength.attained).toContain('knowledge_assessed');
  });

  it('says an independent record exists, so the plan is not mistaken for the evidence', async () => {
    // Withholding the address must not make a checked claim look unchecked.
    const { deps } = createFakes({ access: 'none' });
    const [item] = await getMatchEvidence(OWNER, ROLE_ID, CANDIDATE_ID, deps);
    expect(item!.sourceAvailable).toBe(true);
  });

  it('reports no source when the evidence has none, even to a paying organization', async () => {
    // sourceAvailable follows the evidence, not the plan, so a subscriber
    // must never be told a third party is waiting when none is.
    //
    // Written against a missing reference rather than a graded task: a
    // graded task cannot reach this path at all, because `isVerified`
    // refuses the method retrospectively (ADR 0005). Asserting it here
    // would have been asserting on an empty list.
    const { deps } = createFakes({
      access: 'active',
      evidence: [evidenceItem({ verificationRef: undefined })],
    });
    const [item] = await getMatchEvidence(OWNER, ROLE_ID, CANDIDATE_ID, deps);
    expect(item!.sourceAvailable).toBe(false);
    expect(item!.sourceUrl).toBeNull();
  });

  it('refuses another employer role before it ever considers the subscription', async () => {
    // Order matters. Answering "you need a subscription" for a role that is
    // not theirs would confirm the role exists, which is a disclosure of its
    // own. A paying employer probing somebody else's role gets the same
    // NotFoundError an unpaid one does.
    const { deps } = createFakes({ access: 'active' });
    await expect(getMatchEvidence(OTHER, ROLE_ID, CANDIDATE_ID, deps)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});

/**
 * Withholding the address does not withhold the source.
 *
 * Found by looking at the rendered screen rather than at the response
 * shape. A repository check displays as:
 *
 *   Confirmed on GitHub · qwe324fsf1324ffjgi/Advanced, a public repository
 *   owned by qwe324fsf1324ffjgi with 7 commit(s) credited to them.
 *
 * `qwe324fsf1324ffjgi/Advanced` is the address. Putting github.com in front
 * of it opens the page. So the first version of this gate returned
 * `sourceUrl: null` and handed over the link anyway, in the sentence beside
 * it, and `evidence-strength-service` interpolates that same sentence into
 * its `basis` text where it appeared a second and third time.
 *
 * The strings in this block are the real ones from that screen.
 */
/**
 * The fail-safe layer, tested directly.
 *
 * Between ad77136 and the founder instruction of 2026-09-13, an unpaid
 * employer received the evidence with `sourceUrl` set to null. That was not
 * enough on its own, and the rendered screen is what showed it: a repository
 * check displays as
 *
 *   qwe324fsf1324ffjgi/Advanced, a public repository owned by
 *   qwe324fsf1324ffjgi with 7 commit(s) credited to them.
 *
 * and `qwe324fsf1324ffjgi/Advanced` is the address with github.com taken off
 * the front. `evidence-strength-service` interpolates the same sentence into
 * its basis text, so it appeared three times in a payload whose sourceUrl was
 * null.
 *
 * This is the load-bearing guard now that the unpaid preview is served
 * again: the preview shows the sentence, so the sentence must not carry the
 * address. Tested both directly and through `getMatchEvidence`, because the
 * unit alone would not catch a caller that stopped applying it.
 *
 * The strings are the real ones from that screen.
 */
describe('redactSourceIdentity', () => {
  const REPO = 'qwe324fsf1324ffjgi/Advanced';
  const OWNER_LOGIN = 'qwe324fsf1324ffjgi';
  const REAL_DETAIL = `${REPO}, a public repository owned by ${OWNER_LOGIN} with 7 commit(s) credited to them.`;

  const repoEvidence = () =>
    evidenceItem({
      source: 'github',
      verificationMethod: 'repo_ownership',
      verificationRef: REPO,
      verificationDetail: REAL_DETAIL,
    });

  it('removes the identity from the whole unpaid payload, not just the detail', async () => {
    // Through the service, because `basis` carries the same sentence and was
    // the second and third copy of it.
    const { deps } = createFakes({ access: 'none', evidence: [repoEvidence()] });
    const serialized = JSON.stringify(await getMatchEvidence(OWNER, ROLE_ID, CANDIDATE_ID, deps));
    expect(serialized).not.toContain(REPO);
    expect(serialized).not.toContain(OWNER_LOGIN);
    expect(serialized).not.toContain('github.com');
  });

  it('leaves the sentence whole for a paying organization', async () => {
    const { deps } = createFakes({ access: 'active', evidence: [repoEvidence()] });
    const [item] = await getMatchEvidence(OWNER, ROLE_ID, CANDIDATE_ID, deps);
    expect(item!.detail).toBe(REAL_DETAIL);
    expect(item!.sourceUrl).toBe(`https://github.com/${REPO}`);
  });

  it('takes out the repository, the owner and therefore the address', () => {
    const out = redactSourceIdentity('repo_ownership', REPO, REAL_DETAIL);
    expect(out).not.toContain(REPO);
    expect(out).not.toContain(OWNER_LOGIN);
  });

  it('keeps what the check established, which identifies nobody', () => {
    // Redaction must not turn a corroborated claim into an unchecked one.
    const out = redactSourceIdentity('repo_ownership', REPO, REAL_DETAIL);
    expect(out).toContain('7 commit(s) credited to them');
    expect(out).toContain('A public repository');
  });

  it('falls back to a line with no identity when the sentence is not one we wrote', () => {
    // A row stored by an older or different code path must not leak just
    // because the pattern missed. Fails closed.
    const out = redactSourceIdentity('repo_ownership', REPO, `Something else about ${REPO}.`);
    expect(out).toBe('A public repository the candidate proved control of.');
  });

  it('leaves a certification alone, which carries no part of its address', () => {
    // A Credly address is keyed by an assertion UUID that never appears in
    // the sentence, so removing the credential name would cost the employer
    // real information and protect nothing.
    const detail = 'AWS Certified Solutions Architect, confirmed with AWS.';
    expect(redactSourceIdentity('issuer_badge', 'some-uuid', detail)).toBe(detail);
  });
});

/**
 * Redaction must not invent a source it could not resolve.
 *
 * Found by driving the deployed test environment rather than by reading the
 * code. A fixture stored `verificationMethod: 'repo_ownership'` with a
 * reference that is not an owner/repo path, so `publicVerificationUrl`
 * correctly returned null and there was no address to withhold. Redaction
 * fired anyway, hit its fail-closed branch, and replaced an honest "Checked
 * by Zoryvex." with "A public repository the candidate proved control of."
 *
 * The fallback exists to avoid leaking an address. Applied where there is no
 * address, it stops protecting anything and starts asserting something this
 * product could not establish, which is the one thing it may never do.
 */
describe('an item whose source could not be resolved', () => {
  const unresolvable = () =>
    evidenceItem({
      source: 'github',
      verificationMethod: 'repo_ownership',
      // Not owner/repo, so publicVerificationUrl returns null.
      verificationRef: 'mint-test-session.mjs fixture',
      verificationDetail: undefined,
    });

  it('says what is true rather than describing a repository', async () => {
    const { deps } = createFakes({ access: 'none', evidence: [unresolvable()] });
    const [item] = await getMatchEvidence(OWNER, ROLE_ID, CANDIDATE_ID, deps);
    expect(item!.sourceAvailable).toBe(false);
    expect(item!.sourceUrl).toBeNull();
    expect(item!.detail).toBe('Checked by Zoryvex.');
    expect(item!.detail).not.toContain('public repository');
  });

  it('reads the same for a paying organization, because the plan is not what is missing', async () => {
    const { deps } = createFakes({ access: 'active', evidence: [unresolvable()] });
    const [item] = await getMatchEvidence(OWNER, ROLE_ID, CANDIDATE_ID, deps);
    expect(item!.detail).toBe('Checked by Zoryvex.');
  });

  it('still redacts when there really is an address to protect', async () => {
    // The guard above must not become a way round the redaction.
    const { deps } = createFakes({
      access: 'none',
      evidence: [
        evidenceItem({
          source: 'github',
          verificationMethod: 'repo_ownership',
          verificationRef: 'someone/their-repo',
          verificationDetail:
            'someone/their-repo, a public repository owned by someone with 4 commit(s) credited to them.',
        }),
      ],
    });
    const [item] = await getMatchEvidence(OWNER, ROLE_ID, CANDIDATE_ID, deps);
    expect(item!.sourceAvailable).toBe(true);
    expect(item!.detail).not.toContain('someone/their-repo');
    expect(item!.detail).toContain('4 commit(s) credited to them');
  });
});
