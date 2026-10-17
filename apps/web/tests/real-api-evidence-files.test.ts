import { afterEach, describe, expect, it, vi } from 'vitest';
import { uploadToPresignedPost } from '../src/lib/real-api/evidence-files';

describe('uploadToPresignedPost', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('POSTs the presigned fields plus the file to the storage URL, never the API, without credentials', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);

    const file = new File(['hello'], 'evidence.png', { type: 'image/png' });
    await uploadToPresignedPost(
      {
        url: 'https://zoryvex-test-evidence.s3.amazonaws.com/',
        fields: { key: 'quarantine/cand_1/file_1', policy: 'p' },
      },
      file,
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [
      string,
      NonNullable<Parameters<typeof fetch>[1]>,
    ];
    expect(url).toBe('https://zoryvex-test-evidence.s3.amazonaws.com/');
    expect(init.method).toBe('POST');
    expect(init.credentials).toBeUndefined();
    const body = init.body as FormData;
    expect(body.get('key')).toBe('quarantine/cand_1/file_1');
    expect(body.get('policy')).toBe('p');
    expect(body.get('file')).toBe(file);
  });

  it('throws when S3 rejects the upload', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 403 })));
    const file = new File(['x'], 'x.png', { type: 'image/png' });
    await expect(
      uploadToPresignedPost({ url: 'https://example.com/', fields: {} }, file),
    ).rejects.toThrow('403');
  });
});
