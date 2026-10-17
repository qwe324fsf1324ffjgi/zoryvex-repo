#!/usr/bin/env node
// Verifies a DEPLOYED environment over HTTP, so that confirming a release
// does not depend on a person opening the site and clicking through it.
//
// Everything here is checked against the running deployment, never against
// the source that was supposed to produce it. A passing CI build says the
// code is good; this says the thing actually serving traffic is.
//
//   node scripts/verify-deployment.mjs \
//     --site https://test.zoryvex.space \
//     --api  https://test-api.zoryvex.space \
//     [--expect-version <commit sha>]
//
// Exits non-zero if any check fails, and prints exactly which.

import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { extractPrices, pricePattern } from './lib/live-prices.mjs';
import {
  REQUIRED_SECURITY_HEADERS,
  missingSecurityHeaders,
  cspAllowsApiOrigin,
  webRoutePaths,
  isRefusal,
  summarise,
} from './lib/deployment-verification.mjs';

const root = join(import.meta.dirname, '..');
const results = [];
const record = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` - ${detail}` : ''}`);
};

function parseArgs(argv) {
  const args = { site: null, api: null, expectVersion: null, timeoutMs: 20000 };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--site') args.site = argv[i + 1];
    else if (argv[i] === '--api') args.api = argv[i + 1];
    else if (argv[i] === '--expect-version') args.expectVersion = argv[i + 1];
    else if (argv[i] === '--timeout-ms') args.timeoutMs = Number(argv[i + 1]);
  }
  return args;
}

async function req(url, { method = 'GET', headers = {}, body, timeoutMs } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method, headers, body, signal: controller.signal });
    const text = await res.text();
    const headerMap = {};
    res.headers.forEach((value, key) => {
      headerMap[key] = value;
    });
    return { status: res.status, headers: headerMap, text };
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const { site, api, expectVersion, timeoutMs } = parseArgs(process.argv.slice(2));
  if (!site || !api) {
    console.error('Usage: verify-deployment.mjs --site <url> --api <url> [--expect-version <sha>]');
    process.exit(2);
  }
  const apiOrigin = new URL(api).origin;
  console.log(`Verifying deployed site ${site}\n`);

  // --- 1. The API is the build we think it is ----------------------------
  // First, because every check after it is only meaningful if the code
  // running is the code under test.
  let health = null;
  try {
    const res = await req(`${api}/health`, { timeoutMs });
    health = res.status === 200 ? JSON.parse(res.text) : null;
    record('API /health answers 200', res.status === 200, `status ${res.status}`);
  } catch (err) {
    record('API /health answers 200', false, err.message);
  }
  if (health) {
    record('API reports a build version', Boolean(health.version), `version ${health.version}`);
    record(
      'API reports its environment',
      Boolean(health.environment),
      `environment ${health.environment}`,
    );
    if (expectVersion) {
      const matches = health.version === expectVersion;
      record(
        'Deployed build is the expected commit',
        matches,
        matches ? expectVersion : `serving ${health.version}, expected ${expectVersion}`,
      );
    }
  }

  // --- 2. Every page the app router defines actually serves --------------
  const routes = webRoutePaths(join(root, 'apps', 'web', 'app'));
  const badRoutes = [];
  for (const route of routes) {
    try {
      const res = await req(`${site}${route}`, { timeoutMs });
      if (res.status !== 200) badRoutes.push(`${route} -> ${res.status}`);
    } catch (err) {
      badRoutes.push(`${route} -> ${err.message}`);
    }
  }
  record(
    `All ${routes.length} pages serve 200`,
    badRoutes.length === 0,
    badRoutes.length ? badRoutes.join(', ') : `${routes.length} routes`,
  );

  // --- 3. The deployed site shows the prices the code says ---------------
  // The static export bakes prices into the HTML at build time, so a build
  // that did not pick up a price change serves the old numbers while every
  // test passes against the new ones. That is the same class of failure as
  // a deploy that silently changed nothing, and it is the one that costs
  // money: a price change nobody can see is a price change that did not
  // happen. Read from contracts rather than restated, so this follows every
  // future raise on its own.
  //
  // What it establishes, precisely: every current price appears somewhere on
  // the pricing page. It catches a build that missed a price change
  // wholesale, which is the failure that actually happens. It is not proof
  // that each price is attached to the right tier, and one price can match
  // coincidentally - the page states the founding saving in naira too, so
  // during the 2026-09-04 raise the new founding Scout price of 300,000
  // matched the old page's saving figure while five others were correctly
  // reported missing. Overall detection held; a single-price change is the
  // case where this is weaker than it looks.
  try {
    const contractsSource = readFileSync(
      join(root, 'packages', 'contracts', 'src', 'domain.ts'),
      'utf8',
    );
    const pricingSource = readFileSync(
      join(root, 'apps', 'web', 'src', 'lib', 'pricing.ts'),
      'utf8',
    );
    const prices = extractPrices(contractsSource + pricingSource);
    const res = await req(`${site}/pricing`, { timeoutMs });
    const absent = prices.filter((amount) => !pricePattern(amount).test(res.text));
    record(
      `Pricing page shows all ${prices.length} current prices`,
      prices.length > 0 && absent.length === 0,
      absent.length
        ? `missing ${absent.map((a) => a.toLocaleString('en-US')).join(', ')} - the deployed build predates the current prices`
        : prices.map((a) => a.toLocaleString('en-US')).join(', '),
    );
  } catch (err) {
    record('Pricing page shows the current prices', false, err.message);
  }

  // --- 4. An unknown path 404s -------------------------------------------
  // Without this, a deployment that answered 200 for everything would pass
  // the check above while proving nothing at all.
  try {
    const res = await req(`${site}/zzz-not-a-real-page-${Date.now()}`, { timeoutMs });
    record('Unknown path returns 404', res.status === 404, `status ${res.status}`);
  } catch (err) {
    record('Unknown path returns 404', false, err.message);
  }

  // --- 5. Crawlers are refused unless this deployment opted in -----------
  // TEST serves the whole product on a public hostname. Before robots.ts
  // existed there was no robots.txt at all, so nothing stopped a crawler
  // indexing a pre-launch environment - and getting a product out of a
  // search index is far more work than keeping it out. Checked against the
  // deployment rather than the build, because this is a property of what is
  // actually being served.
  try {
    const res = await req(`${site}/robots.txt`, { timeoutMs });
    const disallowsEverything =
      /user-agent:\s*\*/i.test(res.text) && /disallow:\s*\/\s*$/im.test(res.text);
    record(
      'robots.txt refuses crawlers on this environment',
      res.status === 200 && disallowsEverything,
      res.status === 200 ? res.text.trim().replace(/\s+/g, ' ') : `status ${res.status}`,
    );
  } catch (err) {
    record('robots.txt refuses crawlers on this environment', false, err.message);
  }

  // --- 6. Security headers -----------------------------------------------
  try {
    const res = await req(site, { timeoutMs });
    const missing = missingSecurityHeaders(res.headers);
    record(
      `All ${Object.keys(REQUIRED_SECURITY_HEADERS).length} security headers present`,
      missing.length === 0,
      missing.length ? `missing ${missing.join(', ')}` : undefined,
    );
    record(
      'CSP allows the API origin the site calls',
      cspAllowsApiOrigin(res.headers['content-security-policy'], apiOrigin),
      apiOrigin,
    );
  } catch (err) {
    record('Security headers present', false, err.message);
  }

  // --- 7. Protected endpoints refuse an anonymous caller -----------------
  const protectedPaths = [
    '/candidates/me',
    '/candidates/me/evidence',
    '/candidates/me/export',
    '/candidates/me/graded-task',
    '/roles',
    '/billing',
    '/admin/billing',
    '/admin/exceptions',
  ];
  const notRefused = [];
  for (const path of protectedPaths) {
    try {
      const res = await req(`${api}${path}`, { timeoutMs });
      if (!isRefusal(res.status)) notRefused.push(`${path} -> ${res.status}`);
    } catch (err) {
      notRefused.push(`${path} -> ${err.message}`);
    }
  }
  record(
    `All ${protectedPaths.length} protected endpoints refuse anonymous callers`,
    notRefused.length === 0,
    notRefused.length ? notRefused.join(', ') : undefined,
  );

  // --- 8. A forged webhook is rejected ------------------------------------
  // The money path. An accepted forgery would let anyone grant themselves a
  // paid entitlement, so it is checked against the deployment rather than
  // trusted from a unit test of the signature function. Neither probe can
  // create state: rejection happens before any handling.
  const forgeries = [
    ['no signature', {}],
    ['a wrong signature', { 'x-paystack-signature': '0'.repeat(64) }],
  ];
  for (const [label, extraHeaders] of forgeries) {
    try {
      const res = await req(`${api}/webhooks/paystack`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...extraHeaders },
        body: JSON.stringify({ event: 'charge.success', data: { reference: 'verify-probe' } }),
        timeoutMs,
      });
      record(`Webhook with ${label} is rejected`, res.status === 401, `status ${res.status}`);
    } catch (err) {
      record(`Webhook with ${label} is rejected`, false, err.message);
    }
  }

  // --- 9. An invalid peer token is refused --------------------------------
  try {
    const res = await req(`${api}/peer-attestations/preview`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: 'x'.repeat(40) }),
      timeoutMs,
    });
    record('Invalid peer token is refused', res.status === 404, `status ${res.status}`);
  } catch (err) {
    record('Invalid peer token is refused', false, err.message);
  }

  const summary = summarise(results);
  console.log(`\n${summary.passed}/${summary.total} checks passed.`);
  if (!summary.ok) {
    console.error(`\n${summary.failed} FAILED:`);
    for (const failure of summary.failures) {
      console.error(`  - ${failure.name}: ${failure.detail ?? ''}`);
    }
    process.exit(1);
  }
  console.log('Deployment verified.');
}

main().catch((err) => {
  console.error(`verify-deployment failed: ${err.message}`);
  process.exit(1);
});
