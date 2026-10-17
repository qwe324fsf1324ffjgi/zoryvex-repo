import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  EvidenceFileSchema,
  type EvidenceFile,
  type EvidenceFileScanStatus,
} from '@zoryvex/contracts';
import { ddb, tableName } from './dynamo-client';

function key(candidateId: string, fileId: string) {
  return { PK: `CANDIDATE#${candidateId}`, SK: `EVIDENCEFILE#${fileId}` };
}

function itemToFile(item: Record<string, unknown>): EvidenceFile {
  return EvidenceFileSchema.parse({
    id: item.id,
    candidateId: item.candidateId,
    originalFilename: item.originalFilename,
    mimeType: item.mimeType,
    sizeBytes: item.sizeBytes,
    quarantineKey: item.quarantineKey,
    acceptedKey: item.acceptedKey ?? null,
    scanStatus: item.scanStatus,
    rejectionReason: item.rejectionReason,
    createdAt: item.createdAt,
    scannedAt: item.scannedAt ?? null,
  });
}

/** Unconditional create — fileId is server-generated (uuid), no realistic collision. */
export async function createPendingFile(input: {
  fileId: string;
  candidateId: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  quarantineKey: string;
  createdAt: string;
}): Promise<EvidenceFile> {
  const file: EvidenceFile = EvidenceFileSchema.parse({
    id: input.fileId,
    candidateId: input.candidateId,
    originalFilename: input.originalFilename,
    mimeType: input.mimeType,
    sizeBytes: input.sizeBytes,
    quarantineKey: input.quarantineKey,
    acceptedKey: null,
    scanStatus: 'pending',
    createdAt: input.createdAt,
    scannedAt: null,
  });
  await ddb.send(
    new PutCommand({
      TableName: tableName(),
      Item: { ...key(input.candidateId, input.fileId), ...file },
    }),
  );
  return file;
}

export async function getFile(candidateId: string, fileId: string): Promise<EvidenceFile | null> {
  const result = await ddb.send(
    new GetCommand({ TableName: tableName(), Key: key(candidateId, fileId) }),
  );
  if (!result.Item) return null;
  return itemToFile(result.Item);
}

/**
 * Conditioned on the file still being `pending` — a replayed/duplicate
 * GuardDuty scan-result event for the same object must not re-run
 * promotion twice (idempotent worker, matches the SQS at-least-once
 * delivery model).
 */
export async function markFileClean(
  candidateId: string,
  fileId: string,
  acceptedKey: string,
  scannedAt: string,
): Promise<EvidenceFile | null> {
  return updateScanStatus(candidateId, fileId, {
    scanStatus: 'clean',
    acceptedKey,
    scannedAt,
  });
}

export async function markFileRejected(
  candidateId: string,
  fileId: string,
  scanStatus: Exclude<EvidenceFileScanStatus, 'pending' | 'clean'>,
  rejectionReason: string,
  scannedAt: string,
): Promise<EvidenceFile | null> {
  return updateScanStatus(candidateId, fileId, { scanStatus, rejectionReason, scannedAt });
}

async function updateScanStatus(
  candidateId: string,
  fileId: string,
  patch: {
    scanStatus: EvidenceFileScanStatus;
    acceptedKey?: string;
    rejectionReason?: string;
    scannedAt: string;
  },
): Promise<EvidenceFile | null> {
  const setClauses = ['scanStatus = :scanStatus', 'scannedAt = :scannedAt'];
  const values: Record<string, unknown> = {
    ':pending': 'pending',
    ':scanStatus': patch.scanStatus,
    ':scannedAt': patch.scannedAt,
  };
  if (patch.acceptedKey !== undefined) {
    setClauses.push('acceptedKey = :acceptedKey');
    values[':acceptedKey'] = patch.acceptedKey;
  }
  if (patch.rejectionReason !== undefined) {
    setClauses.push('rejectionReason = :rejectionReason');
    values[':rejectionReason'] = patch.rejectionReason;
  }

  try {
    const result = await ddb.send(
      new UpdateCommand({
        TableName: tableName(),
        Key: key(candidateId, fileId),
        UpdateExpression: `SET ${setClauses.join(', ')}`,
        ConditionExpression: 'attribute_exists(PK) AND scanStatus = :pending',
        ExpressionAttributeValues: values,
        ReturnValues: 'ALL_NEW',
      }),
    );
    return result.Attributes ? itemToFile(result.Attributes) : null;
  } catch (error) {
    if (error instanceof Error && error.name === 'ConditionalCheckFailedException') return null;
    throw error;
  }
}

/** Used by the deletion worker to find every S3 object a candidate's evidence touched. */
export async function listFilesForCandidate(candidateId: string): Promise<EvidenceFile[]> {
  const result = await ddb.send(
    new QueryCommand({
      TableName: tableName(),
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: { ':pk': `CANDIDATE#${candidateId}`, ':prefix': 'EVIDENCEFILE#' },
    }),
  );
  return (result.Items ?? []).map(itemToFile);
}

/** Part of the async deletion workflow — never called from a direct request handler. */
export async function deleteFileRecord(candidateId: string, fileId: string): Promise<void> {
  await ddb.send(new DeleteCommand({ TableName: tableName(), Key: key(candidateId, fileId) }));
}
