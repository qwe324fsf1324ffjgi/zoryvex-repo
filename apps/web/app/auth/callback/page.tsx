'use client';

import { useEffect, useRef, useState } from 'react';
import type { AccountRole } from '@zoryvex/contracts';
import { PageHeader, Section } from '@/components/layout/Section';
import { StatusState } from '@/components/ui/StatusState';
import { Card } from '@/components/ui/Card';
import { isRealApiConfigured, realAuth } from '@/lib/real-api';
import type { RealAccount } from '@/lib/real-api/auth';

const ROLE_LABEL: Record<AccountRole, string> = {
  candidate: 'Candidate',
  employer_member: 'Employer team member',
  employer_admin: 'Employer admin',
  founder_admin: 'Founder/admin',
};

type Status = 'consuming' | 'signed-in' | 'invalid-link' | 'failed' | 'not-configured';

/**
 * The real magic-link landing page (ADR 0001): the email links here with
 * the token in the URL fragment, never a path/query string, so it is never
 * sent to the server or logged by API Gateway/CloudFront. Reads it
 * client-side only (static export has no server here), clears the fragment
 * immediately, then consumes it via the same real-api client every other
 * real page in this app uses (services/api/handlers/auth/consume-code.ts).
 *
 * Every role now has somewhere real to land, which was not true when this
 * page was written. The link is offered rather than followed automatically,
 * so the confirmation that the sign-in worked stays on screen: a redirect
 * that lands somewhere unexpected leaves a person unsure whether they are
 * signed in at all.
 *
 * The founder link goes to the admin views rather than to a message saying
 * they are not wired up. Both of them read the real backend, and both need
 * a WebAuthn step-up that this form does not perform, so what a founder
 * sees there is a 403 they can act on rather than a sentence that is no
 * longer true.
 */
export default function AuthCallbackPage() {
  const [status, setStatus] = useState<Status>(
    isRealApiConfigured() ? 'consuming' : 'not-configured',
  );
  const [account, setAccount] = useState<RealAccount | null>(null);
  const ranRef = useRef(false);

  useEffect(() => {
    if (!isRealApiConfigured() || ranRef.current) return;
    ranRef.current = true;

    const match = /^#token=(.+)$/.exec(window.location.hash);
    window.history.replaceState(null, '', window.location.pathname + window.location.search);

    const capturedToken = match?.[1];
    if (!capturedToken) {
      setStatus('invalid-link');
      return;
    }
    const token = decodeURIComponent(capturedToken);

    realAuth
      .consumeSignInToken(token)
      .then((result) => {
        setAccount(result.account);
        setStatus('signed-in');
      })
      .catch(() => {
        setStatus('failed');
      });
  }, []);

  if (status === 'consuming') {
    return (
      <main id="main-content" tabIndex={-1} className="outline-none">
        <Section className="max-w-md">
          <p role="status" aria-live="polite">
            Signing you in…
          </p>
        </Section>
      </main>
    );
  }

  if (status === 'signed-in' && account) {
    return (
      <main id="main-content" tabIndex={-1} className="outline-none">
        <Section className="max-w-md">
          <PageHeader title="You're signed in" />
          <Card role="status" aria-live="polite">
            <p className="font-semibold text-ink-950">Real account, real session</p>
            <p className="mt-1 text-sm text-ink-700">Signed in as {account.email}.</p>
            <p className="mt-1 text-sm text-ink-700">Role: {ROLE_LABEL[account.role]}.</p>
            {account.role === 'candidate' ? (
              <a
                href="/candidate/profile"
                className="mt-4 inline-block text-sm font-medium underline"
              >
                Continue to your profile
              </a>
            ) : account.role === 'employer_admin' || account.role === 'employer_member' ? (
              // The roles list, not the new-role form. Signing in is not the
              // same as wanting to start something new, and an employer who
              // already has roles was being sent past all of them into a
              // blank form.
              <a href="/employer" className="mt-4 inline-block text-sm font-medium underline">
                Continue to your roles
              </a>
            ) : (
              <a href="/admin" className="mt-4 inline-block text-sm font-medium underline">
                Continue to the admin views
              </a>
            )}
          </Card>
        </Section>
      </main>
    );
  }

  return (
    <main id="main-content" tabIndex={-1} className="outline-none">
      <Section className="max-w-md">
        <PageHeader title="Sign-in link invalid or expired" />
        <StatusState
          kind="500"
          title="This sign-in link no longer works"
          body={
            status === 'not-configured'
              ? 'No real API is configured for this build.'
              : status === 'invalid-link'
                ? 'This link is missing its sign-in token. Copy the full link from the email, or request a new one.'
                : 'Sign-in links expire after 10 minutes and can only be used once. Request a new one and try again.'
          }
          action={
            <a href="/sign-in" className="text-sm font-medium underline">
              Back to sign in
            </a>
          }
        />
      </Section>
    </main>
  );
}
