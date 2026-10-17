'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { getLocalAdapters } from '@zoryvex/local-adapters';
import {
  LAUNCH_TRACK_LABELS,
  compensationFromDraft,
  draftFromRange,
  type CompensationDraft,
  type EngagementKind,
  type LaunchTrack,
  type Role,
  type Seniority,
  TEXT_LIMITS,
} from '@zoryvex/contracts';
import { Button, ButtonLink } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { RadioGroup } from '@/components/ui/RadioGroup';
import { Select } from '@/components/ui/Select';
import { Textarea } from '@/components/ui/Textarea';
import { PageHeader, Section } from '@/components/layout/Section';
import { generateProofGapPreview } from '@zoryvex/kit-templates';
import { useSession } from '@/lib/use-session';
import { useToast } from '@/components/ui/Toast';
import { isRealApiConfigured, messageFor, realRoles } from '@/lib/real-api';
import { CompensationFields } from '@/components/intent/CompensationFields';
import { EngagementKindChoice } from '@/components/intent/EngagementKindFields';
import {
  LocationRequirementFields,
  emptyLocationRequirement,
  requirementOrUndefined,
} from '@/components/employer/LocationRequirementFields';
import { suggestedUtcOffsetMinutes } from '@/lib/countries';

const TRACK_OPTIONS = (Object.entries(LAUNCH_TRACK_LABELS) as [LaunchTrack, string][]).map(
  ([value, label]) => ({ value, label }),
);

const SENIORITY_OPTIONS: { value: Seniority; label: string }[] = [
  { value: 'junior', label: 'Junior' },
  { value: 'mid', label: 'Mid' },
  { value: 'senior', label: 'Senior' },
  { value: 'lead', label: 'Lead' },
];

