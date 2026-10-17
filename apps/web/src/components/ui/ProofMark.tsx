import { cn } from '@/lib/cn';

/**
 * The mark a proof carries.
 *
 * The design decision that makes it ours is the date. Verification badges
 * conventionally imply permanence, which is a lie about how credentials
 * work: an AWS certification lapses, and a mark that pretends otherwise is
 * the first "trust me" in a product built against that sentence. So this
 * one says when it was checked and, when there is one, when it stops being
 * true — which is the visual form of `isVerified`, the single gate every
 * employer-facing path runs evidence through.
 *
 * A lapsed mark renders as lapsed rather than disappearing. Hiding it would
 * leave a candidate wondering why their profile got quieter, and would let
 * a screenshot outlive the fact.
 *
 * Deliberately inside the existing restrained system (see
 * `apps/web/app/globals.css`): ink on warm, one emerald stroke, a square
 * with a hairline border. A second visual language would say the mark is a
 * decoration rather than a fact.
 */

export type ProofMarkState = 'proved' | 'lapsed' | 'unproved';

export interface ProofMarkProps {
  state: ProofMarkState;
  /** ISO date the check ran. Shown, not decorative. */
  checkedAt?: string | undefined;
  /** ISO date the underlying credential stops being current, when it does. */
  lapsesAt?: string | undefined;
  /** What was checked, in the employer's terms, when there is room to say it. */
  detail?: string | undefined;
  size?: 'sm' | 'md';
  className?: string;
}

function shortDate(iso: string | undefined): string | null {
  if (!iso) return null;
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return null;
  return new Date(parsed).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/** The square. A check for a live proof, a broken rule for a lapsed one. */
function Glyph({ state, size }: { state: ProofMarkState; size: 'sm' | 'md' }) {
  const box = size === 'sm' ? 'size-5' : 'size-7';

  if (state === 'proved') {
    return (
      <span
        aria-hidden="true"
        className={cn(
          box,
          'inline-flex shrink-0 items-center justify-center rounded-[3px] border border-accent-700 bg-accent-700',
        )}
      >
        <svg viewBox="0 0 16 16" className="size-3/5" fill="none" stroke="currentColor">
          <path
            d="M3 8.5 6.5 12 13 4.5"
            className="stroke-warm-50"
            strokeWidth="2.25"
            strokeLinecap="square"
          />
        </svg>
      </span>
    );
  }

  if (state === 'lapsed') {
    return (
      <span
        aria-hidden="true"
        className={cn(
          box,
          'inline-flex shrink-0 items-center justify-center rounded-[3px] border border-ink-500 bg-warm-100',
        )}
      >
        {/* The same check, cut through. The proof happened; it stopped being current. */}
        <svg viewBox="0 0 16 16" className="size-3/5" fill="none" stroke="currentColor">
          <path
            d="M3 8.5 6.5 12 13 4.5"
            className="stroke-ink-500"
            strokeWidth="2.25"
            strokeLinecap="square"
          />
          <path
            d="M2 14 14 2"
            className="stroke-ink-700"
            strokeWidth="1.5"
            strokeLinecap="square"
          />
        </svg>
      </span>
    );
  }

  return (
    <span
      aria-hidden="true"
      className={cn(
        box,
        'inline-flex shrink-0 items-center justify-center rounded-[3px] border border-dashed border-ink-500 bg-transparent',
      )}
    />
  );
}

const STATE_LABEL: Record<ProofMarkState, string> = {
  proved: 'Proved',
  lapsed: 'Lapsed',
  unproved: 'Not checked yet',
};

export function ProofMark({
  state,
  checkedAt,
  lapsesAt,
  detail,
  size = 'md',
  className,
}: ProofMarkProps) {
  const checked = shortDate(checkedAt);
  const lapses = shortDate(lapsesAt);

  // The accessible name carries the same three facts the visual does, in a
  // sentence, so a screen reader gets the date rather than the word
  // "verified" on its own.
  const label =
    state === 'proved'
      ? `Proved${checked ? ` on ${checked}` : ''}${lapses ? `, lapses ${lapses}` : ''}`
      : state === 'lapsed'
        ? `Lapsed${lapses ? ` on ${lapses}` : ''}. It was proved${checked ? ` on ${checked}` : ''}.`
        : 'Not checked yet';

  return (
    <span
      className={cn('inline-flex items-start gap-2', className)}
      role="group"
      aria-label={label}
    >
      <Glyph state={state} size={size} />
      <span className="min-w-0">
        <span
          className={cn(
            'block text-xs font-semibold uppercase tracking-wide',
            state === 'proved' ? 'text-accent-700' : 'text-ink-700',
          )}
        >
          {STATE_LABEL[state]}
        </span>
        <span aria-hidden="true" className="block text-xs tabular-nums text-ink-700">
          {state === 'unproved'
            ? 'File the four lines, then submit it'
            : state === 'lapsed'
              ? `Lapsed ${lapses ?? 'already'}`
              : lapses
                ? `${checked ?? 'Checked'} · until ${lapses}`
                : `${checked ?? 'Checked'} · does not lapse`}
        </span>
        {detail && (
          <span aria-hidden="true" className="mt-0.5 block text-xs text-ink-700">
            {detail}
          </span>
        )}
      </span>
    </span>
  );
}

/**
 * The state a stored evidence item is actually in right now.
 *
 * Mirrors `isVerified` in `services/api/src/domain/matching-service.ts`
 * rather than trusting `verificationState` alone: an item verified in 2026
 * against a credential that expired in 2027 is stored as `verified`
 * forever, and the server stops counting it the day it lapses. A mark that
 * did not do the same comparison would keep showing a live check for
 * something the marketplace had already dropped.
 */
export function proofMarkState(
  item: { verificationState: string; verificationExpiresAt?: string | undefined },
  now: Date = new Date(),
): ProofMarkState {
  if (item.verificationState !== 'verified') return 'unproved';
  if (!item.verificationExpiresAt) return 'proved';

  // Shape-checked before parsing, for the same reason the server does it:
  // Date.parse salvages a year out of prose, so "sometime in 2029" would
  // otherwise become a confident expiry.
  if (!/^\d{4}-\d{2}-\d{2}T/.test(item.verificationExpiresAt)) return 'lapsed';
  const expiry = Date.parse(item.verificationExpiresAt);
  if (Number.isNaN(expiry)) return 'lapsed';
  return expiry > now.getTime() ? 'proved' : 'lapsed';
}
