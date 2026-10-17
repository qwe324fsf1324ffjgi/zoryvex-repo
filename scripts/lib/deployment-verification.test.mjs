import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  REQUIRED_SECURITY_HEADERS,
  missingSecurityHeaders,
  cspAllowsApiOrigin,
  webRoutePaths,
  isRefusal,
  summarise,
} from './deployment-verification.mjs';

function appTree(dirs) {
  const root = mkdtempSync(join(tmpdir(), 'zoryvex-routes-'));
  for (const dir of dirs) {
    const full = join(root, dir);
    mkdirSync(full, { recursive: true });
    writeFileSync(join(full, 'page.tsx'), 'export default function Page() { return null; }');
  }
  return root;
}

describe('missingSecurityHeaders', () => {
  it('reports nothing when every required header is present', () => {
    const headers = Object.fromEntries(
      Object.keys(REQUIRED_SECURITY_HEADERS).map((h) => [h, 'value']),
    );
    expect(missingSecurityHeaders(headers)).toEqual([]);
  });

  it('is case-insensitive, because header casing is not guaranteed', () => {
    const headers = Object.fromEntries(
      Object.keys(REQUIRED_SECURITY_HEADERS).map((h) => [h.toUpperCase(), 'value']),
    );
    expect(missingSecurityHeaders(headers)).toEqual([]);
  });

  it('names exactly the header that was dropped', () => {
    const headers = Object.fromEntries(
      Object.keys(REQUIRED_SECURITY_HEADERS)
        .filter((h) => h !== 'x-frame-options')
        .map((h) => [h, 'value']),
    );
    expect(missingSecurityHeaders(headers)).toEqual(['x-frame-options']);
  });

  it('treats a response with no headers at all as missing all of them', () => {
    expect(missingSecurityHeaders(undefined)).toHaveLength(
      Object.keys(REQUIRED_SECURITY_HEADERS).length,
    );
  });
});

describe('cspAllowsApiOrigin', () => {
  const csp =
    "default-src 'self'; script-src 'self'; connect-src 'self' https://test-api.zoryvex.space";

  it('accepts a CSP whose connect-src names the API origin', () => {
    expect(cspAllowsApiOrigin(csp, 'https://test-api.zoryvex.space')).toBe(true);
  });

  /**
   * The failure this exists for: a CSP that is present and well-formed but
   * omits the API origin blocks every real request the app makes. Pages
   * still load, so a page-status check cannot see it.
   */
  it('rejects a well-formed CSP that omits the API origin', () => {
    expect(
      cspAllowsApiOrigin("default-src 'self'; connect-src 'self'", 'https://api.example'),
    ).toBe(false);
  });

  it('does not accept the origin appearing in some other directive', () => {
    const wrongDirective = "default-src 'self' https://test-api.zoryvex.space; connect-src 'self'";
    expect(cspAllowsApiOrigin(wrongDirective, 'https://test-api.zoryvex.space')).toBe(false);
  });

  it('rejects a missing CSP outright', () => {
    expect(cspAllowsApiOrigin(undefined, 'https://api.example')).toBe(false);
  });
});

describe('webRoutePaths', () => {
  it('maps a nested page to its URL path', () => {
    const root = appTree(['employer/billing']);
    expect(webRoutePaths(root)).toEqual(['/employer/billing']);
  });

  it('treats a root page as /', () => {
    expect(webRoutePaths(appTree(['']))).toEqual(['/']);
  });

  /**
   * Route groups organise files without appearing in the URL. Including
   * them would produce paths that 404 on a correct deployment, which would
   * make the whole check untrustworthy.
   */
  it('strips route groups from the URL', () => {
    const root = appTree(['(marketing)/pricing', 'candidate/(app)/profile']);
    expect(webRoutePaths(root)).toEqual(['/candidate/profile', '/pricing']);
  });

  it('skips dynamic segments, which need real data to fetch', () => {
    const root = appTree(['roles/[roleId]', 'roles']);
    expect(webRoutePaths(root)).toEqual(['/roles']);
  });

  it('deduplicates and sorts, so the output is stable to compare', () => {
    const root = appTree(['b', 'a', '(one)/c']);
    expect(webRoutePaths(root)).toEqual(['/a', '/b', '/c']);
  });
});

describe('isRefusal', () => {
  it('accepts both refusal codes', () => {
    expect(isRefusal(401)).toBe(true);
    expect(isRefusal(403)).toBe(true);
  });

  /**
   * A 200 is the hole this is looking for. A 404 is not a refusal either:
   * it means the route is missing, which is a different failure and should
   * not be reported as "protected".
   */
  it('rejects success and not-found alike', () => {
    expect(isRefusal(200)).toBe(false);
    expect(isRefusal(404)).toBe(false);
    expect(isRefusal(500)).toBe(false);
  });
});

describe('summarise', () => {
  it('passes only when nothing failed', () => {
    expect(summarise([{ ok: true }, { ok: true }]).ok).toBe(true);
    expect(summarise([{ ok: true }, { ok: false }]).ok).toBe(false);
  });

  it('counts and returns the failures for reporting', () => {
    const summary = summarise([{ ok: true }, { ok: false, name: 'x' }]);
    expect(summary).toMatchObject({ total: 2, passed: 1, failed: 1 });
    expect(summary.failures).toEqual([{ ok: false, name: 'x' }]);
  });

  it('passes an empty run rather than throwing', () => {
    expect(summarise([]).ok).toBe(true);
  });
});
