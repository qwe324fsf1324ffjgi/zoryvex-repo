import { randomUUID } from 'node:crypto';
import type { Account } from '@zoryvex/contracts';
import type { AuthDependencies } from '../domain/auth-service';
import { SystemClock } from '../repositories/clock-repository';
import { getAuthTokenPepper } from '../repositories/ssm-secure-repository';
import { getAccountByEmail, createAccountIfNotExists } from '../repositories/account-repository';
import { createCandidateProfile } from '../repositories/candidate-repository';
import { createEmployerProfile } from '../repositories/employer-repository';
import {
  createAuthToken as createAuthTokenRecord,
  consumeAuthToken as consumeAuthTokenRecord,
} from '../repositories/auth-token-repository';
import {
  createSession as createSessionRecord,
  getSession as getSessionRecord,
  rotateSessionCsrfToken as rotateSessionCsrfTokenRecord,
  deleteSession as deleteSessionRecord,
  revokeAllSessions as revokeAllSessionsRecord,
} from '../repositories/session-repository';
import { incrementAndCheck } from '../repositories/rate-limit-repository';
import { sendPlainTextEmail } from '../repositories/ses-repository';
import { organizationNameFromEmail } from '../lib/organization-name';

function displayNameFromEmail(email: string): string {
  const localPart = email.split('@')[0] ?? 'there';
  return localPart.charAt(0).toUpperCase() + localPart.slice(1);
}

async function createCandidateAccountAndProfile(input: { email: string }): Promise<Account> {
  const candidateId = randomUUID();
  const now = new Date().toISOString();
  // launchTrack is a required CandidateSchema field but not yet known at
  // sign-up time — onboarding (apps/web) must prompt for and correct this
  // immediately; onboardingComplete stays false until it does.
  await createCandidateProfile({
    candidateId,
    email: input.email,
    displayName: displayNameFromEmail(input.email),
    launchTrack: 'aws_cloud',
    createdAt: now,
  });
  return createAccountIfNotExists({
    id: candidateId,
    email: input.email,
    role: 'candidate',
    candidateId,
    createdAt: now,
  });
}

async function createEmployerAdminAccountAndProfile(input: { email: string }): Promise<Account> {
  const employerId = randomUUID();
  const now = new Date().toISOString();
  await createEmployerProfile({
    employerId,
    // Named from the domain, not the person: this string is emailed to every
    // candidate whose proof this employer opens. See lib/organization-name.
    organizationName: organizationNameFromEmail(input.email),
    contactEmail: input.email,
    createdAt: now,
  });
  return createAccountIfNotExists({
    id: employerId,
    email: input.email,
    role: 'employer_admin',
    employerId,
    createdAt: now,
  });
}

export function createAwsAuthDependencies(): AuthDependencies {
  return {
    clock: new SystemClock(),
    getAuthTokenPepper,
    getAccountByEmail,
    createCandidateAccountAndProfile,
    createEmployerAdminAccountAndProfile,
    createAuthToken: createAuthTokenRecord,
    consumeAuthToken: consumeAuthTokenRecord,
    createSession: createSessionRecord,
    getSession: getSessionRecord,
    rotateSessionCsrfToken: rotateSessionCsrfTokenRecord,
    deleteSession: deleteSessionRecord,
    revokeAllSessions: revokeAllSessionsRecord,
    checkRateLimit: incrementAndCheck,
    async sendSignInEmail(input) {
      const from = process.env.SIGN_IN_EMAIL_FROM;
      if (!from) throw new Error('SIGN_IN_EMAIL_FROM environment variable is not set');
      await sendPlainTextEmail({
        to: input.to,
        from,
        subject: 'Sign in to Zoryvex',
        text: `Click this link to sign in (expires in 10 minutes, works once): ${input.magicLinkUrl}\n\nIf you did not request this, you can ignore this email.`,
        configurationSetName: process.env.SES_CONFIGURATION_SET_NAME,
      });
    },
  };
}
