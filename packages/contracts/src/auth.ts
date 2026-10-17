import { z } from 'zod';

/**
 * Auth/session domain schemas per docs/adr/0001-no-cognito-passwordless-email-auth.md
 * and docs/DATA_MODEL.md. Roles are server-issued only — nothing here is ever
 * accepted from a client request body; the client cannot select or elevate a
 * role. `employer_member`/`employer_admin` distinguish org-level permissions
 * (e.g. billing actions require `employer_admin`); `founder_admin` is
 * pre-provisioned only, never created via self-serve sign-up.
 */
export const AccountRoleSchema = z.enum([
  'candidate',
  'employer_member',
  'employer_admin',
  'founder_admin',
]);
export type AccountRole = z.infer<typeof AccountRoleSchema>;

export const AccountSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  role: AccountRoleSchema,
  candidateId: z.string().optional(),
  employerId: z.string().optional(),
  createdAt: z.string().datetime(),
});
export type Account = z.infer<typeof AccountSchema>;

/**
 * Server-side session record shape. `id` here is the *plaintext* session
 * identifier only inside a freshly-issued Session value returned once to the
 * caller that creates it (to set the cookie) — the DynamoDB item behind it
 * stores only a keyed hash, never this value, per ADR 0001.
 */
export const SessionSchema = z.object({
  id: z.string(),
  accountId: z.string(),
  role: AccountRoleSchema,
  candidateId: z.string().optional(),
  employerId: z.string().optional(),
  csrfToken: z.string(),
  issuedAt: z.string().datetime(),
  idleExpiresAt: z.string().datetime(),
  absoluteExpiresAt: z.string().datetime(),
});
export type Session = z.infer<typeof SessionSchema>;

/**
 * The authorizer context handed to downstream handlers by API Gateway after
 * a successful REQUEST-authorizer lookup. Every handler still performs its
 * own server-side tenant/resource check against this — it is never treated
 * as sufficient authorization by itself (ADR 0001).
 */
export const SessionContextSchema = z.object({
  accountId: z.string(),
  email: z.string().email(),
  role: AccountRoleSchema,
  candidateId: z.string().optional(),
  employerId: z.string().optional(),
  /**
   * Set only once a founder_admin session has completed a WebAuthn step-up
   * ceremony (handlers/auth/webauthn-step-up-verify.ts) — absent for every
   * other role and for a founder_admin session that hasn't stepped up yet.
   * Sensitive admin handlers additionally check this is recent (see
   * requireFounderStepUp), not just present, so step-up privilege doesn't
   * last for the entire 12-hour session.
   */
  stepUpVerifiedAt: z.string().datetime().optional(),
});
export type SessionContext = z.infer<typeof SessionContextSchema>;

export const AuthTokenPurposeSchema = z.enum(['sign_in']);
export type AuthTokenPurpose = z.infer<typeof AuthTokenPurposeSchema>;
