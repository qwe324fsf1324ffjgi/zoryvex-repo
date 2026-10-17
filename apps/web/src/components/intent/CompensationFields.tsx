'use client';

import {
  COMPENSATION_PERIOD_LABELS,
  COMPENSATION_PERIODS,
  compensationFromDraft,
  formatCompensationRange,
  type CompensationDraft,
  type CompensationPeriod,
} from '@zoryvex/contracts';
import { Input } from '@/components/ui/Input';

export interface CompensationFieldsProps {
  /** The draft being edited. Both ends empty means nothing is published. */
  value: CompensationDraft;
  onChange: (value: CompensationDraft) => void;
  /** "What this role pays" reads differently from "what I need to be paid". */
  legend: string;
  hint: string;
  disabled?: boolean;
  /** Distinguishes two instances on one page, e.g. a role range and a candidate minimum. */
  idPrefix: string;
}

/**
 * A pay range, with both ends required.
 *
 * This holds a draft rather than a range, and the difference matters more
 * than it looks. An earlier version held the range itself and wrote 0 into
 * whichever end was empty, which had two consequences: clearing a box could
 * not be told apart from leaving it alone, so a published range could never
 * be withdrawn; and a half-finished range could reach save as a claim that
 * the job pays nothing. `CompensationDraft` gives an empty box a value of
 * its own, and `compensationFromDraft` in the contracts package decides what
 * a draft means. The rules are not restated here: the same function tells
 * this component what to show and tells the page whether it may save.
 */
export function CompensationFields({
  value,
  onChange,
  legend,
  hint,
  disabled,
  idPrefix,
}: CompensationFieldsProps) {
  const { range, problem } = compensationFromDraft(value);

  function parse(raw: string): number | undefined {
    const digits = raw.replace(/[^0-9]/g, '');
    if (digits === '') return undefined;
    return Number.parseInt(digits, 10);
  }

  return (
    <fieldset className="mt-6 border-0 p-0">
      <legend className="text-sm font-semibold text-ink-950">{legend}</legend>
      <p className="mt-1 text-sm text-ink-700">{hint}</p>

      <div className="mt-3 flex flex-wrap items-start gap-3">
        <Input
          id={`${idPrefix}-min`}
          label="From (NGN)"
          inputMode="numeric"
          autoComplete="off"
          disabled={disabled}
          value={value.minNGN === undefined ? '' : String(value.minNGN)}
          onChange={(e) => onChange({ ...value, minNGN: parse(e.target.value) })}
        />
        <Input
          id={`${idPrefix}-max`}
          label="To (NGN)"
          inputMode="numeric"
          autoComplete="off"
          disabled={disabled}
          value={value.maxNGN === undefined ? '' : String(value.maxNGN)}
          onChange={(e) => onChange({ ...value, maxNGN: parse(e.target.value) })}
        />
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-ink-950">Paid</span>
          <select
            id={`${idPrefix}-period`}
            className="min-h-11 rounded border border-ink-500 bg-warm-50 px-3 text-ink-950"
            disabled={disabled}
            value={value.period}
            onChange={(e) => onChange({ ...value, period: e.target.value as CompensationPeriod })}
          >
            {COMPENSATION_PERIODS.map((option) => (
              <option key={option} value={option}>
                {COMPENSATION_PERIOD_LABELS[option]}
              </option>
            ))}
          </select>
        </label>
      </div>

      {problem && (
        <p className="mt-2 text-sm text-ink-950" data-testid={`${idPrefix}-problem`}>
          {problem}
        </p>
      )}

      {range && (
        <p className="mt-2 text-sm text-ink-700">
          Shown as:{' '}
          <span className="font-medium text-ink-950">{formatCompensationRange(range)}</span>
        </p>
      )}

      {!range && !problem && (
        <p className="mt-2 text-sm text-ink-500">Leave both empty to say nothing about pay.</p>
      )}
    </fieldset>
  );
}
