import type {
  AttemptHistory,
  EvidenceStrength,
  InterestState,
  Match,
  VerificationMethod,
} from '@zoryvex/contracts';
import { apiRequest } from './client';

export async function listMatches(roleId: string): Promise<Match[]> {
  return apiRequest(`/roles/${roleId}/matches`);
}

export interface RecomputeResult {
  matches: Match[];
  /**
   * Candidates whose evidence meets this role's requirements but who sit
   * outside its location requirement. They are in `matches`, marked
   * `partial`; the count is reported so an employer can weigh the filter
   * without reading every card.
   */
  locationExcluded: number;
  /**
   * Candidates carrying verified proof that backs none of the written
   * requirements. Also in `matches`, marked `adjacent`. A requirement list is
   * a guess at what the work needs, and this is how many proved people that
   * guess is talking past.
   */
  beyondRequirements: number;
}

/** Deterministic baseline only — never calls Bedrock. Preserves status/contactUnlocked/aiExplanation. */
export async function recomputeMatches(roleId: string): Promise<RecomputeResult> {
  return apiRequest(`/roles/${roleId}/matches/recompute`, { method: 'POST' });
}

export interface ContactUnlockResult {
  match: Match;
  alreadyUnlocked: boolean;
}

/**
 * Matches services/api/src/domain/contact-unlock-service.ts's actual return
 * shape exactly (found and fixed 2026-08-26 — the type here previously
 * claimed an `{allowed, reason}` shape copy-pasted from an internal,
 * never-serialized repository type; the real API never returns that shape).
 * Every failure path (no consent, allowance exhausted, role/match not
 * found) throws instead of returning — catch RealApiError and branch on
 * `.status` (403 forbidden, 404 not found). A match already unlocked
 * before this call is not an error: it resolves normally with
 * `alreadyUnlocked: true`.
 */
export async function unlockContact(
  roleId: string,
  candidateId: string,
): Promise<ContactUnlockResult> {
  return apiRequest(`/roles/${roleId}/matches/${candidateId}/unlock-contact`, { method: 'POST' });
}

export interface UnlockedContactInfo {
  email: string;
  displayName: string;
  /**
   * Present only when the candidate gave the channel. Absent rather than
   * empty, so the UI can tell "they did not give a number" from "the field
   * exists and is blank" without guessing.
   */
  phone?: string;
  linkedinUrl?: string;
  websiteUrl?: string;
}

/** Only ever succeeds once unlockContact has already succeeded for this match. */
export async function getContact(
  roleId: string,
  candidateId: string,
): Promise<UnlockedContactInfo> {
  return apiRequest(`/roles/${roleId}/matches/${candidateId}/contact`);
}

export type MatchExplanationResult =
  | { available: true; explanation: string; citedEvidenceIds: string[] }
  | {
      available: false;
      reason: 'ai_matching_disabled' | 'ai_unavailable' | 'no_supporting_evidence';
    };

/**
 * `aiMatching` stays off in every deployed environment (docs/AI_SAFETY.md)
 * — every real call today returns `{available: false, reason:
 * "ai_matching_disabled"}`, never an error. The match's deterministic
 * rationale is unaffected either way.
 */
export async function explainMatch(
  roleId: string,
  candidateId: string,
): Promise<MatchExplanationResult> {
  return apiRequest(`/roles/${roleId}/matches/${candidateId}/explain`, { method: 'POST' });
}

export interface VerifiedEvidenceSummary {
  evidenceId: string;
  claim: string;
  context: string;
  actions: string;
  outcome: string;
  // The contract's own union rather than a copy of it. Spelled out here,
  // a fourth verification method would be returned by the server, parsed
  // fine at runtime, and rejected by the type that claims it cannot
  // happen. Importing it makes adding a method a compile error in every
  // place that has to care, which is the point of having the enum.
  method: VerificationMethod;
  /** What was checked, in words: the certification name, or the repository. */
  detail: string;
  /**
   * Whether an independent third party holds a public record of this check.
   *
   * Distinct from `sourceUrl`, which is also null when the organization has
   * no marketplace access. Without this the page could not tell "nothing
   * outside the candidate exists to check" from "a record exists and this
   * subscription does not open it", and would have to say the wrong one.
   */
  sourceAvailable: boolean;
  /** The issuer's own public record, so the employer can re-check it without us. */
  sourceUrl: string | null;
  verifiedAt: string;
  /**
   * What this evidence establishes, level by level, and the two levels
   * Zoryvex cannot establish for anybody. On the paid surface deliberately:
   * an employer reading a shortlist should be able to tell a credential
   * somebody else issued from work corroborated against a source the
   * candidate does not control, rather than seeing both as "verified".
   */
  strength: EvidenceStrength;
  /**
   * For a graded task, what happened across the candidate's submissions.
   *
   * Null for every other method rather than an empty history: a certification
   * has no rubric and no attempts, and "no graded attempt recorded" against
   * one would read as something missing rather than something that never
   * applied.
   *
   * Not a score, and nothing here is ranked on it. Three attempts is not
   * worse than one — good engineers get things wrong, are told, and fix them.
   */
  attempts: AttemptHistory | null;
  /** The same history in one line, for a reader who will not open the list. */
  attemptSummary: string | null;
}

/**
 * The proof behind a match.
 *
 * Served to any employer who owns the role, so a buyer can judge the
 * reasoning before subscribing. The source address inside each item is what
 * a marketplace subscription releases; without one it is null and the
 * repository identity is redacted from the detail text too. Contact details
 * remain a separate, separately-consented unlock on top of that.
 *
 * Read on demand rather than carried on the match, so a candidate hiding an
 * item or losing a verification takes effect immediately instead of at the
 * next recompute.
 */
export async function listMatchEvidence(
  roleId: string,
  candidateId: string,
): Promise<VerifiedEvidenceSummary[]> {
  return apiRequest(`/roles/${roleId}/matches/${candidateId}/evidence`);
}

/**
 * The employer's half of a mutual match.
 *
 * Sends only the employer's own answer. The candidate's is theirs to give
 * and the API refuses a request that tries to carry it, so there is
 * nothing to send here even if a caller wanted to.
 */
export async function setEmployerInterest(
  roleId: string,
  candidateId: string,
  interest: InterestState,
): Promise<Match> {
  return apiRequest(`/roles/${roleId}/matches/${candidateId}/interest`, {
    method: 'POST',
    body: { interest },
  });
}
