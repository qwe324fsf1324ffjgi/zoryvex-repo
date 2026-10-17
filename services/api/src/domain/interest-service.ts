import {
  isMutualMatch,
  type AccessState,
  type Candidate,
  type Employer,
  type InterestState,
  type Match,
  type Role,
} from '@zoryvex/contracts';
import { ForbiddenError, NotFoundError } from '../errors/typed-errors';
import { grantsMarketplaceAccess } from './billing-state';
import type { Clock } from '../repositories/clock-repository';

/**
 * One notice per employer, per candidate, per day.
 *
 * Interest is a deliberate act rather than a page render, so the transition
 * check below already stops the ordinary repeat. This stops the other one: an
 * employer who flips between interested and not interested while comparing
 * people would otherwise mail the candidate on every swing back. The
 * candidate learns that this organisation is interested, which is the fact
 * that matters; the number of times they changed their mind is not.
 */
const INTEREST_NOTICE_WINDOW_SECONDS = 24 * 60 * 60;
const INTEREST_NOTICES_PER_WINDOW = 1;

/**
 * Who has said yes to whom.
 *
 * Matching decides who *could* work together. This decides who *wants* to,
 * and it is the half the product promised and did not have: an employer
 * could spend an unlock on somebody who had never seen the role and would
 * never have taken it, and a candidate had no way to put their hand up for
 * work they actually wanted.
 *
 * Deliberately not a message, a like, or a queue. It is one field per side
 * with three states, because the only question worth answering cheaply is
 * whether a conversation is welcome before anybody pays to start one.
 */

export interface InterestDependencies {
  clock: Clock;
  getRole(roleId: string): Promise<{ role: Role; version: number } | null>;
  getMatch(roleId: string, candidateId: string): Promise<Match | null>;
  listMatchesForCandidate(candidateId: string): Promise<Match[]>;
  updateMatchInterest(
    roleId: string,
    candidateId: string,
    patch: { candidateInterest?: InterestState; employerInterest?: InterestState },
  ): Promise<Match | null>;
  appendAuditEvent(event: {
    id: string;
    actorId: string;
    actorRole: 'candidate' | 'employer';
    action: string;
    targetType: string;
    targetId: string;
    reason?: string;
    createdAt: string;
  }): Promise<unknown>;
  generateId(): string;
  getCandidate(candidateId: string): Promise<{ candidate: Candidate; version: number } | null>;
  getEmployer(employerId: string): Promise<Employer | null>;
  /**
   * Whether this organization's subscription currently grants anything.
   *
   * Founder decision, 2026-09-14: saying yes to a candidate is a paid
   * action. It was free until now, on the reasoning that an employer should
   * be able to learn whether interest is returned before spending anything.
   * The same derivation contact unlock uses, so there is one idea of who has
   * paid rather than two.
   */
  getMarketplaceAccess(employerId: string): Promise<AccessState>;
  checkRateLimit(input: {
    kind: string;
    key: string;
    windowSeconds: number;
    limit: number;
    now: Date;
  }): Promise<{ allowed: boolean }>;
  /**
   * Tell the candidate an employer wants to talk.
   *
   * Until this existed, an employer could say yes and the candidate was told
   * nothing at all: the answer lived in a match row that only appeared if
   * they happened to sign in and open Matches. Somebody who checked once a
   * fortnight could miss the only offer they were ever going to get, and
   * nothing on any screen suggested there was a reason to look.
   *
   * Carries the organisation and the role and no way to reply outside the
   * product. The employer's own address is not in it, because interest is
   * not consent to be contacted and the contact direction this product
   * sells runs the other way, through a paid unlock the candidate has
   * separately consented to.
   */
  notifyCandidateOfInterest(notice: {
    email: string;
    displayName: string;
    organizationName: string;
    roleTitle: string;
  }): Promise<void>;
}

/**
 * The employer's side.
 *
 * Ownership is checked against the role rather than the match, because a
 * match is addressed by a role id the caller supplies: trusting the match
 * alone would let any employer write interest onto anybody's shortlist by
 * guessing a candidate id.
 */
