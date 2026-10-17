// Single source of truth lives in @zoryvex/contracts so the real S3-backed
// pipeline (services/api) can never silently drift from what this local
// fake enforces.
export { MAX_EVIDENCE_FILE_BYTES, ALLOWED_EVIDENCE_MIME_TYPES } from '@zoryvex/contracts';

export interface UploadedFile {
  id: string;
  candidateId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedAt: string;
}

export type FileUploadResult =
  { ok: true; file: UploadedFile } | { ok: false; error: 'FILE_TOO_LARGE' | 'UNSUPPORTED_TYPE' };

export interface FileAdapter {
  upload(
    candidateId: string,
    input: { fileName: string; mimeType: string; sizeBytes: number },
  ): FileUploadResult;
  listForCandidate(candidateId: string): UploadedFile[];
  delete(fileId: string): void;
}
