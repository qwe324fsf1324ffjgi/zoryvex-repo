import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const s3 = new S3Client({});

/**
 * Short-lived, ownership-bound presigned POST for evidence uploads —
 * content-length range and exact Content-Type are enforced as POST policy
 * conditions S3 itself checks, not just client-side validation.
 */
export async function createEvidenceUploadPost(input: {
  bucket: string;
  key: string;
  contentType: string;
  maxSizeBytes: number;
  expiresInSeconds: number;
}): Promise<{ url: string; fields: Record<string, string> }> {
  return createPresignedPost(s3, {
    Bucket: input.bucket,
    Key: input.key,
    Conditions: [
      ['content-length-range', 1, input.maxSizeBytes],
      ['eq', '$Content-Type', input.contentType],
    ],
    Fields: { 'Content-Type': input.contentType },
    Expires: input.expiresInSeconds,
  });
}

export async function createEvidenceDownloadUrl(input: {
  bucket: string;
  key: string;
  contentType: string;
  downloadFilename: string;
  inline: boolean;
  expiresInSeconds: number;
}): Promise<string> {
  const disposition = `${input.inline ? 'inline' : 'attachment'}; filename="${escapeFilename(input.downloadFilename)}"`;
  const command = new GetObjectCommand({
    Bucket: input.bucket,
    Key: input.key,
    ResponseContentType: input.contentType,
    ResponseContentDisposition: disposition,
  });
  return getSignedUrl(s3, command, { expiresIn: input.expiresInSeconds });
}

function escapeFilename(name: string): string {
  return name.replace(/["\\]/g, '');
}
