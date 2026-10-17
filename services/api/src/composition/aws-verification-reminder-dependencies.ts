import { SystemClock } from '../repositories/clock-repository';
import { getFeatureFlags } from '../repositories/feature-flags-repository';
import { listCandidateEvidence } from '../repositories/evidence-repository';
import { claimReminderSlot } from '../repositories/verification-reminder-repository';
import { sendPlainTextEmail } from '../repositories/ses-repository';
import { requireEnv } from '../lib/require-env';
import { appendAuditEvent } from '../repositories/audit-event-repository';
import {
  reminderBody,
  type VerificationReminderDependencies,
} from '../domain/verification-reminder-service';

export function createAwsVerificationReminderDependencies(): VerificationReminderDependencies {
  return {
    clock: new SystemClock(),
    getFeatureFlags,
    listCandidateEvidence,
    claimReminderSlot,
    async sendVerificationReminder({ email, displayName, unverifiedCount }) {
      const appOrigin = requireEnv('APP_ORIGIN');
      await sendPlainTextEmail({
        to: email,
        from: requireEnv('REMINDER_FROM_ADDRESS'),
        // Says what it is. A subject line that teases the contents to earn an
        // open is the beginning of every mailing list nobody wanted.
        subject: 'Your Zoryvex evidence is not reaching employers yet',
        text: reminderBody({
          displayName,
          unverifiedCount,
          verifyUrl: `${appOrigin}/candidate/profile`,
          unsubscribeUrl: `${appOrigin}/candidate/account`,
        }),
        ...(process.env.SES_CONFIGURATION_SET_NAME
          ? { configurationSetName: process.env.SES_CONFIGURATION_SET_NAME }
          : {}),
      });
    },
    appendAuditEvent,
  };
}
