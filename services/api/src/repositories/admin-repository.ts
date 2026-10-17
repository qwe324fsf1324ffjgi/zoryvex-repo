import { CandidateSchema, EmployerSchema, type Candidate, type Employer } from '@zoryvex/contracts';
import { queryAllPages } from './dynamo-client';

/**
 * docs/DATA_MODEL.md access pattern #10 — founder/admin console only.
 * Paginates fully (queryAllPages, added 2026-08-26) — this scales with
 * total platform candidates, not one owner's own items, so a single
 * unpaginated page would silently under-report the admin console's own
 * counts past DynamoDB's ~1MB per-query cap.
 */
export async function listAllCandidates(): Promise<Candidate[]> {
  const items = await queryAllPages({
    IndexName: 'GSI3',
    KeyConditionExpression: 'GSI3PK = :pk',
    ExpressionAttributeValues: { ':pk': 'ENTITY#CANDIDATE' },
  });
  // Deliberately narrower than the schema, and it must stay that way.
  //
  // `phone`, `linkedinUrl`, `websiteUrl`, `location`, `publicProofId`,
  // `contactUnlockConsent` and `intent` are omitted on purpose: this is the
  // founder/admin console, which needs to count and moderate accounts and
  // has no business reading a candidate's contact channels, where they
  // live, or what they will work for. Those are released through the
  // contact-unlock route alone, to an employer who paid and only while the
  // candidate's consent stands.
  //
  // Spelled out because it looks exactly like the bug it is not. The
  // candidate and match mappers each enumerated a subset by accident and
  // silently lost data; a reader tidying this one into a spread for
  // consistency would turn a privacy boundary into a leak, and every test
  // would still pass.
  return items.map((item) =>
    CandidateSchema.parse({
      id: item.id,
      email: item.email,
      displayName: item.displayName,
      launchTrack: item.launchTrack,
      discoveryOptIn: item.discoveryOptIn,
      onboardingComplete: item.onboardingComplete,
      summary: item.summary,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    }),
  );
}

/** docs/DATA_MODEL.md access pattern #11 — founder/admin console only. Paginates fully, same reasoning as listAllCandidates above. */
export async function listAllEmployers(): Promise<Employer[]> {
  const items = await queryAllPages({
    IndexName: 'GSI3',
    KeyConditionExpression: 'GSI3PK = :pk',
    ExpressionAttributeValues: { ':pk': 'ENTITY#EMPLOYER' },
  });
  return items.map((item) =>
    EmployerSchema.parse({
      id: item.id,
      organizationName: item.organizationName,
      contactEmail: item.contactEmail,
      createdAt: item.createdAt,
    }),
  );
}