export default function NewRolePage() {
  const session = useSession();
  const router = useRouter();
  const { showToast } = useToast();
  const useReal = isRealApiConfigured();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [track, setTrack] = useState<LaunchTrack | undefined>(undefined);
  const [title, setTitle] = useState('');
  const [seniority, setSeniority] = useState<Seniority>('mid');
  const [outcomes, setOutcomes] = useState('');
  const [mustHaveWorkText, setMustHaveWorkText] = useState('');
  const [constraints, setConstraints] = useState('');
  const [locationRequirement, setLocationRequirement] = useState(() =>
    emptyLocationRequirement(suggestedUtcOffsetMinutes()),
  );
  // What this role is and what it pays. Both optional: a role can be
  // saved before the employer has decided, and an absent range says
  // "not published" rather than putting a number in their mouth.
  const [engagementKind, setEngagementKind] = useState<EngagementKind>('employment');
  const [payDraft, setPayDraft] = useState<CompensationDraft>(() => draftFromRange(undefined));
  const [errors, setErrors] = useState<string[]>([]);
  const [createdRole, setCreatedRole] = useState<Role | null>(null);
  const [saving, setSaving] = useState(false);

  const mustHaveWork = mustHaveWorkText
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  function validateStep2(): boolean {
    const problems: string[] = [];
    if (!title.trim()) problems.push('Role title is required.');
    if (!outcomes.trim()) problems.push('Outcomes are required.');
    if (mustHaveWork.length === 0) problems.push('Add at least one must-have work item.');
    // The pay range is checked by the same function the field itself
    // uses, so the form cannot disagree with what it is showing. A half
    // finished range is stopped here rather than saved as a zero.
    const { problem: payProblem } = compensationFromDraft(payDraft);
    if (payProblem) problems.push(payProblem);
    setErrors(problems);
    return problems.length === 0;
  }

  async function handleNextFromStep2() {
    if (!validateStep2() || !session?.employerId || !track) return;
    // Built once and used by both paths below, so the role a local build
    // stores and the role the API stores carry the same intent.
    const { range: payRange } = compensationFromDraft(payDraft);
    const intent = { engagementKind, ...(payRange ? { compensation: payRange } : {}) };

    if (useReal) {
      setSaving(true);
      try {
        const trimmedConstraints = constraints.trim();
        const requirement = requirementOrUndefined(locationRequirement);
        const { role } = await realRoles.createRole({
          launchTrack: track,
          title: title.trim(),
          seniority,
          outcomes: outcomes.trim(),
          mustHaveWork,
          ...(trimmedConstraints ? { constraints: trimmedConstraints } : {}),
          ...(requirement ? { locationRequirement: requirement } : {}),
          // Always sent, because engagementKind always has a value; the
          // range rides along only when both ends were filled in.
          intent,
        });
        setCreatedRole(role);
        setStep(3);
      } catch (error) {
        showToast(messageFor(error, "Couldn't save that role. Try again."), 'error');
      } finally {
        setSaving(false);
      }
      return;
    }

    const now = new Date().toISOString();
    const role: Role = {
      id: `role_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      employerId: session.employerId,
      launchTrack: track,
      title: title.trim(),
      seniority,
      outcomes: outcomes.trim(),
      mustHaveWork,
      constraints: constraints.trim(),
      ...(requirementOrUndefined(locationRequirement)
        ? { locationRequirement: requirementOrUndefined(locationRequirement)! }
        : {}),
      status: 'active',
      createdAt: now,
      intent,
    };
    getLocalAdapters().data.upsertRole(role);
    setCreatedRole(role);
    setStep(3);
  }

  return (
    <Section className="max-w-2xl">
      <PageHeader title="New role" intro={`Step ${step} of 3`} />

      {step === 1 && (
        <div className="flex flex-col gap-6">
          <RadioGroup
            name="launch-track"
            legend="Which specialism is this role in?"
            options={TRACK_OPTIONS}
            value={track}
            onChange={(v) => setTrack(v as LaunchTrack)}
            required
          />
          {/*
            Says why it is off. A greyed-out button with nothing beside it
            reads as broken rather than as waiting for something, which is
            the same rule the verify page's `blockedBecause` follows.
          */}
          <div>
            <Button
              disabled={!track}
              aria-describedby={!track ? 'next-blocked' : undefined}
              onClick={() => setStep(2)}
              className="self-start"
            >
              Next
            </Button>
            {!track && (
              <p id="next-blocked" className="mt-2 text-sm text-ink-700">
                Choose a specialism above and this turns on.
              </p>
            )}
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="flex flex-col gap-4">
          <Input
            id="role-title"
            maxLength={TEXT_LIMITS.roleTitle}
            label="Role title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
          />
          <Select
            id="seniority"
            label="Seniority"
            value={seniority}
            onChange={(e) => setSeniority(e.target.value as Seniority)}
          >
            {SENIORITY_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </Select>
          <Textarea
            id="outcomes"
            maxLength={TEXT_LIMITS.roleOutcomes}
            label="Outcomes"
            hint="What does success look like in this role?"
            value={outcomes}
            onChange={(e) => setOutcomes(e.target.value)}
            required
          />
          <Textarea
            id="must-have-work"
            label="Must-have work (one per line)"
            hint="Specific things the candidate must have actually done."
            value={mustHaveWorkText}
            onChange={(e) => setMustHaveWorkText(e.target.value)}
            required
          />
          <Textarea
            id="constraints"
            maxLength={TEXT_LIMITS.roleConstraints}
            label="Other constraints"
            hint="Start date, on-call, anything a person should read. Optional."
            value={constraints}
            onChange={(e) => setConstraints(e.target.value)}
          />
          <LocationRequirementFields
            idPrefix="new-role-location"
            value={locationRequirement}
            onChange={setLocationRequirement}
          />
          <EngagementKindChoice value={engagementKind} onChange={setEngagementKind} />
          <CompensationFields
            idPrefix="new-role-pay"
            legend="What does this pay?"
            hint="Publishing a range is optional, and it is the single thing that saves both sides the most time. A candidate who cannot afford to take the role finds out now rather than after three conversations."
            value={payDraft}
            onChange={setPayDraft}
          />
          {errors.length > 0 && (
            <Card role="alert" className="border-error-700">
              <p className="font-medium text-error-700">Fix the following:</p>
              <ul className="mt-1 list-disc pl-5 text-sm text-error-700">
                {errors.map((err) => (
                  <li key={err}>{err}</li>
                ))}
              </ul>
            </Card>
          )}
          <div className="flex gap-3">
            <Button onClick={() => void handleNextFromStep2()} disabled={saving}>
              {saving ? 'Saving…' : 'See the free preview'}
            </Button>
            <Button variant="secondary" onClick={() => setStep(1)}>
              Back
            </Button>
          </div>
        </div>
      )}

      {step === 3 && createdRole && (
        <div className="flex flex-col gap-6">
          {(() => {
            const preview = generateProofGapPreview(createdRole);
            return (
              <>
                <Card>
                  <p className="font-semibold text-ink-950">{preview.headline}</p>
                  <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-ink-700">
                    {preview.gaps.map((gap) => (
                      <li key={gap}>{gap}</li>
                    ))}
                  </ul>
                  <p className="mt-4 text-sm text-ink-700">{preview.note}</p>
                </Card>
                <div className="flex gap-3">
                  <ButtonLink href={`/employer/role?id=${createdRole.id}`}>
                    View role &amp; get the Kit
                  </ButtonLink>
                  <ButtonLink href="/employer" variant="secondary">
                    Back to roles
                  </ButtonLink>
                </div>
              </>
            );
          })()}
        </div>
      )}

      {step === 3 && !createdRole && (
        <Button onClick={() => router.push('/employer')}>Go to roles</Button>
      )}
    </Section>
  );
}