export async function setEmployerInterest(
  employerId: string,
  roleId: string,
  candidateId: string,
  state: InterestState,
  deps: InterestDependencies,
): Promise<Match> {
  const found = await deps.getRole(roleId);
  if (!found || found.role.employerId !== employerId) throw new NotFoundError('Role not found');

  // Paid action, and checked after ownership so a role belonging to somebody
  // else is still NotFoundError whether or not this employer has paid.
  // Answering "you need a subscription" there would confirm the role exists.
  //
  // Withdrawing is deliberately NOT gated below: an employer whose
  // subscription lapses must still be able to take back a yes they already
  // gave, because the candidate is looking at it and a stale yes is a
  // conversation that never comes.
  if (
    state === 'interested' &&
    !grantsMarketplaceAccess(await deps.getMarketplaceAccess(employerId))
  ) {
    throw new ForbiddenError(
      'Telling a candidate you are interested needs an active marketplace subscription.',
    );
  }

  // Read before the write, so "they said yes" can be told apart from "they
  // already had". Pressing the button twice, or re-rendering the shortlist,
  // must not read as a second decision.
  const before = await deps.getMatch(roleId, candidateId);

  const updated = await deps.updateMatchInterest(roleId, candidateId, {
    employerInterest: state,
  });
  // Null means the match row is gone: a recompute can drop a match between
  // the page rendering and the button being pressed. Not an error the
  // employer caused, and not something to invent a row for.
  if (!updated) throw new NotFoundError('Match not found');

  const now = deps.clock.now();
  await deps.appendAuditEvent({
    id: deps.generateId(),
    actorId: employerId,
    actorRole: 'employer',
    action: 'employer_interest_set',
    targetType: 'match',
    targetId: `${roleId}#${candidateId}`,
    reason: state,
    createdAt: now.toISOString(),
  });

  const becameInterested = state === 'interested' && before?.employerInterest !== 'interested';
  if (becameInterested) {
    await tellCandidate({ employerId, roleId, candidateId, now }, deps);
  }

  return updated;
}

/**
 * The notice, and every reason not to send one.
 *
 * Runs after the write and the audit event, and is never allowed to undo
 * either. The employer's decision is recorded either way: throwing here
 * would report a failure for something that succeeded, and would invite a
 * retry that says yes a second time.
 */
async function tellCandidate(
  input: { employerId: string; roleId: string; candidateId: string; now: Date },
  deps: InterestDependencies,
): Promise<void> {
  try {
    const limit = await deps.checkRateLimit({
      kind: 'employer-interest-notice',
      key: `${input.employerId}#${input.candidateId}`,
      windowSeconds: INTEREST_NOTICE_WINDOW_SECONDS,
      limit: INTEREST_NOTICES_PER_WINDOW,
      now: input.now,
    });
    if (!limit.allowed) return;

    const candidateResult = await deps.getCandidate(input.candidateId);
    const employer = await deps.getEmployer(input.employerId);
    const role = await deps.getRole(input.roleId);
    if (!candidateResult || !employer || !role) return;

    // Re-read rather than trusted from the match, the same rule profile-view
    // notices follow: a candidate who has left discovery stops hearing about
    // being looked at, and the state at the moment of the disclosure is the
    // one that governs it.
    if (!candidateResult.candidate.discoveryOptIn) return;

    await deps.notifyCandidateOfInterest({
      email: candidateResult.candidate.email,
      displayName: candidateResult.candidate.displayName,
      organizationName: employer.organizationName,
      roleTitle: role.role.title,
    });
  } catch {
    // Recorded rather than swallowed. A candidate who was never told is the
    // one failure in this flow that costs them something real, so it leaves
    // a row the founder's exception queue reads, exactly as a failed
    // contact-unlock notice does.
    await deps.appendAuditEvent({
      id: deps.generateId(),
      actorId: input.employerId,
      actorRole: 'employer',
      action: 'employer_interest_notice_failed',
      targetType: 'match',
      targetId: `${input.roleId}#${input.candidateId}`,
      reason: 'The candidate was not told an employer is interested. Tell them manually.',
      createdAt: input.now.toISOString(),
    });
  }
}

/**
 * The candidate's side.
 *
 * Addressed by role id alone: a candidate may only ever speak about their
 * own match, so the candidate id comes from the session and never from the
 * request. The match must already exist — a candidate cannot express
 * interest in a role they were never matched to, which is what stops this
 * becoming an open application inbox the product does not have.
 */
export async function setCandidateInterest(
  candidateId: string,
  roleId: string,
  state: InterestState,
  deps: InterestDependencies,
): Promise<Match> {
  const existing = await deps.getMatch(roleId, candidateId);
  if (!existing) throw new NotFoundError('Match not found');

  const updated = await deps.updateMatchInterest(roleId, candidateId, {
    candidateInterest: state,
  });
  if (!updated) throw new NotFoundError('Match not found');

  await deps.appendAuditEvent({
    id: deps.generateId(),
    actorId: candidateId,
    actorRole: 'candidate',
    action: 'candidate_interest_set',
    targetType: 'match',
    targetId: `${roleId}#${candidateId}`,
    reason: state,
    createdAt: deps.clock.now().toISOString(),
  });

  return updated;
}

