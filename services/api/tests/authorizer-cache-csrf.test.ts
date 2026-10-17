import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The authorizer's CSRF and Origin checks must actually run.
 *
 * They did not. The API Gateway authorizer caches its decision keyed on
 * `identity_sources`, which is the session cookie and nothing else, and
 * the TTL was thirty seconds. The Origin header and the session-bound
 * CSRF token are checked inside the authorizer and appear in no cache
 * key, so once any request with that cookie had been authorized — a plain
 * GET of the profile is enough — every mutating request for the next
 * thirty seconds was answered from the cache without the authorizer
 * running at all.
 *
 * Measured against the deployed test API rather than argued. Cold, a
 * PATCH with no CSRF header was refused 403 and a PATCH from another
 * origin was refused 403. Warm, both were answered 200. A signed-in
 * browser is essentially always inside that window, so ADR 0001's CSRF
 * defence was inert in practice, leaving SameSite=Lax and the CORS
 * allow-list carrying a job neither was written to carry alone.
 *
 * This is here rather than only in a comment because the TTL reads like a
 * performance dial, and the obvious optimisation — putting it back —
 * silently removes a security control while every other test still
 * passes.
 */

const MODULE = join(
  import.meta.dirname,
  '..',
  '..',
  '..',
  'infrastructure',
  'modules',
  'api-gateway',
  'main.tf',
);

const AUTHORIZER_HANDLER = join(import.meta.dirname, '..', 'handlers', 'authorizer.ts');

describe('the session authorizer cannot be short-circuited by its own cache', () => {
  const terraform = readFileSync(MODULE, 'utf8');

  it('caches no authorizer result', () => {
    const ttl = /authorizer_result_ttl_in_seconds\s*=\s*(\d+)/.exec(terraform);
    expect(ttl, 'the authorizer must state its TTL explicitly').not.toBeNull();
    expect(
      Number(ttl![1]),
      'any non-zero TTL replays a decision made for a different Origin and CSRF token',
    ).toBe(0);
  });

  it('still keys identity on the cookie alone, which is why the TTL must stay zero', () => {
    // Listing the CSRF header here instead would look like the fix and is
    // not one: API Gateway refuses a request that omits any declared
    // identity source, so every GET would start failing.
    expect(terraform).toContain('identity_sources                  = ["$request.header.Cookie"]');
    expect(terraform).not.toContain('x-zoryvex-csrf"]');
  });

  it('records why, so the TTL is not tuned back up as a latency win', () => {
    const at = terraform.indexOf('authorizer_result_ttl_in_seconds');
    const preamble = terraform.slice(Math.max(0, at - 1800), at);
    expect(preamble).toMatch(/CSRF/);
    expect(preamble).toMatch(/cache key|cached decision/i);
  });

  /** The check the cache was skipping, still present in the handler. */
  it('checks Origin and the session-bound token on every mutating route', () => {
    const handler = readFileSync(AUTHORIZER_HANDLER, 'utf8');
    expect(handler).toMatch(/method !== 'GET' && method !== 'HEAD'/);
    expect(handler).toMatch(/event\.headers\?\.origin !== appOrigin/);
    expect(handler).toMatch(/csrfTokenMatches\(providedCsrfHash, session\.csrfTokenHash\)/);
  });
});
