import { apiRequest } from './client';

export interface RequestUploadInput {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
}

export interface RequestUploadResult {
  fileId: string;
  upload: { url: string; fields: Record<string, string> };
}

export async function requestUpload(input: RequestUploadInput): Promise<RequestUploadResult> {
  return apiRequest('/evidence/upload-requests', { method: 'POST', body: input });
}

/**
 * The actual bytes go straight to S3 via the presigned POST fields
 * (services/api/src/domain/evidence-upload-service.ts) — never through
 * services/api itself, and never with the session cookie/CSRF header (a
 * different origin, a bucket, not our API). Promotion out of quarantine
 * happens asynchronously via GuardDuty (docs/DATA_MODEL.md "Evidence
 * pipeline") — this function only proves the upload was accepted by S3,
 * not that the file has cleared the malware scan yet.
 */
export async function uploadToPresignedPost(
  upload: RequestUploadResult['upload'],
  file: File,
): Promise<void> {
  const formData = new FormData();
  for (const [key, value] of Object.entries(upload.fields)) formData.append(key, value);
  formData.append('file', file);

  const response = await fetch(upload.url, { method: 'POST', body: formData });
  if (!response.ok) {
    throw new Error(`Upload to storage failed with status ${response.status}`);
  }
}

export async function getDownloadUrl(fileId: string): Promise<{ url: string }> {
  return apiRequest(`/evidence/files/${fileId}/download`);
}
