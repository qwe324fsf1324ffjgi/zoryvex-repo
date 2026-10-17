import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { AuditEvent, Candidate, Evidence, GradedAttemptRecord } from '@zoryvex/contracts';
import {
  UpstreamUnavailableError,
  beginRepoVerification,
  extractBadgeAssertionId,
  verifyEvidence,
  type VerificationDependencies,
} from '../src/domain/verification-service';
import type { BadgeAssertion } from '../src/lib/verifiers/issuer-badge';
import type {
  ContributorPayload,
  GistPayload,
  RepoPayload,
} from '../src/lib/verifiers/github-repo';
import { NotFoundError, TooManyRequestsError, ValidationError } from '../src/errors/typed-errors';

const CANDIDATE_ID = 'cand_1';
const EVIDENCE_ID = 'ev_1';
const EMAIL = 'candidate@example.com';
const SALT = 'a-fixed-test-salt';
const BADGE_ID = '11111111-2222-4333-8444-555555555555';
const BADGE_URL = `https://www.credly.com/badges/${BADGE_ID}`;
const BADGE_CLASS_URI =
  'https://api.credly.com/api/v1/obi/v2/issuers/7b741b5c-231d-4925-8041-c64b6846f1c8/badge_classes/54225396-3c1a-44b6-ba14-9fe2f812842b';

function hashedIdentity(email: string): string {
  return (
    'sha256$' +
    createHash('sha256')
      .update(email.toLowerCase() + SALT)
      .digest('hex')
  );
}

function goodAssertion(): BadgeAssertion {
  return {
    recipient: { type: 'email', hashed: true, salt: SALT, identity: hashedIdentity(EMAIL) },
    // A URI, exactly as Credly returns it (confirmed live 2026-08-27).
    badge: BADGE_CLASS_URI,
    issuedOn: '2026-01-01T00:00:00.000Z',
    expires: '2029-01-01T00:00:00.000Z',
    revoked: false,
  };
}

const GITHUB_LOGIN = 'a-candidate';
const NONCE = 'zoryvex-verify-9f2c4a1e';
const GIST_URL = 'https://gist.github.com/a1b2c3d4e5f60718293a';
const REPO_URL = `https://github.com/${GITHUB_LOGIN}/landing-zone`;

function goodGist(): GistPayload {
  return {
    owner: { login: GITHUB_LOGIN },
    public: true,
    files: { 'zoryvex-verification.txt': { content: NONCE } },
  };
}

function goodRepo(): RepoPayload {
  return {
    full_name: `${GITHUB_LOGIN}/landing-zone`,
    private: false,
    fork: false,
    archived: false,
    disabled: false,
    size: 512,
    created_at: '2025-02-01T00:00:00Z',
    pushed_at: '2026-08-01T00:00:00Z',
    owner: { login: GITHUB_LOGIN },
  };
}

function candidate(): Candidate {
  return {
    id: CANDIDATE_ID,
    email: EMAIL,
    displayName: 'A Candidate',
    launchTrack: 'aws_cloud',
    discoveryOptIn: true,
    onboardingComplete: true,
    summary: '',
    createdAt: '2026-08-19T00:00:00.000Z',
    updatedAt: '2026-08-19T00:00:00.000Z',
  };
}

function evidenceItem(overrides: Partial<Evidence> = {}): Evidence {
  return {
    id: EVIDENCE_ID,
    candidateId: CANDIDATE_ID,
    source: 'certification',
    claim: 'AWS Certified Solutions Architect',
    context: 'Passed the associate exam',
    actions: 'Studied and sat the exam',
    outcome: 'Certified',
    verificationState: 'unverified',
    visibility: 'discovery',
    consentGiven: true,
    createdAt: '2026-08-19T00:00:00.000Z',
    updatedAt: '2026-08-19T00:00:00.000Z',
    ...overrides,
  };
}

