import type {
  CandidateIntent,
  Candidate,
  CandidateLocation,
  LaunchTrack,
} from '@zoryvex/contracts';
import { apiRequest } from './client';

export async function getProfile(): Promise<{ candidate: Candidate; version: number }> {
  return apiRequest('/candidates/me');
}

export interface UpdateProfileInput {
  displayName?: string;
  launchTrack?: LaunchTrack;
  summary?: string;
  onboardingComplete?: boolean;
  /**
   * null clears a stated location; omitting the key leaves whatever is
   * there alone. Both are needed, and they mean opposite things: without
   * null a candidate could state a location and never take it back.
   */
  location?: CandidateLocation | null;
  /**
   * What this person is open to and what they need to be paid. Null
   * clears it, for the same reason location is null-clearable: omitting
   * the key means "this update does not mention intent" and would leave a
   * stated preference in place forever.
   */
  intent?: CandidateIntent | null;
  /**
   * Optional contact channels, null-clearable for the same reason location
   * is: without null a candidate could give a number and never take it back.
   * They are inert until an employer unlocks contact and the candidate's
   * consent stands, so nothing here changes who can see what by itself.
   */
  phone?: string | null;
  linkedinUrl?: string | null;
  websiteUrl?: string | null;
  /** A file the candidate already uploaded, or null to take the photo down. */
}

/** Never accepts discoveryOptIn/contactUnlockConsent — use privacy.ts's updateConsent for those. */
export async function updateProfile(
  version: number,
  patch: UpdateProfileInput,
): Promise<{ candidate: Candidate; version: number }> {
  return apiRequest('/candidates/me', { method: 'PATCH', body: { version, ...patch } });
}
