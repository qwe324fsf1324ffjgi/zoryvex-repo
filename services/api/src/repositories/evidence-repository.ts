import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { EvidenceSchema, type Evidence, type VerificationMethod } from '@zoryvex/contracts';
import { ddb, tableName } from './dynamo-client';
import { isConditionalCheckFailed } from './dynamo-errors';
import { ConflictError, NotFoundError } from '../errors/typed-errors';

function key(candidateId: string, evidenceId: string) {
  return { PK: `CANDIDATE#${candidateId}`, SK: `EVIDENCE#${evidenceId}` };
}

/**
 * Parses the whole item rather than copying named fields across.
 *
 * The hand-written field list this replaced was a trap: adding a field to
 * EvidenceSchema silently dropped it on every read, with nothing failing.
 * It had already happened @D@ verificationMethod, verifiedAt and
 * verificationRef were written to the table by markEvidenceVerified and then
 * thrown away by this function on the way back out, so the proof behind a
 * verified claim existed in DynamoDB and was unreadable by the API.
 *
 * Zod strips unknown keys, so the item's PK/SK/version do not leak into the
 * domain object, and a new schema field can never again be lost here.
 */
function itemToEvidence(item: Record<string, unknown>): Evidence {
  return EvidenceSchema.parse(item);
}

export async function listCandidateEvidence(candidateId: string): Promise<Evidence[]> {
  const result = await ddb.send(
    new QueryCommand({
      TableName: tableName(),
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: { ':pk': `CANDIDATE#${candidateId}`, ':prefix': 'EVIDENCE#' },
    }),
  );
  return (result.Items ?? []).map(itemToEvidence);
}

export async function getEvidence(
  candidateId: string,
  evidenceId: string,
): Promise<Evidence | null> {
  const result = await ddb.send(
    new GetCommand({ TableName: tableName(), Key: key(candidateId, evidenceId) }),
  );
  if (!result.Item) return null;
  return itemToEvidence(result.Item);
}

/**
 * Same read as getEvidence, but also returns the optimistic-concurrency
 * version — added 2026-08-26 alongside the first real caller of
 * updateEvidence's `expectedVersion` parameter that isn't the create
 * response itself. Without this, no client could ever discover an
 * evidence item's current version after leaving the page it was created
 * on, making the update capability effectively uncallable in practice
 * despite existing end-to-end.
 */
export async function getEvidenceWithVersion(
  candidateId: string,
  evidenceId: string,
): Promise<{ evidence: Evidence; version: number } | null> {
  const result = await ddb.send(
    new GetCommand({ TableName: tableName(), Key: key(candidateId, evidenceId) }),
  );
  if (!result.Item) return null;
  return { evidence: itemToEvidence(result.Item), version: Number(result.Item.version) };
}

export async function createEvidence(
  evidence: Evidence,
): Promise<{ evidence: Evidence; version: number }> {
  const validated = EvidenceSchema.parse(evidence);
  await ddb.send(
    new PutCommand({
      TableName: tableName(),
      Item: { ...key(validated.candidateId, validated.id), version: 1, ...validated },
      ConditionExpression: 'attribute_not_exists(PK)',
    }),
  );
  return { evidence: validated, version: 1 };
}