function createFakes(
  input: {
    evidence?: Evidence | null;
    assertion?: BadgeAssertion | null;
    attempts?: number;
    markReturnsNull?: boolean;
    gist?: GistPayload | null;
    repo?: RepoPayload | null;
    contributors?: ContributorPayload[];
    nonce?: string | null;
    githubDown?: boolean;
    badgeClass?: { name?: string; issuer?: { name?: string } } | null;
    launchTrack?: Candidate['launchTrack'];
    /**
     * What the claim says it is about. Now decides which check it is
     * eligible for, so a repository test has to file a repository claim -
     * this fixture used to file everything as a certification and check it
     * however the test liked, which is the exact mismatch the server now
     * refuses.
     */
    evidenceSource?: Evidence['source'];
    /** Forces the per-candidate hourly limit to refuse. */
    rateLimited?: boolean;
  } = {},
) {
  const auditEvents: AuditEvent[] = [];
  const fetchedIds: string[] = [];
  const recordedAttempts: string[] = [];
  const gradedAttempts: GradedAttemptRecord[] = [];
  const storedNonces: string[] = [];
  let stored =
    input.evidence === undefined
      ? evidenceItem(input.evidenceSource ? { source: input.evidenceSource } : {})
      : input.evidence;

  const deps: VerificationDependencies = {
    clock: { now: () => new Date('2026-08-27T00:00:00.000Z') },
    // Allowed unless a test says otherwise. The limit has its own tests
    // below; everything else here is about what a check concludes, and a
    // fake that refused would make every one of them fail for the wrong
    // reason.
    async checkRateLimit() {
      return { allowed: input.rateLimited !== true };
    },
    async getCandidate() {
      const base = candidate();
      return {
        candidate: input.launchTrack ? { ...base, launchTrack: input.launchTrack } : base,
        version: 1,
      };
    },
    async getEvidence() {
      return stored;
    },
    async fetchBadgeAssertion(assertionId) {
      fetchedIds.push(assertionId);
      return input.assertion === undefined ? goodAssertion() : input.assertion;
    },
    async markEvidenceVerified(_c, _e, method, verificationRef, verifiedAt) {
      if (input.markReturnsNull) return null;
      if (!stored) return null;
      stored = {
        ...stored,
        verificationState: 'verified',
        verificationMethod: method,
        verificationRef,
        verifiedAt,
      };
      return stored;
    },
    async countVerificationAttempts() {
      return input.attempts ?? 0;
    },
    async recordVerificationAttempt(_c, _e, at) {
      recordedAttempts.push(at);
    },
    async fetchBadgeClass(uri) {
      fetchedIds.push(`badgeclass:${uri}`);
      return input.badgeClass === undefined
        ? {
            name: 'AWS Certified Solutions Architect – Associate',
            issuer: { name: 'Amazon Web Services Training and Certification' },
          }
        : input.badgeClass;
    },
    async fetchGist(gistId) {
      fetchedIds.push(`gist:${gistId}`);
      if (input.githubDown) throw new UpstreamUnavailableError('rate limited');
      return input.gist === undefined ? goodGist() : input.gist;
    },
    async fetchRepo(owner, repo) {
      fetchedIds.push(`repo:${owner}/${repo}`);
      if (input.githubDown) throw new UpstreamUnavailableError('rate limited');
      return input.repo === undefined ? goodRepo() : input.repo;
    },
    async fetchRepoContributors() {
      if (input.githubDown) throw new UpstreamUnavailableError('rate limited');
      return input.contributors ?? [{ login: GITHUB_LOGIN, contributions: 42 }];
    },
    async putVerificationNonce(_c, _e, nonce) {
      storedNonces.push(nonce);
    },
    async consumeVerificationNonce() {
      return input.nonce === undefined ? NONCE : input.nonce;
    },
    generateNonce: () => NONCE,
    async appendAuditEvent(event) {
      auditEvents.push(event);
      return event;
    },
    async recordGradedAttempt(_candidateId, _id, attempt) {
      gradedAttempts.push(attempt);
    },
    generateId: () => 'audit_1',
  };

  return {
    deps,
    auditEvents,
    fetchedIds,
    recordedAttempts,
    gradedAttempts,
    storedNonces,
    current: () => stored,
  };
}

