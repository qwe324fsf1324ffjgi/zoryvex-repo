import { describe, expect, it } from 'vitest';
import { AccountRoleSchema, AccountSchema, SessionSchema, SessionContextSchema } from '../src/auth';

describe('AccountRoleSchema', () => {
  it('accepts exactly the four server-issued roles', () => {
    for (const role of ['candidate', 'employer_member', 'employer_admin', 'founder_admin']) {
      expect(AccountRoleSchema.safeParse(role).success).toBe(true);
    }
  });

  it('rejects a client-invented role', () => {
    expect(AccountRoleSchema.safeParse('super_admin').success).toBe(false);
  });

  it('rejects the pre-Phase-7 local-adapters role names', () => {
    // packages/local-adapters used a 3-value role set (candidate/employer/admin)
    // before Phase 7's server-issued 4-role model; a stray old value must not
    // silently validate against the new schema.
    expect(AccountRoleSchema.safeParse('employer').success).toBe(false);
    expect(AccountRoleSchema.safeParse('admin').success).toBe(false);
  });
});

describe('AccountSchema', () => {
  it('accepts a candidate account', () => {
    const result = AccountSchema.safeParse({
      id: 'acct_1',
      email: 'candidate@example.com',
      role: 'candidate',
      candidateId: 'cand_1',
      createdAt: new Date().toISOString(),
    });
    expect(result.success).toBe(true);
  });

  it('accepts a founder_admin account with no candidateId/employerId', () => {
    const result = AccountSchema.safeParse({
      id: 'acct_admin',
      email: 'founder@example.com',
      role: 'founder_admin',
      createdAt: new Date().toISOString(),
    });
    expect(result.success).toBe(true);
  });

  it('rejects a malformed email', () => {
    const result = AccountSchema.safeParse({
      id: 'acct_1',
      email: 'not-an-email',
      role: 'candidate',
      createdAt: new Date().toISOString(),
    });
    expect(result.success).toBe(false);
  });
});

describe('SessionSchema / SessionContextSchema', () => {
  const now = new Date();
  const later = new Date(now.getTime() + 60_000);

  it('accepts a well-formed session', () => {
    const result = SessionSchema.safeParse({
      id: 'sess_1',
      accountId: 'acct_1',
      role: 'employer_admin',
      employerId: 'emp_1',
      csrfToken: 'csrf_1',
      issuedAt: now.toISOString(),
      idleExpiresAt: later.toISOString(),
      absoluteExpiresAt: later.toISOString(),
    });
    expect(result.success).toBe(true);
  });

  it('accepts a session-context subset with no csrfToken/timestamps', () => {
    const result = SessionContextSchema.safeParse({
      accountId: 'acct_1',
      email: 'candidate@example.com',
      role: 'candidate',
      candidateId: 'cand_1',
    });
    expect(result.success).toBe(true);
  });

  it('rejects a session missing csrfToken', () => {
    const result = SessionSchema.safeParse({
      id: 'sess_1',
      accountId: 'acct_1',
      role: 'candidate',
      issuedAt: now.toISOString(),
      idleExpiresAt: later.toISOString(),
      absoluteExpiresAt: later.toISOString(),
    });
    expect(result.success).toBe(false);
  });
});