export async function updateEvidence(
  candidateId: string,
  evidenceId: string,
  expectedVersion: number,
  patch: Partial<
    Pick<
      Evidence,
      | 'claim'
      | 'context'
      | 'actions'
      | 'outcome'
      | 'verificationState'
      | 'visibility'
      | 'consentGiven'
    >
  > & {
    /**
     * Set only by evidence-claim-service's updateOwnEvidence when a verified
     * item's substance changes. Handled explicitly below and never written as
     * an attribute — the generic loop would otherwise persist a control flag
     * onto the item as if it were domain data.
     */
    resetVerification?: boolean | undefined;
  },
  updatedAt: string,
): Promise<{ evidence: Evidence; version: number }> {
  const { resetVerification, ...fields } = patch;
  const setClauses = ['updatedAt = :updatedAt', 'version = version + :one'];
  const removeClauses: string[] = [];
  const values: Record<string, unknown> = {
    ':expectedVersion': expectedVersion,
    ':updatedAt': updatedAt,
    ':one': 1,
  };
  const names: Record<string, string> = {};

  for (const [field, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    setClauses.push(`#${field} = :${field}`);
    names[`#${field}`] = field;
    values[`:${field}`] = value;
  }

  // Dropping back to `unverified` AND clearing the proof that no longer
  // describes this content. Leaving verificationMethod/Ref/verifiedAt behind
  // would let a later reader reconstruct a "verified" badge from stale
  // fields, which is the laundering route this whole rule exists to close.
  if (resetVerification) {
    setClauses.push('#verificationState = :verificationState');
    names['#verificationState'] = 'verificationState';
    values[':verificationState'] = 'unverified';
    for (const field of [
      'verificationMethod',
      'verificationRef',
      'verificationDetail',
      'verificationExpiresAt',
      'verifiedAt',
    ]) {
      removeClauses.push(`#${field}`);
      names[`#${field}`] = field;
    }
  }

  try {
    const result = await ddb.send(
      new UpdateCommand({
        TableName: tableName(),
        Key: key(candidateId, evidenceId),
        UpdateExpression:
          `SET ${setClauses.join(', ')}` +
          (removeClauses.length > 0 ? ` REMOVE ${removeClauses.join(', ')}` : ''),
        ConditionExpression: 'attribute_exists(PK) AND version = :expectedVersion',
        ExpressionAttributeNames: Object.keys(names).length > 0 ? names : undefined,
        ExpressionAttributeValues: values,
        ReturnValues: 'ALL_NEW',
      }),
    );
    const item = result.Attributes;
    if (!item) throw new NotFoundError('Evidence not found');
    return { evidence: itemToEvidence(item), version: Number(item.version) };
  } catch (error) {
    if (isConditionalCheckFailed(error)) {
      const existing = await getEvidence(candidateId, evidenceId);
      if (!existing) throw new NotFoundError('Evidence not found');
      throw new ConflictError('Evidence item was modified by another request');
    }
    throw error;
  }
}

/**
 * The only write in the codebase that can set `verified`, called solely by
 * services/api/src/domain/verification-service.ts after an autonomous check
 * has actually passed.
 *
 * Conditional on the item still being unverified, so two concurrent
 * verifications settle to one, and so an item edited (and therefore reset)
 * between the check and this write is refused rather than stamped — the
 * service treats `null` as "re-run the verification", never as success.
 */
export async function markEvidenceVerified(
  candidateId: string,
  evidenceId: string,
  method: VerificationMethod,
  verificationRef: string,
  verifiedAt: string,
  verificationDetail: string,
  verificationExpiresAt: string | null,
): Promise<Evidence | null> {
  try {
    const result = await ddb.send(
      new UpdateCommand({
        TableName: tableName(),
        Key: key(candidateId, evidenceId),
        UpdateExpression:
          'SET verificationState = :verified, verificationMethod = :method, ' +
          'verificationRef = :ref, verificationDetail = :detail, verifiedAt = :at, ' +
          'updatedAt = :at, version = version + :one' +
          // A credential with no expiry must not inherit a stale one from a
          // previous verification of the same item.
          (verificationExpiresAt
            ? ', verificationExpiresAt = :expires'
            : ' REMOVE verificationExpiresAt'),
        ConditionExpression: 'attribute_exists(PK) AND verificationState <> :verified',
        ExpressionAttributeValues: {
          ':verified': 'verified',
          ':method': method,
          ':ref': verificationRef,
          ':detail': verificationDetail,
          ':at': verifiedAt,
          ...(verificationExpiresAt ? { ':expires': verificationExpiresAt } : {}),
          ':one': 1,
        },
        ReturnValues: 'ALL_NEW',
      }),
    );
    return result.Attributes ? itemToEvidence(result.Attributes) : null;
  } catch (error) {
    if (isConditionalCheckFailed(error)) return null;
    throw error;
  }
}

export async function deleteEvidence(candidateId: string, evidenceId: string): Promise<void> {
  await ddb.send(new DeleteCommand({ TableName: tableName(), Key: key(candidateId, evidenceId) }));
}
