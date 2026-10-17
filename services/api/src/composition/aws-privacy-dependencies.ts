import { randomUUID } from 'node:crypto';
import { getFeatureFlags } from '../repositories/feature-flags-repository';
import { SystemClock } from '../repositories/clock-repository';
import {
  getCandidate,
  setDiscoveryOptIn,
  updateCandidateProfile,
  deleteCandidateProfile,
  enablePublicProof,
  disablePublicProof,
} from '../repositories/candidate-repository';
import { listCandidateEvidence, deleteEvidence } from '../repositories/evidence-repository';
import { deleteGradedAttemptsForEvidence } from '../repositories/graded-attempt-repository';
import { deleteVerificationState } from '../repositories/verification-repository';
import { deleteAttestationsForEvidence } from '../repositories/peer-attestation-repository';
import { deleteReminderSlot } from '../repositories/verification-reminder-repository';
import { listFilesForCandidate, deleteFileRecord } from '../repositories/evidence-file-repository';
import { deleteObject } from '../repositories/s3-object-repository';
import {
  listMatchesForCandidate,
  listMatchesForRole,
  getMatch,
  deleteMatch,
  unlockContactAtomic,
} from '../repositories/match-repository';
import { revokeAllSessions } from '../repositories/session-repository';
import { deleteAccount } from '../repositories/account-repository';
import { appendAuditEvent } from '../repositories/audit-event-repository';
import { sendPlainTextEmail } from '../repositories/ses-repository';
import { requireEnv } from '../lib/require-env';
import { getRole } from '../repositories/role-repository';
import { listGradedAttempts } from '../repositories/graded-attempt-repository';
import { getEntitlement } from '../repositories/employer-repository';
import { getBillingSubscription } from '../repositories/billing-repository';
import { deriveAccess } from '../domain/billing-state';
import type { PrivacyDependencies } from '../domain/privacy-service';
import type { DeletionDependencies } from '../domain/deletion-service';
import {
  contactUnlockNoticeBody,
  type ContactUnlockDependencies,
} from '../domain/contact-unlock-service';

function evidenceBucket(): string {
  const name = process.env.EVIDENCE_BUCKET_NAME;
  if (!name) throw new Error('EVIDENCE_BUCKET_NAME environment variable is not set');
  return name;
}

export function createAwsPrivacyDependencies(): PrivacyDependencies {
  return {
    clock: new SystemClock(),
    getCandidate,
    setDiscoveryOptIn,
    updateCandidateProfile,
    enablePublicProof,
    disablePublicProof,
    appendAuditEvent,
    listCandidateEvidence,
    listFilesForCandidate,
    listMatchesForCandidate,
    getRole,
    listGradedAttempts,
    deleteMatch,
    generateId: randomUUID,
  };
}

export function createAwsDeletionDependencies(): DeletionDependencies {
  return {
    clock: new SystemClock(),
    getCandidate,
    listCandidateEvidence,
    deleteEvidence,
    deleteGradedAttemptsForEvidence,
    deleteVerificationState,
    deleteAttestationsForEvidence,
    deleteReminderSlot,
    disablePublicProof,
    listFilesForCandidate,
    deleteFileRecord,
    deleteS3Object: (key: string) => deleteObject(evidenceBucket(), key),
    listMatchesForCandidate,
    deleteMatch,
    revokeAllSessions,
    deleteAccount,
    deleteCandidateProfile,
    appendAuditEvent,
    generateId: randomUUID,
  };
}

export function createAwsContactUnlockDependencies(): ContactUnlockDependencies {
  return {
    clock: new SystemClock(),
    getFeatureFlags,
    getRole,
    getMatch,
    getCandidate,
    getEntitlementPlan: async (employerId: string) => {
      const entitlement = await getEntitlement(employerId);
      return entitlement?.plan ?? null;
    },
    // Derived from the subscription rather than read from the entitlement,
    // for the same reason the billing page derives it: a stored access
    // state needs something to wake up and change it the moment a grace
    // window closes, and that something's failure mode is serving paid
    // features to somebody who stopped paying eleven days ago.
    getMarketplaceAccess: async (employerId: string) =>
      deriveAccess(await getBillingSubscription(employerId), new Date()),
    unlockContactAtomic,
    appendAuditEvent,
    countMatchesForRole: async (roleId: string) => (await listMatchesForRole(roleId)).length,
    async notifyCandidateOfUnlock({ email, displayName, roleTitle }) {
      const appOrigin = requireEnv('APP_ORIGIN');
      await sendPlainTextEmail({
        to: email,
        from: requireEnv('REMINDER_FROM_ADDRESS'),
        // Plain and specific. This is a privacy notice, not an announcement.
        subject: 'An employer unlocked your contact details on Zoryvex',
        text: contactUnlockNoticeBody({
          displayName,
          roleTitle,
          settingsUrl: `${appOrigin}/candidate/profile`,
        }),
        ...(process.env.SES_CONFIGURATION_SET_NAME
          ? { configurationSetName: process.env.SES_CONFIGURATION_SET_NAME }
          : {}),
      });
    },
    generateId: randomUUID,
  };
}
