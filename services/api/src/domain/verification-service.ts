import { EVIDENCE_SOURCE_LABELS, VERIFICATION_METHOD_FOR_SOURCE } from '@zoryvex/contracts';
import type {
  AuditEvent,
  Candidate,
  Evidence,
  GradedAttemptRecord,
  VerificationMethod,
} from '@zoryvex/contracts';
import { NotFoundError, TooManyRequestsError, ValidationError } from '../errors/typed-errors';
import {
  resolveBadgeClass,
  verifyBadgeAssertion,
  type BadgeAssertion,
  type BadgeClass,
} from '../lib/verifiers/issuer-badge';
import {
  parseGistUrl,
  parseRepoUrl,
  provenLoginFromGist,
  verifyRepository,
  type ContributorPayload,
  type GistPayload,
  type RepoPayload,
} from '../lib/verifiers/github-repo';
import {
  deriveTaskParams,
  gradeSubmission,
  gradedTaskDetail,
  taskById,
  tasksForTrack,
  type GradeResult,
  type GradedTask,
} from './graded-task-service';
import type { Clock } from '../repositories/clock-repository';

/**
 * Autonomous evidence verification.
 *
 * Zoryvex sells proof, and until now nothing in the codebase could move an
 * Evidence item to `verified` — evidence-claim-service set every new item to
 * `unverified` and deferred the rest to "a future admin/verification flow"
 * that did not exist. Every claim on the platform was therefore a self-report
 * wearing the word "evidence", and the matching engine's `verified: 1` weight
 * was unreachable code.
 *
 * This is that flow, and it is deliberately autonomous: a check a machine can
 * re-run and get the same answer from. Human review was never going to work
 * here. It does not scale past the founder's own hours, it cannot re-run
 * itself when a certification expires, and one tired reviewer is exactly the
 * failure mode a proof-first platform cannot survive.
 */

const MAX_VERIFICATION_ATTEMPTS_PER_EVIDENCE = 5;
const REPO_NONCE_TTL_MINUTES = 30;
const CONTACT_SUPPORT =
  'If you believe this is wrong, contact support with the badge link and a person will look at it.';

/**
 * How often one candidate may run a check, and why there is a limit at all.
 *
 * Every other outbound-or-costly path in this service is bounded and this one
 * was not, which mattered more here than anywhere else: verification is the
 * only path that calls somebody else's API on a candidate's behalf, and
 * GitHub's unauthenticated limit is 60 requests an hour per IP — a number
 * this file already documents on UpstreamUnavailableError, and one a warm
 * Lambda reaches easily because every candidate shares that IP.
 *
 * So an unbounded verify button is not merely a cost risk. One person
 * pressing it in a loop exhausts the shared GitHub budget and every other
 * candidate's check starts failing as "we could not check right now". The
 * platform would be denying its own verification, to innocent people, at the
 * request of the one abusing it.
 *
 * Twelve an hour is deliberately generous for the real behaviour: a
 * candidate fixes a secret gist, retries, fixes the file name, retries. It is
 * useless for a script. The two paths are counted separately because issuing
 * a nonce costs us a write and no outbound call, while running a check costs
 * an outbound call to somebody else.
 */
const CHECKS_PER_CANDIDATE_LIMIT = 12;
const CHECKS_PER_CANDIDATE_WINDOW_SECONDS = 60 * 60;
const NONCES_PER_CANDIDATE_LIMIT = 20;
const NONCES_PER_CANDIDATE_WINDOW_SECONDS = 60 * 60;

