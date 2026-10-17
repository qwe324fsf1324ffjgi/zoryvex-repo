import { ENGAGEMENT_KIND_LABELS, type EngagementKind } from '@zoryvex/contracts';

/**
 * What kind of work this candidate said they want.
 *
 * Matching has read `intent.openTo` since it was written, and reported it
 * only as an absence: when a candidate's list excludes what the role
 * offers, the fit reason says so. When it includes it, or when they listed
 * nothing at all, the employer was told nothing either way, so "open to
 * tutoring and mentoring" and "never answered" looked the same.
 *
 * It matters most to the person about to spend an unlock. Reaching somebody
 * who wants a permanent role to offer them a week of training wastes an
 * allowance and lands as an unwanted approach, and the fact that would have
 * prevented it was in the database the whole time.
 *
 * Three states, not two, because "no preference" is an answer and an
 * employer reading a silent row should not have to guess which silence it
 * is. A row written before the field existed says nothing, which is honest:
 * we do not know what they chose, so we do not say.
 */
export function OpenToLine({ openTo }: { openTo: EngagementKind[] | undefined }) {
  if (openTo === undefined) return null;

  if (openTo.length === 0) {
    return (
      <p className="mt-2 text-xs text-ink-700">
        They have not said which kinds of work they want, so this role was not ruled out on that.
      </p>
    );
  }

  return (
    <p className="mt-2 break-words text-xs text-ink-700">
      <span className="font-medium text-ink-950">Open to:</span>{' '}
      {openTo.map((kind) => ENGAGEMENT_KIND_LABELS[kind]).join(', ')}
    </p>
  );
}
