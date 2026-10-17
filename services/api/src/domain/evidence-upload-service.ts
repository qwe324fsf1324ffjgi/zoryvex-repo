import { randomUUID } from 'node:crypto';
import {
  ALLOWED_EVIDENCE_MIME_TYPES,
  MAX_EVIDENCE_FILE_BYTES,
  type EvidenceFile,
} from '@zoryvex/contracts';
import { ValidationError } from '../errors/typed-errors';
import { sanitizeFilename } from '../lib/sanitize-filename';
import type { Clock } from '../repositories/clock-repository';

const UPLOAD_URL_TTL_SECONDS = 5 * 60;

export interface EvidenceUploadDependencies {
  clock: Clock;
  createPendingFile(input: {
    fileId: string;
    candidateId: string;
    originalFilename: string;
    mimeType: string;
    sizeBytes: number;
    quarantineKey: string;
    createdAt: string;
  }): Promise<EvidenceFile>;
  createUploadPost(input: {
    key: string;
    contentType: string;
    maxSizeBytes: number;
    expiresInSeconds: number;
  }): Promise<{ url: string; fields: Record<string, string> }>;
}

export function quarantineKeyFor(candidateId: string, fileId: string): string {
  return `quarantine/${candidateId}/${fileId}`;
}

export function acceptedKeyFor(candidateId: string, fileId: string): string {
  return `accepted/${candidateId}/${fileId}`;
}

/**
 * A short-lived presigned POST bound to the authenticated candidate's own
 * prefix, an exact content-type, and a content-length range — never a
 * client-suppliable storage key (docs/DATA_MODEL.md: "randomize storage
 * keys"). The uploaded object lands in quarantine/ only; nothing here ever
 * grants direct write access to accepted/.
 */
export async function requestEvidenceUpload(
  candidateId: string,
  input: { fileName: string; sizeBytes: number; mimeType: string },
  deps: EvidenceUploadDependencies,
): Promise<{ fileId: string; upload: { url: string; fields: Record<string, string> } }> {
  if (!(ALLOWED_EVIDENCE_MIME_TYPES as readonly string[]).includes(input.mimeType)) {
    throw new ValidationError('Unsupported file type');
  }
  if (
    !Number.isInteger(input.sizeBytes) ||
    input.sizeBytes <= 0 ||
    input.sizeBytes > MAX_EVIDENCE_FILE_BYTES
  ) {
    throw new ValidationError('File size out of range');
  }

  const fileId = randomUUID();
  const quarantineKey = quarantineKeyFor(candidateId, fileId);
  const now = deps.clock.now().toISOString();

  await deps.createPendingFile({
    fileId,
    candidateId,
    originalFilename: sanitizeFilename(input.fileName),
    mimeType: input.mimeType,
    sizeBytes: input.sizeBytes,
    quarantineKey,
    createdAt: now,
  });

  const upload = await deps.createUploadPost({
    key: quarantineKey,
    contentType: input.mimeType,
    maxSizeBytes: MAX_EVIDENCE_FILE_BYTES,
    expiresInSeconds: UPLOAD_URL_TTL_SECONDS,
  });

  return { fileId, upload };
}
