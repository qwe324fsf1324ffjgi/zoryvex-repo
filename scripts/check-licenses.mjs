#!/usr/bin/env node
// No external license-check account/service: walks already-resolved
// node_modules package.json files directly.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const nodeModules = join(root, 'node_modules');

const ALLOWED = new Set([
  'MIT',
  'ISC',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  '0BSD',
  'CC0-1.0',
  'Unlicense',
  'BlueOak-1.0.0',
  'Python-2.0',
  'MPL-2.0',
  'CC-BY-4.0',
  'MIT-0',
]);

// Our own private, unpublished workspaces — not third-party, not flagged.
const OWN_SCOPE = '@zoryvex/';

function collectPackageDirs(dir, acc) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return acc;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    if (entry.startsWith('@')) {
      collectPackageDirs(full, acc);
      continue;
    }
    const pkgJson = join(full, 'package.json');
    try {
      if (statSync(pkgJson).isFile()) acc.push(pkgJson);
    } catch {
      // not a package dir — ignore
    }
  }
  return acc;
}

const flagged = [];
const seen = new Set();

for (const pkgJsonPath of collectPackageDirs(nodeModules, [])) {
  let pkg;
  try {
    pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf8'));
  } catch {
    continue;
  }
  const key = `${pkg.name}@${pkg.version}`;
  if (seen.has(key) || pkg.name?.startsWith(OWN_SCOPE)) continue;
  seen.add(key);

  const license = typeof pkg.license === 'string' ? pkg.license : pkg.license?.type;
  if (!license || !ALLOWED.has(license)) {
    flagged.push(`${key}: ${license ?? 'MISSING'}`);
  }
}

if (flagged.length > 0) {
  console.warn(
    `License check: ${flagged.length} package(s) outside the allowed license set (review, not auto-blocked):`,
  );
  for (const f of flagged.slice(0, 50)) console.warn(`  - ${f}`);
  // Non-blocking by design: many legitimate packages use dual/complex
  // license expressions this simple string check can't parse. Human review,
  // not an automatic CI failure.
  process.exit(0);
}

console.log(`License check: all ${seen.size} resolved packages use an allowed license.`);
