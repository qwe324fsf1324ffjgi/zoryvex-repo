import type { Evidence } from '@zoryvex/contracts';

const now = '2026-08-01T00:00:00.000Z';

function evidence(partial: Omit<Evidence, 'createdAt' | 'updatedAt'>): Evidence {
  return { createdAt: now, updatedAt: now, ...partial };
}

/**
 * FICTIONAL TEST DATA — invented work samples, not real evidence.
 *
 * The states here are deliberately mixed, because a demo that shows every
 * item already verified would misrepresent how the product actually behaves.
 * Two items carry a completed autonomous verification, one is still awaiting
 * one, and one is private. Only the verified items reach an employer
 * (services/api/src/domain/matching-service.ts), which is exactly what the
 * demo should let someone see for themselves.
 */
export const EVIDENCE: Evidence[] = [
  evidence({
    id: 'ev_amara_1',
    candidateId: 'cand_amara',
    source: 'project',
    claim: 'Migrated a monolith to containerized services on ECS Fargate',
    context: 'A single EC2-hosted Rails app was the only deploy target for a 6-person team.',
    actions:
      'Containerized the app, wrote the ECS task/service Terraform, set up blue/green deploys.',
    outcome: 'Deploy time went from 25 minutes to 4; zero-downtime deploys became routine.',
    verificationState: 'verified',
    verificationMethod: 'issuer_badge',
    verifiedAt: '2026-08-02T09:12:00.000Z',
    verificationRef: '00000000-0000-4000-8000-00000000ama1',
    visibility: 'discovery',
    consentGiven: true,
  }),
  evidence({
    id: 'ev_kelechi_1',
    candidateId: 'cand_kelechi',
    source: 'writeup',
    claim: 'Built a multi-account AWS Organizations landing zone',
    context: 'Company had one shared AWS account with no separation between prod and test.',
    actions:
      'Designed an Organizations structure with SCPs, centralized CloudTrail and log archive.',
    outcome:
      'Prod/test isolation achieved with zero cross-account incidents in 6 months post-launch.',
    verificationState: 'verified',
    verificationMethod: 'issuer_badge',
    verifiedAt: '2026-08-03T14:40:00.000Z',
    verificationRef: '00000000-0000-4000-8000-0000000kel1',
    visibility: 'discovery',
    consentGiven: true,
  }),
  evidence({
    id: 'ev_ngozi_1',
    candidateId: 'cand_ngozi',
    source: 'github',
    claim: 'Cut CI pipeline time from 40 to 9 minutes',
    context: 'A monorepo CI pipeline rebuilt every package on every push.',
    actions: 'Introduced dependency-aware build caching and parallelized independent test suites.',
    // Deliberately not verified: this is what an item looks like while the
    // candidate is still working through the checks.
    outcome: 'Median PR feedback time dropped from 40 minutes to 9.',
    verificationState: 'unverified',
    visibility: 'discovery',
    consentGiven: true,
  }),
  evidence({
    id: 'ev_chidi_1',
    candidateId: 'cand_chidi',
    source: 'writeup',
    claim: 'Ran a tabletop incident-response exercise',
    context: 'Team had a written incident process that had never been tested.',
    actions: 'Designed and ran a tabletop exercise, documented every gap found.',
    outcome: 'All 7 identified gaps were closed within the following sprint.',
    verificationState: 'unverified',
    visibility: 'private',
    consentGiven: false,
  }),
];
