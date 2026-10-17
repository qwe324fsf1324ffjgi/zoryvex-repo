import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import type { PeerAttestation } from '@zoryvex/contracts';
import { ddb, tableName } from './dynamo-client';
import { isConditionalCheckFailed } from './dynamo-errors';
import type { PeerRequestRecord } from '../domain/peer-request-service';

/**
 * Pending requests and recorded attestations.
 *
 * The token item mirrors AUTHTOKEN exactly, including the lesson that cost a
 * live failure there: `consumed` is a DynamoDB reserved word and has to be
 * aliased in an UpdateExpression. The unit tests could not catch it, because
 * a mocked client never parses the expression.
 */

function requestKey(tokenHash: string) {
  return { PK: `PEERREQ#${tokenHash}`, SK: 'PEERREQ' };
}

function attestationKey(evidenceId: string, attestationId: string) {
  return { PK: `EVIDENCE#${evidenceId}`, SK: `PEERATT#${attestationId}` };
}

export async function createPeerRequest(
  input: PeerRequestRecord & { ttlEpochSeconds: number },
): Promise<void> {
  await ddb.send(
    new PutCommand({
      TableName: tableName(),
      Item: {
        ...requestKey(input.tokenHash),
        evidenceId: input.evidenceId,
        candidateId: input.candidateId,
        verifierEmail: input.verifierEmail,
        createdAt: input.createdAt,
        expiresAt: input.expiresAt,
        consumed: false,
        // TTL is a floor, not the expiry check. DynamoDB deletes within 48
        // hours of the timestamp, which is far too loose to be a security
        // boundary — the domain checks expiresAt itself and this only stops
        // spent tokens accumulating.
        ttl: input.ttlEpochSeconds,
      },
      ConditionExpression: 'attribute_not_exists(PK)',
    }),
  );
}

function toRequest(item: Record<string, unknown>): PeerRequestRecord {
  return {
    tokenHash: String(item.PK).replace('PEERREQ#', ''),
    evidenceId: String(item.evidenceId),
    candidateId: String(item.candidateId),
    verifierEmail: String(item.verifierEmail),
    createdAt: String(item.createdAt),
    expiresAt: String(item.expiresAt),
    consumed: item.consumed === true,
  };
}

/** Reads without spending, so a verifier can re-read what they were asked. */
export async function getPeerRequest(tokenHash: string): Promise<PeerRequestRecord | null> {
  const result = await ddb.send(
    new GetCommand({ TableName: tableName(), Key: requestKey(tokenHash) }),
  );
  return result.Item ? toRequest(result.Item) : null;
}

/**
 * Atomic single-use consume. Returns null for unknown, already spent, or
 * expired — the caller turns all three into the same refusal.
 */
export async function consumePeerRequest(tokenHash: string): Promise<PeerRequestRecord | null> {
  try {
    const result = await ddb.send(
      new UpdateCommand({
        TableName: tableName(),
        Key: requestKey(tokenHash),
        UpdateExpression: 'SET #consumed = :true',
        // #consumed, aliased: unaliased this fails at runtime with
        // "Attribute name is a reserved keyword", which is exactly how the
        // auth token consume failed in Phase 7 slice 11.
        ConditionExpression: 'attribute_exists(PK) AND #consumed = :false AND expiresAt > :now',
        ExpressionAttributeNames: { '#consumed': 'consumed' },
        ExpressionAttributeValues: {
          ':true': true,
          ':false': false,
          ':now': new Date().toISOString(),
        },
        ReturnValues: 'ALL_OLD',
      }),
    );
    return result.Attributes ? toRequest(result.Attributes) : null;
  } catch (error) {
    if (isConditionalCheckFailed(error)) return null;
    throw error;
  }
}

export async function putAttestation(attestation: PeerAttestation): Promise<PeerAttestation> {
  await ddb.send(
    new PutCommand({
      TableName: tableName(),
      Item: { ...attestationKey(attestation.evidenceId, attestation.id), ...attestation },
    }),
  );
  return attestation;
}

export async function listAttestationsForEvidence(evidenceId: string): Promise<PeerAttestation[]> {
  const result = await ddb.send(
    new QueryCommand({
      TableName: tableName(),
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: { ':pk': `EVIDENCE#${evidenceId}`, ':sk': 'PEERATT#' },
    }),
  );
  return (result.Items ?? []).map((item) => item as unknown as PeerAttestation);
}

/**
 * Reciprocity: did this candidate previously vouch for the person now
 * vouching for them?
 *
 * Keyed on email hashes in BOTH positions, deliberately. A verifier may not
 * be a candidate at all — they are a colleague at some company — so there is
 * no candidate id to key them by, and the only identifier the two directions
 * share is the address.
 *
 * The first version of this was written the wrong way round: it recorded
 * "this candidate was vouched for by this verifier" and then asked the same
 * question back, which detects a second vouch from the same person (already
 * refused by the one-per-verifier rule) and never detects a ring at all.
 * Caught by reading it rather than by a test, which is why the direction is
 * now spelled out in the names.
 *
 * A marker item rather than a scan. A reciprocity check that had to read
 * every candidate's evidence is the sort of thing that gets quietly removed
 * the first time somebody notices it is slow.
 */
function vouchKey(voucherEmailHash: string, vouchedForEmailHash: string) {
  return { PK: `PEERVOUCH#${voucherEmailHash}`, SK: `FOR#${vouchedForEmailHash}` };
}

/** Records that the verifier vouched for the candidate. */
export async function recordVouch(
  verifierEmailHash: string,
  candidateEmailHash: string,
): Promise<void> {
  await ddb.send(
    new PutCommand({
      TableName: tableName(),
      Item: {
        ...vouchKey(verifierEmailHash, candidateEmailHash),
        createdAt: new Date().toISOString(),
      },
    }),
  );
}

/**
 * True when the candidate has already vouched for this verifier — the other
 * direction, which is what makes it a ring.
 */
export async function hasCandidateVouchedFor(
  candidateEmailHash: string,
  verifierEmailHash: string,
): Promise<boolean> {
  const result = await ddb.send(
    new GetCommand({
      TableName: tableName(),
      Key: vouchKey(candidateEmailHash, verifierEmailHash),
    }),
  );
  return Boolean(result.Item);
}

export async function deleteAttestation(evidenceId: string, attestationId: string): Promise<void> {
  await ddb.send(
    new DeleteCommand({ TableName: tableName(), Key: attestationKey(evidenceId, attestationId) }),
  );
}

/**
 * Removes every colleague statement attached to one evidence item.
 *
 * These live on the EVIDENCE partition rather than the candidate's, which is
 * why account deletion missed them until 2026-09-04: it deleted the evidence
 * row and left the attestations about it on a partition nobody walked. An
 * attestation is somebody else's written statement about the candidate, so
 * it is theirs to have removed along with the claim it supports.
 */
export async function deleteAttestationsForEvidence(evidenceId: string): Promise<void> {
  const result = await ddb.send(
    new QueryCommand({
      TableName: tableName(),
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: { ':pk': `EVIDENCE#${evidenceId}`, ':sk': 'PEERATT#' },
      ProjectionExpression: 'PK, SK',
    }),
  );

  for (const item of result.Items ?? []) {
    await ddb.send(
      new DeleteCommand({ TableName: tableName(), Key: { PK: item.PK, SK: item.SK } }),
    );
  }
}