export interface VerificationDependencies {
  clock: Clock;
  /**
   * Bounds how often one candidate can make this Lambda call GitHub or
   * Credly. Same fixed-window counter every other abuse control here uses.
   */
  checkRateLimit(input: {
    kind: string;
    key: string;
    windowSeconds: number;
    limit: number;
    now: Date;
  }): Promise<{ allowed: boolean }>;
  getCandidate(candidateId: string): Promise<{ candidate: Candidate; version: number } | null>;
  getEvidence(candidateId: string, evidenceId: string): Promise<Evidence | null>;
  /**
   * Fetches the assertion by its id ONLY. The repository builds the issuer
   * URL itself — see extractBadgeAssertionId below for why the candidate's
   * URL never reaches an HTTP client.
   */
  fetchBadgeAssertion(assertionId: string): Promise<BadgeAssertion | null>;
  /**
   * Dereferences the BadgeClass the assertion points at. Credly returns
   * `badge` as a URI rather than an embedded object, so the name and issuer
   * this check depends on live behind a second request. The URI is validated
   * against Credly's host by resolveBadgeClass before it reaches here.
   */
  fetchBadgeClass(uri: string): Promise<BadgeClass | null>;
  markEvidenceVerified(
    candidateId: string,
    evidenceId: string,
    method: VerificationMethod,
    verificationRef: string,
    verifiedAt: string,
    verificationDetail: string,
    verificationExpiresAt: string | null,
  ): Promise<Evidence | null>;
  countVerificationAttempts(candidateId: string, evidenceId: string): Promise<number>;
  recordVerificationAttempt(candidateId: string, evidenceId: string, at: string): Promise<void>;
  /**
   * GitHub reads. Each returns `null` for "no such public thing" and THROWS
   * UpstreamUnavailableError when the answer could not be obtained — the
   * distinction matters, see the rate-limit note on that error.
   */
  fetchGist(gistId: string): Promise<GistPayload | null>;
  fetchRepo(owner: string, repo: string): Promise<RepoPayload | null>;
  fetchRepoContributors(owner: string, repo: string): Promise<ContributorPayload[]>;
  putVerificationNonce(
    candidateId: string,
    evidenceId: string,
    nonce: string,
    ttlEpochSeconds: number,
  ): Promise<void>;
  consumeVerificationNonce(candidateId: string, evidenceId: string): Promise<string | null>;
  generateNonce(): string;
  appendAuditEvent(event: AuditEvent): Promise<AuditEvent>;
  /**
   * Writes what a graded submission was marked against. Awaited rather than
   * fired and forgotten: a submission that tripped a disqualifying check and
   * left no record would show an employer a cleaner history than the one
   * that happened, so a failed write fails the attempt and the candidate
   * retries, rather than passing quietly with the record missing.
   */
  recordGradedAttempt(candidateId: string, id: string, attempt: GradedAttemptRecord): Promise<void>;
  generateId(): string;
}

export type VerificationProof =
  | { method: 'issuer_badge'; badgeUrl: string }
  | { method: 'repo_ownership'; gistUrl: string; repoUrl: string }
  | { method: 'graded_task'; taskId: string; submission: string };

export type VerificationResult =
  | { verified: true; method: VerificationMethod; verificationRef: string; detail: string }
  /**
   * `retryable` separates "we checked, and it did not pass" from "we could
   * not check right now". Telling a candidate their real work failed
   * verification because GitHub rate-limited us would be both wrong and the
   * kind of thing that loses a good candidate for good.
   */
  | { verified: false; retryable: boolean; reason: string; whatToDo: string };

/**
 * Thrown by a fetch dependency when the upstream could not answer — most
 * often GitHub's unauthenticated API limit, which is 60 requests an hour per
 * IP and is genuinely reachable on a warm Lambda. Never conflated with a
 * failed check.
 */
export class UpstreamUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UpstreamUnavailableError';
  }
}

/**
 * A Credly badge id, and nothing else, is taken from whatever the candidate
 * pasted. The candidate-supplied string is NEVER handed to an HTTP client.
 *
 * That is not defensive tidiness, it is the difference between a feature and
 * a server-side request forgery hole: these Lambdas are not VPC-attached, so
 * a fetch of an attacker-chosen URL would reach the internet, and a fetch of
 * `http://169.254.169.254/...` would reach the instance metadata service.
 * Parsing out a UUID and rebuilding the issuer's own URL from a constant
 * makes the whole class of attack unreachable rather than merely filtered.
 */
export function extractBadgeAssertionId(badgeUrl: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(badgeUrl.trim());
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:') return null;
  const host = parsed.hostname.toLowerCase();
  if (host !== 'credly.com' && host !== 'www.credly.com') return null;

  const match = /^\/badges\/([0-9a-f-]{36})\/?$/i.exec(parsed.pathname);
  return match ? match[1]!.toLowerCase() : null;
}

/**
 * Never silently rejects (CLAUDE.md): every outcome, pass or fail, returns a
 * specific reason and a concrete next step, and is written to the audit log.
 * A candidate always learns exactly why a check did not pass and what would
 * make it pass.
 */
