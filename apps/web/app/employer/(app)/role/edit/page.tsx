'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { getLocalAdapters } from '@zoryvex/local-adapters';
import {
  LAUNCH_TRACK_LABELS,
  compensationFromDraft,
  draftFromRange,
  type CompensationDraft,
  type EngagementKind,
  type Role,
  type Seniority,
  TEXT_LIMITS,
} from '@zoryvex/contracts';
import { Button, ButtonLink } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { StatusState } from '@/components/ui/StatusState';
import { Textarea } from '@/components/ui/Textarea';
import { PageHeader, Section } from '@/components/layout/Section';
import { useSession } from '@/lib/use-session';
import { useToast } from '@/components/ui/Toast';
import { isRealApiConfigured, messageFor, realKit, realRoles } from '@/lib/real-api';
import { CompensationFields } from '@/components/intent/CompensationFields';
import { EngagementKindChoice } from '@/components/intent/EngagementKindFields';
import {
  LocationRequirementFields,
  emptyLocationRequirement,
  requirementOrUndefined,
} from '@/components/employer/LocationRequirementFields';
import { suggestedUtcOffsetMinutes } from '@/lib/countries';
import { PageLoading } from '@/components/ui/PageLoading';

const SENIORITY_OPTIONS: { value: Seniority; label: string }[] = [
  { value: 'junior', label: 'Junior' },
  { value: 'mid', label: 'Mid' },
  { value: 'senior', label: 'Senior' },
  { value: 'lead', label: 'Lead' },
];

/**
 * Roles were create-only. `PATCH /roles/{id}` has existed since Phase 7, with
 * ownership checks and optimistic concurrency, and nothing ever called it.
 *
 * The gap mattered more than a missing convenience. `mustHaveWork` is what
 * matching scores against, and a role is what a Kit is bought for. An
 * employer who mistyped a requirement had two options: live with the wrong
 * matches, or create a second role and buy a second Kit at the same price.
 *
 * The launch track is deliberately not editable. It decides which candidates
 * a role is matched against at all, so changing it is a different role rather
 * than a correction — and the server's UpdateRoleInput does not accept it.
 */
