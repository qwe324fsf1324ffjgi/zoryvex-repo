import { describe, expect, it } from 'vitest';
import type { EvidenceFile } from '@zoryvex/contracts';
import {
  authorizeAndPresignEvidenceDownload,
  type EvidenceDownloadDependencies,
} from '../src/domain/evidence-download-service';
import { NotFoundError } from '../src/errors/typed-errors';

function cleanFile(overrides: Partial<EvidenceFile> = {}): EvidenceFile {
  return {
    id: 'file_1',
    candidateId: 'cand_1',
    originalFilename: 'proof.png',
    mimeType: 'image/png',
    sizeBytes: 100,
    quarantineKey: 'quarantine/cand_1/file_1',
    acceptedKey: 'accepted/cand_1/file_1',
    scanStatus: 'clean',
    createdAt: '2026-08-19T00:00:00.000Z',
    scannedAt: '2026-08-19T00:01:00.000Z',
    ...overrides,
  };
}

function createFakeDeps(file: EvidenceFile | null) {
  const requestedUrls: unknown[] = [];
  const deps: EvidenceDownloadDependencies = {
    async getFile() {
      return file;
    },
    async createDownloadUrl(input) {
      requestedUrls.push(input);
      return 'https://bucket.s3.example/signed';
    },
  };
  return { deps, requestedUrls };
}

describe('authorizeAndPresignEvidenceDownload', () => {
  it('returns a presigned URL for a clean, accepted file', async () => {
    const { deps, requestedUrls } = createFakeDeps(cleanFile());
    const result = await authorizeAndPresignEvidenceDownload('cand_1', 'file_1', deps);
    expect(result.url).toBe('https://bucket.s3.example/signed');
    expect(requestedUrls).toHaveLength(1);
  });

  it('serves an image inline for preview', async () => {
    const { deps, requestedUrls } = createFakeDeps(cleanFile({ mimeType: 'image/jpeg' }));
    await authorizeAndPresignEvidenceDownload('cand_1', 'file_1', deps);
    expect((requestedUrls[0] as { inline: boolean }).inline).toBe(true);
  });

  it('forces attachment (never inline) for a PDF', async () => {
    const { deps, requestedUrls } = createFakeDeps(cleanFile({ mimeType: 'application/pdf' }));
    await authorizeAndPresignEvidenceDownload('cand_1', 'file_1', deps);
    expect((requestedUrls[0] as { inline: boolean }).inline).toBe(false);
  });

  it('throws NotFoundError for a nonexistent file', async () => {
    const { deps } = createFakeDeps(null);
    await expect(
      authorizeAndPresignEvidenceDownload('cand_1', 'file_1', deps),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('never serves a file still in quarantine, even if it exists', async () => {
    const { deps, requestedUrls } = createFakeDeps(
      cleanFile({ scanStatus: 'pending', acceptedKey: null }),
    );
    await expect(
      authorizeAndPresignEvidenceDownload('cand_1', 'file_1', deps),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(requestedUrls).toHaveLength(0);
  });

  it('never serves a rejected/infected file', async () => {
    const { deps } = createFakeDeps(cleanFile({ scanStatus: 'infected', acceptedKey: null }));
    await expect(
      authorizeAndPresignEvidenceDownload('cand_1', 'file_1', deps),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('the identical NotFoundError distinguishes neither "not mine" nor "does not exist"', async () => {
    // getFile is always called with the authenticated caller's own
    // candidateId — a different candidate's fileId simply never matches,
    // which this fake models by returning null regardless of the id asked
    // for, proving the service layer cannot leak existence either way.
    const { deps } = createFakeDeps(null);
    let messageForMissing: string | undefined;
    try {
      await authorizeAndPresignEvidenceDownload('cand_1', 'someone-elses-file', deps);
    } catch (error) {
      messageForMissing = error instanceof Error ? error.message : undefined;
    }
    let messageForNeverExisted: string | undefined;
    try {
      await authorizeAndPresignEvidenceDownload('cand_1', 'never-existed', deps);
    } catch (error) {
      messageForNeverExisted = error instanceof Error ? error.message : undefined;
    }
    expect(messageForMissing).toBe(messageForNeverExisted);
  });
});
