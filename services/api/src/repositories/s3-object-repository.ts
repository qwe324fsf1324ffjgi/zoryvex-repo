import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';

const s3 = new S3Client({});

async function streamToUint8Array(body: unknown): Promise<Uint8Array> {
  // @aws-sdk/client-s3's Body is a web/Node stream depending on runtime;
  // transformToByteArray() is the SDK's own cross-runtime helper.
  return (body as { transformToByteArray(): Promise<Uint8Array> }).transformToByteArray();
}

/** Ranged read — just enough bytes for a magic-byte check, not the whole object. */
export async function getObjectRange(
  bucket: string,
  key: string,
  endByteInclusive: number,
): Promise<Uint8Array> {
  const result = await s3.send(
    new GetObjectCommand({ Bucket: bucket, Key: key, Range: `bytes=0-${endByteInclusive}` }),
  );
  return streamToUint8Array(result.Body);
}

export async function getObjectBytes(bucket: string, key: string): Promise<Uint8Array> {
  const result = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  return streamToUint8Array(result.Body);
}

export async function putObject(input: {
  bucket: string;
  key: string;
  body: Uint8Array;
  contentType: string;
}): Promise<void> {
  await s3.send(
    new PutObjectCommand({
      Bucket: input.bucket,
      Key: input.key,
      Body: input.body,
      ContentType: input.contentType,
    }),
  );
}

export async function deleteObject(bucket: string, key: string): Promise<void> {
  await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}