export async function verifyEvidence(
  candidateId: string,
  evidenceId: string,
  proof: VerificationProof,
  deps: VerificationDependencies,
): Promise<VerificationResult> {
  // Before anything is fetched, and before the per-evidence attempt counter,
  // because those two protect different things. The per-evidence cap stops
  // one claim being ground against a check until it passes; this stops one
  // account spending everybody's shared GitHub budget across many claims.
  const withinLimit = await deps.checkRateLimit({
    kind: 'verification-check-candidate',
    key: candidateId,
    windowSeconds: CHECKS_PER_CANDIDATE_WINDOW_SECONDS,
    limit: CHECKS_PER_CANDIDATE_LIMIT,
    now: deps.clock.now(),
  });
  if (!withinLimit.allowed) {
    throw new TooManyRequestsError(
      'You have run a lot of checks in the last hour. Wait an hour and try again. Nothing about your evidence has changed.',
    );
  }

  const candidateResult = await deps.getCandidate(candidateId);
  if (!candidateResult) throw new NotFoundError('Candidate not found');

  const evidence = await deps.getEvidence(candidateId, evidenceId);
  if (!evidence) throw new NotFoundError('Evidence not found');

  if (evidence.verificationState === 'verified') {
    return {
      verified: true,
      method: evidence.verificationMethod ?? proof.method,
      verificationRef: evidence.verificationRef ?? '',
      detail: 'This evidence is already verified.',
    };
  }

  // The claim's own kind decides which check it is eligible for, and the
  // client does not get a say. Filed as a certification, checked with the
  // issuer; filed as code, checked by proving the account and reading the
  // repository. Anything else has no source outside the candidate to check
  // against, and is refused here rather than offered a check that would mean
  // nothing.
  //
  // Enforced on the server because the alternative is a stored evidence item
  // whose recorded method contradicts what it says it is about, which is
  // precisely the arbitrariness the verification states exist to prevent.
  // Checked BEFORE the attempt counter, so a mismatch a candidate cannot
  // succeed at never burns one of their attempts.
  const eligible = VERIFICATION_METHOD_FOR_SOURCE[evidence.source];
  if (eligible === null) {
    return {
      verified: false,
      retryable: false,
      reason: `A ${EVIDENCE_SOURCE_LABELS[evidence.source]} has no outside source we can check it against.`,
      whatToDo:
        'If this claim is really about a certification or a public repository, edit it and say ' +
        'so, then run the check again. Otherwise it stays on your profile as something you have ' +
        'said, which is not the same as a proof and is not shown to employers as one.',
    };
  }
  if (proof.method !== eligible) {
    return {
      verified: false,
      retryable: false,
      reason: `This claim is filed as a ${EVIDENCE_SOURCE_LABELS[evidence.source]}, which is not checked that way.`,
      whatToDo: 'Edit the claim if you filed it as the wrong kind of thing, then check it again.',
    };
  }

  // Bounded, because each attempt is an outbound request to a third party.
  // Unbounded retries would be both a cost line and a way to use Zoryvex as
  // an oracle for guessing which badge ids exist.
  const attempts = await deps.countVerificationAttempts(candidateId, evidenceId);
  if (attempts >= MAX_VERIFICATION_ATTEMPTS_PER_EVIDENCE) {
    return {
      verified: false,
      retryable: false,
      reason: 'Too many verification attempts for this evidence item.',
      whatToDo:
        'Check the link you submitted is the public one, then contact support to have the count reset.',
    };
  }
  await deps.recordVerificationAttempt(candidateId, evidenceId, deps.clock.now().toISOString());

  let outcome: CheckOutcome;
  if (proof.method === 'issuer_badge') {
    outcome = await checkIssuerBadge(proof, candidateResult.candidate, deps);
  } else if (proof.method === 'repo_ownership') {
    outcome = await checkRepoOwnership(candidateId, evidenceId, proof, deps);
  } else {
    outcome = await checkGradedTask(
      candidateId,
      evidenceId,
      proof,
      candidateResult.candidate,
      deps,
    );
  }

  if ('failed' in outcome) {
    if (outcome.retryable) {
      // Deliberately NOT audited as a verification failure and NOT reported
      // as one. Nothing about the evidence was judged; the check simply could
      // not be reached.
      return {
        verified: false,
        retryable: true,
        reason: outcome.failed,
        whatToDo: outcome.whatToDo,
      };
    }
    return failure(evidenceId, outcome.failed, outcome.whatToDo, deps);
  }

  const verifiedAt = deps.clock.now().toISOString();
  const updated = await deps.markEvidenceVerified(
    candidateId,
    evidenceId,
    proof.method,
    outcome.verificationRef,
    verifiedAt,
    outcome.detail,
    outcome.expiresAt ?? null,
  );
  if (!updated) {
    // The item changed underneath us (edited, or deleted) between the read
    // above and this write. Stamping `verified` onto content we no longer
    // have is exactly the laundering hole the edit-resets-verification rule
    // exists to close, so this fails rather than forcing the write through.
    return {
      verified: false,
      retryable: true,
      reason: 'This evidence changed while it was being verified.',
      whatToDo: 'Open the evidence item and run verification again.',
    };
  }

  await deps.appendAuditEvent({
    id: deps.generateId(),
    actorId: 'system:verification',
    actorRole: 'admin',
    action: 'evidence_verified',
    targetType: 'evidence',
    targetId: evidenceId,
    reason: outcome.detail,
    createdAt: verifiedAt,
  });

  return {
    verified: true,
    method: proof.method,
    verificationRef: outcome.verificationRef,
    detail: outcome.detail,
  };
}