/** What a candidate sees about one of their matches. */
export interface CandidateMatchView {
  roleId: string;
  roleTitle: string;
  employerId: string;
  matchScore: number;
  fit: Match['fit'];
  /**
   * Written for this candidate, never the employer's copy of it. The two
   * differ on purpose: the employer's says "they", and it does not name
   * the figure this candidate entered as their minimum.
   */
  fitReason: string | undefined;
  compensation: Role['intent'];
  candidateInterest: InterestState;
  employerInterest: InterestState;
  mutual: boolean;
}

/**
 * The roles a candidate has been matched to.
 *
 * This did not exist. Matching wrote rows a candidate could never see, so
 * "mutual" could not happen: one side was structurally unable to answer.
 *
 * What is returned is deliberately narrow. A candidate learns which role,
 * which employer, how well it fits and what it pays — never who else was
 * matched, never their own score's internals, and never anything about the
 * employer beyond the role itself.
 *
 * The employer's interest is exposed, on purpose. Knowing somebody has
 * already said yes is the entire reason a candidate would bother
 * answering, and it is the employer's own stated position about a
 * candidate they chose to consider.
 */
export async function listRolesForCandidate(
  candidateId: string,
  deps: InterestDependencies,
): Promise<CandidateMatchView[]> {
  const matches = await deps.listMatchesForCandidate(candidateId);

  const views = await Promise.all(
    matches.map(async (match) => {
      const found = await deps.getRole(match.roleId);
      // A match whose role has been deleted is a dangling row, not
      // something to show somebody. Dropped rather than rendered as a
      // blank card they cannot act on.
      if (!found) return null;
      const candidateInterest = match.candidateInterest ?? 'unstated';
      const employerInterest = match.employerInterest ?? 'unstated';
      return {
        roleId: match.roleId,
        roleTitle: found.role.title,
        employerId: found.role.employerId,
        matchScore: match.matchScore,
        fit: match.fit,
        // Deliberately not `match.fitReason`, which is addressed to the
        // employer. A shortlist written before this field existed has
        // none, and no explanation is better than the wrong one.
        fitReason: match.fitReasonForCandidate,
        compensation: found.role.intent,
        candidateInterest,
        employerInterest,
        mutual: isMutualMatch(candidateInterest, employerInterest),
      } as CandidateMatchView;
    }),
  );

  return views.filter((view): view is CandidateMatchView => view !== null);
}

/**
 * Whether contact may be unlocked for this match.
 *
 * Separate from the entitlement and allowance checks in
 * contact-unlock-service, which answer "may this employer spend an
 * unlock". This answers "should anybody be unlocked here at all", and the
 * answer is no when the candidate has actively declined.
 *
 * Silence still permits an unlock. Requiring a candidate to opt in before
 * an employer may pay to reach them would empty the marketplace on the day
 * it launched, and the existing contact-unlock consent already governs
 * whether their details may be shared at all. What this adds is the one
 * case the product had no way to express: a candidate who looked at the
 * role and said no.
 */
export function contactUnlockBlockedByCandidate(match: Pick<Match, 'candidateInterest'>): boolean {
  return match.candidateInterest === 'declined';
}

/**
 * The words a candidate actually receives.
 *
 * Written to answer the three questions somebody has on opening it: who,
 * what happens now, and where. The link goes to Matches rather than the
 * profile, because Matches is the one screen where the answer can be given,
 * and a notice that lands somebody on the wrong page is a notice they act on
 * once and then ignore.
 *
 * It says plainly that nothing is shared by answering. A candidate who
 * suspects that saying yes hands over their number will not say yes, and
 * they would be wrong: interest is an answer, and contact stays behind its
 * own paid, separately-consented unlock.
 */
export function interestNoticeBody(input: {
  displayName: string;
  organizationName: string;
  roleTitle: string;
  matchesUrl: string;
  profileUrl: string;
}): string {
  const { displayName, organizationName, roleTitle, matchesUrl, profileUrl } = input;

  return [
    `Hi ${displayName},`,
    '',
    `${organizationName} is interested in you for "${roleTitle}".`,
    '',
    'They saw the claims you have had checked. They did not see your email address, your',
    'phone number, or anything you marked private.',
    '',
    'This one needs an answer from you. Saying yes tells them a conversation is welcome;',
    'it still shares none of your contact details, and they only reach you after a',
    'separate unlock you are told about. Saying no closes it and they are not told why.',
    '',
    'Your answer is here, and the role stays on that page either way so you can come back',
    'to it:',
    matchesUrl,
    '',
    'You are getting this because your profile is open to employer discovery. Turning that',
    'off stops both the discovery and these messages:',
    profileUrl,
  ].join('\n');
}
