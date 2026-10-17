'use client';

import { useCallback, useEffect, useState } from 'react';
import { getLocalAdapters } from '@zoryvex/local-adapters';
import { LAUNCH_TRACK_LABELS, type Candidate, type Evidence } from '@zoryvex/contracts';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { PageHeader, Section } from '@/components/layout/Section';
import { StatusState } from '@/components/ui/StatusState';
import { useSession } from '@/lib/use-session';
import { isRealApiConfigured, realCandidateProfile, realEvidenceClaims } from '@/lib/real-api';
import { retryWithBackoff } from '@/lib/retry-with-backoff';
import { PageLoading } from '@/components/ui/PageLoading';

export default function ProfilePreviewPage() {
  const session = useSession();
  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const [visibleEvidence, setVisibleEvidence] = useState<Evidence[]>([]);
  const [loadFailed, setLoadFailed] = useState(false);

  const load = useCallback(() => {
    if (!session?.candidateId) return;

    if (isRealApiConfigured()) {
      setLoadFailed(false);
      retryWithBackoff(() =>
        Promise.all([realCandidateProfile.getProfile(), realEvidenceClaims.listEvidence()]),
      )
        .then(([{ candidate: found }, evidenceList]) => {
          setCandidate(found);
          setVisibleEvidence(evidenceList.filter((e) => e.visibility !== 'private'));
        })
        .catch(() => setLoadFailed(true));
      return;
    }

    const { data } = getLocalAdapters();
    setCandidate(data.getCandidate(session.candidateId));
    setVisibleEvidence(
      data.listCandidateEvidence(session.candidateId).filter((e) => e.visibility !== 'private'),
    );
  }, [session]);

  useEffect(load, [load]);

  if (!candidate) {
    if (loadFailed) {
      return (
        <Section className="max-w-md">
          <StatusState
            kind="500"
            action={
              <Button variant="secondary" onClick={load}>
                Try again
              </Button>
            }
          />
        </Section>
      );
    }
    return (
      <Section className="max-w-2xl">
        <PageLoading blocks={2} />
      </Section>
    );
  }

  return (
    <Section className="max-w-2xl">
      <PageHeader
        title="Employer preview"
        intro="Your evidence as an employer reads it. Private items never appear here."
      />
      {/*
        This page used to say "this is exactly what an employer sees", which
        was not true and undersold the product. An employer browsing matches
        sees an anonymous card: the evidence, the score, and a short id. The
        name below appears to them only after they have spent one of their
        monthly contact unlocks, and only if contact sharing is on.
      */}
      <Card className="mb-6">
        <p className="text-sm text-ink-700">
          Employers see this without your name or email. Both stay hidden behind a short id until an
          employer spends one of their monthly contact unlocks on you.
        </p>
        <p className="mt-2 text-sm text-ink-700">
          {candidate.contactUnlockConsent === true
            ? 'Contact sharing is on, so an employer can spend an unlock to reach you. You are told each time.'
            : 'Contact sharing is off, so no employer can reach you here. They can still read your evidence.'}
        </p>
      </Card>
      {!candidate.discoveryOptIn && (
        <Card className="mb-6 border-error-700">
          <p className="text-sm text-error-700">
            You are not opted into employer discovery, so no employer can find this profile at all.
            Turn it on from your profile when you are ready.
          </p>
        </Card>
      )}
      <Card>
        <h2 className="text-xl font-bold break-words text-ink-950">
          {candidate.displayName}{' '}
          <span className="text-sm font-normal text-ink-700">(shown to you, not to employers)</span>
        </h2>
        <p className="text-sm text-ink-700">{LAUNCH_TRACK_LABELS[candidate.launchTrack]}</p>
        <p className="mt-3 text-ink-700">{candidate.summary || 'No summary yet.'}</p>
      </Card>

      <h3 className="mb-3 mt-8 text-lg font-bold text-ink-950">Evidence</h3>
      {visibleEvidence.length === 0 ? (
        <p className="text-sm text-ink-700">No shareable evidence yet.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {visibleEvidence.map((item) => (
            <li key={item.id}>
              <Card>
                <p className="font-medium break-words text-ink-950">{item.claim}</p>
                <p className="mt-1 break-words text-sm text-ink-700">{item.outcome}</p>
                <Badge tone="neutral">{item.verificationState.replace('_', '-')}</Badge>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
