import { CandidateSchema, type Candidate, type LaunchTrack } from '@zoryvex/contracts';
import { queryAllPages } from './dynamo-client';

/**
 * docs/DATA_MODEL.md access pattern #7. Only ever returns candidates whose
 * GSI1 item exists (i.e. currently opted into discovery for this track) —
 * consent is structural, never a post-read filter (see
 * candidate-repository.ts's setDiscoveryOptIn). Paginates fully
 * (queryAllPages) — the one access pattern here where result size scales
 * with platform-wide adoption, not one owner's own items, so a single
 * unpaginated page (the pre-2026-08-26 behavior) would silently and
 * permanently drop real candidates from real matching once a launch
 * track's opted-in population grows large enough.
 */
export async function listDiscoveryOptedCandidates(launchTrack: LaunchTrack): Promise<Candidate[]> {
  const items = await queryAllPages({
    IndexName: 'GSI1',
    KeyConditionExpression: 'GSI1PK = :pk',
    ExpressionAttributeValues: { ':pk': `TRACK#${launchTrack}` },
  });
  // Parses the whole item rather than copying named fields, for the same
  // reason evidence-repository does: the hand-written list this replaced had
  // already lost `contactUnlockConsent`, silently, with nothing failing.
  // Harmless so far only because no caller happened to read it — one that
  // filtered on consent would have excluded every consenting candidate.
  // Zod strips the storage keys, so nothing leaks the other way.
  return items.map((item) => CandidateSchema.parse(item));
}
