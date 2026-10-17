import type { AttemptHistory, GradedAttempt, GradedAttemptRecord } from '@zoryvex/contracts';

/**
 * Reading a sequence of graded attempts, without pretending it is more than
 * it is.
 *
 * See packages/contracts/src/attempt-history.ts for why this is not called
 * process observation. Briefly: it is where somebody was each time they
 * stopped and asked, not how they got there.
 */

/**
 * Turns what the store keeps into what an employer reads.
 *
 * The number is assigned here rather than written down at submission time.
 * Two submissions landing together would otherwise each read the same count
 * and each claim to be attempt 3; derived from order, the sequence cannot
 * duplicate a number or leave a gap.
 *
 * Sorted by time, and the sort is stable, so records sharing a timestamp keep
 * the order the store returned them in rather than being shuffled into an
 * arbitrary one.
 */
export function numberInOrder(records: GradedAttemptRecord[]): GradedAttempt[] {
  return [...records]
    .sort((a, b) => a.at.localeCompare(b.at))
    .map((record, index) => ({ ...record, attemptNumber: index + 1 }));
}

export function summariseAttempts(attempts: GradedAttempt[]): AttemptHistory {
  const ordered = [...attempts].sort((a, b) => a.attemptNumber - b.attemptNumber);
  const first = ordered[0];
  return {
    attempts: ordered,
    // Nothing outstanding on the first submission. Deliberately not "passed
    // eventually": the distinction is the entire point of keeping this.
    passedFirstTime: Boolean(first?.passed) && first?.failedCheckIds.length === 0,
    // Surfaced even when a later attempt passed. "Wrote a credential into the
    // config, then removed it" is something an employer may reasonably want
    // to know, and hiding it behind an eventual pass chooses for them.
    everDisqualified: ordered.some((a) => a.disqualified),
  };
}

/**
 * One line an employer can read without learning the rubric.
 *
 * Says what happened and stops. Three attempts is not worse than one — good
 * engineers get things wrong, are told, and fix them, and a product that
 * framed that as a failing would teach people to submit once and guess.
 */
export function describeAttempts(history: AttemptHistory): string {
  const count = history.attempts.length;
  if (count === 0) return 'No graded attempt recorded.';

  const passedAt = history.attempts.find((a) => a.passed)?.attemptNumber;
  const parts: string[] = [];

  if (history.passedFirstTime) {
    parts.push('Passed on the first submission, with nothing outstanding.');
  } else if (passedAt) {
    const missed = history.attempts
      .filter((a) => a.attemptNumber < passedAt)
      .flatMap((a) => a.failedCheckIds);
    const unique = [...new Set(missed)];
    parts.push(
      `Passed on attempt ${passedAt} of ${count}.` +
        (unique.length > 0 ? ` Earlier attempts missed: ${unique.join(', ')}.` : ''),
    );
  } else {
    parts.push(`${count} attempt${count === 1 ? '' : 's'}, none passing yet.`);
  }

  if (history.everDisqualified) {
    // Named plainly rather than softened. A disqualifying check is the one
    // outcome a task exists to prevent, and an employer deciding whether it
    // matters needs to know it happened.
    parts.push('At least one attempt tripped a disqualifying check.');
  }

  return parts.join(' ');
}
