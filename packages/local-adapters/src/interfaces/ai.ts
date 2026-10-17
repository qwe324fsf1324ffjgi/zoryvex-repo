import type { Candidate, Evidence, Role } from '@zoryvex/contracts';

export interface MatchSuggestion {
  candidateId: string;
  score: number;
  rationale: string;
}

/**
 * Deterministic, heuristic, clearly-labeled-synthetic outputs only — never
 * a real model call. Every rule in docs/AI_SAFETY.md still applies to the
 * local implementation: no protected-trait input, no face scoring, output
 * is always a suggestion for a human to review, never applied as a
 * decision by this adapter itself.
 */
export interface AIAdapter {
  summarizeEvidence(evidence: Evidence): string;
  suggestMatches(role: Role, candidates: Candidate[]): MatchSuggestion[];
}
