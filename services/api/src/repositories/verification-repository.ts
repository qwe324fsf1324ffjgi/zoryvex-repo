import { DeleteCommand, GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, tableName } from './dynamo-client';

function key(candidateId: string, evidenceId: string) {
  return { PK: `CANDIDATE#${candidateId}`, SK: `VERIFYNONCE#${evidenceId}` };
}

function attemptKey(candidateId: string, evidenceId: string) {
  return { PK: `CANDIDATE#${candidateId}`, SK: `VERIFYATTEMPTS#${evidenceId}` };
}

/** Single-use challenge, TTL-bound the same way the WebAuthn ceremony challenge is. */
export async function putVerificationNonce(
  candidateId: string,
  evidenceId: string,
  nonce: string,
  ttlEpochSeconds: number,
): Promise<void> {
  await ddb.send(
    new PutCommand({
      TableName: tableName(),
      Item: { ...key(candidateId, evidenceId), nonce, ttl: ttlEpochSeconds },
    }),
  );
}

/**
 * Expiry is checked in code as well as via TTL. DynamoDB's TTL deletion is
 * best-effort and can lag by up to 48 hours, so trusting it alone would leave
 * a 30-minute challenge usable for two days — the same trap
 * webauthn-credential-repository's consumeChallenge already avoids.
 */
export async function consumeVerificationNonce(
  candidateId: string,
  evidenceId: string,
): Promise<string | null> {
  const itemKey = key(candidateId, evidenceId);
  const result = await ddb.send(new GetCommand({ TableName: tableName(), Key: itemKey }));
  const item = result.Item;
  if (!item) return null;

  await ddb.send(new DeleteCommand({ TableName: tableName(), Key: itemKey }));
  if (Number(item.ttl) < Math.floor(Date.now() / 1000)) return null;
  return String(item.nonce);
}

export async function countVerificationAttempts(
  candidateId: string,
  evidenceId: string,
): Promise<number> {
  const result = await ddb.send(
    new GetCommand({ TableName: tableName(), Key: attemptKey(candidateId, evidenceId) }),
  );
  return Number(result.Item?.count ?? 0);
}

/**
 * An atomic ADD rather than read-modify-write, so parallel attempts cannot
 * both read the same count and each believe they are within the limit.
 */
export async function recordVerificationAttempt(
  candidateId: string,
  evidenceId: string,
  at: string,
): Promise<void> {
  await ddb.send(
    new UpdateCommand({
      TableName: tableName(),
      Key: attemptKey(candidateId, evidenceId),
      UpdateExpression: 'ADD #count :one SET lastAttemptAt = :at',
      ExpressionAttributeNames: { '#count': 'count' },
      ExpressionAttributeValues: { ':one': 1, ':at': at },
    }),
  );
}

/**
 * Removes the attempt counter and any unconsumed challenge for one evidence
 * item, so a deleted account leaves no verification state behind.
 *
 * The nonce is TTL-bound and would expire on its own; it is deleted anyway
 * rather than left to a cleanup window that DynamoDB does not promise to
 * meet promptly.
 */
export async function deleteVerificationState(
  candidateId: string,
  evidenceId: string,
): Promise<void> {
  await ddb.send(
    new DeleteCommand({ TableName: tableName(), Key: attemptKey(candidateId, evidenceId) }),
  );
  await ddb.send(new DeleteCommand({ TableName: tableName(), Key: key(candidateId, evidenceId) }));
}
