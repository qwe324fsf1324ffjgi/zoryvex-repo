import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getCsrfToken, setCsrfToken } from '../src/lib/real-api/client';
import { consumeSignInToken, getSession, signOut } from '../src/lib/real-api/auth';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('real-api auth', () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_API_BASE_URL = 'https://test-api.zoryvex.space';
    setCsrfToken(null);
  });
  afterEach(() => {
    delete process.env.NEXT_PUBLIC_API_BASE_URL;
    vi.unstubAllGlobals();
  });

  it('consumeSignInToken captures the returned CSRF token for later mutating calls', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(200, {
          account: {
            id: 'acct_1',
            email: 'a@example.com',
            role: 'candidate',
            candidateId: 'cand_1',
          },
          csrfToken: 'issued-csrf',
        }),
      ),
    );

    await consumeSignInToken('the-token');

    expect(getCsrfToken()).toBe('issued-csrf');
  });

  it('signOut clears the CSRF token even if the request is still idempotently successful', async () => {
    setCsrfToken('stale-token');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, { signedOut: true })));

    await signOut();

    expect(getCsrfToken()).toBeNull();
  });

  it('getSession captures the re-issued CSRF token for a signed-in caller', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(200, {
          accountId: 'acct_1',
          email: 'a@example.com',
          role: 'candidate',
          candidateId: 'cand_1',
          csrfToken: 'reissued-csrf',
        }),
      ),
    );

    await getSession();

    expect(getCsrfToken()).toBe('reissued-csrf');
  });

  it('getSession returns null (not a thrown error) for a signed-out caller', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(jsonResponse(401, { error: 'UNAUTHORIZED', message: 'no session' })),
    );

    await expect(getSession()).resolves.toBeNull();
  });

  it('getSession still propagates a genuine non-401 error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse(500, { error: 'INTERNAL_ERROR', message: 'boom' })),
    );

    await expect(getSession()).rejects.toThrow('boom');
  });
});
