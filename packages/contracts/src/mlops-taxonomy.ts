import type { LaunchTrack } from './domain';

/**
 * One canonical, versioned source for MLOps role-title aliases and its
 * evidence/skill vocabulary — added per the founder's MLOps role-taxonomy
 * amendment (2026-08-25), instead of scattering hard-coded strings through
 * search, filters, candidate/employer UI, and Kit generation. `mlops` is a
 * single LaunchTrack value (packages/contracts/src/domain.ts); the titles
 * below are searchable/displayable aliases for that one track, not separate
 * structural tracks — see docs/PHASE_REGISTER.md's "Amendments integrated"
 * section for the full reasoning (a fragmented set of near-identical tracks
 * would work against the 5-real-match marketplace gate this repo already
 * enforces per saved role).
 */
export const MLOPS_TAXONOMY_VERSION = 1;

/**
 * Job titles a candidate or employer might type, all mapped to the single
 * `mlops` LaunchTrack for search/filter/display purposes. Order is not
 * significant. Adding a title here never requires a schema migration.
 */
export const MLOPS_ROLE_TITLE_ALIASES: readonly string[] = [
  'MLOps Engineer',
  'ML Platform Engineer',
  'ML Infrastructure Engineer',
  'AI Platform Engineer',
  'Machine Learning Operations Engineer',
  'Machine Learning Infrastructure Engineer',
];

export const MLOPS_LAUNCH_TRACK: LaunchTrack = 'mlops';

/**
 * Deliberately explicit per the amendment: "do not falsely treat every data
 * scientist, AI engineer, software engineer, DevOps engineer, or cloud
 * engineer as an MLOps professional." Not consumed by any structural
 * matching logic (no code should reject a title merely for matching this
 * list) — this is guidance for copy/UI and human review, not a filter.
 */
export const MLOPS_NON_ALIAS_TITLES: readonly string[] = [
  'Data Scientist',
  'AI Engineer',
  'Software Engineer',
  'DevOps Engineer',
  'Cloud Engineer',
];

/**
 * A stable id per capability area (not the display label, so relabeling
 * never breaks stored evidence-tag references), grouped under the 20 areas
 * the amendment lists. Used for employer requirement filters, candidate
 * evidence tagging, and Proof Hiring Kit checklist/rubric generation for
 * `mlops` roles — the same way `Role.mustHaveWork` free-text items already
 * drive `packages/kit-templates`, except this vocabulary gives MLOps roles
 * and candidate evidence a shared, structured set of terms to reference
 * rather than only free text.
 */
export interface MlopsCapabilityArea {
  id: string;
  label: string;
}

export const MLOPS_CAPABILITY_AREAS: readonly MlopsCapabilityArea[] = [
  { id: 'ml_lifecycle_design', label: 'Machine-learning lifecycle design' },
  { id: 'training_pipelines', label: 'Reproducible model training and evaluation pipelines' },
  { id: 'data_feature_pipelines', label: 'Data and feature pipeline operations' },
  { id: 'experiment_tracking', label: 'Experiment tracking and reproducibility' },
  { id: 'artifact_versioning', label: 'Model, prompt, dataset, and artifact versioning' },
  { id: 'model_registry', label: 'Model registry and release management' },
  { id: 'ml_cicd', label: 'CI/CD and continuous testing for ML systems' },
  { id: 'ml_iac', label: 'Infrastructure as code for ML workloads' },
  {
    id: 'model_deployment',
    label: 'Batch, asynchronous, real-time, serverless, containerized, or managed model deployment',
  },
  { id: 'model_serving', label: 'Model serving and inference operations' },
  {
    id: 'ml_monitoring',
    label: 'Model, data, concept, bias, quality, latency, error, and cost monitoring',
  },
  { id: 'drift_detection', label: 'Drift detection and response' },
  {
    id: 'staged_releases',
    label: 'Rollback, fallback, canary, shadow, blue-green, and staged ML releases',
  },
  { id: 'human_in_the_loop', label: 'Human-in-the-loop review' },
  { id: 'explainability_evaluation', label: 'Explainability and evaluation' },
  {
    id: 'responsible_ai_governance',
    label: 'Responsible AI, privacy, security, governance, and auditability',
  },
  { id: 'ml_cost_optimization', label: 'Cloud cost optimization for training and inference' },
  {
    id: 'aws_ml_genai_ops',
    label: 'AWS machine-learning and generative-AI operations',
  },
  {
    id: 'ml_platform_tooling',
    label:
      'Orchestration, observability, automation, GitHub, Terraform, Python, containers, APIs, data, and cloud-platform experience',
  },
  {
    id: 'llmops_genai_ops',
    label: 'LLMOps or generative-AI operations',
  },
];

/**
 * `llmops_genai_ops` and `aws_ml_genai_ops` require their own specific
 * supporting evidence per the amendment ("do not assume it from generic
 * MLOps experience") — never implied by the presence of any other area in
 * `MLOPS_CAPABILITY_AREAS`. Consuming code (evidence tagging, matching, Kit
 * checklists) must treat these two ids as independently evidenced, not as
 * implied by a broader MLOps claim.
 */
export const MLOPS_CAPABILITY_AREAS_REQUIRING_SPECIFIC_EVIDENCE: readonly string[] = [
  'aws_ml_genai_ops',
  'llmops_genai_ops',
];
