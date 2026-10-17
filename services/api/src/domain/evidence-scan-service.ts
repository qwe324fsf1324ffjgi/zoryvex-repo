import type { AuditEvent, EvidenceFile, EvidenceFileScanStatus } from '@zoryvex/contracts';
import { bytesMatchClaimedType } from '../lib/magic-bytes';
import { stripJpegMetadata } from '../lib/strip-jpeg-metadata';
import { stripPngMetadata } from '../lib/strip-png-metadata';
import { acceptedKeyFor } from './evidence-upload-service';
import type { Clock } from '../repositories/clock-repository';

export interface ScanResultEvent {
  bucket: string;
  objectKey: string;
  scanStatus: 'COMPLETED' | 'SKIPPED' | 'FAILED';
  scanResultStatus:
    'NO_THREATS_FOUND' | 'THREATS_FOUND' | 'UNSUPPORTED' | 'ACCESS_DENIED' | 'FAILED' | null;
  statusReasons: string[] | null;
}

export interface EvidenceScanDependencies {
  clock: Clock;
  getFile(candidateId: string, fileId: string): Promise<EvidenceFile | null>;
  markFileClean(
    candidateId: string,
    fileId: string,
    acceptedKey: string,
    scannedAt: string,
  ): Promise<EvidenceFile | null>;
  markFileRejected(
    candidateId: string,
    fileId: string,
    scanStatus: Exclude<EvidenceFileScanStatus, 'pending' | 'clean'>,
    reason: string,
    scannedAt: string,
  ): Promise<EvidenceFile | null>;
  getObjectBytes(bucket: string, key: string): Promise<Uint8Array>;
  putAcceptedObject(input: {
    bucket: string;
    key: string;
    body: Uint8Array;
    contentType: string;
  }): Promise<void>;
  deleteObject(bucket: string, key: string): Promise<void>;
  appendAuditEvent(event: AuditEvent): Promise<AuditEvent>;
  generateId(): string;
}

/**
 * PK/SK for the EVIDENCEFILE record is derivable directly from the object
 * key we chose (quarantine/<candidateId>/<fileId>) — no reverse lookup
 * index needed.
 */
export function parseQuarantineKey(
  objectKey: string,
): { candidateId: string; fileId: string } | null {
  const match = /^quarantine\/([^/]+)\/([^/]+)$/.exec(objectKey);
  if (!match) return null;
  return { candidateId: match[1]!, fileId: match[2]! };
}

function classifyRejection(event: ScanResultEvent): {
  status: Exclude<EvidenceFileScanStatus, 'pending' | 'clean'>;
  reason: string;
  deleteImmediately: boolean;
} {
  if (event.scanStatus === 'FAILED') {
    return { status: 'failed', reason: 'GuardDuty scan failed', deleteImmediately: false };
  }
  switch (event.scanResultStatus) {
    case 'THREATS_FOUND':
      return { status: 'infected', reason: 'Malware detected', deleteImmediately: true };
    case 'UNSUPPORTED':
      return {
        status: 'unsupported',
        reason: event.statusReasons?.join(', ') ?? 'Unsupported file for scanning',
        deleteImmediately: false,
      };
    case 'ACCESS_DENIED':
    case 'FAILED':
      return {
        status: 'failed',
        reason: event.statusReasons?.join(', ') ?? 'Scan could not complete',
        deleteImmediately: false,
      };
    default:
      // Any unrecognized combination is treated as a failure — fail closed,
      // never default-accept an object this code doesn't fully understand.
      return { status: 'failed', reason: 'Unrecognized scan result', deleteImmediately: false };
  }
}

function stripMetadataIfImage(bytes: Uint8Array, mimeType: string): Uint8Array {
  if (mimeType === 'image/jpeg') return stripJpegMetadata(bytes);
  if (mimeType === 'image/png') return stripPngMetadata(bytes);
  return bytes; // application/pdf, text/plain — no stripper implemented (docs/RISK_REGISTER.md)
}

