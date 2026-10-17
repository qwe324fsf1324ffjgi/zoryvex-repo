'use client';

import { useMemo } from 'react';
import type { RoleLocationRequirement } from '@zoryvex/contracts';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { countriesByName, countryName, utcOffsetOptions } from '@/lib/countries';

/**
 * The location requirement, on both the new-role and edit-role forms.
 *
 * One component rather than two copies. The Paystack business name was
 * wrong on every payment surface for seventeen days because two pages each
 * held their own copy of a string, and a filter that decides who an employer
 * sees is a worse thing to keep two copies of than a sentence.
 *
 * Both halves are opt-in and a role with neither set filters nobody, which
 * is where every role starts. The countries field is an allow-list: an
 * employer says where they are able to employ someone, never where they will
 * not. Those are the same arithmetic and very different questions, and only
 * one of them stays about payroll.
 */
export interface LocationRequirementFieldsProps {
  value: RoleLocationRequirement;
  onChange: (next: RoleLocationRequirement) => void;
  /** Distinguishes the two forms' inputs when both are on a page in tests. */
  idPrefix?: string;
}

const DIFFERENCE_OPTIONS = [1, 2, 3, 4, 5, 6, 8, 10, 12];

export function LocationRequirementFields({
  value,
  onChange,
  idPrefix = 'location',
}: LocationRequirementFieldsProps) {
  const countryOptions = useMemo(() => countriesByName(), []);
  const offsetOptions = useMemo(() => utcOffsetOptions(), []);
  const available = countryOptions.filter((option) => !value.countries.includes(option.code));

  function addCountry(code: string) {
    if (!code || value.countries.includes(code)) return;
    onChange({ ...value, countries: [...value.countries, code] });
  }

  function removeCountry(code: string) {
    onChange({ ...value, countries: value.countries.filter((c) => c !== code) });
  }

  return (
    <div className="flex flex-col gap-4 border-t border-warm-200 pt-6">
      <div>
        <h3 className="font-bold text-ink-950">Where this role can hire</h3>
        <p className="mt-1 text-sm text-ink-700">
          Optional. Both parts are separate, and leaving them alone means this role considers
          everyone. Candidates who have not said where they work from are never filtered out.
        </p>
      </div>

      <div>
        <Select
          id={`${idPrefix}-add-country`}
          label="Countries you can employ in"
          hint="Add each one. No countries listed means anywhere."
          value=""
          onChange={(e) => addCountry(e.target.value)}
        >
          <option value="">Add a country…</option>
          {available.map((option) => (
            <option key={option.code} value={option.code}>
              {option.name}
            </option>
          ))}
        </Select>

        {value.countries.length > 0 ? (
          <ul className="mt-3 flex flex-wrap gap-2">
            {value.countries.map((code) => (
              <li key={code}>
                <span className="inline-flex items-center gap-2 rounded-md border border-warm-300 bg-warm-100 py-1 pl-3 pr-1 text-sm text-ink-900">
                  {countryName(code)}
                  <Button
                    variant="ghost"
                    onClick={() => removeCountry(code)}
                    aria-label={`Remove ${countryName(code)}`}
                    className="px-2 py-0 text-ink-700"
                  >
                    ×
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-ink-500">Anywhere.</p>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Select
          id={`${idPrefix}-offset`}
          label="This role's working hours"
          hint="What the overlap below is measured against."
          value={String(value.utcOffsetMinutes)}
          onChange={(e) => onChange({ ...value, utcOffsetMinutes: Number(e.target.value) })}
        >
          {offsetOptions.map((option) => (
            <option key={option.minutes} value={option.minutes}>
              {option.label}
            </option>
          ))}
        </Select>

        <Select
          id={`${idPrefix}-max-difference`}
          label="Furthest a candidate may be"
          hint="How far their working day can sit from this role's."
          value={
            value.maxTimezoneDifferenceHours === null
              ? ''
              : String(value.maxTimezoneDifferenceHours)
          }
          onChange={(e) =>
            onChange({
              ...value,
              maxTimezoneDifferenceHours: e.target.value === '' ? null : Number(e.target.value),
            })
          }
        >
          <option value="">Any distance</option>
          <option value="0">Same hours exactly</option>
          {DIFFERENCE_OPTIONS.map((hours) => (
            <option key={hours} value={hours}>
              Up to {hours} {hours === 1 ? 'hour' : 'hours'} apart
            </option>
          ))}
        </Select>
      </div>
    </div>
  );
}

/** What a role with no requirement starts from, so the form has something to edit. */
export function emptyLocationRequirement(utcOffsetMinutes: number): RoleLocationRequirement {
  return { countries: [], utcOffsetMinutes, maxTimezoneDifferenceHours: null };
}

/**
 * A requirement that constrains nothing is sent as undefined rather than as
 * an empty object, so a role the employer never touched stays a role with no
 * location requirement at all, rather than one carrying an inert one.
 */
export function requirementOrUndefined(
  value: RoleLocationRequirement,
): RoleLocationRequirement | undefined {
  const constrains = value.countries.length > 0 || value.maxTimezoneDifferenceHours !== null;
  return constrains ? value : undefined;
}
