import type { Role } from '@zoryvex/contracts';

export interface ProofGapPreview {
  headline: string;
  gaps: string[];
  note: string;
}

/**
 * Free preview: useful on its own, deliberately incomplete — the full
 * evidence checklist / claim-verification matrix / rubric / interview
 * guide / scorecard only exist after the Kit is purchased for this role.
 * Moved from apps/web (Phase 4) into this shared package (Phase 7) so
 * services/api's real, paid Kit generation and the client-side free
 * preview are provably the same deterministic logic, never two copies
 * that could silently drift.
 */
export function generateProofGapPreview(
  role: Pick<Role, 'title' | 'mustHaveWork' | 'outcomes'>,
): ProofGapPreview {
  return {
    headline: `To hire well for "${role.title}", you'll need evidence of ${role.mustHaveWork.length} specific ${role.mustHaveWork.length === 1 ? 'thing' : 'things'}, not just a resume claim.`,
    gaps: role.mustHaveWork,
    // The last sentence a reader sees at the exact moment they have just been
    // shown their own gaps, which makes it the most load-bearing line in the
    // funnel. It used to list the five deliverables, which answers "what do I
    // get" for someone who has not yet decided they want anything.
    //
    // What it says now is the consequence, and it is definitionally true
    // rather than a claim about hiring: a CV entry is an assertion, and an
    // assertion is not evidence. No statistic, no research, nothing this
    // repository cannot stand behind (docs/COMMERCIAL_RUNBOOK.md).
    note: 'Right now every one of these is a claim on a CV. The Kit is the method for checking them one at a time, and for scoring what you actually find.',
  };
}
