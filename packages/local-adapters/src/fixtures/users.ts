import type { AuthAccount } from '../interfaces/auth';

/**
 * FICTIONAL TEST ACCOUNTS for local sign-in. Not real people. The admin
 * account represents the founder signing into the same app with an admin
 * role — never a separate service or account (CLAUDE.md).
 */
export const AUTH_ACCOUNTS: AuthAccount[] = [
  {
    id: 'acct_amara',
    email: 'amara.demo@example.com',
    role: 'candidate',
    candidateId: 'cand_amara',
  },
  {
    id: 'acct_ngozi',
    email: 'ngozi.demo@example.com',
    role: 'candidate',
    candidateId: 'cand_ngozi',
  },
  {
    id: 'acct_northwind',
    email: 'hiring.demo@example.com',
    role: 'employer',
    employerId: 'emp_northwind',
  },
  { id: 'acct_delta', email: 'talent.demo@example.com', role: 'employer', employerId: 'emp_delta' },
  { id: 'acct_admin', email: 'founder.demo@example.com', role: 'admin' },
];
