import type { Candidate, CandidateLocation, LaunchTrack } from '@zoryvex/contracts';
import { NotFoundError } from '../errors/typed-errors';
import type { Clock } from '../repositories/clock-repository';

export interface CandidateProfileDependencies {
  clock: Clock;
  getCandidate(candidateId: string): Promise<{ candidate: Candidate; version: number } | null>;
  updateCandidateProfile(
    candidateId: string,
    expectedVersion: number,
    patch: UpdateCandidateProfileInput,
    updatedAt: string,
  ): Promise<{ candidate: Candidate; version: number }>;
  /**
   * Keyed by candidate, so a file belonging to somebody else simply is not
   * found rather than being found and then rejected. Ownership is structural
   * here for the same reason it is on evidence.
   */
}

export async function getOwnCandidateProfile(
  candidateId: string,
  deps: Pick<CandidateProfileDependencies, 'getCandidate'>,
): Promise<{ candidate: Candidate; version: number }> {
  const result = await deps.getCandidate(candidateId);
  if (!result) throw new NotFoundError('Candidate profile not found');
  return result;
}

export interface UpdateCandidateProfileInput {
  displayName?: string | undefined;
  launchTrack?: LaunchTrack | undefined;
  summary?: string | undefined;
  onboardingComplete?: boolean | undefined;
  /**
   * Stated by the candidate about themselves, which is the only way this
   * field is ever allowed to be set. Nothing infers it from an IP address,
   * a phone prefix, or a name: an inferred location would turn an employer's
   * payroll filter into a proxy for nationality.
   *
   * `null` clears it, and clearing it means "I would rather not say" rather
   * than "nowhere". A candidate with no stated location is never filtered
   * out, so withdrawing it costs them no visibility.
   */
  location?: CandidateLocation | null | undefined;
  /**
   * How else a candidate is willing to be reached, if at all.
   *
   * Nullable for the same reason `location` is: `null` clears the field, and
   * clearing it costs nothing. Neither channel is used in matching, scoring
   * or ranking, neither appears on a public proof page, and neither reaches
   * an employer until they have unlocked contact and while consent still
   * stands. A candidate who gives neither is not ranked below one who gives
   * both.
   *
   * They live here rather than behind the consent endpoint because they are
   * ordinary profile data, not a permission. The permission is
   * `contactUnlockConsent`, which stays where it is and stays audited: these
   * fields are inert without it.
   */
  phone?: string | null | undefined;
  linkedinUrl?: string | null | undefined;
  websiteUrl?: string | null | undefined;
}

/**
 * Deliberately excludes `contactUnlockConsent`/`discoveryOptIn` — those are
 * owned exclusively by `src/domain/privacy-service.ts`'s `PATCH
 * /candidates/me/consent`, which appends an audit event on every real
 * change (docs/DATA_MODEL.md "Privacy and contact-unlock domain"). Routing
 * consent through this general profile endpoint too would create a second,
 * unaudited path to the same fields.
 */
export async function updateOwnCandidateProfile(
  candidateId: string,
  expectedVersion: number,
  patch: UpdateCandidateProfileInput,
  deps: CandidateProfileDependencies,
): Promise<{ candidate: Candidate; version: number }> {
  const now = deps.clock.now().toISOString();
  return deps.updateCandidateProfile(candidateId, expectedVersion, patch, now);
}
