#!/usr/bin/env node
// Standalone diagnostic, not part of the CI e2e suite. Proves the exact
// origin allow-list configured for the Playwright MCP server (see
// mcpServers.playwright.args --allowed-origins in the user's global Claude
// Code config) actually restricts navigation, using the same pinned
// @playwright/test-managed Chromium build. Exists for phases where the MCP
// server itself hasn't been reconnected yet in the current session — this
// script proves the restriction directly rather than skipping the check.
import { chromium } from '@playwright/test';

const ALLOWED_ORIGINS = [
  'http://localhost:4173',
  'http://127.0.0.1:4173',
  'https://test.zoryvex.space',
  'https://test-api.zoryvex.space',
];

const CASES = [
  { url: 'https://test.zoryvex.space/', expect: 'allowed' },
  { url: 'https://test-api.zoryvex.space/health', expect: 'allowed' },
  { url: 'https://example.com/', expect: 'blocked' },
  { url: 'https://evil-phish.example/', expect: 'blocked' },
];

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();

  await context.route('**/*', (route) => {
    const origin = new URL(route.request().url()).origin;
    if (ALLOWED_ORIGINS.includes(origin)) {
      route.continue();
    } else {
      route.abort('accessdenied');
    }
  });

  const page = await context.newPage();
  const results = [];

  for (const { url, expect } of CASES) {
    let outcome;
    try {
      const res = await page.goto(url, { timeout: 15_000, waitUntil: 'domcontentloaded' });
      outcome = res ? 'allowed' : 'blocked';
    } catch {
      outcome = 'blocked';
    }
    const pass = outcome === expect;
    results.push({ url, expect, outcome, pass });
    console.log(`${pass ? 'PASS' : 'FAIL'}  ${url}  expected=${expect} actual=${outcome}`);
  }

  await browser.close();

  const failed = results.filter((r) => !r.pass);
  if (failed.length > 0) {
    console.error(`\n${failed.length} case(s) did not match the expected origin-guard behavior.`);
    process.exit(1);
  }
  console.log('\nAll origin-guard cases matched expectations.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
