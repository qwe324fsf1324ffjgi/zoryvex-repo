import type { Role } from '@zoryvex/contracts';

/**
 * Bumped only when the template's structure/content logic itself changes —
 * distinct from a per-role generated artifact's own version number (which
 * services/api tracks separately, incrementing on each regeneration; see
 * docs/DATA_MODEL.md's KitArtifact entity).
 */
export const KIT_TEMPLATE_VERSION = 1;

export interface KitDeliverables {
  version: number;
  generatedAt: string;
  roleSuccessProfile: { outcomes: string; seniority: string; mustHaveWork: string[] };
  evidenceChecklist: string[];
  claimVerificationMatrix: { claim: string; howToVerify: string }[];
  practicalAssessmentRubric: { criterion: string; passingBar: string }[];
  structuredInterviewGuide: string[];
  decisionScorecard: string[];
}

const VERIFY_HINTS: Record<string, string> = {
  aws_cloud: 'Ask for the infrastructure-as-code or console evidence and read it together.',
  devops_platform: 'Ask to see the pipeline config or dashboard, not just a description.',
  cloud_security: 'Ask for the finding, the fix, and how it was confirmed closed.',
  mlops:
    'Ask to see the training/serving pipeline, model registry entry, or monitoring dashboard, not just a description.',
};

/**
 * Deterministic derivation from role data alone — reproducible from the
 * role, so no separate persisted deliverable *content* record is needed
 * (only the rendered HTML artifact, once paid, is persisted — see
 * kit-html-document.ts). `now` is injectable for deterministic tests;
 * defaults to the real clock for real callers.
 */
export function generateKitDeliverables(role: Role, now: Date = new Date()): KitDeliverables {
  const verifyHint =
    VERIFY_HINTS[role.launchTrack] ?? 'Ask for direct evidence, not a description.';

  return {
    version: KIT_TEMPLATE_VERSION,
    generatedAt: now.toISOString(),
    roleSuccessProfile: {
      outcomes: role.outcomes,
      seniority: role.seniority,
      mustHaveWork: role.mustHaveWork,
    },
    evidenceChecklist: role.mustHaveWork.map((item) => `Evidence of: ${item}`),
    claimVerificationMatrix: role.mustHaveWork.map((item) => ({
      claim: item,
      howToVerify: verifyHint,
    })),
    practicalAssessmentRubric: role.mustHaveWork.map((item) => ({
      criterion: item,
      passingBar: 'Candidate can walk through real evidence of this, not just describe it.',
    })),
    structuredInterviewGuide: [
      `Tell me about a time you did: ${role.mustHaveWork[0] ?? 'the core work for this role'}. Walk me through it.`,
      ...role.mustHaveWork.slice(1).map((item) => `Same for: ${item}.`),
      `What would you do differently if you were solving for: ${role.outcomes}?`,
    ],
    decisionScorecard: [
      ...role.mustHaveWork.map((item) => `${item}: evidenced? (yes / partial / no)`),
      'Overall: would this hire achieve the stated outcome?',
    ],
  };
}
