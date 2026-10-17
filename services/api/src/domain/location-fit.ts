import type { CandidateLocation, RoleLocationRequirement } from '@zoryvex/contracts';

/**
 * Whether a candidate's stated location satisfies a role's location
 * requirement, and if not, why.
 *
 * Pure and separate from the matcher on purpose. This is the one piece of
 * matching that removes a person from a shortlist outright rather than
 * scoring them lower, so it is the piece most worth being able to read in
 * one screen and test exhaustively.
 *
 * Two rules shape everything below.
 *
 * The filter is an allow-list, never a deny-list. An employer says where
 * they can employ someone; they never say where they will not. The two are
 * equivalent in arithmetic and not at all equivalent in what they encourage,
 * and only one of them stays a payroll question rather than becoming a
 * question about people.
 *
 * A candidate who has not stated a location is never excluded. Location
 * arrived on 2026-09-01 and every candidate who signed up before it has
 * none. Dropping them would be a silent rejection caused by a schema change,
 * which is exactly what CLAUDE.md rules out, and the employer would have no
 * way of knowing it happened.
 */

export type LocationFit =
  | { fits: true; reason: 'no-requirement' | 'meets-requirement' | 'location-not-stated' }
  | { fits: false; reason: 'country' | 'timezone'; explanation: string };

const MINUTES_IN_A_DAY = 24 * 60;

/**
 * How far apart two working days really are, in hours.
 *
 * Offsets wrap. UTC+13 and UTC-11 look 24 hours apart subtracted naively and
 * are actually the same clock time, so a role in Auckland would reject a
 * candidate it shares an entire working day with. Taking the shorter way
 * round the clock is what makes the number mean "how much of the day do we
 * miss each other by".
 */
export function timezoneDifferenceHours(offsetMinutesA: number, offsetMinutesB: number): number {
  const raw = Math.abs(offsetMinutesA - offsetMinutesB);
  const shorterWayRound = Math.min(raw, MINUTES_IN_A_DAY - raw);
  return shorterWayRound / 60;
}

export function evaluateLocationFit(
  requirement: RoleLocationRequirement | undefined,
  location: CandidateLocation | undefined,
): LocationFit {
  if (!requirement) return { fits: true, reason: 'no-requirement' };
  if (!location) return { fits: true, reason: 'location-not-stated' };

  if (requirement.countries.length > 0 && !requirement.countries.includes(location.country)) {
    return {
      fits: false,
      reason: 'country',
      explanation:
        `Works from ${location.country}; this role can employ in ` +
        `${requirement.countries.join(', ')}.`,
    };
  }

  if (requirement.maxTimezoneDifferenceHours !== null) {
    const difference = timezoneDifferenceHours(
      requirement.utcOffsetMinutes,
      location.utcOffsetMinutes,
    );
    if (difference > requirement.maxTimezoneDifferenceHours) {
      return {
        fits: false,
        reason: 'timezone',
        explanation:
          `${formatHours(difference)} from this role's working hours; ` +
          `the role allows up to ${formatHours(requirement.maxTimezoneDifferenceHours)}.`,
      };
    }
  }

  return { fits: true, reason: 'meets-requirement' };
}

/** Half-hour offsets are real (India, Iran), so 5.5 must not print as 5.5000001 or 6. */
function formatHours(hours: number): string {
  const rounded = Math.round(hours * 2) / 2;
  const label = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  return `${label} ${rounded === 1 ? 'hour' : 'hours'}`;
}

/** True when a role filters on location at all. Used to decide whether to say so. */
export function hasLocationRequirement(requirement: RoleLocationRequirement | undefined): boolean {
  if (!requirement) return false;
  return requirement.countries.length > 0 || requirement.maxTimezoneDifferenceHours !== null;
}
