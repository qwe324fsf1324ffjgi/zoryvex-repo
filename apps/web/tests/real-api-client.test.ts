import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  apiRequest,
  apiRequestRawText,
  getCsrfToken,
  isRealApiConfigured,
  RealApiError,
  setCsrfToken,
} from '../src/lib/real-api/client';
import { messageFor } from '../src/lib/real-api/error-message';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('isRealApiConfigured', () => {
  afterEach(() => {
    delete process.env.NEXT_PUBLIC_API_BASE_URL;
  });

  it('is false when NEXT_PUBLIC_API_BASE_URL is unset (the default for every existing page/test)', () => {
    delete process.env.NEXT_PUBLIC_API_BASE_URL;
    expect(isRealApiConfigured()).toBe(false);
  });

  it('is true once set', () => {
    process.env.NEXT_PUBLIC_API_BASE_URL = 'https://test-api.zoryvex.space';
    expect(isRealApiConfigured()).toBe(true);
  });
});

describe('apiRequest', () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_API_BASE_URL = 'https://test-api.zoryvex.space';
    setCsrfToken(null);
  });
  afterEach(() => {
    delete process.env.NEXT_PUBLIC_API_BASE_URL;
    vi.unstubAllGlobals();
  });

  it('throws when the API base URL is not configured', async () => {
    delete process.env.NEXT_PUBLIC_API_BASE_URL;
    await expect(apiRequest('/health')).rejects.toThrow('NEXT_PUBLIC_API_BASE_URL');
  });

  it('sends a GET with credentials included and parses the JSON response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { status: 'ok' }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await apiRequest<{ status: string }>('/health');

    expect(result).toEqual({ status: 'ok' });
    const [url, init] = fetchMock.mock.calls[0] as [
      string,
      NonNullable<Parameters<typeof fetch>[1]>,
    ];
    expect(url).toBe('https://test-api.zoryvex.space/health');
    expect(init.credentials).toBe('include');
    expect(init.method).toBe('GET');
  });

  it('sends a mutating request with no CSRF header when no token has been captured yet — required for the unauthenticated /auth/request-code and /auth/consume-code routes, which never check for one', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { requested: true }));
    vi.stubGlobal('fetch', fetchMock);

    await apiRequest('/auth/request-code', {
      method: 'POST',
      body: { email: 'a@example.com', intendedRole: 'candidate' },
    });

    const [, init] = fetchMock.mock.calls[0] as [string, NonNullable<Parameters<typeof fetch>[1]>];
    const headers = init.headers as Record<string, string>;
    expect(headers['x-zoryvex-csrf']).toBeUndefined();
  });

  it('attaches the captured CSRF token header on a mutating request', async () => {
    setCsrfToken('csrf-abc');
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true }));
    vi.stubGlobal('fetch', fetchMock);

    await apiRequest('/roles', { method: 'POST', body: { title: 'x' } });

    const [, init] = fetchMock.mock.calls[0] as [string, NonNullable<Parameters<typeof fetch>[1]>];
    const headers = init.headers as Record<string, string>;
    expect(headers['x-zoryvex-csrf']).toBe('csrf-abc');
    expect(init.body).toBe(JSON.stringify({ title: 'x' }));
  });

  it('omits the CSRF header on a GET request even when a token has been captured — the authorizer never checks it there, and sending it anyway would make the browser preflight a header API Gateway CORS does not allow-list, silently blocking the request', async () => {
    setCsrfToken('csrf-abc');
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true }));
    vi.stubGlobal('fetch', fetchMock);

    await apiRequest('/candidates/me');

    const [, init] = fetchMock.mock.calls[0] as [string, NonNullable<Parameters<typeof fetch>[1]>];
    const headers = init.headers as Record<string, string>;
    expect(headers['x-zoryvex-csrf']).toBeUndefined();
  });

  it('throws a RealApiError carrying the status/code/message from a non-2xx JSON error body', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(403, { error: 'FORBIDDEN', message: 'employer only' }));
    vi.stubGlobal('fetch', fetchMock);

    const error = await apiRequest('/roles').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RealApiError);
    expect((error as RealApiError).status).toBe(403);
    expect((error as RealApiError).code).toBe('FORBIDDEN');
    expect((error as RealApiError).message).toBe('employer only');
  });

  it('getCsrfToken reflects the most recent setCsrfToken call', () => {
    setCsrfToken('token-1');
    expect(getCsrfToken()).toBe('token-1');
    setCsrfToken(null);
    expect(getCsrfToken()).toBeNull();
  });
});

describe('apiRequestRawText', () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_API_BASE_URL = 'https://test-api.zoryvex.space';
  });
  afterEach(() => {
    delete process.env.NEXT_PUBLIC_API_BASE_URL;
    vi.unstubAllGlobals();
  });

  it('returns the raw response text unparsed, for the Kit HTML download endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('<html>Kit</html>', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const html = await apiRequestRawText('/roles/role_1/kit');
    expect(html).toBe('<html>Kit</html>');
  });

  it('throws a RealApiError on a non-2xx response', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(404, { error: 'NOT_FOUND', message: 'x' }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(apiRequestRawText('/roles/missing/kit')).rejects.toThrow(RealApiError);
  });
});

/**
 * Nothing bounded a request at all until 2026-09-04. A connection that
 * opened and then stalled - a phone moving between networks is the ordinary
 * way this happens - left the page on its loading state until the browser's
 * own limit expired, which can be minutes. A spinner that never resolves is
 * worse than an error: there is nothing to act on, and no way to tell it
 * apart from slow.
 */
describe('request timeout', () => {
  it('gives up on a request that never settles, and says so', async () => {
    vi.stubEnv('NEXT_PUBLIC_API_BASE_URL', 'https://api.test');
    // A fetch that only ever rejects when its signal aborts, which is what a
    // stalled connection looks like from here.
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init: { signal?: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener('abort', () =>
              reject(new DOMException('Aborted', 'AbortError')),
            );
          }),
      ),
    );

    const failure = await apiRequest('/candidates/me', { timeoutMs: 10 }).catch(
      (error: unknown) => error,
    );

    expect(failure).toBeInstanceOf(RealApiError);
    expect((failure as RealApiError).status).toBe(408);
    expect((failure as RealApiError).message).toContain('took too long');
  });

  it('leaves a request that answers in time alone', async () => {
    vi.stubEnv('NEXT_PUBLIC_API_BASE_URL', 'https://api.test');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })),
    );
    await expect(apiRequest('/candidates/me', { timeoutMs: 5_000 })).resolves.toEqual({ ok: true });
  });

  /**
   * A timeout is a 4xx on purpose, so messageFor keeps its sentence rather
   * than replacing it with the caller's generic fallback. "That took too
   * long, check your connection" is more use than "try again", and a retry
   * genuinely is the right next action.
   */
  it('carries a message a person can act on rather than a status name', async () => {
    vi.stubEnv('NEXT_PUBLIC_API_BASE_URL', 'https://api.test');
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init: { signal?: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener('abort', () =>
              reject(new DOMException('Aborted', 'AbortError')),
            );
          }),
      ),
    );
    const failure = (await apiRequest('/x', { timeoutMs: 10 }).catch((e: unknown) => e)) as Error;
    expect(messageFor(failure, 'Something went wrong.')).toContain('Check your connection');
  });
});
