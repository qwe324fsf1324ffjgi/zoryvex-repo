#!/usr/bin/env node
// Build-time proof that the safe-shell export contains none of the
// forbidden capabilities: no Cognito, no Paystack key/plan/URL, no
// checkout CTA, no WhatsApp/LinkedIn link, no founder photo, no pricing,
// no marketing copy, no form/upload. Greps the ENTIRE built output —
// apps/web-safe-shell shares no code with apps/web, so a clean grep here
// is a real proof, not a hope that a conditional branch never leaked.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { extractPrices, forbiddenPricePatterns } from './lib/live-prices.mjs';

const root = join(import.meta.dirname, '..');
const outDir = join(root, 'apps/web-safe-shell/out');
const pkgPath = join(root, 'apps/web-safe-shell/package.json');

// Read the live prices instead of restating them. The four price rows that
// used to sit in the list below were the founding tiers and a Kit price of
// 29,000, and they stayed that way through the 2026-08-30 raise — so the
// three standard-tier prices and the current Kit price were not being
// checked for at all, and this script would have reported PASS on a
// safe-shell that displayed every one of them.
const LIVE_PRICES = extractPrices(
  readFileSync(join(root, 'apps/web/src/lib/pricing.ts'), 'utf8') +
    readFileSync(join(root, 'packages/contracts/src/domain.ts'), 'utf8'),
);

if (LIVE_PRICES.length < 7) {
  // Seven: the Kit, three founding tiers, three standard tiers. Fewer means
  // the extraction stopped seeing a source it used to read, and the guard
  // has quietly narrowed again.
  console.error(
    `assert-safe-shell: expected at least 7 live prices, found ${LIVE_PRICES.length} ` +
      `(${LIVE_PRICES.join(', ')}). Check scripts/lib/live-prices.mjs against the pricing modules.`,
  );
  process.exit(1);
}

const FORBIDDEN_PATTERNS = [
  { name: 'Cognito', pattern: /cognito/i },
  { name: 'Paystack', pattern: /paystack/i },
  { name: 'Paystack live secret key', pattern: /sk_live_/ },
  { name: 'Paystack test secret key', pattern: /sk_test_/ },
  { name: 'Checkout CTA/copy', pattern: /checkout/i },
  { name: 'WhatsApp link', pattern: /wa\.link/i },
  { name: 'LinkedIn link', pattern: /linkedin\.com/i },
  ...forbiddenPricePatterns(LIVE_PRICES),
  { name: 'Business name disclosure', pattern: /abbas solution/i },
  { name: 'Founder photo asset', pattern: /founder-photo/i },
  { name: 'Contact email domain', pattern: /gmail\.com/i },
];

function collectFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectFiles(full));
    else out.push(full);
  }
  return out;
}

const failures = [];

for (const file of collectFiles(outDir)) {
  let content;
  try {
    content = readFileSync(file, 'utf8');
  } catch {
    continue; // binary asset — nothing to grep
  }
  for (const { name, pattern } of FORBIDDEN_PATTERNS) {
    if (pattern.test(content)) {
      failures.push(`${file.replace(root, '.')}: contains forbidden content (${name})`);
    }
  }
  if (/<form[\s>]/i.test(content))
    failures.push(`${file.replace(root, '.')}: contains a <form> element`);
  if (/<input[\s>]/i.test(content))
    failures.push(`${file.replace(root, '.')}: contains an <input> element`);
}

const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
const deps = { ...pkg.dependencies, ...pkg.devDependencies };
for (const forbiddenDep of ['@zoryvex/local-adapters', '@zoryvex/contracts']) {
  if (deps[forbiddenDep]) {
    failures.push(
      `package.json depends on ${forbiddenDep} — the safe-shell must have zero shared code path`,
    );
  }
}

if (failures.length > 0) {
  console.error('Safe-shell assertion failed:');
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}

console.log('Safe-shell assertion passed: no forbidden capability found in the built output.');
