import {
  ALLOWED_EVIDENCE_MIME_TYPES,
  MAX_EVIDENCE_FILE_BYTES,
  type FileAdapter,
  type FileUploadResult,
  type UploadedFile,
} from '../interfaces/files';
import { getJSON, setJSON, store } from './storage';

const indexKey = (candidateId: string) => `FILES#${candidateId}#IDS`;
const fileKey = (fileId: string) => `FILE#${fileId}`;

export class LocalFileAdapter implements FileAdapter {
  upload(
    candidateId: string,
    input: { fileName: string; mimeType: string; sizeBytes: number },
  ): FileUploadResult {
    if (input.sizeBytes > MAX_EVIDENCE_FILE_BYTES) {
      return { ok: false, error: 'FILE_TOO_LARGE' };
    }
    if (
      !ALLOWED_EVIDENCE_MIME_TYPES.includes(
        input.mimeType as (typeof ALLOWED_EVIDENCE_MIME_TYPES)[number],
      )
    ) {
      return { ok: false, error: 'UNSUPPORTED_TYPE' };
    }

    const file: UploadedFile = {
      id: `file_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      candidateId,
      fileName: input.fileName,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      uploadedAt: new Date().toISOString(),
    };
    setJSON(fileKey(file.id), file);
    const ids = new Set(getJSON<string[]>(indexKey(candidateId)) ?? []);
    ids.add(file.id);
    setJSON(indexKey(candidateId), [...ids]);
    return { ok: true, file };
  }

  listForCandidate(candidateId: string): UploadedFile[] {
    const ids = getJSON<string[]>(indexKey(candidateId)) ?? [];
    return ids
      .map((id) => getJSON<UploadedFile>(fileKey(id)))
      .filter((f): f is UploadedFile => f !== null);
  }

  delete(fileId: string): void {
    store.delete(fileKey(fileId));
  }
}
