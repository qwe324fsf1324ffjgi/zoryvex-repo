import { beforeEach, describe, expect, it } from 'vitest';
import { LocalAuthAdapter } from '../src/local/local-auth-adapter';
import { LocalEmailAdapter } from '../src/local/local-email-adapter';
import { LocalDataAdapter } from '../src/local/local-data-adapter';
import type { AuthAccount } from '../src/interfaces/auth';
import type { SentEmail } from '../src/interfaces/email';

const accounts: AuthAccount[] = [
  { id: 'acct_1', email: 'known@example.com', role: 'candidate', candidateId: 'cand_1' },
  { id: 'acct_admin', email: 'founder@example.com', role: 'admin' },
];

beforeEach(() => {
  window.localStorage.clear();
});

function extractCode(bodyPreview: string): string {
  const match = bodyPreview.match(/code is (\d{6})/);
  const code = match?.[1];
  if (!code) throw new Error('code not found in email body');
  return code;
}

function firstSent(email: LocalEmailAdapter): SentEmail {
  const sent = email.listSent()[0];
  if (!sent) throw new Error('no email was sent');
  return sent;
}

function makeAuth(seeded: AuthAccount[] = accounts) {
  const email = new LocalEmailAdapter();
  const data = new LocalDataAdapter();
  const auth = new LocalAuthAdapter(seeded, email, data);
  return { auth, email, data };
}

describe('LocalAuthAdapter', () => {
  it('always sends a code, for both a known and an unknown email (enumeration-resistant)', () => {
    const { auth, email } = makeAuth();
    expect(auth.requestCode('known@example.com', 'candidate')).toEqual({ sent: true });
    expect(auth.requestCode('unknown@example.com', 'candidate')).toEqual({ sent: true });
    expect(email.listSent()).toHaveLength(2);
  });

  it('verifies the correct code for an existing account and issues a session', () => {
    const { auth, email } = makeAuth();
    auth.requestCode('known@example.com', 'candidate');
    const code = extractCode(firstSent(email).bodyPreview);

    const session = auth.verifyCode('known@example.com', code);
    expect(session?.candidateId).toBe('cand_1');
    expect(auth.getSession()?.candidateId).toBe('cand_1');
  });

  it('verifying a code for an unknown email creates a real new account (sign-up)', () => {
    const { auth, email, data } = makeAuth();
    auth.requestCode('new-candidate@example.com', 'candidate');
    const code = extractCode(firstSent(email).bodyPreview);

    const session = auth.verifyCode('new-candidate@example.com', code);
    expect(session?.role).toBe('candidate');
    expect(session?.candidateId).toBeTruthy();
    const candidate = data.getCandidate(session!.candidateId!);
    expect(candidate?.email).toBe('new-candidate@example.com');
    expect(candidate?.onboardingComplete).toBe(false);
  });

  it('signing up as an employer creates an employer profile and a none-plan entitlement', () => {
    const { auth, email, data } = makeAuth();
    auth.requestCode('new-employer@example.com', 'employer');
    const code = extractCode(firstSent(email).bodyPreview);

    const session = auth.verifyCode('new-employer@example.com', code);
    expect(session?.role).toBe('employer');
    const employer = data.getEmployer(session!.employerId!);
    expect(employer?.contactEmail).toBe('new-employer@example.com');
    expect(data.getEntitlement(session!.employerId!)?.plan).toBe('none');
  });

  it('signing up with the same email twice reuses the same account, not a second one', () => {
    const { auth, email } = makeAuth();
    auth.requestCode('repeat@example.com', 'candidate');
    const firstSession = auth.verifyCode(
      'repeat@example.com',
      extractCode(firstSent(email).bodyPreview),
    );
    auth.signOut();

    auth.requestCode('repeat@example.com', 'candidate');
    const sentAgain = email.listSent();
    const secondCode = sentAgain[sentAgain.length - 1]?.bodyPreview ?? '';
    const secondSession = auth.verifyCode('repeat@example.com', extractCode(secondCode));

    expect(secondSession?.candidateId).toBe(firstSession?.candidateId);
  });

  it('rejects a wrong code', () => {
    const { auth } = makeAuth();
    auth.requestCode('known@example.com', 'candidate');
    expect(auth.verifyCode('known@example.com', '000000')).toBeNull();
  });

  it('the code is single-use', () => {
    const { auth, email } = makeAuth();
    auth.requestCode('known@example.com', 'candidate');
    const code = extractCode(firstSent(email).bodyPreview);

    expect(auth.verifyCode('known@example.com', code)).not.toBeNull();
    auth.signOut();
    expect(auth.verifyCode('known@example.com', code)).toBeNull();
  });

  it('signOut clears the session', () => {
    const { auth, email } = makeAuth();
    auth.requestCode('known@example.com', 'candidate');
    const code = extractCode(firstSent(email).bodyPreview);
    auth.verifyCode('known@example.com', code);
    auth.signOut();
    expect(auth.getSession()).toBeNull();
  });

  describe('admin accounts are pre-provisioned only', () => {
    it('verifies a pre-provisioned admin email and issues an admin session', () => {
      const { auth, email } = makeAuth();
      auth.requestCode('founder@example.com', 'admin');
      const code = extractCode(firstSent(email).bodyPreview);

      const session = auth.verifyCode('founder@example.com', code);
      expect(session?.role).toBe('admin');
      expect(session?.employerId).toBeUndefined();
      expect(session?.candidateId).toBeUndefined();
    });

    it('never self-serve-creates an admin account for an unrecognized email', () => {
      const { auth, email, data } = makeAuth();
      auth.requestCode('not-the-founder@example.com', 'admin');
      const code = extractCode(firstSent(email).bodyPreview);

      expect(auth.verifyCode('not-the-founder@example.com', code)).toBeNull();
      expect(data.listAllEmployers()).toHaveLength(0);
      expect(data.listAllCandidates()).toHaveLength(0);
    });

    it('rejecting an unrecognized admin email returns the same null a wrong code would', () => {
      const { auth: auth1, email: email1 } = makeAuth();
      auth1.requestCode('known@example.com', 'admin');
      const wrongCodeResult = auth1.verifyCode('known@example.com', '000000');
      expect(email1.listSent()).toHaveLength(1); // a code was still sent either way

      const { auth: auth2, email: email2 } = makeAuth();
      auth2.requestCode('not-the-founder@example.com', 'admin');
      const correctCode = extractCode(firstSent(email2).bodyPreview);
      const unrecognizedAdminResult = auth2.verifyCode('not-the-founder@example.com', correctCode);

      expect(wrongCodeResult).toBeNull();
      expect(unrecognizedAdminResult).toBeNull();
    });
  });
});
