import type { Match } from '@zoryvex/contracts';
import { AWS_CLOUD_CANDIDATES, DEVOPS_PLATFORM_CANDIDATES } from './candidates';

const now = '2026-08-02T00:00:00.000Z';

function matchesFor(roleId: string, candidateIds: string[], status: Match['status']): Match[] {
  return candidateIds.map((candidateId, i) => ({
    id: `match_${roleId}_${candidateId}`,
    roleId,
    candidateId,
    matchScore: 0.6 + i * 0.05,
    status,
    contactUnlocked: false,
    createdAt: now,
  }));
}

const awsOptedInIds = AWS_CLOUD_CANDIDATES.filter((c) => c.discoveryOptIn).map((c) => c.id);
const devopsOptedInIds = DEVOPS_PLATFORM_CANDIDATES.filter((c) => c.discoveryOptIn).map(
  (c) => c.id,
);

export const MATCHES: Match[] = [
  ...matchesFor('role_platform_lead', awsOptedInIds, 'suggested'), // 5 matches — gate OPEN
  // 4 matches. This was the gate-CLOSED fixture while the gate needed 5; the
  // founder lowered it to 1 on 2026-09-02, so this role is now gate OPEN and
  // the only closed state left is having no matches at all.
  ...matchesFor('role_sre', devopsOptedInIds, 'suggested'),
  // role_secops intentionally has zero matches — the empty state, and now
  // also the only way a role can be gate-closed.
];