describe('extractBadgeAssertionId', () => {
  it('takes the badge id out of a public Credly URL', () => {
    expect(extractBadgeAssertionId(BADGE_URL)).toBe(BADGE_ID);
    expect(extractBadgeAssertionId(`https://credly.com/badges/${BADGE_ID}/`)).toBe(BADGE_ID);
  });

  /**
   * These Lambdas are not VPC-attached, so they have outbound internet. If a
   * candidate-supplied URL were ever handed to an HTTP client, this endpoint
   * would be a server-side request forgery primitive — including against the
   * instance metadata service. Parsing out a UUID and rebuilding the issuer
   * URL from a constant is what makes that unreachable.
   */
  it('refuses a URL pointing anywhere other than Credly', () => {
    expect(extractBadgeAssertionId(`https://evil.example.com/badges/${BADGE_ID}`)).toBeNull();
    expect(extractBadgeAssertionId('https://169.254.169.254/latest/meta-data/')).toBeNull();
    expect(extractBadgeAssertionId('http://localhost:8080/badges/x')).toBeNull();
  });

  it('refuses a lookalike host that merely ends in credly.com', () => {
    expect(extractBadgeAssertionId(`https://notcredly.com/badges/${BADGE_ID}`)).toBeNull();
    expect(extractBadgeAssertionId(`https://credly.com.evil.test/badges/${BADGE_ID}`)).toBeNull();
  });

  it('refuses plain http even on the right host', () => {
    expect(extractBadgeAssertionId(`http://www.credly.com/badges/${BADGE_ID}`)).toBeNull();
  });

  it('refuses a path that is not a badge id', () => {
    expect(extractBadgeAssertionId('https://www.credly.com/users/someone')).toBeNull();
    expect(extractBadgeAssertionId('https://www.credly.com/badges/../../etc/passwd')).toBeNull();
    expect(extractBadgeAssertionId('not a url at all')).toBeNull();
  });
});