type CheckOutcome =
  | { verificationRef: string; detail: string; expiresAt?: string | null }
  | { failed: string; whatToDo: string; retryable: boolean };

async function checkIssuerBadge(
  proof: { badgeUrl: string },
  candidate: Candidate,
  deps: VerificationDependencies,
): Promise<CheckOutcome> {
  const assertionId = extractBadgeAssertionId(proof.badgeUrl);
  if (!assertionId) {
    throw new ValidationError(
      'That does not look like a public Credly badge link. It should look like https://www.credly.com/badges/<id>.',
    );
  }

  let assertion: BadgeAssertion | null;
  try {
    assertion = await deps.fetchBadgeAssertion(assertionId);
  } catch (error) {
    if (error instanceof UpstreamUnavailableError) return upstreamDown('Credly');
    throw error;
  }

  if (!assertion) {
    return {
      failed: 'The issuer did not return a public record for that badge.',
      whatToDo: 'Open the badge on Credly and make sure it is set to public, then try again.',
      retryable: false,
    };
  }

  // Credly puts the badge's name and issuer behind a URI rather than inline,
  // so the class has to be dereferenced before anything can be checked
  // against it. Confirmed against the live endpoint on 2026-08-27 — reading
  // `assertion.badge.name` directly gave undefined and would have rejected
  // every genuine credential.
  const resolved = resolveBadgeClass(assertion);
  if ('reason' in resolved) {
    return { failed: resolved.reason, whatToDo: CONTACT_SUPPORT, retryable: false };
  }

  let badgeClass: BadgeClass | null;
  if ('inline' in resolved) {
    badgeClass = resolved.inline;
  } else {
    try {
      badgeClass = await deps.fetchBadgeClass(resolved.fetchUri);
    } catch (error) {
      if (error instanceof UpstreamUnavailableError) return upstreamDown('Credly');
      throw error;
    }
  }
  if (!badgeClass) {
    return {
      failed: 'The issuer did not return a record for that badge type.',
      whatToDo: 'Try again shortly. If it keeps happening, contact support with the badge link.',
      retryable: true,
    };
  }

  const outcome = verifyBadgeAssertion(assertion, badgeClass, candidate.email, deps.clock.now());
  if (!outcome.verified) {
    return {
      failed: outcome.reason,
      whatToDo: CONTACT_SUPPORT,
      retryable: false,
    };
  }

  return {
    verificationRef: assertionId,
    detail: `${outcome.badgeName}, confirmed with ${outcome.issuerName}.`,
    // Certifications lapse. Kept so the claim can expire with the thing it
    // describes, rather than outliving it.
    expiresAt: outcome.expiresAt,
  };
}

/**
 * Proves control of a GitHub account, then reads facts about the repository.
 *
 * The nonce is consumed before the network calls but after the URLs parse, so
 * a mistyped link does not cost the candidate their challenge. A check that
 * fails for a fixable reason does burn it, deliberately: the gist has to have
 * been created in response to the current challenge, not an earlier one.
 */
