'use client';

import { ENGAGEMENT_KIND_LABELS, ENGAGEMENT_KINDS, type EngagementKind } from '@zoryvex/contracts';
import { Checkbox } from '@/components/ui/Checkbox';

export interface OpenToFieldsProps {
  value: EngagementKind[];
  onChange: (value: EngagementKind[]) => void;
  disabled?: boolean;
}

/**
 * What a candidate is open to.
 *
 * Multi-select, because a person can want a permanent role and still be
 * willing to tutor at weekends. The labels come from contracts so the
 * words on screen and the words a role is matched against cannot drift
 * apart.
 *
 * Choosing nothing is a real answer and means "no preference", which
 * matching reads as no constraint rather than as a refusal of everything.
 * The copy says so, because an empty set of ticked boxes otherwise looks
 * like an unfinished form.
 */
export function OpenToFields({ value, onChange, disabled }: OpenToFieldsProps) {
  function toggle(kind: EngagementKind, checked: boolean) {
    onChange(checked ? [...value, kind] : value.filter((k) => k !== kind));
  }

  return (
    <fieldset className="mt-6 border-0 p-0">
      <legend className="text-sm font-semibold text-ink-950">What are you open to?</legend>
      <p className="mt-1 text-sm text-ink-700">
        Tick everything that applies. Mentoring, tutoring and training are proper answers here, not
        afterthoughts: a verified practitioner is exactly who is worth learning from.
      </p>

      <div className="mt-3 flex flex-col gap-2">
        {ENGAGEMENT_KINDS.map((kind) => (
          <Checkbox
            key={kind}
            id={`open-to-${kind}`}
            label={ENGAGEMENT_KIND_LABELS[kind]}
            checked={value.includes(kind)}
            disabled={disabled}
            onChange={(e) => toggle(kind, e.target.checked)}
          />
        ))}
      </div>

      {value.length === 0 && (
        <p className="mt-2 text-sm text-ink-500">
          Nothing ticked means no preference, so you will be considered for all of them.
        </p>
      )}
    </fieldset>
  );
}

export interface EngagementKindChoiceProps {
  value: EngagementKind;
  onChange: (value: EngagementKind) => void;
  disabled?: boolean;
}

/**
 * What a role is offering.
 *
 * Single choice where the candidate's is multiple: a role is one
 * arrangement, while a person can be open to several.
 */
export function EngagementKindChoice({ value, onChange, disabled }: EngagementKindChoiceProps) {
  return (
    <label className="mt-6 flex flex-col gap-1 text-sm">
      <span className="font-semibold text-ink-950">What kind of engagement is this?</span>
      <select
        id="role-engagement-kind"
        className="min-h-11 max-w-sm rounded border border-ink-500 bg-warm-50 px-3 text-ink-950"
        disabled={disabled}
        value={value}
        onChange={(e) => onChange(e.target.value as EngagementKind)}
      >
        {ENGAGEMENT_KINDS.map((kind) => (
          <option key={kind} value={kind}>
            {ENGAGEMENT_KIND_LABELS[kind]}
          </option>
        ))}
      </select>
    </label>
  );
}
