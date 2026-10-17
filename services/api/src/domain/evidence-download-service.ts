import type { EvidenceFile } from '@zoryvex/contracts';
import { NotFoundError } from '../errors/typed-errors';

const DOWNLOAD_URL_TTL_SECONDS = 5 * 60;
const INLINE_PREVIEWABLE_TYPES = new Set(['image/png', 'image/jpeg', 'text/plain']);

export interface EvidenceDownloadDependencies {
  getFile(candidateId: string, fileId: string): Promise<EvidenceFile | null>;
  createDownloadUrl(input: {
    key: string;
    contentType: string;
    downloadFilename: string;
    inline: boolean;
    expiresInSeconds: number;
  }): Promise<string>;
}

/**
 * `candidateId` is always the authenticated caller's own id (from the
 * session context) — never a client-suppliable value. A fileId that
 * belongs to a different candidate resolves to the identical NotFoundError
 * a nonexistent fileId would, so this never confirms/denies another
 * candidate's file exists. Never serves a quarantine/ object regardless of
 * any tag — only ever the accepted/ key once scanStatus is `clean`.
 */
export async function authorizeAndPresignEvidenceDownload(
  candidateId: string,
  fileId: string,
  deps: EvidenceDownloadDependencies,
): Promise<{ url: string }> {
  const file = await deps.getFile(candidateId, fileId);
  if (!file || file.scanStatus !== 'clean' || !file.acceptedKey) {
    throw new NotFoundError('Evidence file not found');
  }

  const url = await deps.createDownloadUrl({
    key: file.acceptedKey,
    contentType: file.mimeType,
    downloadFilename: file.originalFilename,
    inline: INLINE_PREVIEWABLE_TYPES.has(file.mimeType),
    expiresInSeconds: DOWNLOAD_URL_TTL_SECONDS,
  });

  return { url };
}