function EditRoleForm() {
  const params = useSearchParams();
  const router = useRouter();
  const session = useSession();
  const { showToast } = useToast();
  const useReal = isRealApiConfigured();
  const roleId = params.get('id');

  const [role, setRole] = useState<Role | null | undefined>(undefined);
  const [version, setVersion] = useState(0);
  const [hasPaidKit, setHasPaidKit] = useState(false);
  const [title, setTitle] = useState('');
  const [seniority, setSeniority] = useState<Seniority>('mid');
  const [outcomes, setOutcomes] = useState('');
  const [mustHaveWorkText, setMustHaveWorkText] = useState('');
  const [constraints, setConstraints] = useState('');
  const [locationRequirement, setLocationRequirement] = useState(() =>
    emptyLocationRequirement(suggestedUtcOffsetMinutes()),
  );
  const [engagementKind, setEngagementKind] = useState<EngagementKind>('employment');
  const [payDraft, setPayDraft] = useState<CompensationDraft>(() => draftFromRange(undefined));
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [savedWithPaidKit, setSavedWithPaidKit] = useState(false);

  const fill = useCallback((loaded: Role) => {
    setRole(loaded);
    setTitle(loaded.title);
    setSeniority(loaded.seniority);
    setOutcomes(loaded.outcomes);
    setMustHaveWorkText(loaded.mustHaveWork.join('\n'));
    setConstraints(loaded.constraints);
    setLocationRequirement(
      loaded.locationRequirement ?? emptyLocationRequirement(suggestedUtcOffsetMinutes()),
    );
    setEngagementKind(loaded.intent?.engagementKind ?? 'employment');
    setPayDraft(draftFromRange(loaded.intent?.compensation));
  }, []);

  useEffect(() => {
    if (!roleId || !session?.employerId) return;

    if (useReal) {
      void (async () => {
        try {
          const [loaded, kit] = await Promise.all([
            realRoles.getRole(roleId),
            realKit.getStatus(roleId),
          ]);
          fill(loaded.role);
          setVersion(loaded.version);
          setHasPaidKit(kit.status === 'succeeded');
        } catch {
          setRole(null);
        }
      })();
      return;
    }

    const { data } = getLocalAdapters();
    const loaded = data.getRole(roleId);
    if (!loaded || loaded.employerId !== session.employerId) {
      setRole(null);
      return;
    }
    fill(loaded);
    setHasPaidKit(data.getKitOrderForRole(roleId)?.status === 'succeeded');
  }, [roleId, session, useReal, fill]);

  const mustHaveWork = mustHaveWorkText
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  function validate(): boolean {
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

  async function handleSave() {
    if (!role || !validate()) return;
    const { range: payRange } = compensationFromDraft(payDraft);
    const patch = {
      title: title.trim(),
      seniority,
      outcomes: outcomes.trim(),
      mustHaveWork,
      constraints: constraints.trim(),
      // null rather than omitted when the employer clears it, so a
      // requirement can actually be removed rather than only ever added.
      locationRequirement: requirementOrUndefined(locationRequirement) ?? null,
      // Validation above has already refused a half finished range, so
      // an absent one here means the employer cleared it and the stored
      // range is withdrawn rather than left behind.
      intent: { engagementKind, ...(payRange ? { compensation: payRange } : {}) },
    };

    setSaving(true);
    try {
      if (useReal) {
        // The version is what stops two people editing the same role from
        // silently overwriting each other. A rejected write means someone
        // else saved first, and the honest answer is to reload rather than
        // guess which edit was meant to win.
        const updated = await realRoles.updateRole(role.id, version, patch);
        setVersion(updated.version);
        fill(updated.role);
      } else {
        // The stored Role has no null: a cleared requirement is an absent
        // one, so the local path deletes the key rather than writing null,
        // exactly as the DynamoDB repository REMOVEs the attribute.
        const { locationRequirement: cleared, intent: nextIntent, ...rest } = patch;
        const next = { ...role, ...rest };
        if (cleared) next.locationRequirement = cleared;
        else delete next.locationRequirement;
        // Spelled out rather than spread. This object is rebuilt field by
        // field, and a field nobody adds here saves on the real path and
        // vanishes on this one — which is precisely what happened to the
        // candidate profile's intent, reporting success and losing the
        // values on reload.
        if (nextIntent) next.intent = nextIntent;
        else delete next.intent;
        getLocalAdapters().data.upsertRole(next);
      }
      showToast('Role updated.', 'success');
      // Only the real backend stores a generated Kit. The demo builds the
      // deliverables from the role every time they are rendered, so they
      // already describe the change and there is nothing to regenerate —
      // offering the button here would be a control that does nothing.
      if (hasPaidKit && useReal) setSavedWithPaidKit(true);
      else router.push(`/employer/role?id=${role.id}`);
    } catch {
      showToast(
        "Couldn't save that role. Someone may have changed it. Reload and try again.",
        'error',
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleRegenerate() {
    if (!role) return;
    setRegenerating(true);
    try {
      await realKit.regenerate(role.id);
      showToast('Kit regenerated from the updated role.', 'success');
      router.push(`/employer/role?id=${role.id}`);
    } catch (error) {
      showToast(messageFor(error, "Couldn't regenerate the Kit. Try again."), 'error');
    } finally {
      setRegenerating(false);
    }
  }

  if (!roleId) return <StatusState kind="404" />;
  if (role === undefined)
    return (
      <Section className="max-w-2xl">
        <PageLoading blocks={2} />
      </Section>
    );
  if (role === null) return <StatusState kind="403" />;

  if (savedWithPaidKit) {
    return (
      <Section className="max-w-2xl">
        <PageHeader title="Role updated" />
        <Card>
          <h2 className="font-semibold text-ink-950">Your Kit still describes the old role</h2>
          <p className="mt-2 text-sm text-ink-700">
            The Kit you paid for was written against the requirements as they were. It is kept
            exactly as it was, because it is what you bought. Regenerating adds a new version
            written from the role you just saved, and the original stays available.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <Button onClick={() => void handleRegenerate()} disabled={regenerating}>
              {regenerating ? 'Regenerating…' : 'Regenerate the Kit'}
            </Button>
            <ButtonLink href={`/employer/role?id=${role.id}`} variant="secondary">
              Leave it as it is
            </ButtonLink>
          </div>
        </Card>
        <p className="mt-4 text-sm text-ink-700">
          Matches are scored against must-have work, so recompute them from the role page if you
          changed that list.
        </p>
      </Section>
    );
  }

  return (
    <Section className="max-w-2xl">
      <PageHeader title="Edit role" intro={LAUNCH_TRACK_LABELS[role.launchTrack]} />

      <div className="flex flex-col gap-6">
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
          hint="Specific things the candidate must have actually done. Matches are scored against this list, so recompute them after you change it."
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
        <EngagementKindChoice value={engagementKind} onChange={setEngagementKind} />
        <CompensationFields
          idPrefix="edit-role-pay"
          legend="What does this pay?"
          hint="Optional. Clearing both boxes withdraws a range you published earlier."
          value={payDraft}
          onChange={setPayDraft}
        />
        <LocationRequirementFields
          idPrefix="edit-role-location"
          value={locationRequirement}
          onChange={setLocationRequirement}
        />

        <Card>
          <h2 className="text-sm font-semibold text-ink-950">
            Track: {LAUNCH_TRACK_LABELS[role.launchTrack]}
          </h2>
          <p className="mt-1 text-sm text-ink-700">
            The track decides which candidates this role is matched against, so it cannot be changed
            here. A role for a different track is a different role. Create one and this one keeps
            its own matches and Kit.
          </p>
        </Card>

        {hasPaidKit && (
          <Card>
            <h2 className="text-sm font-semibold text-ink-950">This role has a paid Kit</h2>
            <p className="mt-1 text-sm text-ink-700">
              Saving does not change it. The Kit you paid for stays exactly as it was, and you can
              regenerate a new version from the updated role afterwards.
            </p>
          </Card>
        )}

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
          <Button onClick={() => void handleSave()} disabled={saving}>
            {saving ? 'Saving…' : 'Save changes'}
          </Button>
          <ButtonLink href={`/employer/role?id=${role.id}`} variant="secondary">
            Cancel
          </ButtonLink>
        </div>
      </div>
    </Section>
  );
}

export default function EditRolePage() {
  return (
    <Suspense
      fallback={
        <Section className="max-w-2xl">
          <PageLoading blocks={2} />
        </Section>
      }
    >
      <EditRoleForm />
    </Suspense>
  );
}
