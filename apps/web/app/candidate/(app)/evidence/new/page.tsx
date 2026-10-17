'use client';

import { TEXT_LIMITS, VERIFICATION_METHOD_FOR_SOURCE } from '@zoryvex/contracts';
import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { getLocalAdapters } from '@zoryvex/local-adapters';
import type { Evidence } from '@zoryvex/contracts';
import { Button } from '@/components/ui/Button';
import { Checkbox } from '@/components/ui/Checkbox';
import { RadioGroup } from '@/components/ui/RadioGroup';
import { Select } from '@/components/ui/Select';
import { Textarea } from '@/components/ui/Textarea';
import { PageHeader, Section } from '@/components/layout/Section';
import { useSession } from '@/lib/use-session';
import { isRealApiConfigured, realEvidenceClaims } from '@/lib/real-api';

/**
 * What picking this source type means for whether the claim can ever be
 * checked, said at the moment of picking.
 *
 * The choice decides the outcome and nothing here admitted it. Three of the
 * five options have no outside source at all, so a candidate could fill in
 * four careful paragraphs, save, open the verify page and be told for the
 * first time that there is nothing to check it against. That is late enough
 * to feel like a refusal of the work rather than a property of the category
 * they chose on the first field.
 *
 * Derived from the same map the verify page branches on, so the promise made
 * here and the check offered there cannot drift apart.
 */
function checkabilityHint(source: (typeof SOURCE_OPTIONS)[number]['value']): string {
  const method = VERIFICATION_METHOD_FOR_SOURCE[source];
  if (method === 'issuer_badge') {
    return 'Checkable. We confirm the certification with the body that issued it, against the email address on your account.';
  }
  if (method === 'repo_ownership') {
    return 'Checkable. You prove the GitHub account is yours with a one-time code, and we read the repository on GitHub.';
  }
  return 'Not checkable. Nothing outside you can confirm work described in your own words, so this will not reach employers as a proof. File it if it is useful to you, then add a certification or a public repository for the part that can be checked.';
}

const SOURCE_OPTIONS = [
  { value: 'github', label: 'GitHub / code repository' },
  { value: 'project', label: 'Project write-up' },
  { value: 'writeup', label: 'Blog post / write-up' },
  { value: 'certification', label: 'Certification' },
  { value: 'other', label: 'Other' },
] as const;

/**
 * A link, or nothing. Uploading a file was removed on 2026-09-09, on the
 * founder instruction "remove upload file feature".
 *
 * It is a coherent decision rather than a retreat from a broken feature, and
 * the reason is what this product sells. A file a candidate uploads is a
 * thing they control: they chose it, they could have made it, and Zoryvex
 * can say nothing about it beyond that it was virus-scanned. It could never
 * move a claim to verified, so it sat on the one page whose whole argument
 * is the difference between what somebody says and what a source they do not
 * control confirms. A link is at least somewhere an employer can go and look.
 *
 * The storage, scanning and download code still exists and is now unreachable
 * from the product. Deleting the S3 bucket, its GuardDuty malware protection
 * and the upload/download routes is a Terraform destroy, which needs founder
 * approval before it runs, so it is recorded as outstanding rather than done
 * quietly here.
 */
const ATTACHMENT_OPTIONS = [
  { value: 'link', label: 'Link to it', hint: 'A URL to the repository, article, or certificate.' },
  { value: 'none', label: 'No attachment', hint: 'Just the written description below.' },
] as const;

