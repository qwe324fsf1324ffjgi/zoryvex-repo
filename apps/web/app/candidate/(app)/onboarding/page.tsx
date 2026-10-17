'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getLocalAdapters } from '@zoryvex/local-adapters';
import { LAUNCH_TRACK_LABELS, type Candidate, type LaunchTrack } from '@zoryvex/contracts';
import { Button } from '@/components/ui/Button';
import { RadioGroup } from '@/components/ui/RadioGroup';
import { PageHeader, Section } from '@/components/layout/Section';
import { StatusState } from '@/components/ui/StatusState';
import { useSession } from '@/lib/use-session';
import { isRealApiConfigured, messageFor, realCandidateProfile } from '@/lib/real-api';
import { retryWithBackoff } from '@/lib/retry-with-backoff';
import { useToast } from '@/components/ui/Toast';
import { PageLoading } from '@/components/ui/PageLoading';

const TRACK_OPTIONS = (Object.entries(LAUNCH_TRACK_LABELS) as [LaunchTrack, string][]).map(
  ([value, label]) => ({ value, label }),
);

export default function OnboardingPage() {
  const session = useSession();
  const router = useRouter();
  const { showToast } = useToast();
  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const [version, setVersion] = useState<number | null>(null);
  const [track, setTrack] = useState<LaunchTrack | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);

  const loadCandidate = useCallback(() => {
    if (!session?.candidateId) return;

    if (isRealApiConfigured()) {
      setLoadFailed(false);
      retryWithBackoff(() => realCandidateProfile.getProfile())
        .then(({ candidate: found, version: v }) => {
          setCandidate(found);
          setVersion(v);
          if (found.onboardingComplete) router.replace('/candidate/profile');
        })
        .catch(() => setLoadFailed(true));
      return;
    }

    const found = getLocalAdapters().data.getCandidate(session.candidateId);
    setCandidate(found);
    if (found?.onboardingComplete) router.replace('/candidate/profile');
  }, [session, router]);

  useEffect(loadCandidate, [loadCandidate]);

  async function handleSubmit() {
    if (!candidate || !track) return;

    if (isRealApiConfigured()) {
      if (version === null) return;
      setSaving(true);
      try {
        await realCandidateProfile.updateProfile(version, {
          launchTrack: track,
          onboardingComplete: true,
        });
        router.replace('/candidate/profile');
      } catch (error) {
        showToast(messageFor(error, 'Something went wrong saving your track. Try again.'), 'error');
      } finally {
        setSaving(false);
      }
      return;
    }

    const { data } = getLocalAdapters();
    data.upsertCandidate({
      ...candidate,
      launchTrack: track,
      onboardingComplete: true,
      updatedAt: new Date().toISOString(),
    });
    router.replace('/candidate/profile');
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
      <Section className="max-w-md">
        <PageLoading blocks={2} intro />
      </Section>
    );
  }

  return (
    <Section className="max-w-md">
      <PageHeader
        title="Pick one launch track"
        intro="Your proof profile focuses on work for a single track. You can't be onboarded onto more than one. This keeps evidence relevant to the roles you actually want."
      />
      <RadioGroup
        name="launch-track"
        legend="Which specialism do you work in?"
        options={TRACK_OPTIONS}
        value={track}
        onChange={(v) => setTrack(v as LaunchTrack)}
        required
      />
      <Button className="mt-6" disabled={!track || saving} onClick={() => void handleSubmit()}>
        {saving ? 'Saving…' : 'Continue'}
      </Button>
    </Section>
  );
}
