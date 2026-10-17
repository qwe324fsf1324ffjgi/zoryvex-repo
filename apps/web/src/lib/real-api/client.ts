/**
 * Thin fetch wrapper against the real services/api (Phase 7 slice 8, part
 * 2). `NEXT_PUBLIC_API_BASE_URL` is a build-time env var (Next.js static
 * export bakes NEXT_PUBLIC_* values into the bundle, docs/ARCHITECTURE.md)
 * — unset by default, so every existing page/component/test that calls
 * `getLocalAdapters()` is completely unaffected by this module's
 * existence. See docs/DECISIONS.md for why this ships as an independently
 * tested client library this slice, wired into exactly one new page,
 * rather than replacing every `packages/local-adapters` call site.
 */
export function isRealApiConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_API_BASE_URL);
}

function apiBaseUrl(): string {
  const url = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (!url) throw new Error('NEXT_PUBLIC_API_BASE_URL is not configured');
  return url;
}

export class RealApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'RealApiError';
  }
}

/**
 * The CSRF token issued at sign-in (ADR 0001: exact-Origin + session-bound
 * token, checked by the authorizer on every mutating request) — held only
 * in memory, never persisted, lost on reload by design (a fresh page load
 * has no session-bound token until GET /auth/session or a new sign-in
 * re-establishes one).
 */
let csrfToken: string | null = null;

export function setCsrfToken(token: string | null): void {
  csrfToken = token;
}

export function getCsrfToken(): string | null {
  return csrfToken;
}

export interface ApiRequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  headers?: Record<string, string>;
  /** Overridable for the rare call that legitimately takes longer. */
  timeoutMs?: number;
}

/**
 * How long to wait before giving up on a request.
 *
 * Nothing bounded these at all, so a connection that opened and then stalled
 * - a phone moving between networks is the ordinary way this happens - left
 * the page on its loading state until the browser's own limit expired,
 * which can be minutes. A spinner that never resolves is worse than an
 * error: there is nothing to act on and no way to tell it apart from slow.
 *
 * 30 seconds because API Gateway's own integration timeout is 30 and no
 * handler here is meant to approach it, so anything longer is a stall
 * rather than a slow answer.
 */
const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Runs `fetch` under an abort signal and turns a timeout into an error a
 * person can read. 408 so it lands in messageFor's 4xx branch and keeps its
 * own sentence, which is more use than a generic "try again": it says the
 * request was abandoned rather than refused, and a retry is exactly right.
 */
type FetchInit = NonNullable<Parameters<typeof fetch>[1]>;

async function fetchWithTimeout(url: string, init: FetchInit, timeoutMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new RealApiError(
        408,
        'REQUEST_TIMEOUT',
        'That took too long to answer. Check your connection and try again.',
      );
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Always sends `credentials: 'include'` (the httpOnly session cookie,
 * ADR 0001) and, for a mutating method, the CSRF header the authorizer
 * requires — attached whenever one has been captured. Not enforced
 * client-side: `POST /auth/request-code`/`/auth/consume-code`/`/auth/
 * sign-out` are unauthenticated routes the real authorizer never applies
 * CSRF checking to at all (no session exists yet to bind a token to), so a
 * blanket "every mutating call needs a token" rule here would be actively
 * wrong for exactly the calls that establish the token in the first place.
 * The server is the sole source of truth for whether CSRF was required —
 * a real 403 surfaces as a RealApiError like any other rejection.
 */
export async function apiRequest<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const method = options.method ?? 'GET';
  const headers: Record<string, string> = { ...options.headers };

  if (options.body !== undefined) headers['content-type'] = 'application/json';
  // Only the authorizer's mutating-method branch ever checks this header
  // (services/api/handlers/authorizer.ts) — sending it on GET/HEAD too
  // makes the browser preflight a header the API Gateway CORS config
  // doesn't allow-list, which silently blocks the real request.
  if (method !== 'GET' && csrfToken) headers['x-zoryvex-csrf'] = csrfToken;

  const response = await fetchWithTimeout(
    `${apiBaseUrl()}${path}`,
    {
      method,
      headers,
      credentials: 'include',
      body: options.body !== undefined ? JSON.stringify(options.body) : null,
    },
    options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );

  const text = await response.text();
  const parsed: unknown = text ? JSON.parse(text) : undefined;

  if (!response.ok) {
    const body = parsed as { error?: string; message?: string } | undefined;
    throw new RealApiError(
      response.status,
      body?.error ?? 'UNKNOWN_ERROR',
      body?.message ?? `Request failed with status ${response.status}`,
    );
  }

  return parsed as T;
}

/** For the one endpoint that returns raw HTML, not JSON (GET /roles/{roleId}/kit). */
export async function apiRequestRawText(path: string, timeoutMs?: number): Promise<string> {
  const response = await fetchWithTimeout(
    `${apiBaseUrl()}${path}`,
    { credentials: 'include' },
    timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );
  const text = await response.text();
  if (!response.ok) {
    let body: { error?: string; message?: string } | undefined;
    try {
      body = JSON.parse(text) as { error?: string; message?: string };
    } catch {
      body = undefined;
    }
    throw new RealApiError(
      response.status,
      body?.error ?? 'UNKNOWN_ERROR',
      body?.message ?? `Request failed with status ${response.status}`,
    );
  }
  return text;
}