export default function NewEvidencePage() {
  const session = useSession();
  const router = useRouter();
  const useReal = isRealApiConfigured();

  const [source, setSource] = useState<(typeof SOURCE_OPTIONS)[number]['value']>('project');
  const [attachment, setAttachment] =
    useState<(typeof ATTACHMENT_OPTIONS)[number]['value']>('link');
  const [sourceUrl, setSourceUrl] = useState('');
  const [claim, setClaim] = useState('');
  const [context, setContext] = useState('');
  const [actions, setActions] = useState('');
  const [outcome, setOutcome] = useState('');
  const [visibility, setVisibility] = useState<Evidence['visibility']>('private');
  const [consentGiven, setConsentGiven] = useState(false);
  const [formError, setFormError] = useState<string | undefined>(undefined);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setFormError(undefined);

    if (!session?.candidateId) return;
    if (attachment === 'link' && !sourceUrl) {
      setFormError('Add a link, or choose a different attachment type.');
      return;
    }

    if (useReal) {
      setSubmitting(true);
      try {
        await realEvidenceClaims.createEvidence({
          source,
          claim,
          context,
          actions,
          outcome,
          visibility,
          consentGiven,
          ...(attachment === 'link' ? { sourceUrl } : {}),
        });
        router.replace('/candidate/profile');
      } catch {
        setFormError('Something went wrong saving this evidence. Try again.');
      } finally {
        setSubmitting(false);
      }
      return;
    }

    const now = new Date().toISOString();
    const evidence: Evidence = {
      id: `ev_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      candidateId: session.candidateId,
      source,
      claim,
      context,
      actions,
      outcome,
      verificationState: 'self_attested',
      visibility,
      consentGiven,
      createdAt: now,
      updatedAt: now,
      ...(attachment === 'link' ? { sourceUrl } : {}),
    };

    getLocalAdapters().data.upsertEvidence(evidence);
    router.replace('/candidate/profile');
  }

  return (
    <Section className="max-w-2xl">
      <PageHeader
        title="File a claim"
        intro="Four lines, then a check. A claim is something you say; it counts for nothing until a source you do not control confirms it."
      />
      <form onSubmit={(e) => void handleSubmit(e)} className="flex flex-col gap-6">
        <Select
          id="source"
          label="Source type"
          hint={checkabilityHint(source)}
          value={source}
          onChange={(e) => setSource(e.target.value as typeof source)}
        >
          {SOURCE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </Select>

        <RadioGroup
          name="attachment"
          legend="Attachment"
          value={attachment}
          onChange={(v) => setAttachment(v as typeof attachment)}
          options={[...ATTACHMENT_OPTIONS]}
        />

        {attachment === 'link' && (
          <div className="flex flex-col gap-1.5">
            <label htmlFor="source-url" className="text-sm font-medium text-ink-950">
              Link
            </label>
            <input
              id="source-url"
              type="url"
              required
              value={sourceUrl}
              onChange={(e) => setSourceUrl(e.target.value)}
              className="w-full rounded-md border border-ink-500 bg-warm-50 px-3 py-2 text-ink-950"
            />
          </div>
        )}

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
          hint="Where, and what state it was in when you got there."
          required
          value={context}
          onChange={(e) => setContext(e.target.value)}
          rows={2}
        />
        <Textarea
          id="actions"
          maxLength={TEXT_LIMITS.actions}
          label="Actions"
          hint="What you personally did. Not the team. This is the line that decides whether a check can confirm anything."
          required
          value={actions}
          onChange={(e) => setActions(e.target.value)}
          rows={3}
        />
        <Textarea
          id="outcome"
          maxLength={TEXT_LIMITS.outcome}
          label="Outcome"
          hint="What changed, measurably. A number a check could land on beats an adjective."
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

        {/*
          The consent box sits directly above this, so the reason is close
          by, but "close by" is not the same as said. Worded the way the
          verify page words its own blocked check.
        */}
        <div>
          <div className="flex gap-3">
            <Button
              type="submit"
              disabled={!consentGiven || submitting}
              aria-describedby={!consentGiven && !submitting ? 'file-blocked' : undefined}
            >
              {submitting ? 'Filing…' : 'File this claim'}
            </Button>
            <Button type="button" variant="secondary" onClick={() => router.back()}>
              Cancel
            </Button>
          </div>
          {!consentGiven && !submitting && (
            <p id="file-blocked" className="mt-2 text-sm text-ink-700">
              Tick the consent box above and this turns on.
            </p>
          )}
        </div>
      </form>
    </Section>
  );
}