/**
 * Fail-closed by construction: promotion to accepted/ happens on exactly
 * one path (scanStatus=COMPLETED AND scanResultStatus=NO_THREATS_FOUND,
 * then a magic-byte check that must also pass) — every other branch
 * rejects. Idempotent against SQS at-least-once delivery: a file no longer
 * `pending` is treated as already handled, not re-processed.
 */
export async function processScanResult(
  event: ScanResultEvent,
  deps: EvidenceScanDependencies,
): Promise<void> {
  const parsed = parseQuarantineKey(event.objectKey);
  if (!parsed) return; // defensive — the EventBridge rule is already scoped to this bucket/prefix

  const file = await deps.getFile(parsed.candidateId, parsed.fileId);
  if (!file || file.scanStatus !== 'pending') return;

  const now = deps.clock.now().toISOString();
  const isClean = event.scanStatus === 'COMPLETED' && event.scanResultStatus === 'NO_THREATS_FOUND';

  if (!isClean) {
    const { status, reason, deleteImmediately } = classifyRejection(event);
    const marked = await deps.markFileRejected(
      parsed.candidateId,
      parsed.fileId,
      status,
      reason,
      now,
    );
    if (!marked) return; // already handled by a concurrent/duplicate delivery
    if (deleteImmediately) await deps.deleteObject(event.bucket, event.objectKey);
    await deps.appendAuditEvent({
      id: deps.generateId(),
      actorId: 'system:evidence-scan-worker',
      actorRole: 'admin',
      action: 'evidence_file_rejected',
      targetType: 'evidence_file',
      targetId: parsed.fileId,
      reason,
      createdAt: now,
    });
    return;
  }

  const bytes = await deps.getObjectBytes(event.bucket, event.objectKey);
  if (!bytesMatchClaimedType(bytes, file.mimeType)) {
    const marked = await deps.markFileRejected(
      parsed.candidateId,
      parsed.fileId,
      'rejected',
      'File content does not match its declared type',
      now,
    );
    if (marked) {
      await deps.deleteObject(event.bucket, event.objectKey);
      await deps.appendAuditEvent({
        id: deps.generateId(),
        actorId: 'system:evidence-scan-worker',
        actorRole: 'admin',
        action: 'evidence_file_rejected',
        targetType: 'evidence_file',
        targetId: parsed.fileId,
        reason: 'magic_bytes_mismatch',
        createdAt: now,
      });
    }
    return;
  }

  const stripped = stripMetadataIfImage(bytes, file.mimeType);
  const acceptedKey = acceptedKeyFor(parsed.candidateId, parsed.fileId);
  await deps.putAcceptedObject({
    bucket: event.bucket,
    key: acceptedKey,
    body: stripped,
    contentType: file.mimeType,
  });

  const marked = await deps.markFileClean(parsed.candidateId, parsed.fileId, acceptedKey, now);
  if (!marked) {
    // Lost the idempotency race after already writing accepted/.
    //
    // This used to delete acceptedKey unconditionally, to avoid leaving an
    // orphan. But acceptedKeyFor is deterministic (accepted/<candidateId>/
    // <fileId>), so the delivery that WON the race wrote that exact same
    // key — and the winner has already deleted the quarantine original. The
    // cleanup therefore destroyed the only surviving copy of the file while
    // the record still said `clean` with an acceptedKey pointing at it. The
    // race handler made the race strictly worse than doing nothing (found in
    // a 2026-08-27 audit).
    //
    // Re-read instead of guessing. If the file is now clean at our key, the
    // object is the winner's and must be left alone. If it ended up rejected
    // or failed (a different scan-result event won), the object we wrote is a
    // genuine orphan for a file that was never accepted, and deleting it is
    // both correct and required — nothing must be readable from accepted/
    // for a file that did not pass.
    const current = await deps.getFile(parsed.candidateId, parsed.fileId);
    const winnerPromotedTheSameObject =
      current?.scanStatus === 'clean' && current.acceptedKey === acceptedKey;
    if (!winnerPromotedTheSameObject) await deps.deleteObject(event.bucket, acceptedKey);
    return;
  }
  await deps.deleteObject(event.bucket, event.objectKey);
}
