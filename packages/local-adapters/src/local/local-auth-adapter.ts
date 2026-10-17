import type { AccountRole, AuthAccount, AuthAdapter, Session } from '../interfaces/auth';
import type { EmailAdapter } from '../interfaces/email';
import type { DataAdapter } from '../interfaces/data';
import { getJSON, setJSON, store } from './storage';

const SESSION_KEY = 'AUTH#SESSION';
const DYNAMIC_ACCOUNTS_KEY = 'AUTH#ACCOUNTS#DYNAMIC';
const CODE_TTL_MS = 10 * 60 * 1000; // 10 minutes, matches docs/THREAT_MODEL.md's expiry

interface PendingCode {
  code: string;
  expiresAt: number;
  intendedRole: 'candidate' | 'employer' | 'admin';
}

function pendingCodeKey(email: string): string {
  return `AUTH#CODE#${email.toLowerCase()}`;
}

function generateCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function newId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export class LocalAuthAdapter implements AuthAdapter {
  constructor(
    private readonly seededAccounts: AuthAccount[],
    private readonly email: EmailAdapter,
    private readonly data: DataAdapter,
  ) {}

  private dynamicAccounts(): AuthAccount[] {
    return getJSON<AuthAccount[]>(DYNAMIC_ACCOUNTS_KEY) ?? [];
  }

  private findAccount(email: string): AuthAccount | undefined {
    const all = [...this.seededAccounts, ...this.dynamicAccounts()];
    return all.find((a) => a.email.toLowerCase() === email.toLowerCase());
  }

  requestCode(email: string, intendedRole: 'candidate' | 'employer' | 'admin'): { sent: true } {
    const code = generateCode();
    setJSON<PendingCode>(pendingCodeKey(email), {
      code,
      expiresAt: Date.now() + CODE_TTL_MS,
      intendedRole,
    });
    this.email.send(
      email,
      'Your Zoryvex sign-in code',
      `Your sign-in code is ${code}. It expires in 10 minutes. (Local demo — no real email sent.)`,
    );
    return { sent: true };
  }

  verifyCode(email: string, code: string): Session | null {
    const pending = getJSON<PendingCode>(pendingCodeKey(email));
    if (!pending || pending.expiresAt < Date.now() || pending.code !== code) return null;

    store.delete(pendingCodeKey(email)); // single-use

    let account = this.findAccount(email);
    if (!account) {
      // Admin accounts are pre-provisioned only — never self-serve-created.
      // Returning null here is indistinguishable from a wrong/expired code.
      if (pending.intendedRole === 'admin') return null;
      account = this.createAccount(email, pending.intendedRole);
    }

    const session: Session = {
      accountId: account.id,
      role: account.role as AccountRole,
      issuedAt: new Date().toISOString(),
      ...(account.candidateId !== undefined ? { candidateId: account.candidateId } : {}),
      ...(account.employerId !== undefined ? { employerId: account.employerId } : {}),
    };
    setJSON(SESSION_KEY, session);
    return session;
  }

  private createAccount(email: string, role: 'candidate' | 'employer'): AuthAccount {
    const now = new Date().toISOString();
    const account: AuthAccount =
      role === 'candidate'
        ? { id: newId('acct'), email, role, candidateId: newId('cand') }
        : { id: newId('acct'), email, role, employerId: newId('emp') };

    if (role === 'candidate' && account.candidateId) {
      this.data.upsertCandidate({
        id: account.candidateId,
        email,
        displayName: email.split('@')[0] ?? 'New candidate',
        launchTrack: 'aws_cloud',
        discoveryOptIn: false,
        onboardingComplete: false,
        summary: '',
        createdAt: now,
        updatedAt: now,
      });
    } else if (role === 'employer' && account.employerId) {
      this.data.upsertEmployer({
        id: account.employerId,
        organizationName: 'New organization',
        contactEmail: email,
        createdAt: now,
      });
      this.data.upsertEntitlement({
        employerId: account.employerId,
        plan: 'none',
        status: 'none',
        kitPurchasedAt: null,
        subscriptionRenewsAt: null,
        // Signing up does not take a founding place. A place is claimed by
        // subscribing, not by creating an account, or twenty-five curious
        // visitors would exhaust the founding tier without paying anything.
        priceNGN: null,
        foundingMember: false,
      });
    }

    const dynamic = this.dynamicAccounts();
    dynamic.push(account);
    setJSON(DYNAMIC_ACCOUNTS_KEY, dynamic);
    return account;
  }

  getSession(): Session | null {
    return getJSON<Session>(SESSION_KEY);
  }

  signOut(): void {
    store.delete(SESSION_KEY);
  }
}