describe('verifyEvidence', () => {
  it('verifies a genuine credential and stamps the method and reference', async () => {
    const fakes = createFakes();
    const result = await verifyEvidence(
      CANDIDATE_ID,
      EVIDENCE_ID,
      { method: 'issuer_badge', badgeUrl: BADGE_URL },
      fakes.deps,
    );

    expect(result.verified).toBe(true);
    expect(fakes.current()).toMatchObject({
      verificationState: 'verified',
      verificationMethod: 'issuer_badge',
      verificationRef: BADGE_ID,
    });
  });

  it('only ever fetches the id it parsed, never the candidate string', async () => {
    const fakes = createFakes();
    await verifyEvidence(
      CANDIDATE_ID,
      EVIDENCE_ID,
      { method: 'issuer_badge', badgeUrl: BADGE_URL },
      fakes.deps,
    );
    expect(fakes.fetchedIds).toEqual([BADGE_ID, `badgeclass:${BADGE_CLASS_URI}`]);
  });

  it('audits a successful verification with what was actually checked', async () => {
    const fakes = createFakes();
    await verifyEvidence(
      CANDIDATE_ID,
      EVIDENCE_ID,
      { method: 'issuer_badge', badgeUrl: BADGE_URL },
      fakes.deps,
    );
    const audit = fakes.auditEvents.find((e) => e.action === 'evidence_verified');
    expect(audit).toBeDefined();
    expect(audit!.reason).toContain('Amazon Web Services');
  });

  it('never silently rejects: a failure says why and what to do', async () => {
    // CLAUDE.md forbids a silent rejection. A candidate must always learn
    // exactly what did not pass and what would make it pass.
    const fakes = createFakes({
      assertion: { ...goodAssertion(), revoked: true },
    });
    const result = await verifyEvidence(
      CANDIDATE_ID,
      EVIDENCE_ID,
      { method: 'issuer_badge', badgeUrl: BADGE_URL },
      fakes.deps,
    );

    expect(result.verified).toBe(false);
    expect(result).toMatchObject({
      reason: expect.stringContaining('revoked'),
      whatToDo: expect.stringContaining('support'),
    });
    expect(fakes.auditEvents.some((e) => e.action === 'evidence_verification_failed')).toBe(true);
    expect(fakes.current()!.verificationState).toBe('unverified');
  });

  it('leaves the evidence unverified when the issuer has no public record', async () => {
    const fakes = createFakes({ assertion: null });
    const result = await verifyEvidence(
      CANDIDATE_ID,
      EVIDENCE_ID,
      { method: 'issuer_badge', badgeUrl: BADGE_URL },
      fakes.deps,
    );
    expect(result.verified).toBe(false);
    expect(fakes.current()!.verificationState).toBe('unverified');
  });

  it('rejects a badge belonging to a different person', async () => {
    const fakes = createFakes({
      assertion: {
        ...goodAssertion(),
        recipient: {
          type: 'email',
          hashed: true,
          salt: SALT,
          identity: hashedIdentity('someone.else@example.com'),
        },
      },
    });
    const result = await verifyEvidence(
      CANDIDATE_ID,
      EVIDENCE_ID,
      { method: 'issuer_badge', badgeUrl: BADGE_URL },
      fakes.deps,
    );
    expect(result.verified).toBe(false);
    expect(fakes.current()!.verificationState).toBe('unverified');
  });

  it('bounds attempts, so this cannot be used to probe which badge ids exist', async () => {
    const fakes = createFakes({ attempts: 5 });
    const result = await verifyEvidence(
      CANDIDATE_ID,
      EVIDENCE_ID,
      { method: 'issuer_badge', badgeUrl: BADGE_URL },
      fakes.deps,
    );
    expect(result.verified).toBe(false);
    expect(fakes.fetchedIds).toEqual([]); // never reached the issuer at all
  });

  it('counts an attempt before contacting the issuer, not after', async () => {
    // Counting afterwards would let a caller that always errors mid-flight
    // retry without limit.
    const fakes = createFakes({ assertion: null });
    await verifyEvidence(
      CANDIDATE_ID,
      EVIDENCE_ID,
      { method: 'issuer_badge', badgeUrl: BADGE_URL },
      fakes.deps,
    );
    expect(fakes.recordedAttempts).toHaveLength(1);
  });

  it('is idempotent on already-verified evidence without re-contacting the issuer', async () => {
    const fakes = createFakes({
      evidence: evidenceItem({
        verificationState: 'verified',
        verificationMethod: 'issuer_badge',
        verificationRef: BADGE_ID,
      }),
    });
    const result = await verifyEvidence(
      CANDIDATE_ID,
      EVIDENCE_ID,
      { method: 'issuer_badge', badgeUrl: BADGE_URL },
      fakes.deps,
    );
    expect(result.verified).toBe(true);
    expect(fakes.fetchedIds).toEqual([]);
  });

  it('does not force the write through when the evidence changed mid-verification', async () => {
    // Stamping `verified` onto content we no longer hold is the laundering
    // hole the edit-resets-verification rule exists to close.
    const fakes = createFakes({ markReturnsNull: true });
    const result = await verifyEvidence(
      CANDIDATE_ID,
      EVIDENCE_ID,
      { method: 'issuer_badge', badgeUrl: BADGE_URL },
      fakes.deps,
    );
    expect(result.verified).toBe(false);
    expect(fakes.auditEvents.some((e) => e.action === 'evidence_verified')).toBe(false);
  });

  it('rejects a malformed badge link before spending an issuer call', async () => {
    const fakes = createFakes();
    await expect(
      verifyEvidence(
        CANDIDATE_ID,
        EVIDENCE_ID,
        { method: 'issuer_badge', badgeUrl: 'https://evil.example.com/badges/x' },
        fakes.deps,
      ),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(fakes.fetchedIds).toEqual([]);
  });

  it("does not confirm or deny another candidate's evidence", async () => {
    const fakes = createFakes({ evidence: null });
    await expect(
      verifyEvidence(
        CANDIDATE_ID,
        EVIDENCE_ID,
        { method: 'issuer_badge', badgeUrl: BADGE_URL },
        fakes.deps,
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('repo-ownership verification', () => {
  const proof = { method: 'repo_ownership' as const, gistUrl: GIST_URL, repoUrl: REPO_URL };

  it('issues a single-use code with instructions the candidate can follow', async () => {
    const fakes = createFakes({ evidenceSource: 'github' });
    const challenge = await beginRepoVerification(CANDIDATE_ID, EVIDENCE_ID, fakes.deps);

    expect(challenge.nonce).toBe(NONCE);
    expect(fakes.storedNonces).toEqual([NONCE]);
    expect(challenge.fileName).toBe('zoryvex-verification.txt');
    expect(challenge.instructions.length).toBeGreaterThan(0);
    expect(challenge.expiresInMinutes).toBeGreaterThan(0);
  });

  it('verifies a public non-fork repository the proven account committed to', async () => {
    const fakes = createFakes({ evidenceSource: 'github' });
    const result = await verifyEvidence(CANDIDATE_ID, EVIDENCE_ID, proof, fakes.deps);

    expect(result.verified).toBe(true);
    expect(fakes.current()).toMatchObject({
      verificationState: 'verified',
      verificationMethod: 'repo_ownership',
      verificationRef: `${GITHUB_LOGIN}/landing-zone`,
    });
  });

  it('only ever fetches the ids it parsed, never the candidate strings', async () => {
    const fakes = createFakes({ evidenceSource: 'github' });
    await verifyEvidence(CANDIDATE_ID, EVIDENCE_ID, proof, fakes.deps);
    expect(fakes.fetchedIds).toEqual([
      'gist:a1b2c3d4e5f60718293a',
      `repo:${GITHUB_LOGIN}/landing-zone`,
    ]);
  });

  it('refuses a repository belonging to an account the candidate did not prove', async () => {
    // The impersonation route: publish the nonce under your own login, then
    // point at somebody else's repository.
    const fakes = createFakes({
      evidenceSource: 'github',
      repo: { ...goodRepo(), owner: { login: 'someone-else' }, full_name: 'someone-else/repo' },
    });
    const result = await verifyEvidence(CANDIDATE_ID, EVIDENCE_ID, proof, fakes.deps);
    expect(result.verified).toBe(false);
    expect(fakes.current()!.verificationState).toBe('unverified');
  });

  it('refuses a gist that does not carry the issued code', async () => {
    const fakes = createFakes({
      evidenceSource: 'github',
      gist: { ...goodGist(), files: { 'a.txt': { content: 'nothing useful' } } },
    });
    const result = await verifyEvidence(CANDIDATE_ID, EVIDENCE_ID, proof, fakes.deps);
    expect(result.verified).toBe(false);
    // Never reached the repository: control has to be proven first.
    expect(fakes.fetchedIds).toEqual(['gist:a1b2c3d4e5f60718293a']);
  });

  it('tells the candidate to restart when the code has expired', async () => {
    const fakes = createFakes({ evidenceSource: 'github', nonce: null });
    const result = await verifyEvidence(CANDIDATE_ID, EVIDENCE_ID, proof, fakes.deps);
    expect(result).toMatchObject({ verified: false, retryable: true });
    expect(fakes.fetchedIds).toEqual([]);
  });

  /**
   * GitHub allows 60 unauthenticated requests an hour per IP, which a warm
   * Lambda genuinely reaches. Telling a candidate their real work failed
   * verification because of that would be wrong, and would lose a good
   * candidate for good.
   */
  it('separates "could not check" from "did not pass" when GitHub is unreachable', async () => {
    const fakes = createFakes({ evidenceSource: 'github', githubDown: true });
    const result = await verifyEvidence(CANDIDATE_ID, EVIDENCE_ID, proof, fakes.deps);

    expect(result).toMatchObject({ verified: false, retryable: true });
    expect(result).toMatchObject({ reason: expect.stringContaining('could not reach') });
    // Not recorded as a verification failure, because nothing was judged.
    expect(fakes.auditEvents.some((e) => e.action === 'evidence_verification_failed')).toBe(false);
    expect(fakes.current()!.verificationState).toBe('unverified');
  });

  it('marks a genuine rejection as not retryable, so the reason is acted on', async () => {
    const fakes = createFakes({ evidenceSource: 'github', repo: { ...goodRepo(), fork: true } });
    const result = await verifyEvidence(CANDIDATE_ID, EVIDENCE_ID, proof, fakes.deps);
    expect(result).toMatchObject({ verified: false, retryable: false });
    expect(fakes.auditEvents.some((e) => e.action === 'evidence_verification_failed')).toBe(true);
  });

  it('rejects a malformed gist or repository link before spending the code', async () => {
    const fakes = createFakes({ evidenceSource: 'github' });
    await expect(
      verifyEvidence(
        CANDIDATE_ID,
        EVIDENCE_ID,
        { method: 'repo_ownership', gistUrl: 'https://evil.example.com/x', repoUrl: REPO_URL },
        fakes.deps,
      ),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(fakes.fetchedIds).toEqual([]);
  });

  it('audits what was actually checked', async () => {
    const fakes = createFakes({ evidenceSource: 'github' });
    await verifyEvidence(CANDIDATE_ID, EVIDENCE_ID, proof, fakes.deps);
    const audit = fakes.auditEvents.find((e) => e.action === 'evidence_verified');
    expect(audit!.reason).toContain(`${GITHUB_LOGIN}/landing-zone`);
    expect(audit!.reason).toContain('42 commit');
  });
});

/**
 * The third verification route, and the only one Zoryvex scores itself.
 *
 * It exists because of the clearest finding in the market research: hiring
 * managers say bad hires trace to interviews testing vocabulary rather than
 * work, and candidates report take-homes demanding up to forty unpaid hours
 * repeated for every employer. One task, scored the same way every time,
 * reusable by everybody, removes both costs at once.
 *//**
 * Graded tasks no longer mint proof, and this is the guard on that.
 *
 * A graded task is a brief we publish, with a rubric we publish, marked
 * against a file the candidate uploads. That was defensible when it was
 * written. It is not defensible now: a candidate can paste the brief into a
 * language model, paste the answer back, and hold a credential that says a
 * machine checked their skill. The per-candidate token in the brief stops
 * one candidate copying another's answer. It does nothing about this.
 *
 * The founder's instruction was to fix it or remove it, and there is no
 * honest fix at this shape - the rubric is public by design, the submission
 * is a static file, and nothing observes the person. So no claim type maps
 * to `graded_task` in VERIFICATION_METHOD_FOR_SOURCE any more, which makes
 * the method unreachable rather than merely discouraged.
 *
 * The enum keeps `graded_task` so evidence verified this way before the
 * decision still parses and still reads honestly on a profile. Nothing new
 * can be verified this way.
 *
 * The grading logic itself is untouched and still has its own tests
 * (graded-task-service.test.ts and the multi-cloud files). Those check that
 * a rubric marks a submission correctly, which is a separate question from
 * whether a marked submission should count as proof of a person's skill.
 */
describe('graded task verification is no longer a way to become verified', () => {
  it('refuses a graded submission whatever the claim says it is about', async () => {
    for (const source of ['certification', 'github', 'project', 'writeup', 'other'] as const) {
      const { deps } = createFakes({ evidenceSource: source });
      const result = await verifyEvidence(
        CANDIDATE_ID,
        EVIDENCE_ID,
        { method: 'graded_task', taskId: 'task_least_privilege_role_v1', submission: 'anything' },
        deps,
      );
      expect(result.verified, source).toBe(false);
    }
  });

  it('does not spend one of the five attempts refusing it', async () => {
    // The mismatch is checked before the attempt counter. Somebody who
    // cannot succeed should not be charged for trying.
    const { deps, recordedAttempts } = createFakes({ evidenceSource: 'github' });
    await verifyEvidence(
      CANDIDATE_ID,
      EVIDENCE_ID,
      { method: 'graded_task', taskId: 'task_least_privilege_role_v1', submission: 'anything' },
      deps,
    );
    expect(recordedAttempts).toEqual([]);
  });

  it('tells the candidate what to do instead rather than only refusing', async () => {
    const { deps } = createFakes({ evidenceSource: 'project' });
    const result = await verifyEvidence(
      CANDIDATE_ID,
      EVIDENCE_ID,
      { method: 'graded_task', taskId: 'task_least_privilege_role_v1', submission: 'anything' },
      deps,
    );
    if (result.verified) throw new Error('expected a refusal');
    // Asking a colleague was removed on 2026-09-09, so the advice now points
    // at the two routes that still exist rather than at a third that does not.
    expect(result.whatToDo).toContain('certification or a public repository');
    expect(result.whatToDo).not.toContain('Ask somebody');
  });
});

/**
 * The verify button was unbounded, and that mattered more here than on any
 * other route.
 *
 * Verification is the only path that calls somebody else's API on a
 * candidate's behalf. GitHub's unauthenticated limit is 60 requests an hour
 * per IP, a number this service already documents on
 * UpstreamUnavailableError, and every candidate shares that IP because they
 * share the Lambda. So one person holding down the button does not merely
 * cost money: it exhausts the shared budget and every other candidate's real
 * check starts failing as "we could not check right now". The platform would
 * be denying its own verification to innocent people at the request of the
 * one abusing it.
 */
describe('how often one candidate can run a check', () => {
  const repoProof = {
    method: 'repo_ownership' as const,
    gistUrl: GIST_URL,
    repoUrl: REPO_URL,
  };

  it('refuses once the hourly limit is spent', async () => {
    const { deps } = createFakes({ rateLimited: true, evidenceSource: 'github' });

    await expect(verifyEvidence(CANDIDATE_ID, EVIDENCE_ID, repoProof, deps)).rejects.toThrow(
      TooManyRequestsError,
    );
  });

  /**
   * The property that actually protects the shared budget. A refusal that
   * still called GitHub first would spend the request it exists to save, and
   * would look identical from the candidate's side.
   */
  it('calls GitHub not at all when it refuses', async () => {
    const { deps, fetchedIds } = createFakes({ rateLimited: true, evidenceSource: 'github' });

    await expect(verifyEvidence(CANDIDATE_ID, EVIDENCE_ID, repoProof, deps)).rejects.toThrow(
      TooManyRequestsError,
    );
    expect(fetchedIds).toEqual([]);
  });

  /**
   * The refusal has to read as temporary and as nothing to do with the
   * candidate's work, or somebody whose repository is genuinely fine
   * concludes it was rejected.
   */
  it('says the evidence is untouched rather than implying it failed', async () => {
    const { deps } = createFakes({ rateLimited: true, evidenceSource: 'github' });

    await expect(verifyEvidence(CANDIDATE_ID, EVIDENCE_ID, repoProof, deps)).rejects.toThrow(
      /Nothing about your evidence has changed/i,
    );
  });

  it('still verifies a real repository when the limit has room', async () => {
    const { deps, fetchedIds } = createFakes({ evidenceSource: 'github' });

    const result = await verifyEvidence(CANDIDATE_ID, EVIDENCE_ID, repoProof, deps);

    expect(result.verified).toBe(true);
    // The repository was genuinely read, not assumed: the gist proved the
    // account and the repo and its contributors were fetched.
    expect(fetchedIds.some((id) => id.startsWith('gist:'))).toBe(true);
    expect(fetchedIds.some((id) => id.startsWith('repo:'))).toBe(true);
  });

  it('bounds code issuance separately, and issues no nonce when it refuses', async () => {
    const { deps, storedNonces } = createFakes({ rateLimited: true, evidenceSource: 'github' });

    await expect(beginRepoVerification(CANDIDATE_ID, EVIDENCE_ID, deps)).rejects.toThrow(
      TooManyRequestsError,
    );
    expect(storedNonces).toEqual([]);
  });
});
