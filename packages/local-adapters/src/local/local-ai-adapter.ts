import type { Candidate, Evidence, Role } from '@zoryvex/contracts';
import { LAUNCH_TRACK_LABELS } from '@zoryvex/contracts';
import type { AIAdapter, MatchSuggestion } from '../interfaces/ai';

const SUMMARY_DISCLAIMER =
  'AI-generated summary of the evidence below — verify before deciding, not a decision by itself.';

/** Deterministic 0..1 score from two IDs — no randomness, no protected-trait input. */
function deterministicScore(a: string, b: string): number {
  const input = `${a}:${b}`;
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 31 + input.charCodeAt(i)) >>> 0;
  }
  return (hash % 1000) / 1000;
}

export class LocalAIAdapter implements AIAdapter {
  summarizeEvidence(evidence: Evidence): string {
    return [
      SUMMARY_DISCLAIMER,
      `Claim: ${evidence.claim}`,
      `Context: ${evidence.context}`,
      `Actions: ${evidence.actions}`,
      `Outcome: ${evidence.outcome}`,
    ].join(' ');
  }

  suggestMatches(role: Role, candidates: Candidate[]): MatchSuggestion[] {
    return candidates
      .filter((c) => c.launchTrack === role.launchTrack && c.discoveryOptIn)
      .map((c) => ({
        candidateId: c.id,
        score: deterministicScore(role.id, c.id),
        rationale: `Opted into discovery for ${LAUNCH_TRACK_LABELS[role.launchTrack]}; onboarding ${
          c.onboardingComplete ? 'complete' : 'incomplete'
        }. Review the candidate's own evidence before deciding — this is a suggestion, not a ranking of merit.`,
      }))
      .sort((a, b) => b.score - a.score);
  }
}
