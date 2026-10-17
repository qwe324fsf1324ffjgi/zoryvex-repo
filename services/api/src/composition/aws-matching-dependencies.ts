import { randomUUID } from 'node:crypto';
import { SystemClock } from '../repositories/clock-repository';
import { listAttestationsForEvidence } from '../repositories/peer-attestation-repository';
import { listGradedAttempts } from '../repositories/graded-attempt-repository';
import { getRole } from '../repositories/role-repository';
import { listDiscoveryOptedCandidates } from '../repositories/discovery-repository';
import { listCandidateEvidence } from '../repositories/evidence-repository';
import {
  deleteMatch,
  getMatch,
  listMatchesForRole,
  putMatch,
} from '../repositories/match-repository';
import { getFeatureFlags } from '../repositories/feature-flags-repository';
import { getBillingSubscription } from '../repositories/billing-repository';
import { deriveAccess } from '../domain/billing-state';
import { invokeModelForExplanation } from '../repositories/bedrock-repository';
import type { MatchingDependencies } from '../domain/matching-service';
import type { MatchExplanationDependencies } from '../domain/bedrock-explain-service';
import type { MatchEvidenceDependencies } from '../domain/match-evidence-service';
import {
  profileViewNoticeBody,
  type ProfileViewDependencies,
} from '../domain/profile-view-service';
import { getCandidate } from '../repositories/candidate-repository';
import { getEmployer } from '../repositories/employer-repository';
import { incrementAndCheck } from '../repositories/rate-limit-repository';
import { appendAuditEvent } from '../repositories/audit-event-repository';
import { sendPlainTextEmail } from '../repositories/ses-repository';
import { requireEnv } from '../lib/require-env';

export function createAwsMatchingDependencies(): MatchingDependencies {
  return {
    clock: new SystemClock(),
    getRole,
    listDiscoveryOptedCandidates,
    listCandidateEvidence,
    getMatch,
    putMatch,
    listMatchesForRole,
    deleteMatch,
    getFeatureFlags,
    generateId: randomUUID,
  };
}

export function createAwsMatchExplanationDependencies(): MatchExplanationDependencies {
  return {
    getRole,
    getMatch,
    listCandidateEvidence,
    putMatch,
    getFeatureFlags,
    invokeModelForExplanation,
  };
}

export function createAwsMatchEvidenceDependencies(): MatchEvidenceDependencies {
  return {
    clock: new SystemClock(),
    // Derived from the subscription rather than read from the entitlement,
    // exactly as createAwsContactUnlockDependencies does it. The entitlement
    // row carries a plan name that outlives the money: an organization whose
    // card failed keeps `plan` and loses access, and access is the field
    // that answers this question.
    getMarketplaceAccess: async (employerId: string) =>
      deriveAccess(await getBillingSubscription(employerId), new Date()),
    getRole,
    getMatch,
    listCandidateEvidence,
    listAttestationsForEvidence,
    listGradedAttempts,
  };
}

export function createAwsProfileViewDependencies(): ProfileViewDependencies {
  return {
    clock: new SystemClock(),
    getCandidate,
    getEmployer,
    checkRateLimit: incrementAndCheck,
    appendAuditEvent,
    generateId: randomUUID,

    async notifyCandidateOfView({ email, displayName, organizationName, roleTitle }) {
      const appOrigin = requireEnv('APP_ORIGIN');
      await sendPlainTextEmail({
        to: email,
        from: requireEnv('REMINDER_FROM_ADDRESS'),
        // Names the organisation in the subject, so the recipient can decide
        // from the inbox list whether this is worth opening.
        subject: `${organizationName} looked at your proof on Zoryvex`,
        text: profileViewNoticeBody({
          displayName,
          organizationName,
          roleTitle,
          profileUrl: `${appOrigin}/candidate/profile`,
        }),
        ...(process.env.SES_CONFIGURATION_SET_NAME
          ? { configurationSetName: process.env.SES_CONFIGURATION_SET_NAME }
          : {}),
      });
    },
  };
}
