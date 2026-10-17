// Pure logic behind scripts/verify-deployment.mjs.
//
// Kept separate from the CLI so every rule below is unit-testable without a
// network. The CLI does the fetching; this decides what counts as correct.

import { readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Every response header the deployed site must carry, and what each one is
 * for. Checked as a set rather than spot-checked, because a headers policy
 * is edited as one block and losing a single line from it is silent.
 *
 * Strict-Transport-Security is deliberately absent: it is gated behind
 * var.enable_hsts and switched off in test on purpose
 * (infrastructure/envs/test/main.tf), so requiring it here would fail a
 * correct deployment.
 */
export const REQUIRED_SECURITY_HEADERS = {
  'content-security-policy': 'confines script, style and connect origins',
  'x-content-type-options': 'stops MIME sniffing',
  'x-frame-options': 'stops framing, so clickjacking has nothing to work with',
  'referrer-policy': 'stops full URLs leaking to third parties',
  'permissions-policy': 'switches off camera, microphone and geolocation',
};

/** Header names present in `headers` are removed; whatever remains is missing. */
export function missingSecurityHeaders(headers) {
  const present = new Set(Object.keys(headers ?? {}).map((h) => h.toLowerCase()));
  return Object.keys(REQUIRED_SECURITY_HEADERS).filter((h) => !present.has(h));
}

/**
 * The CSP must actually name the API origin the site talks to. A CSP that
 * looks well-formed but omits it blocks every real request the app makes,
 * which is invisible in a page-loads check and fatal in use.
 */
export function cspAllowsApiOrigin(csp, apiOrigin) {
  if (!csp || !apiOrigin) return false;
  const connect = csp
    .split(';')
    .map((d) => d.trim())
    .find((d) => d.startsWith('connect-src'));
  return Boolean(connect && connect.includes(apiOrigin));
}

/**
 * Turns Next.js app-router directories into the URL paths a browser asks
 * for. Derived from the filesystem rather than a hand-kept list, so a new
 * page cannot be added and left unverified.
 *
 * Route groups — a directory in parentheses — organise files without
 * appearing in the URL, so they are stripped. Dynamic segments ([id]) are
 * skipped: their URL needs real data, so they are covered by the e2e suite
 * rather than by fetching a made-up id.
 */
export function webRoutePaths(appDir) {
  const found = [];
  const walk = (dir, urlParts) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (entry.name.startsWith('[')) continue;
        const isGroup = entry.name.startsWith('(') && entry.name.endsWith(')');
        walk(join(dir, entry.name), isGroup ? urlParts : [...urlParts, entry.name]);
      } else if (entry.name === 'page.tsx') {
        found.push(`/${urlParts.join('/')}`.replace(/\/+$/, '') || '/');
      }
    }
  };
  walk(appDir, []);
  return [...new Set(found)].sort();
}

/**
 * A protected endpoint reached without a session must refuse. 401 and 403
 * are both correct refusals; anything 2xx is a live authorization hole, and
 * a 404 would mean the route is missing rather than protected.
 */
export function isRefusal(status) {
  return status === 401 || status === 403;
}

/** Formats one check for the terminal, and says whether the run can pass. */
export function summarise(results) {
  const failures = results.filter((r) => !r.ok);
  return {
    total: results.length,
    failed: failures.length,
    passed: results.length - failures.length,
    failures,
    ok: failures.length === 0,
  };
}