async function checkRepoOwnership(
  candidateId: string,
  evidenceId: string,
  proof: { gistUrl: string; repoUrl: string },
  deps: VerificationDependencies,
): Promise<CheckOutcome> {
  const gistId = parseGistUrl(proof.gistUrl);
  if (!gistId) {
    throw new ValidationError(
      'That does not look like a public gist link. It should look like https://gist.github.com/<id>.',
    );
  }
  const target = parseRepoUrl(proof.repoUrl);
  if (!target) {
    throw new ValidationError(
      'That does not look like a GitHub repository link. It should look like https://github.com/<owner>/<repo>.',
    );
  }

  const nonce = await deps.consumeVerificationNonce(candidateId, evidenceId);
  if (!nonce) {
    return {
      failed: 'Your verification code has expired.',
      whatToDo: 'Start verification again to get a fresh code, then put that one in your gist.',
      retryable: true,
    };
  }

  try {
    const gist = await deps.fetchGist(gistId);
    if (!gist) {
      return {
        failed: 'That gist could not be found.',
        whatToDo: 'Check the link, and make sure the gist is public.',
        retryable: false,
      };
    }

    const proven = provenLoginFromGist(gist, nonce);
    if ('reason' in proven) {
      return {
        failed: proven.reason,
        whatToDo: 'Fix the gist, then start verification again to get a fresh code.',
        retryable: false,
      };
    }

    const repo = await deps.fetchRepo(target.owner, target.repo);
    if (!repo) {
      return {
        failed: 'That repository could not be found.',
        whatToDo: 'Check the link, and make sure the repository is public.',
        retryable: false,
      };
    }

    const contributors = await deps.fetchRepoContributors(target.owner, target.repo);
    const outcome = verifyRepository(repo, contributors, proven.login);
    if (!outcome.verified) {
      return {
        failed: outcome.reason,
        whatToDo:
          'If you believe this is wrong, contact support with the repository link and a person will look at it.',
        retryable: false,
      };
    }

    return {
      verificationRef: outcome.facts.fullName,
      detail:
        `${outcome.facts.fullName}, a public repository owned by ${proven.login} with ` +
        `${outcome.facts.contributions} commit(s) credited to them.`,
    };
  } catch (error) {
    if (error instanceof UpstreamUnavailableError) return upstreamDown('GitHub');
    throw error;
  }
}

/**
 * The only check with no third party in it, and the only one Zoryvex scores
 * itself. That is why it carries no source link: there is nobody else to
 * check with, and a Zoryvex-hosted link would dress our own word up as an
 * independent one.
 *
 * What makes it verification rather than an opinion is that the rubric is
 * code. The same submission scores identically for ever, an employer can be
 * told exactly which requirements were met, and a candidate who disagrees
 * has something concrete to appeal. No model reads any of it.
 *
 * Synchronous on purpose: no network, no clock, no randomness. Anything that
 * could vary between runs would break the property the whole thing rests on.
 */
/**
 * Grades one submission, and writes down what it was marked against.
 *
 * The record is the point of the second half of this function. Until now a
 * pass and a fail left the same trace: a `verified` flag or nothing at all,
 * so a candidate who passed first time and one who wrote a wildcard
 * permission, was told, and fixed it were indistinguishable afterwards.
 *
 * Recorded at every exit where a rubric was actually applied, and at no exit
 * where one was not. A task that does not exist, a task not offered for the
 * candidate's track, and a submission too long to grade are all refusals to
 * mark, and writing them down as attempts would put failures in somebody's
 * history for things that were never judged.
 *
 * The submission is never part of what is written. See
 * packages/contracts/src/attempt-history.ts.
 */
