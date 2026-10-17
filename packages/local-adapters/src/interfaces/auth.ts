export type AccountRole = 'candidate' | 'employer' | 'admin';

export interface AuthAccount {
  id: string;
  email: string;
  role: AccountRole;
  candidateId?: string;
  employerId?: string;
}

export interface Session {
  accountId: string;
  role: AccountRole;
  candidateId?: string;
  employerId?: string;
  issuedAt: string;
}

export interface AuthAdapter {
  /**
   * Always resolves the same way whether or not the email matches an
   * account (mirrors docs/THREAT_MODEL.md's enumeration-resistance rule) —
   * a code is sent either way, since any email can self-serve sign up.
   * `intendedRole` only matters if this becomes a brand-new account.
   */
  requestCode(email: string, intendedRole: 'candidate' | 'employer' | 'admin'): { sent: true };
  /**
   * Verifies the code. If the email has no existing account, creates one
   * with the role requested at requestCode time (real sign-up, not just
   * sign-in) and returns the new session — except for `intendedRole:
   * 'admin'`, which never self-serve-creates (admin accounts are
   * pre-provisioned only, per docs/THREAT_MODEL.md's founder/admin account
   * takeover row) and returns null instead, indistinguishable from a wrong
   * code so an attacker can't use this to enumerate admin emails.
   */
  verifyCode(email: string, code: string): Session | null;
  getSession(): Session | null;
  signOut(): void;
}
