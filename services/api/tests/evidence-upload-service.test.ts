import { describe, expect, it } from 'vitest';
import type { EvidenceFile } from '@zoryvex/contracts';
import {
  acceptedKeyFor,
  quarantineKeyFor,
  requestEvidenceUpload,
  type EvidenceUploadDependencies,
} from '../src/domain/evidence-upload-service';
import { ValidationError } from '../src/errors/typed-errors';

function createFakeDeps() {
  const createdFiles: unknown[] = [];
  const posts: unknown[] = [];
  const deps: EvidenceUploadDependencies = {
    clock: { now: () => new Date('2026-08-19T00:00:00.000Z') },
    async createPendingFile(input) {
      createdFiles.push(input);
      return {
        ...input,
        id: input.fileId,
        acceptedKey: null,
        scanStatus: 'pending',
        scannedAt: null,
      } as EvidenceFile;
    },
    async createUploadPost(input) {
      posts.push(input);
      return { url: 'https://bucket.s3.example/', fields: { key: input.key } };
    },
  };
  return { deps, createdFiles, posts };
}

describe('requestEvidenceUpload', () => {
  it('accepts a valid PDF request and returns a presigned POST scoped to the quarantine prefix', async () => {
    const { deps, posts } = createFakeDeps();
    const result = await requestEvidenceUpload(
      'cand_1',
      { fileName: 'resume.pdf', mimeType: 'application/pdf', sizeBytes: 1024 },
      deps,
    );
    expect(result.fileId).toBeTruthy();
    expect(result.upload.fields.key).toBe(quarantineKeyFor('cand_1', result.fileId));
    expect(posts).toHaveLength(1);
  });

  it('sanitizes the filename before storing it', async () => {
    const { deps, createdFiles } = createFakeDeps();
    await requestEvidenceUpload(
      'cand_1',
      { fileName: '../../etc/passwd', mimeType: 'text/plain', sizeBytes: 10 },
      deps,
    );
    expect((createdFiles[0] as { originalFilename: string }).originalFilename).toBe('passwd');
  });

  it('rejects an unsupported MIME type', async () => {
    const { deps } = createFakeDeps();
    await expect(
      requestEvidenceUpload(
        'cand_1',
        { fileName: 'app.exe', mimeType: 'application/x-msdownload', sizeBytes: 10 },
        deps,
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects a file over the size limit', async () => {
    const { deps } = createFakeDeps();
    await expect(
      requestEvidenceUpload(
        'cand_1',
        { fileName: 'huge.pdf', mimeType: 'application/pdf', sizeBytes: 6 * 1024 * 1024 },
        deps,
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects a zero or negative size', async () => {
    const { deps } = createFakeDeps();
    await expect(
      requestEvidenceUpload(
        'cand_1',
        { fileName: 'x.pdf', mimeType: 'application/pdf', sizeBytes: 0 },
        deps,
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

describe('quarantineKeyFor / acceptedKeyFor', () => {
  it('never overlap for the same candidate/file', () => {
    expect(quarantineKeyFor('cand_1', 'file_1')).not.toBe(acceptedKeyFor('cand_1', 'file_1'));
  });
});
