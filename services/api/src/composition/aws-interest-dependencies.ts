import { randomUUID } from 'node:crypto';
import { SystemClock } from '../repositories/clock-repository';
import { getRole } from '../repositories/role-repository';
import {
  getMatch,
  listMatchesForCandidate,
  updateMatchInterest,
} from '../repositories/match-repository';
import { appendAuditEvent } from '../repositories/audit-event-repository';
import { getCandidate } from '../repositories/candidate-repository';
import { getEmployer } from '../repositories/employer-repository';
import { incrementAndCheck } from '../repositories/rate-limit-repository';
import { getBillingSubscription } from '../repositories/billing-repository';
import { deriveAccess } from '../domain/billing-state';
import { sendPlainTextEmail } from '../repositories/ses-repository';
import { requireEnv } from '../lib/require-env';
import { interestNoticeBody, type InterestDependencies } from '../domain/interest-service';

/**
 * Wires the mutual-interest domain to DynamoDB and SES.
 *
 * Nothing here decides anything. Who may write which side of a match, what
 * silence means, and when a candidate is told, live in interest-service and
 * are tested without AWS anywhere near them.
 */
export function createAwsInterestDependencies(): InterestDependencies {
  return {
    clock: new SystemClock(),
    getRole,
    getMatch,
    listMatchesForCandidate,
    updateMatchInterest,
    appendAuditEvent,
    generateId: () => randomUUID(),
    getCandidate,
    getEmployer,
    checkRateLimit: incrementAndCheck,
    // Derived from the subscription rather than read from the entitlement,
    // exactly as contact unlock and the evidence gate do it. The entitlement
    // row carries a plan name that outlives the money.
    getMarketplaceAccess: async (employerId: string) =>
      deriveAccess(await getBillingSubscription(employerId), new Date()),

    async notifyCandidateOfInterest({ email, displayName, organizationName, roleTitle }) {
      const appOrigin = requireEnv('APP_ORIGIN');
      await sendPlainTextEmail({
        to: email,
        from: requireEnv('REMINDER_FROM_ADDRESS'),
        // Names the organisation in the subject, so the recipient can decide
        // from the inbox list whether this is worth opening. The same shape
        // the profile-view notice already uses.
        subject: `${organizationName} is interested in you on Zoryvex`,
        text: interestNoticeBody({
          displayName,
          organizationName,
          roleTitle,
          matchesUrl: `${appOrigin}/candidate/matches`,
          profileUrl: `${appOrigin}/candidate/profile`,
        }),
      });
    },
  };
}
