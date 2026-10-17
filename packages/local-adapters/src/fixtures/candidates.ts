import type { Candidate } from '@zoryvex/contracts';

/**
 * FICTIONAL TEST DATA. Every person here is invented for local
 * development/demo/testing only — not a real candidate, never used with
 * real evidence or contact details. See docs/PRIVACY_AND_RETENTION.md.
 */

const now = '2026-08-01T00:00:00.000Z';

function candidate(
  partial: Omit<Candidate, 'createdAt' | 'updatedAt' | 'summary'> & { summary?: string },
): Candidate {
  // Contact-sharing consent defaults on here because these fixtures exist to
  // exercise the marketplace, and an employer cannot unlock a contact without
  // it — the server refuses outright. It used to be absent from every fixture,
  // which meant the demo showed contacts being unlocked for candidates who
  // had never agreed to it, while the real backend would have refused every
  // one of those unlocks. cand_amara below deliberately opts out, so the
  // refusal has somewhere to be seen.
  // Reachability defaults on for the same reason, and it is a different axis
  // from consent. Since 2026-09-14 a candidate is only findable if an
  // employer could act on the result: a phone number and one link to where
  // the work lives. A fixture without them would be invisible to every
  // shortlist, which would empty the demo marketplace rather than exercise
  // it. cand_amara keeps both and still refuses to share them, which is the
  // combination worth being able to see.
  //
  // Fictional throughout. The number is in Ofcom's reserved drama range and
  // reaches nobody; the domain is IANA's reserved example.com.
  return {
    summary: '',
    contactUnlockConsent: true,
    phone: '+447700900123',
    websiteUrl: 'https://example.com/portfolio',
    createdAt: now,
    updatedAt: now,
    ...partial,
  };
}

// aws_cloud: 5 discovery-opted (marketplace gate OPEN for this track) + 1 opted-out
export const AWS_CLOUD_CANDIDATES: Candidate[] = [
  candidate({
    id: 'cand_amara',
    email: 'amara.demo@example.com',
    displayName: 'Amara (fictional test candidate)',
    launchTrack: 'aws_cloud',
    discoveryOptIn: true,
    // Findable, but not contactable. The two consents are separate, and this
    // is the combination that has to work: an employer reads the evidence and
    // is told plainly that this one cannot be reached, rather than spending an
    // unlock to find out.
    contactUnlockConsent: false,
    onboardingComplete: true,
    summary:
      'Migrated a monolith to containerized services on ECS Fargate; owns cost-guardrail tooling.',
  }),
  candidate({
    id: 'cand_kelechi',
    email: 'kelechi.demo@example.com',
    displayName: 'Kelechi (fictional test candidate)',
    launchTrack: 'aws_cloud',
    discoveryOptIn: true,
    onboardingComplete: true,
    summary:
      'Built a multi-account AWS Organizations landing zone with SCPs and centralized logging.',
  }),
  candidate({
    id: 'cand_bayo',
    email: 'bayo.demo@example.com',
    displayName: 'Bayo (fictional test candidate)',
    launchTrack: 'aws_cloud',
    discoveryOptIn: true,
    onboardingComplete: true,
    summary:
      'Reduced a Lambda-based pipeline’s cold-start latency by redesigning package layering.',
  }),
  candidate({
    id: 'cand_chioma',
    email: 'chioma.demo@example.com',
    displayName: 'Chioma (fictional test candidate)',
    launchTrack: 'aws_cloud',
    discoveryOptIn: true,
    onboardingComplete: true,
    summary: 'Led a DynamoDB single-table redesign that removed every scan from a hot read path.',
  }),
  candidate({
    id: 'cand_segun',
    email: 'segun.demo@example.com',
    displayName: 'Segun (fictional test candidate)',
    launchTrack: 'aws_cloud',
    discoveryOptIn: true,
    onboardingComplete: true,
    summary:
      'Implemented S3/CloudFront static hosting with OAC, cut origin egress cost by two-thirds.',
  }),
  candidate({
    id: 'cand_ifeanyi',
    email: 'ifeanyi.demo@example.com',
    displayName: 'Ifeanyi (fictional test candidate)',
    launchTrack: 'aws_cloud',
    discoveryOptIn: false,
    onboardingComplete: false,
  }),
];

// devops_platform: 4 discovery-opted (below the 5-match gate)
export const DEVOPS_PLATFORM_CANDIDATES: Candidate[] = [
  candidate({
    id: 'cand_ngozi',
    email: 'ngozi.demo@example.com',
    displayName: 'Ngozi (fictional test candidate)',
    launchTrack: 'devops_platform',
    discoveryOptIn: true,
    onboardingComplete: true,
    summary: 'Cut CI pipeline time from 40 to 9 minutes by restructuring build caching.',
  }),
  candidate({
    id: 'cand_tunde',
    email: 'tunde.demo@example.com',
    displayName: 'Tunde (fictional test candidate)',
    launchTrack: 'devops_platform',
    discoveryOptIn: true,
    onboardingComplete: true,
    summary:
      'Introduced GitOps-based deploys for a 12-service platform, removing manual rollout steps.',
  }),
  candidate({
    id: 'cand_folake',
    email: 'folake.demo@example.com',
    displayName: 'Folake (fictional test candidate)',
    launchTrack: 'devops_platform',
    discoveryOptIn: true,
    onboardingComplete: true,
    summary:
      'Wrote the on-call runbook and incident-response process a 6-engineer team still uses.',
  }),
  candidate({
    id: 'cand_uche',
    email: 'uche.demo@example.com',
    displayName: 'Uche (fictional test candidate)',
    launchTrack: 'devops_platform',
    discoveryOptIn: true,
    onboardingComplete: true,
    summary: 'Built a self-service internal developer platform on top of Terraform modules.',
  }),
];

// cloud_security: 0 discovery-opted (zero-match scenario)
export const CLOUD_SECURITY_CANDIDATES: Candidate[] = [
  candidate({
    id: 'cand_chidi',
    email: 'chidi.demo@example.com',
    displayName: 'Chidi (fictional test candidate)',
    launchTrack: 'cloud_security',
    discoveryOptIn: false,
    onboardingComplete: true,
    summary: 'Ran a tabletop incident-response exercise and closed the findings within a sprint.',
  }),
  candidate({
    id: 'cand_zainab',
    email: 'zainab.demo@example.com',
    displayName: 'Zainab (fictional test candidate)',
    launchTrack: 'cloud_security',
    discoveryOptIn: false,
    onboardingComplete: false,
  }),
];

export const ALL_CANDIDATES: Candidate[] = [
  ...AWS_CLOUD_CANDIDATES,
  ...DEVOPS_PLATFORM_CANDIDATES,
  ...CLOUD_SECURITY_CANDIDATES,
];
