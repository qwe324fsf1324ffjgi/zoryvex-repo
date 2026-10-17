#!/usr/bin/env node
// Lightweight, dependency-free secret scanner. Used both as a pre-commit
// hook (staged files only) and in CI (full tracked tree). No third-party
// account or SaaS involved.
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const STAGED_ONLY = process.argv.includes('--staged');

const PATTERNS = [
  { name: 'AWS Access Key ID', regex: /AKIA[0-9A-Z]{16}/ },
  {
    name: 'AWS Secret Access Key (heuristic)',
    regex: /aws_secret_access_key\s*=\s*['"][A-Za-z0-9/+=]{40}['"]/i,
  },
  { name: 'Private key block', regex: /-----BEGIN (RSA |EC |OPENSSH |DSA |)PRIVATE KEY-----/ },
  { name: 'GitHub token', regex: /gh[pousr]_[A-Za-z0-9]{36,}/ },
  { name: 'Paystack live secret key', regex: /sk_live_[A-Za-z0-9]{20,}/ },
  { name: 'Paystack test secret key', regex: /sk_test_[A-Za-z0-9]{20,}/ },
  {
    name: 'Generic bearer/API key assignment',
    regex: /(api[_-]?key|secret|token)\s*[:=]\s*['"][A-Za-z0-9_\-.]{24,}['"]/i,
  },
];

const EXCLUDED_PATH_SEGMENTS = [
  'node_modules/',
  'package-lock.json',
  '.terraform/',
  'dist/',
  'build/',
  'out/',
  '.next/',
];

function listFiles() {
  const cmd = STAGED_ONLY ? 'git diff --cached --name-only --diff-filter=ACM' : 'git ls-files';
  return execSync(cmd, { encoding: 'utf8' })
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((path) => !EXCLUDED_PATH_SEGMENTS.some((seg) => path.includes(seg)));
}

let findings = [];

for (const file of listFiles()) {
  let content;
  try {
    content = readFileSync(file, 'utf8');
  } catch {
    continue; // binary or unreadable — skip rather than crash the scan
  }
  for (const { name, regex } of PATTERNS) {
    if (regex.test(content)) {
      findings.push(`${file}: possible ${name}`);
    }
  }
}

if (findings.length > 0) {
  console.error('Secret scan found possible exposed credentials:');
  for (const f of findings) console.error(`  - ${f}`);
  console.error('\nRemove the secret, rotate it if it was ever real, and re-run the scan.');
  process.exit(1);
}

console.log(`Secret scan clean (${STAGED_ONLY ? 'staged files' : 'full tracked tree'}).`);
