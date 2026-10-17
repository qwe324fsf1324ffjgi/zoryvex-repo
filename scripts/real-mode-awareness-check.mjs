#!/usr/bin/env node
// Lightweight, dependency-free static check — same style/spirit as
// scan-secrets.mjs and terraform-policy-check.mjs. Added 2026-08-26 after a
// product audit found four real, live defects (a live employer-facing page
// showing "No roles yet" despite real roles existing, a "Subscribe" button
// that fabricated a paid subscription with zero payment, the same
// fake-success problem on team invites, and a founder-facing dashboard
// showing fake platform metrics) that all shared one root cause: a
// candidate/employer/admin "app" page imported packages/local-adapters'
// getLocalAdapters() with no isRealApiConfigured() branch at all, so it ran
// entirely on local-fake data even when deployed with a real backend
// configured. None of this was caught by the existing test suite because
// playwright.config.ts's webServer never sets NEXT_PUBLIC_API_BASE_URL, so
// e2e tests structurally only ever exercise local-fake mode (a separate,
// larger gap — building real-mode e2e coverage needs a live or mocked
// backend in CI, tracked as future work, not attempted here). This check
// is the cheap, buildable half: it can't prove a page's real-mode branch is
// CORRECT, but it can make it structurally impossible for a new app page to
// silently ship with no real-mode awareness at all, the exact failure mode
// found in every one of those four bugs.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = join(import.meta.dirname, '..');
const appRoot = join(root, 'apps', 'web', 'app');

// Only the authenticated, role-scoped "(app)" sections carry real user data
// — marketing pages never call getLocalAdapters for domain data at all, and
// checking them too would just add noise, not catch a real failure mode.
const SCOPED_DIRS = ['candidate/(app)', 'employer/(app)', 'admin/(app)'];

function listPageFiles(dir) {
  const out = [];
  let entries;
  try {
    entries = readdirSync(dir);
  } catch (err) {
    if (err.code === 'ENOENT') return out;
    throw err;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...listPageFiles(full));
    } else if (entry === 'page.tsx') {
      out.push(full);
    }
  }
  return out;
}

const findings = [];

for (const scoped of SCOPED_DIRS) {
  for (const file of listPageFiles(join(appRoot, scoped))) {
    const content = readFileSync(file, 'utf8');
    const usesLocalFake = /getLocalAdapters/.test(content);
    const awareOfRealMode = /isRealApiConfigured/.test(content);
    if (usesLocalFake && !awareOfRealMode) {
      findings.push(
        `${relative(root, file)}: imports getLocalAdapters but never checks isRealApiConfigured() ` +
          `— this page will run entirely on local-fake data even when a real backend is configured.`,
      );
    }
  }
}

if (findings.length > 0) {
  console.error('Real-mode awareness check found violations:');
  for (const f of findings) console.error(`  - ${f}`);
  console.error(
    '\nEvery candidate/employer/admin app page that reads or writes domain data must check ' +
      'isRealApiConfigured() and branch accordingly — even if the honest real-mode behavior is ' +
      'just a "not built yet" notice (see apps/web/app/employer/(app)/billing/page.tsx for the ' +
      'established pattern). Never let a page silently run on fictional data in a real deployment.',
  );
  process.exit(1);
}

console.log('Real-mode awareness check clean — every app page checks isRealApiConfigured().');
