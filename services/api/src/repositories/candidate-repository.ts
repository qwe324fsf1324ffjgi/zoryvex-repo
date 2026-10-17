import { DeleteCommand, GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { CandidateSchema, type Candidate, type LaunchTrack } from '@zoryvex/contracts';
import { ddb, tableName } from './dynamo-client';
import { isConditionalCheckFailed } from './dynamo-errors';
import { ConflictError, NotFoundError } from '../errors/typed-errors';

function key(candidateId: string) {
  return { PK: `CANDIDATE#${candidateId}`, SK: 'PROFILE' };
}

/** `version` is a persistence-layer detail (optimistic concurrency) — never part of the returned domain object. */
/**
 * Every field, not a hand-picked list.
 *
 * This enumerated twelve of sixteen and dropped `phone`, `linkedinUrl`,
 * `websiteUrl` and `intent`. All four were written to DynamoDB and thrown
 * away on the way back out, and nothing failed because all four are
 * optional, so the narrower object still parsed.
 *
 * Two consequences, both silent. A candidate who saved a phone number saw
 * it vanish on the next load and had no way to tell whether it had ever
 * been stored. And `getUnlockedContactInfo` reads exactly these fields off
 * this object, so an employer who *paid* to unlock a contact received an
 * email address and a display name and never the number or links the
 * candidate had actually provided — the paid feature quietly delivering
 * less than it charged for.
 *
 * `version` is an optimistic-concurrency detail and must not reach the
 * domain object; zod strips unknown keys, so the spread cannot leak it or
 * the storage keys.
 */
function itemToCandidate(item: Record<string, unknown>): Candidate {
  return CandidateSchema.parse(item);
}

export async function createCandidateProfile(input: {
  candidateId: string;
  email: string;
  displayName: string;
  launchTrack: LaunchTrack;
  createdAt: string;
}): Promise<Candidate> {
  const candidate: Candidate = CandidateSchema.parse({
    id: input.candidateId,
    email: input.email,
    displayName: input.displayName,
    launchTrack: input.launchTrack,
    discoveryOptIn: false,
    onboardingComplete: false,
    summary: '',
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
  });

  await ddb.send(
    new PutCommand({
      TableName: tableName(),
      Item: {
        ...key(input.candidateId),
        GSI3PK: 'ENTITY#CANDIDATE',
        GSI3SK: input.candidateId,
        version: 1,
        ...candidate,
      },
      ConditionExpression: 'attribute_not_exists(PK)',
    }),
  );

  return candidate;
}

export async function getCandidate(
  candidateId: string,
): Promise<{ candidate: Candidate; version: number } | null> {
  const result = await ddb.send(new GetCommand({ TableName: tableName(), Key: key(candidateId) }));
  if (!result.Item) return null;
  return { candidate: itemToCandidate(result.Item), version: Number(result.Item.version) };
}

/**
 * Optimistic concurrency (docs/DATA_MODEL.md "Rules"): `expectedVersion` must
 * match the version last read by the caller, or this throws ConflictError
 * rather than silently overwriting a concurrent edit.
 */
export async function updateCandidateProfile(
  candidateId: string,
  expectedVersion: number,
  patch: Partial<
    Pick<
      Candidate,
      'displayName' | 'launchTrack' | 'summary' | 'onboardingComplete' | 'contactUnlockConsent'
    >
  > & {
    // Nullable so they can be cleared. The generic REMOVE handling below
    // covers all three identically, so a cleared field leaves no attribute
    // behind rather than a stored NULL that would fail CandidateSchema on
    // the way back out.
    location?: Candidate['location'] | null;
    phone?: Candidate['phone'] | null;
    linkedinUrl?: Candidate['linkedinUrl'] | null;
    websiteUrl?: Candidate['websiteUrl'] | null;
  },
  updatedAt: string,
): Promise<{ candidate: Candidate; version: number }> {
  const setClauses = ['updatedAt = :updatedAt', 'version = version + :one'];
  const values: Record<string, unknown> = {
    ':expectedVersion': expectedVersion,
    ':updatedAt': updatedAt,
    ':one': 1,
  };
  const names: Record<string, string> = {};

  // null and undefined mean different things here, and conflating them is a
  // real bug rather than a style question. `undefined` is "this request did
  // not mention the field"; `null` is "clear it". Writing `SET field = null`
  // would store a DynamoDB NULL, which comes back as `location: null` and
  // fails CandidateSchema on the next read, because the schema says the
  // field is absent or an object and never null. So a cleared field is
  // REMOVEd from the item instead.
  const removeClauses: string[] = [];

  for (const [field, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    names[`#${field}`] = field;
    if (value === null) {
      removeClauses.push(`#${field}`);
      continue;
    }
    setClauses.push(`#${field} = :${field}`);
    values[`:${field}`] = value;
  }

  const updateExpression =
    `SET ${setClauses.join(', ')}` +
    (removeClauses.length > 0 ? ` REMOVE ${removeClauses.join(', ')}` : '');

  try {
    const result = await ddb.send(
      new UpdateCommand({
        TableName: tableName(),
        Key: key(candidateId),
        UpdateExpression: updateExpression,
        ConditionExpression: 'attribute_exists(PK) AND version = :expectedVersion',
        ExpressionAttributeNames: Object.keys(names).length > 0 ? names : undefined,
        ExpressionAttributeValues: values,
        ReturnValues: 'ALL_NEW',
      }),
    );
    const item = result.Attributes;
    if (!item) throw new NotFoundError('Candidate not found');
    return { candidate: itemToCandidate(item), version: Number(item.version) };
  } catch (error) {
    if (isConditionalCheckFailed(error)) {
      const existing = await getCandidate(candidateId);
      if (!existing) throw new NotFoundError('Candidate not found');
      throw new ConflictError('Candidate profile was modified by another request');
    }
    throw error;
  }
}

/**
 * Discovery consent is structural (docs/DATA_MODEL.md GSI1): opting in
 * writes GSI1PK/GSI1SK onto this same item; opting out REMOVEs them, so a
 * discovery query can never return an opted-out candidate, not by an
 * application-layer filter that could be forgotten in one code path.
 */
export async function setDiscoveryOptIn(
  candidateId: string,
  launchTrack: LaunchTrack,
  optIn: boolean,
  updatedAt: string,
): Promise<void> {
  if (optIn) {
    await ddb.send(
      new UpdateCommand({
        TableName: tableName(),
        Key: key(candidateId),
        UpdateExpression:
          'SET discoveryOptIn = :true, GSI1PK = :gsi1pk, GSI1SK = :gsi1sk, updatedAt = :updatedAt',
        ConditionExpression: 'attribute_exists(PK)',
        ExpressionAttributeValues: {
          ':true': true,
          ':gsi1pk': `TRACK#${launchTrack}`,
          ':gsi1sk': `CANDIDATE#${candidateId}`,
          ':updatedAt': updatedAt,
        },
      }),
    );
    return;
  }

  await ddb.send(
    new UpdateCommand({
      TableName: tableName(),
      Key: key(candidateId),
      UpdateExpression: 'SET discoveryOptIn = :false, updatedAt = :updatedAt REMOVE GSI1PK, GSI1SK',
      ConditionExpression: 'attribute_exists(PK)',
      ExpressionAttributeValues: { ':false': false, ':updatedAt': updatedAt },
    }),
  );
}

/**
 * Deletes the whole profile item in one call — GSI1/GSI3 membership lives
 * on this same item (never a separate index item for the profile), so
 * there is nothing else to clean up structurally. Part of the async
 * deletion workflow (docs/PRIVACY_AND_RETENTION), never called directly
 * from an authenticated request handler.
 */
export async function deleteCandidateProfile(candidateId: string): Promise<void> {
  await ddb.send(new DeleteCommand({ TableName: tableName(), Key: key(candidateId) }));
}

// ---------------------------------------------------------------------------
// Public proof pages
// ---------------------------------------------------------------------------

/**
 * The pointer that resolves a public URL to a candidate.
 *
 * A separate item rather than an index, for two reasons. It needs no GSI, so
 * turning the feature on costs nothing on a live table. And revocation is a
 * delete rather than a flag flip, which is the only kind of revocation that
 * means anything once somebody has saved the link.
 */
function publicProofKey(publicProofId: string) {
  return { PK: `PUBLICPROOF#${publicProofId}`, SK: 'POINTER' };
}

export async function getCandidateIdByPublicProofId(publicProofId: string): Promise<string | null> {
  const result = await ddb.send(
    new GetCommand({ TableName: tableName(), Key: publicProofKey(publicProofId) }),
  );
  const candidateId = result.Item?.candidateId;
  return typeof candidateId === 'string' ? candidateId : null;
}

/**
 * Writes the pointer, then stamps the id on the profile.
 *
 * In that order deliberately. A pointer with no matching profile field
 * resolves to a candidate whose `publicProofId` does not match, and
 * `getPublicProof` refuses it — so the failure between the two writes is a
 * page that does not exist yet. The other order would leave a profile
 * claiming a public id that nothing resolves, which is harmless but reads to
 * the candidate as a live page that 404s.
 */
export async function enablePublicProof(
  candidateId: string,
  publicProofId: string,
  updatedAt: string,
): Promise<void> {
  await ddb.send(
    new PutCommand({
      TableName: tableName(),
      Item: { ...publicProofKey(publicProofId), candidateId, createdAt: updatedAt },
      // Never overwrite an existing pointer. Two candidates sharing a public
      // id would publish one person's proofs under the other's URL.
      ConditionExpression: 'attribute_not_exists(PK)',
    }),
  );
  await ddb.send(
    new UpdateCommand({
      TableName: tableName(),
      Key: key(candidateId),
      UpdateExpression: 'SET publicProofId = :id, updatedAt = :updatedAt',
      ConditionExpression: 'attribute_exists(PK)',
      ExpressionAttributeValues: { ':id': publicProofId, ':updatedAt': updatedAt },
    }),
  );
}

/**
 * Clears the profile field, then deletes the pointer.
 *
 * The reverse order of enabling, and for the same reason: whichever write
 * lands first must leave the page unreachable rather than reachable. Clearing
 * the field first means `getPublicProof` refuses immediately, even if the
 * pointer delete fails and has to be retried.
 */
export async function disablePublicProof(
  candidateId: string,
  publicProofId: string,
  updatedAt: string,
): Promise<void> {
  await ddb.send(
    new UpdateCommand({
      TableName: tableName(),
      Key: key(candidateId),
      UpdateExpression: 'REMOVE publicProofId SET updatedAt = :updatedAt',
      ConditionExpression: 'attribute_exists(PK)',
      ExpressionAttributeValues: { ':updatedAt': updatedAt },
    }),
  );
  await ddb.send(new DeleteCommand({ TableName: tableName(), Key: publicProofKey(publicProofId) }));
}
