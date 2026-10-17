import { LaunchTrackSchema, type Candidate } from '@zoryvex/contracts';
import { getFeatureFlags } from '../../src/repositories/feature-flags-repository';
import { listDiscoveryOptedCandidates } from '../../src/repositories/discovery-repository';
import { sendVerificationReminders } from '../../src/domain/verification-reminder-service';
import { createAwsVerificationReminderDependencies } from '../../src/composition/aws-verification-reminder-dependencies';

const deps = createAwsVerificationReminderDependencies();

/**
 * Scheduled sweep for candidates whose evidence never got verified.
 *
 * Only candidates currently opted into discovery are considered, and that is
 * a deliberate narrowing rather than a convenient reuse of the existing
 * index. Someone opted out has said they do not want employers finding them;
 * emailing them that employers cannot find them would be both useless and
 * tone-deaf. Opting in is what makes the reminder information they actually
 * want.
 *
 * Runs once a day. The work is bounded by the number of opted-in candidates
 * across four tracks, and the domain service skips almost all of them
 * cheaply, so this is a small daily read rather than a growing cost line.
 */
export const handler = async (): Promise<{ scanned: number; sent: number; skipped: boolean }> => {
  // Checked before any read, so the job costs nothing at all while it is off.
  // The domain service checks it again on its own behalf; this is the outer
  // half of the same guard, not a duplicate of it.
  const flags = await getFeatureFlags();
  if (!flags.verificationReminders) return { scanned: 0, sent: 0, skipped: true };

  const candidates: Candidate[] = [];
  for (const track of LaunchTrackSchema.options) {
    candidates.push(...(await listDiscoveryOptedCandidates(track)));
  }

  const run = await sendVerificationReminders(candidates, deps);

  // Counts only, never an address or a name: this log is operational, and
  // docs/PRIVACY_AND_RETENTION.md keeps candidate identity out of it.
  //
  // Silent on a quiet run. A job that reports "0 sent" every morning for
  // months trains whoever reads it to stop reading it, so it speaks only
  // when a human might actually want to know something.
  const tally = new Map<string, number>();
  for (const outcome of Object.values(run.outcomes)) {
    tally.set(outcome, (tally.get(outcome) ?? 0) + 1);
  }
  const failures = tally.get('send_failed') ?? 0;
  if (run.sent > 0 || failures > 0) {
    console.warn(
      `verification reminders: ${candidates.length} considered, ${run.sent} sent, ` +
        `${failures} failed to send`,
      Object.fromEntries(tally),
    );
  }

  return { scanned: candidates.length, sent: run.sent, skipped: false };
};
