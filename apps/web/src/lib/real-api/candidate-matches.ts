import type { InterestState, Match, RoleIntent } from '@zoryvex/contracts';
import { apiRequest } from './client';

/**
 * What a candidate is shown about one of their own matches.
 *
 * Mirrors the API's CandidateMatchView exactly rather than reshaping it.
 * A translation layer here would be a second place for the rules about
 * what a candidate may see to live, and the point of this view is that
 * the narrowing happens once, on the server.
 */
export interface CandidateMatchView {
  roleId: string;
  roleTitle: string;
  employerId: string;
  matchScore: number;
  fit?: 'meets' | 'partial' | 'adjacent';
  fitReason?: string;
  /** Absent when the employer has published no pay range. */
  compensation?: RoleIntent;
  candidateInterest: InterestState;
  employerInterest: InterestState;
  /** True only when both sides have actively said yes. */
  mutual: boolean;
}

/**
 * The roles this candidate has been matched to.
 *
 * No candidate id is sent: the server reads it from the session. There is
 * deliberately no way to ask for somebody else's matches.
 */
export async function listMyMatches(): Promise<CandidateMatchView[]> {
  const result = await apiRequest<{ matches: CandidateMatchView[] }>('/candidates/me/matches');
  return result.matches;
}

/** The candidate's half of a mutual match. */
export async function setMyInterest(roleId: string, interest: InterestState): Promise<Match> {
  return apiRequest(`/candidates/me/matches/${roleId}/interest`, {
    method: 'POST',
    body: { interest },
  });
}