async function checkGradedTask(
  candidateId: string,
  evidenceId: string,
  proof: { taskId: string; submission: string },
  candidate: Candidate,
  deps: VerificationDependencies,
): Promise<CheckOutcome> {
  const task = taskById(proof.taskId);
  if (!task) {
    throw new ValidationError('That task does not exist.');
  }

  // Eligibility is asked of the same function that decides what to offer,
  // rather than re-derived here. It used to be re-derived, as
  // `task.track !== candidate.launchTrack`, and that was correct while a task
  // belonged to exactly one track. It stopped being correct the moment
  // tasksForTrack began offering tasks by capability. On aws_cloud a candidate
  // was shown 25 tasks and could submit 8; every track was affected, 54 of the
  // 84 offered places across the four. Those failed after the work was done
  // rather than before it was started, which is the worst moment to find out.
  //
  // A task is offered because it tests a capability the track needs. That is
  // the whole claim being made, and the same sentence is now what lets a
  // submission through, so the two cannot drift apart again. What this still
  // refuses is a task testing a capability the track does not need, which is
  // the case the original check was really protecting.
  const offered = tasksForTrack(candidate.launchTrack);
  if (!offered.some((offeredTask) => offeredTask.id === task.id)) {
    throw new ValidationError('That task is not one of the tasks offered for your track.');
  }

  const params = deriveTaskParams(candidateId, task.id);
  const result = gradeSubmission(task, proof.submission, params);

  const record = (passed: boolean, disqualified: boolean) =>
    deps.recordGradedAttempt(candidateId, deps.generateId(), {
      evidenceId,
      taskId: task.id,
      passed,
      disqualified,
      // Every unmet requirement, in the rubric's own order, not just the one
      // that ended the attempt. An employer reading the history should see
      // what was outstanding, not the first thing the code happened to check.
      failedCheckIds: result.checks.filter((c) => !c.passed).map((c) => c.id),
      at: deps.clock.now().toISOString(),
    });

  // Reported before the score, because it is a different kind of answer.
  // Somebody who did good work under the wrong name needs to know that, not
  // a mark out of five.
  if (!result.identityOk && !result.refused) {
    // Recorded as disqualifying rather than as a low mark. Submitting work
    // set for somebody else is categorical, and the contract names it
    // alongside writing a credential into configuration for that reason.
    await record(false, true);
    return {
      failed: result.identityMissing ?? 'This submission is not the one you were set.',
      whatToDo: 'Open your brief, use the name it gives you, and submit again.',
      retryable: true,
    };
  }

  // Deliberately not recorded. Nothing was marked: the submission was too
  // large to grade, which is a refusal to look rather than a judgement, and
  // the same reasoning that keeps an unreachable third party out of the audit
  // trail keeps this out of somebody's history.
  if (result.refused) {
    return {
      failed: result.refused,
      whatToDo: 'Trim the submission and try again.',
      retryable: true,
    };
  }

  // Before the score, because the score would contradict it. A disqualifying
  // check can fail on a submission that met the pass mark, and reporting
  // "4 of 5 met, and 4 are needed" alongside a failure is a rejection with no
  // legible cause. This says which thing ended it and why.
  const disqualified = result.disqualifiedBy
    ? result.checks.find((c) => c.id === result.disqualifiedBy)
    : undefined;
  if (disqualified && !disqualified.passed) {
    await record(false, true);
    return {
      failed:
        disqualified.missing ?? 'This submission does the one thing the task asks you to avoid.',
      whatToDo:
        `${disqualified.matters ?? ''} ${result.disqualifiedRemedy ?? 'Fix that and submit again.'}`.trim(),
      retryable: true,
    };
  }

  if (!result.passed) {
    await record(false, false);
    return {
      failed: `${result.score} of ${result.outOf} requirements met, and ${result.passMark} are needed.`,
      // Never a bare rejection: the response carries every unmet requirement
      // and why it mattered, so the attempt teaches something true about the
      // work even when it does not pass.
      whatToDo: unmetSummary(result),
      retryable: false,
    };
  }

  await record(true, false);
  return {
    verificationRef: task.id,
    detail: gradedTaskDetail(task, result),
  };
}

function unmetSummary(result: GradeResult): string {
  const unmet = result.checks.filter((c) => !c.passed);
  if (unmet.length === 0) return 'Try the task again.';
  return `Not yet demonstrated: ${unmet.map((c) => `${c.requirement} (${c.missing})`).join(' ')}`;
}

/**
 * Every task a candidate can attempt on their track, each with its full
 * rubric.
 *
 * All of them, not the first one. A track can offer more than one, and
 * silently picking one would hide the rest and force somebody down a task
 * that happens not to suit the work they have actually done. The choice is
 * theirs.
 *
 * The requirements travel with each brief, because a hidden rubric turns a
 * practical task into a guessing game: the point is whether somebody can do
 * the work, not whether they can infer what is being marked.
 */
