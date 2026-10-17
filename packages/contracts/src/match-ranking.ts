import { EVIDENCE_STRENGTH_LEVELS } from './evidence-strength';
import type { Match } from './domain';

/**
 * The order a shortlist is read in, defined once for everybody who shows
 * one.
 *
 * This lives in contracts rather than in either the API or the web app
 * because it was written twice and the two copies disagreed. The server
 * ranked by how well a candidate answered what the role asked for; the
 * employer's role page re-sorted the same list in the browser by score
 * alone. The browser's copy is the one an employer actually sees, so the
 * server's rule had no effect on the product at all, and nothing failed to
 * make that visible.
 *
 * A ranking rule is a product decision, not an implementation detail of
 * whichever process happens to hold the list. One definition, imported by
 * both.
 */

/**
 * How well the candidate matches what the role said it needed.
 *
 * First, ahead of coverage, deliberately. A role states the countries it
 * can employ in and how far from its working hours it can stretch, and a
 * candidate outside either is kept in the list with an explanation rather
 * than dropped, because the employer may still want them. What they must
 * not do is outrank somebody hireable. Before this, a candidate in the
 * wrong country with broader proof sat at the top of the list.
 *
 * A match with no recorded fit reads as `meets`, the same as everywhere
 * else, so a shortlist stored before tiering existed does not reorder
 * itself under an employer who already looked at it.
 */
function fitRank(fit: Match['fit']): number {
  switch (fit ?? 'meets') {
    case 'meets':
      return 2;
    case 'partial':
      return 1;
    case 'adjacent':
      return 0;
  }
}

/** Absent sorts below everything: a match scored before ranking used strength. */
function strengthRank(level: Match['strongestEvidence']): number {
  return level ? EVIDENCE_STRENGTH_LEVELS.indexOf(level) : -1;
}

/**
 * Fit, then how much of the role the proof covers, then how rigorously
 * that proof was checked, then candidate id so equal matches hold their
 * place between loads rather than shuffling.
 */
export function compareMatchesForDisplay(a: Match, b: Match): number {
  return (
    fitRank(b.fit) - fitRank(a.fit) ||
    b.matchScore - a.matchScore ||
    strengthRank(b.strongestEvidence) - strengthRank(a.strongestEvidence) ||
    a.candidateId.localeCompare(b.candidateId)
  );
}

/** The same order, as a new array. Never sorts the caller's list in place. */
export function byStrongestMatch<T extends Match>(matches: T[]): T[] {
  return [...matches].sort(compareMatchesForDisplay);
}
