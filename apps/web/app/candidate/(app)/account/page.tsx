'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getLocalAdapters } from '@zoryvex/local-adapters';
import type { Candidate, Match } from '@zoryvex/contracts';
import { Button, ButtonLink } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Dialog } from '@/components/ui/Dialog';
import { PageHeader, Section } from '@/components/layout/Section';
import { StatusState } from '@/components/ui/StatusState';
import { useSession } from '@/lib/use-session';
import { useToast } from '@/components/ui/Toast';
import { downloadJson } from '@/lib/download-file';
import { retryWithBackoff } from '@/lib/retry-with-backoff';
import { PageLoading } from '@/components/ui/PageLoading';
import {
  isRealApiConfigured,
  messageFor,
  realAuth,
  realCandidateProfile,
  realPrivacy,
} from '@/lib/real-api';

export default function AccountPage() {
  const session = useSession();
  const router = useRouter();
  const { showToast } = useToast();
  const useReal = isRealApiConfigured();
  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const [unlockedMatches, setUnlockedMatches] = useState<Match[]>([]);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);

  const loadCandidate = useCallback(() => {
    if (!session?.candidateId) return;

    if (useReal) {
      setLoadFailed(false);
      retryWithBackoff(() => realCandidateProfile.getProfile())
        .then(({ candidate: found }) => setCandidate(found))
        .catch(() => setLoadFailed(true));
      return;
    }

    const { data } = getLocalAdapters();
    setCandidate(data.getCandidate(session.candidateId));
    setUnlockedMatches(
      data.listMatchesForCandidate(session.candidateId).filter((m) => m.contactUnlocked),
    );
  }, [session, useReal]);

  useEffect(loadCandidate, [loadCandidate]);

  async function handleExport() {
    if (!session?.candidateId) return;

    if (useReal) {
      try {
        downloadJson('zoryvex-my-data.json', await realPrivacy.exportData());
        showToast('Your data export has started downloading.', 'success');
      } catch (error) {
        showToast(
          messageFor(error, 'Something went wrong exporting your data. Try again.'),
          'error',
        );
      }
      return;
    }

    const exported = getLocalAdapters().data.exportCandidateData(session.candidateId);
    if (!exported) return;
    downloadJson('zoryvex-my-data.json', exported);
    showToast('Your data export has started downloading.', 'success');
  }

  async function handleDelete() {
    if (!session?.candidateId) return;

    if (useReal) {
      setDeleting(true);
      try {
        // Real deletion is asynchronous (a queued worker, not an in-request
        // delete) — sign out immediately since the session/account are gone
        // either way, and be honest that the rest may take a few minutes.
        await realPrivacy.requestDeletion();
        await realAuth.signOut();
        showToast('Deletion requested. This finishes within a few minutes.', 'success');
        router.replace('/');
      } catch (error) {
        showToast(
          messageFor(error, 'Something went wrong requesting deletion. Try again.'),
          'error',
        );
      } finally {
        setDeleting(false);
      }
      return;
    }

    const { data, auth } = getLocalAdapters();
    // Deletion is instant and self-serve (never a founder-approval queue —
    // it's the candidate's own data and their right) but is still recorded
    // as a compliance-audit event so the founder/admin view has real
    // evidence deletions actually happened, not just faith that they did.
    data.appendAuditEvent({
      id: `audit_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      actorId: session.candidateId,
      actorRole: 'candidate',
      action: 'account_deleted',
      targetType: 'candidate',
      targetId: session.candidateId,
      createdAt: new Date().toISOString(),
    });
    data.deleteCandidate(session.candidateId);
    auth.signOut();
    router.replace('/');
  }

  if (!candidate) {
    if (loadFailed) {
      return (
        <Section className="max-w-md">
          <StatusState
            kind="500"
            action={
              <Button variant="secondary" onClick={loadCandidate}>
                Try again
              </Button>
            }
          />
        </Section>
      );
    }
    return (
      <Section className="max-w-2xl">
        <PageLoading blocks={4} />
      </Section>
    );
  }

  return (
    <Section className="max-w-2xl">
      <PageHeader title="Account" />

      <div className="flex flex-col gap-6">
        <Card>
          <h2 className="font-semibold text-ink-950">Contact-unlock activity</h2>
          <p className="mt-1 text-sm text-ink-700">
            {useReal
              ? 'You are emailed whenever an employer unlocks your contact details, and the full list is in your data download below.'
              : unlockedMatches.length === 0
                ? 'No employer has unlocked your contact details yet.'
                : `${unlockedMatches.length} employer(s) have unlocked your contact details.`}
          </p>
        </Card>

        {/*
          This card used to advertise an authenticator app as "planned but not
          yet available" behind a permanently disabled button reading "(coming
          soon)". A dead control is worse than no control: it draws the eye,
          invites a click, and its only message is that the product is
          unfinished. Nothing was planned closely enough to promise, either.

          What is true is more reassuring than what was promised, so the card
          now says that instead. There is no password on the account at all,
          which removes the entire category of attack a second factor exists to
          cover.
        */}
        <Card>
          <h2 className="font-semibold text-ink-950">How you sign in</h2>
          <p className="mt-1 text-sm text-ink-700">
            Your account has no password, so there is nothing to guess, reuse or leak.{' '}
            {useReal
              ? 'Every session starts from a one-time link emailed to you, which expires after 10 minutes and works once.'
              : 'Every session starts from a one-time email code. A real build expires it after 10 minutes and accepts it once.'}
          </p>
        </Card>

        <Card>
          <h2 className="font-semibold text-ink-950">Your data</h2>
          <p className="mt-1 text-sm text-ink-700">
            Download everything Zoryvex holds about you as JSON, or permanently delete your account.
          </p>
          <div className="mt-3 flex gap-3">
            <Button variant="secondary" onClick={() => void handleExport()}>
              Download my data
            </Button>
            <Button variant="secondary" onClick={() => setDeleteDialogOpen(true)}>
              Delete my account
            </Button>
          </div>
        </Card>

        <Card>
          <h2 className="font-semibold text-ink-950">Report a problem or appeal a decision</h2>
          <p className="mt-1 text-sm text-ink-700">
            Reach the founder directly. Every report is read by a person, not a queue.
          </p>
          <ButtonLink href="/contact" variant="secondary" className="mt-3">
            Go to Contact
          </ButtonLink>
        </Card>
      </div>

      <Dialog
        open={deleteDialogOpen}
        onClose={() => setDeleteDialogOpen(false)}
        title="Delete your account?"
      >
        <p className="text-sm text-ink-700">
          This permanently removes your profile, evidence, and discovery visibility. This cannot be
          undone.
        </p>
        <div className="mt-4 flex gap-3">
          <Button variant="danger" onClick={() => void handleDelete()} disabled={deleting}>
            {deleting ? 'Deleting…' : 'Yes, delete everything'}
          </Button>
          <Button variant="secondary" onClick={() => setDeleteDialogOpen(false)}>
            Cancel
          </Button>
        </div>
      </Dialog>
    </Section>
  );
}
