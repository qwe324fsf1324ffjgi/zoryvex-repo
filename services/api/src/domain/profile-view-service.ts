import type { AuditEvent, Candidate, Employer } from '@zoryvex/contracts';
import type { Clock } from '../repositories/clock-repository';

/**
 * Telling a candidate when an employer looked at their proof.
 *
 * The asymmetry this closes is the ordinary one in hiring: an employer can
 * study somebody for a week and that person never learns it happened. On a
 * platform whose whole argument is that a candidate can check what is being
 * said about them, leaving the looking itself invisible is inconsistent.
 *
 * Three decisions shape what counts as a view, and each rules something out.
 *
 * It is a deliberate look at ONE person, not a page render. Opening a
 * shortlist shows a row of anonymous cards; notifying on that would mean a
 * single recompute mailed every candidate on the list, which is noise
 * dressed as transparency. The trigger is an employer opening a specific
 * candidate's evidence, which is a choice about that person.
 *
 * It is reported at most once a day per employer. Somebody comparing two
 * candidates will open the same panel repeatedly, and a mail each time
 * teaches the recipient to filter the sender. The candidate learns that this
 * employer looked, which is the fact that matters; the count is not.
 *
 * It never fails the employer's page. The read is the product; the notice is
 * a courtesy attached to it. A candidate's mailbox being unreachable must
 * not stop an employer seeing evidence they are paying for, so the caller
 * treats every failure here as non-fatal and logs it rather than surfacing
 * it.
 *
 * Only candidates who opted into discovery are told, because only they can
 * be looked at in the first place. A candidate who has since opted out is
 * not mailed about a match that predates the opt-out.
 */

/** One notice per employer, per candidate, per day. */
const VIEW_NOTICE_WINDOW_SECONDS = 24 * 60 * 60;
const VIEW_NOTICES_PER_WINDOW = 1;

export interface ProfileViewDependencies {
  clock: Clock;
  getCandidate(candidateId: string): Promise<{ candidate: Candidate; version: number } | null>;
  getEmployer(employerId: string): Promise<Employer | null>;
  checkRateLimit(input: {
    kind: string;
    key: string;
    windowSeconds: number;
    limit: number;
    now: Date;
  }): Promise<{ allowed: boolean }>;
  notifyCandidateOfView(notice: {
    email: string;
    displayName: string;
    organizationName: string;
    roleTitle: string;
  }): Promise<void>;
  appendAuditEvent(event: AuditEvent): Promise<AuditEvent>;
  generateId(): string;
}

export type ProfileViewOutcome =
  | { notified: true }
  | { notified: false; reason: 'already_notified_today' | 'not_discoverable' | 'unknown_party' };

export async function notifyCandidateOfProfileView(
  input: { employerId: string; roleId: string; roleTitle: string; candidateId: string },
  deps: ProfileViewDependencies,
): Promise<ProfileViewOutcome> {
  const now = deps.clock.now();

  // Checked before anything is read or sent. A repeat look inside the window
  // costs one conditional write and nothing else.
  const limit = await deps.checkRateLimit({
    kind: 'profile-view-notice',
    key: `${input.employerId}#${input.candidateId}`,
    windowSeconds: VIEW_NOTICE_WINDOW_SECONDS,
    limit: VIEW_NOTICES_PER_WINDOW,
    now,
  });
  if (!limit.allowed) return { notified: false, reason: 'already_notified_today' };

  const candidateResult = await deps.getCandidate(input.candidateId);
  const employer = await deps.getEmployer(input.employerId);
  if (!candidateResult || !employer) return { notified: false, reason: 'unknown_party' };

  // Re-read rather than trusted from the match. A candidate who left
  // discovery should stop hearing about being looked at, for the same reason
  // withdrawn contact consent stops contact being served: the state at the
  // moment of the disclosure is the one that governs it.
  if (!candidateResult.candidate.discoveryOptIn) {
    return { notified: false, reason: 'not_discoverable' };
  }

  await deps.notifyCandidateOfView({
    email: candidateResult.candidate.email,
    displayName: candidateResult.candidate.displayName,
    organizationName: employer.organizationName,
    roleTitle: input.roleTitle,
  });

  // Written after the send, so the log records notices that really went
  // rather than intentions. A failed send throws before this line and the
  // caller logs it; an audit trail claiming a candidate was told when they
  // were not would be worse than no trail.
  await deps.appendAuditEvent({
    id: deps.generateId(),
    actorId: input.employerId,
    actorRole: 'employer',
    action: 'candidate_profile_viewed',
    targetType: 'candidate',
    targetId: input.candidateId,
    reason: `Viewed for role ${input.roleId}`,
    createdAt: now.toISOString(),
  });

  return { notified: true };
}

/**
 * What the candidate reads.
 *
 * Written to answer the question the subject line provokes — "what did they
 * see?" — before the recipient has to wonder. An employer at this point has
 * the verified claims and nothing else: no email address, no phone number,
 * no private items, and nothing the candidate has not had checked. Saying so
 * is the difference between a notice and an alarm.
 *
 * It does not name a number of views or invite a reply. There is nothing for
 * the candidate to do here, and a message implying otherwise would be asking
 * them to perform interest in being hired.
 */
export function profileViewNoticeBody(input: {
  displayName: string;
  organizationName: string;
  roleTitle: string;
  profileUrl: string;
}): string {
  const { displayName, organizationName, roleTitle, profileUrl } = input;

  return [
    `Hi ${displayName},`,
    '',
    `${organizationName} opened your proof while looking at candidates for "${roleTitle}".`,
    '',
    'They saw the claims you have had checked, and what each check does and does not',
    'establish. They did not see your email address, your phone number, or anything you',
    'marked private. An employer only gets your contact details by unlocking them, and you',
    'are told separately when that happens.',
    '',
    'There is nothing you need to do. This is here so you know when you are being',
    'considered, rather than finding out only if somebody writes to you.',
    '',
    'You are getting this because your profile is open to employer discovery. Turning that',
    'off stops both the discovery and these messages:',
    profileUrl,
  ].join('\n');
}
