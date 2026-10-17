'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { getLocalAdapters } from '@zoryvex/local-adapters';
import type { Employer } from '@zoryvex/contracts';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { StatusState } from '@/components/ui/StatusState';
import { PageHeader, Section } from '@/components/layout/Section';
import { useToast } from '@/components/ui/Toast';
import { useSession } from '@/lib/use-session';
import { isRealApiConfigured } from '@/lib/real-api';

const MAX_INVITES_PER_BATCH = 5;

export default function EmployerOnboardingPage() {
  const session = useSession();
  const router = useRouter();
  const { showToast } = useToast();
  const useReal = isRealApiConfigured();
  const [employer, setEmployer] = useState<Employer | null>(null);
  const [orgName, setOrgName] = useState('');
  const [inviteEmails, setInviteEmails] = useState('');
  const [rateLimited, setRateLimited] = useState(false);

  useEffect(() => {
    if (!session?.employerId || useReal) return;
    setEmployer(getLocalAdapters().data.getEmployer(session.employerId));
  }, [session, useReal]);

  useEffect(() => {
    if (employer) setOrgName(employer.organizationName);
  }, [employer]);

  // No real backend yet for org-name editing or team invites (employer_member
  // creation is an explicitly documented follow-up, see
  // services/api/src/repositories/account-repository.ts) — this page is also
  // unreachable from any current in-app link, so this only matters for a
  // direct URL visit. Redirect rather than show a fake-success form.
  useEffect(() => {
    if (useReal) router.replace('/employer');
  }, [useReal, router]);

  // Says what is happening instead of rendering nothing.
  //
  // The landmark was never missing here - the layout wraps children in
  // <main id="main-content"> - so returning null gave an empty main rather
  // than a page without one, and the skip link always worked. What was
  // missing is any indication of what is going on: an empty region
  // announces nothing to somebody who cannot see the URL change. RoleGuard
  // words its own redirect for the same reason.
  if (useReal) {
    return (
      <Section className="max-w-2xl">
        <p role="status" aria-live="polite">
          Taking you back to your roles…
        </p>
      </Section>
    );
  }

  function handleSaveOrg(event: FormEvent) {
    event.preventDefault();
    if (!employer) return;
    getLocalAdapters().data.upsertEmployer({ ...employer, organizationName: orgName });
    showToast('Organization details saved.', 'success');
    router.push('/employer');
  }

  function handleInvite(event: FormEvent) {
    event.preventDefault();
    setRateLimited(false);
    const emails = inviteEmails
      .split(/[\n,]/)
      .map((e) => e.trim())
      .filter(Boolean);

    if (emails.length > MAX_INVITES_PER_BATCH) {
      setRateLimited(true);
      return;
    }

    const { email } = getLocalAdapters();
    for (const address of emails) {
      email.send(
        address,
        `You're invited to ${orgName || 'a Zoryvex organization'}`,
        'A team member invited you to their Zoryvex organization. (Local demo. No real email sent.)',
      );
    }
    setInviteEmails('');
    showToast(`Invited ${emails.length} teammate(s).`, 'success');
  }

  if (!employer) return null;

  return (
    <Section className="max-w-2xl">
      <PageHeader title="Set up your organization" />

      <form onSubmit={handleSaveOrg} className="flex flex-col gap-4">
        <Input
          id="org-name"
          label="Organization name"
          value={orgName}
          onChange={(e) => setOrgName(e.target.value)}
          required
        />
        <Button type="submit" className="self-start">
          Save and continue
        </Button>
      </form>

      <h2 className="mb-3 mt-10 text-xl font-bold text-ink-950">Invite teammates</h2>
      <form onSubmit={handleInvite} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="invite-emails" className="text-sm font-medium text-ink-950">
            Email addresses
          </label>
          <p className="text-sm text-ink-700">
            One per line or comma-separated. Up to {MAX_INVITES_PER_BATCH} at a time.
          </p>
          <textarea
            id="invite-emails"
            value={inviteEmails}
            onChange={(e) => setInviteEmails(e.target.value)}
            rows={3}
            className="w-full rounded-md border border-ink-500 bg-warm-50 px-3 py-2 text-ink-950"
          />
        </div>
        {rateLimited && (
          <StatusState
            kind="429"
            body={`Invite up to ${MAX_INVITES_PER_BATCH} teammates per batch. Remove some and try again.`}
          />
        )}
        <Button type="submit" variant="secondary" className="self-start">
          Send invites
        </Button>
      </form>
    </Section>
  );
}