export interface OfferedTask {
  task: Pick<GradedTask, 'id' | 'title' | 'timeboxMinutes' | 'passMark'> & { brief: string[] };
  requirements: string[];
  outOf: number;
}

export function gradedTasksFor(candidate: Candidate): OfferedTask[] {
  return tasksForTrack(candidate.launchTrack).map((task) => ({
    task: {
      id: task.id,
      title: task.title,
      brief: task.brief(deriveTaskParams(candidate.id, task.id)),
      timeboxMinutes: task.timeboxMinutes,
      passMark: task.passMark,
    },
    requirements: task.checks.map((c) => c.requirement),
    outOf: task.checks.length,
  }));
}

function upstreamDown(service: string): CheckOutcome {
  return {
    failed: `Zoryvex could not reach ${service} to run this check.`,
    whatToDo: 'Nothing is wrong with your evidence. Try again in a few minutes.',
    retryable: true,
  };
}

/**
 * Issues the one-time code a candidate publishes to prove they control a
 * GitHub account. Short-lived and single-use, so a leaked code is worth
 * nothing and the gist must have been created for THIS challenge rather than
 * found lying around.
 */
export async function beginRepoVerification(
  candidateId: string,
  evidenceId: string,
  deps: VerificationDependencies,
): Promise<{ nonce: string; fileName: string; instructions: string[]; expiresInMinutes: number }> {
  // Bounded separately and more loosely than the check itself: issuing a
  // nonce costs one write and no outbound call, so the limit here is about
  // stopping a write loop rather than protecting somebody else's API.
  const withinLimit = await deps.checkRateLimit({
    kind: 'verification-nonce-candidate',
    key: candidateId,
    windowSeconds: NONCES_PER_CANDIDATE_WINDOW_SECONDS,
    limit: NONCES_PER_CANDIDATE_LIMIT,
    now: deps.clock.now(),
  });
  if (!withinLimit.allowed) {
    throw new TooManyRequestsError(
      'You have asked for a lot of codes in the last hour. Wait an hour and try again.',
    );
  }

  const evidence = await deps.getEvidence(candidateId, evidenceId);
  if (!evidence) throw new NotFoundError('Evidence not found');

  const nonce = deps.generateNonce();
  const expiresAt = Math.floor(deps.clock.now().getTime() / 1000) + REPO_NONCE_TTL_MINUTES * 60;
  await deps.putVerificationNonce(candidateId, evidenceId, nonce, expiresAt);

  return {
    nonce,
    fileName: 'zoryvex-verification.txt',
    /**
     * Written for somebody who has never made a gist.
     *
     * The old three lines said "create a new public gist" and stopped, which
     * assumes the reader already knows what a gist is, where they are made,
     * and that public is a choice at all. It is: GitHub's own create page
     * puts "Create secret gist" on the button and hides "Create public gist"
     * behind the dropdown arrow beside it, so the default action produces a
     * gist this check refuses. Somebody following the old wording would do
     * the obvious thing and be told their gist is secret with no idea why it
     * happened, and provingLoginFromGist rejects exactly that.
     *
     * Source: GitHub Docs, "Creating gists".
     */
    instructions: [
      'Go to gist.github.com, signed in as the GitHub account that owns the work.',
      'Type zoryvex-verification.txt into the filename box.',
      'Paste the code below into the large box underneath it.',
      'Press the dropdown arrow beside the green "Create secret gist" button and choose "Create public gist" instead. A secret gist cannot be checked, and secret is what the button does on its own.',
      'Copy the address of the page you land on. That is your gist link.',
    ],
    expiresInMinutes: REPO_NONCE_TTL_MINUTES,
  };
}

async function failure(
  evidenceId: string,
  reason: string,
  whatToDo: string,
  deps: VerificationDependencies,
): Promise<VerificationResult> {
  await deps.appendAuditEvent({
    id: deps.generateId(),
    actorId: 'system:verification',
    actorRole: 'admin',
    action: 'evidence_verification_failed',
    targetType: 'evidence',
    targetId: evidenceId,
    reason,
    createdAt: deps.clock.now().toISOString(),
  });
  return { verified: false, retryable: false, reason, whatToDo };
}
