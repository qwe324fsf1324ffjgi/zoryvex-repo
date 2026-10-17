'use client';

import { TEXT_LIMITS } from '@zoryvex/contracts';
import { Suspense, useCallback, useEffect, useState, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { getLocalAdapters } from '@zoryvex/local-adapters';
import type { Evidence } from '@zoryvex/contracts';
import { Button } from '@/components/ui/Button';
import { Checkbox } from '@/components/ui/Checkbox';
import { Select } from '@/components/ui/Select';
import { Textarea } from '@/components/ui/Textarea';
import { StatusState } from '@/components/ui/StatusState';
import { PageHeader, Section } from '@/components/layout/Section';
import { useSession } from '@/lib/use-session';
import { isRealApiConfigured, RealApiError, realEvidenceClaims } from '@/lib/real-api';
import { PageLoading } from '@/components/ui/PageLoading';

/**
 * `employer_shared` is no longer offered, so a record still carrying it has
 * no matching option in the select — which would render as the first option,
 * "Private", for something that is in fact shared. It always behaved
 * identically to `discovery` (every filter reads `visibility !== 'private'`),
 * so showing it as that is both accurate and what saving will store.
 */
function editableVisibility(stored: Evidence['visibility']): Evidence['visibility'] {
  return stored === 'employer_shared' ? 'discovery' : stored;
}

/**
 * Query-param routing (`?id=`), not a `[id]` dynamic segment — this app is
 * a static export (`output: 'export'`), the same pattern already used by
 * `/employer/role`. Only claim/context/actions/outcome/visibility/consent
 * are editable, matching `UpdateEvidenceInput`'s own scope exactly (source
 * and the attachment itself are set once at creation, never changed here).
 */
function EditEvidenceContent() {
  const session = useSession();
  const router = useRouter();
  const useReal = isRealApiConfigured();
  const searchParams = useSearchParams();
  const evidenceId = searchParams.get('id');

  const [evidence, setEvidence] = useState<Evidence | null | undefined>(undefined);
  const [version, setVersion] = useState<number | null>(null);
  const [claim, setClaim] = useState('');
  const [context, setContext] = useState('');
  const [actions, setActions] = useState('');
  const [outcome, setOutcome] = useState('');
  const [visibility, setVisibility] = useState<Evidence['visibility']>('private');
  const [consentGiven, setConsentGiven] = useState(false);
  const [formError, setFormError] = useState<string | undefined>(undefined);
  const [submitting, setSubmitting] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);

  const load = useCallback(() => {
    if (!evidenceId || !session?.candidateId) return;

    if (useReal) {
      setLoadFailed(false);
      realEvidenceClaims
        .getEvidence(evidenceId)
        .then(({ evidence: found, version: v }) => {
          setEvidence(found);
          setVersion(v);
          setClaim(found.claim);
          setContext(found.context);
          setActions(found.actions);
          setOutcome(found.outcome);
          setVisibility(editableVisibility(found.visibility));
          setConsentGiven(found.consentGiven);
        })
        .catch((error: unknown) => {
          // A real 404/403 means this evidence genuinely isn't there (or
          // isn't yours) — a permanent answer. Anything else is a transient
          // failure, and saying "not found" for a network blip would tell a
          // candidate their work is gone when it isn't.
          if (error instanceof RealApiError && (error.status === 403 || error.status === 404)) {
            setEvidence(null);
          } else {
            setLoadFailed(true);
          }
        });
      return;
    }

    const { data } = getLocalAdapters();
    const found = data.listCandidateEvidence(session.candidateId).find((e) => e.id === evidenceId);
    setEvidence(found ?? null);
    if (found) {
      setClaim(found.claim);
      setContext(found.context);
      setActions(found.actions);
      setOutcome(found.outcome);
      setVisibility(editableVisibility(found.visibility));
      setConsentGiven(found.consentGiven);
    }
  }, [evidenceId, session, useReal]);

  useEffect(load, [load]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setFormError(undefined);
    if (!evidence || !session?.candidateId) return;

    const patch = { claim, context, actions, outcome, visibility, consentGiven };

    if (useReal) {
      setSubmitting(true);
      try {
        if (version === null) throw new Error('missing version');
        await realEvidenceClaims.updateEvidence(evidence.id, version, patch);
        router.replace('/candidate/profile');
      } catch (error: unknown) {
        // A 409 means this item changed somewhere else since it loaded, so
        // the version we hold is stale. "Try again" is the wrong advice —
        // resubmitting the same stale version fails identically, forever.
        // Reloading is the only thing that actually resolves it.
        setFormError(
          error instanceof RealApiError && error.status === 409
            ? 'This evidence was changed somewhere else while you were editing. Reload the page to get the latest version, then reapply your changes.'
            : 'Something went wrong saving this evidence. Try again.',
        );
      } finally {
        setSubmitting(false);
      }
      return;
    }

    getLocalAdapters().data.upsertEvidence({
      ...evidence,
      ...patch,
      updatedAt: new Date().toISOString(),
    });
    router.replace('/candidate/profile');
  }

  if (!evidenceId) return <StatusState kind="404" title="No evidence specified" />;
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
  if (evidence === undefined) {
    return (
      <Section className="max-w-2xl">
        <PageLoading blocks={2} />
      </Section>
    );
  }
  if (evidence === null) return <StatusState kind="404" title="Evidence not found" />;

  return (
    <Section className="max-w-2xl">
      <PageHeader title="Edit this claim" />
      <form onSubmit={(e) => void handleSubmit(e)} className="flex flex-col gap-6">
        <Textarea
          id="claim"
          maxLength={TEXT_LIMITS.claim}
          label="Claim"
          hint="What you did, in one sentence."
          required
          value={claim}
          onChange={(e) => setClaim(e.target.value)}
          rows={2}
        />
        <Textarea
          id="context"
          maxLength={TEXT_LIMITS.context}
          label="Context"
          hint="The situation you were solving for."
          required
          value={context}
          onChange={(e) => setContext(e.target.value)}
          rows={2}
        />
        <Textarea
          id="actions"
          maxLength={TEXT_LIMITS.actions}
          label="Actions"
          hint="What you specifically did."
          required
          value={actions}
          onChange={(e) => setActions(e.target.value)}
          rows={3}
        />
        <Textarea
          id="outcome"
          maxLength={TEXT_LIMITS.outcome}
          label="Outcome"
          hint="What changed as a result."
          required
          value={outcome}
          onChange={(e) => setOutcome(e.target.value)}
          rows={2}
        />

        <Select
          id="visibility"
          label="Visibility"
          value={visibility}
          onChange={(e) => setVisibility(e.target.value as Evidence['visibility'])}
        >
          <option value="private">Private. Only you can see this.</option>
          <option value="discovery">Visible to employers whose role you match</option>
        </Select>

        <Checkbox
          id="consent"
          label="I consent to this evidence being shared per the visibility I selected above"
          checked={consentGiven}
          onChange={(e) => setConsentGiven(e.target.checked)}
        />

        {formError && (
          <p role="alert" className="text-sm text-error-700">
            {formError}
          </p>
        )}

        <div className="flex gap-3">
          <Button type="submit" disabled={!consentGiven || submitting}>
            {submitting ? 'Saving…' : 'Save changes'}
          </Button>
          <Button type="button" variant="secondary" onClick={() => router.back()}>
            Cancel
          </Button>
        </div>
      </form>
    </Section>
  );
}

export default function EditEvidencePage() {
  return (
    <Suspense fallback={null}>
      <EditEvidenceContent />
    </Suspense>
  );
}
