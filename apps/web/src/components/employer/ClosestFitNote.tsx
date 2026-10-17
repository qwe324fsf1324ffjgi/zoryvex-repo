import type { Match } from '@zoryvex/contracts';

/**
 * What to say when nobody on the shortlist matches everything.
 *
 * Matching stopped excluding people some time ago: a candidate outside the
 * location requirement, or whose proof backs none of the written must-haves,
 * still appears, marked `partial` or `adjacent`. That was the right call and
 * it left a gap in the reading. An employer opening a list where every card
 * says "Close, not exact" sees a page of near-misses and no indication that
 * this is normal, that the list is ordered, or that the top row is the
 * closest thing to what they asked for.
 *
 * So this says it once, above the list, and only when it is true. It does
 * not appear when an exact match exists, because then the list speaks for
 * itself and a note would be noise.
 *
 * The framing is the product's own, already used where a candidate's proof
 * backs none of the written requirements: a requirement list is a guess at
 * what the work needs. Encouraging somebody to read a partial match is
 * honest for that reason, and it stops short of recommending a hire, which
 * is not a judgement this product makes.
 */
export function ClosestFitNote({ matches }: { matches: Match[] }) {
  if (matches.length === 0) return null;

  // A match written before fit tiering has no `fit` and is read as `meets`
  // everywhere else, so it is read as `meets` here too. A stored shortlist
  // must not start apologising for itself because a field was added later.
  const hasExact = matches.some((match) => (match.fit ?? 'meets') === 'meets');
  if (hasExact) return null;

  return (
    <p className="mb-4 rounded-md border border-warm-300 bg-warm-100 px-3 py-2 text-sm text-ink-700">
      <span className="font-medium text-ink-950">Nobody here matches every requirement.</span> The
      closest is first, and each card says what that person does have and where the gap is. A
      requirement list is a guess at what the work needs, so a partial match is often worth a
      conversation before you rule it out.
    </p>
  );
}
