import type { FeatureFlags } from '@zoryvex/config';
import type { AuditEvent, Candidate, Evidence } from '@zoryvex/contracts';
import type { Clock } from '../repositories/clock-repository';

/**
 * One nudge, once, to a candidate who wrote up their work and then stopped
 * before verifying it.
 *
 * This is the only place in the system that emails a person who did not ask
 * for it, so the constraints are deliberately tight: exactly one reminder per
 * candidate ever, never a sequence, only after a real quiet period, and never
 * to anyone who already has something verified. A drip campaign aimed at
 * people who did not finish is spam, and CLAUDE.md rules out dark patterns.
 *
 * Worth doing because verification is the supply side, and supply is the
 * constraint: a candidate with unverified evidence is invisible to every
 * employer, which is a worse outcome for them than for us and they usually
 * do not know it.
 */

const QUIET_PERIOD_DAYS = 3;

export interface VerificationReminderDependencies {
  clock: Clock;
  getFeatureFlags(): Promise<FeatureFlags>;
  listCandidateEvidence(candidateId: string): Promise<Evidence[]>;
  /**
   * Conditional, single-use claim. Returns false when this candidate has
   * already been reminded, at any time in the past.
   */
  claimReminderSlot(candidateId: string, at: string): Promise<boolean>;
  sendVerificationReminder(input: {
    email: string;
    displayName: string;
    unverifiedCount: number;
  }): Promise<void>;
  appendAuditEvent(event: AuditEvent): Promise<AuditEvent>;
}

export type ReminderOutcome =
  | 'sent'
  | 'flag_off'
  | 'already_reminded'
  | 'nothing_to_verify'
  | 'already_verified'
  | 'too_soon'
  | 'send_failed';

export interface ReminderRun {
  outcomes: Record<string, ReminderOutcome>;
  sent: number;
}

/**
 * Never throws for one candidate's sake: a single bad address or SES hiccup
 * must not stop the rest of the batch.
 */
export async function sendVerificationReminders(
  candidates: Candidate[],
  deps: VerificationReminderDependencies,
): Promise<ReminderRun> {
  const outcomes: Record<string, ReminderOutcome> = {};

  const flags = await deps.getFeatureFlags();
  if (!flags.verificationReminders) {
    // Checked once, before any work. Nothing about this job should run,
    // including the reads, while it is switched off.
    for (const candidate of candidates) outcomes[candidate.id] = 'flag_off';
    return { outcomes, sent: 0 };
  }

  const now = deps.clock.now();
  let sent = 0;

  for (const candidate of candidates) {
    outcomes[candidate.id] = await remindOne(candidate, now, deps);
    if (outcomes[candidate.id] === 'sent') sent += 1;
  }

  return { outcomes, sent };
}

async function remindOne(
  candidate: Candidate,
  now: Date,
  deps: VerificationReminderDependencies,
): Promise<ReminderOutcome> {
  const evidence = await deps.listCandidateEvidence(candidate.id);

  // Nothing written up yet is a different problem, and one an email about
  // verification would only confuse.
  if (evidence.length === 0) return 'nothing_to_verify';

  // Anyone with a verified item is already visible to employers. Telling them
  // to go verify would be both wrong and irritating.
  if (evidence.some((item) => item.verificationState === 'verified')) return 'already_verified';

  const unverified = evidence.filter((item) => item.verificationState !== 'verified');

  // Measured from the most recent write, so somebody still actively editing
  // today is left alone.
  const lastTouched = Math.max(...evidence.map((item) => Date.parse(item.updatedAt)));
  const quietFor = now.getTime() - lastTouched;
  if (!Number.isFinite(quietFor) || quietFor < QUIET_PERIOD_DAYS * 24 * 60 * 60 * 1000) {
    return 'too_soon';
  }

  // Claimed BEFORE sending, which is the opposite of how the Paystack webhook
  // orders its own idempotency, and deliberately so. There, losing the effect
  // is worse than repeating it, because somebody paid. Here, repeating it is
  // worse than losing it: a duplicate unsolicited email is spam, and a missed
  // nudge costs nothing. A crash between the claim and the send loses at most
  // one reminder, which is the right direction to fail in.
  const claimed = await deps.claimReminderSlot(candidate.id, now.toISOString());
  if (!claimed) return 'already_reminded';

  try {
    await deps.sendVerificationReminder({
      email: candidate.email,
      displayName: candidate.displayName,
      unverifiedCount: unverified.length,
    });
  } catch {
    // The slot stays claimed. Retrying would risk a duplicate for a benefit
    // that does not justify it.
    return 'send_failed';
  }

  await deps.appendAuditEvent({
    id: `audit_verification_reminder_${candidate.id}`,
    actorId: 'system:verification-reminder',
    actorRole: 'admin',
    action: 'verification_reminder_sent',
    targetType: 'candidate',
    targetId: candidate.id,
    reason: `${unverified.length} unverified evidence item(s)`,
    createdAt: now.toISOString(),
  });

  return 'sent';
}

/**
 * Plain text, no tracking pixel, no marketing. It states one fact the
 * candidate does not know and cannot see from outside: their work is not
 * reaching employers. Whether that matters to them is their call, so it says
 * so plainly and offers a way out that actually works.
 */
export function reminderBody(input: {
  displayName: string;
  unverifiedCount: number;
  verifyUrl: string;
  unsubscribeUrl: string;
}): string {
  const { displayName, unverifiedCount, verifyUrl, unsubscribeUrl } = input;
  const plural = unverifiedCount === 1 ? 'piece' : 'pieces';

  return [
    `Hi ${displayName},`,
    '',
    `You have ${unverifiedCount} ${plural} of evidence on Zoryvex that employers cannot see yet.`,
    '',
    'Employers only see evidence we have checked ourselves. Until at least one of yours is',
    'verified, your profile does not appear in any of their searches. Verifying takes a few',
    'minutes: a cloud certification is checked with the body that set the exam, and a public',
    'repository is checked on GitHub.',
    '',
    verifyUrl,
    '',
    'This is the only reminder we will send you about this.',
    '',
    `If you would rather we did not email you at all: ${unsubscribeUrl}`,
  ].join('\n');
}
