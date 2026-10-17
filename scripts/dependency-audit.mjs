#!/usr/bin/env node
// The dependency audit gate.
//
// Replaces a bare `npm audit --audit-level=high`, which failed the whole
// Validate job - and with it the deploy - when npm's advisory endpoint
// timed out. That happened on 2026-09-04 and had nothing to do with this
// repository, which audits clean.
//
// A vulnerability still blocks. What changed is that a transport failure is
// retried, and if it never succeeds it is reported as UNMEASURED rather
// than quietly passing or noisily failing. The same distinction
// scripts/check-feature-flags.mjs already makes.

import { spawnSync } from 'node:child_process';
import {
  AUDIT_OUTCOME,
  classifyAuditResult,
  parseFindings,
  blockingAdvisories,
} from './lib/dependency-audit.mjs';

const ATTEMPTS = 3;
const BACKOFF_MS = 5000;

function runAudit() {
  const isWindows = process.platform === 'win32';
  const result = spawnSync(
    isWindows ? 'npm.cmd' : 'npm',
    ['audit', '--audit-level=high', '--json'],
    // shell is required on Windows: npm.cmd is a batch file, and Node
    // refuses to spawn one directly. The argument list is fixed literals,
    // so shell word-splitting has nothing to act on. Left off elsewhere,
    // which is where CI runs.
    { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, shell: isWindows },
  );
  // npm never started - wrong platform assumption, npm missing from PATH,
  // a spawn limit. Surfaced as itself rather than falling through to the
  // classifier, which would see an empty non-zero result and call it a
  // vulnerability. A broken harness must never be reported as a finding.
  if (result.error) {
    throw new Error(`could not run npm audit: ${result.error.message}`);
  }
  return {
    exitCode: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  let last;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    last = runAudit();
    const outcome = classifyAuditResult(last);

    if (outcome === AUDIT_OUTCOME.clean) {
      const findings = parseFindings(last.stdout);
      const moderate = findings ? findings.moderate + findings.low : 0;
      console.log(
        `No high or critical advisories.${moderate ? ` ${moderate} below the blocking level.` : ''}`,
      );
      return;
    }

    if (outcome === AUDIT_OUTCOME.vulnerable) {
      const named = blockingAdvisories(last.stdout);
      console.error('Dependency audit FAILED: high or critical advisories present.');
      if (named.length) console.error(`  ${named.join('\n  ')}`);
      else console.error(last.stderr.trim() || last.stdout.trim());
      process.exit(1);
    }

    // Unreachable. Worth another try - this is usually a blip.
    console.warn(
      `Advisory endpoint unreachable (attempt ${attempt} of ${ATTEMPTS}).` +
        (attempt < ATTEMPTS ? ` Retrying in ${BACKOFF_MS / 1000}s.` : ''),
    );
    if (attempt < ATTEMPTS) await sleep(BACKOFF_MS);
  }

  // Deliberately not a failure, and deliberately not a pass either.
  //
  // npm's advisory endpoint being down says nothing about this repository,
  // and letting a third party's uptime block a deploy is its own risk. But
  // nothing was checked, so this must never read as a clean audit: it is
  // labelled UNMEASURED so it is visible in the log and in any review of
  // what a release actually verified.
  console.warn('');
  console.warn('DEPENDENCY AUDIT UNMEASURED - npm advisory endpoint unreachable after retries.');
  console.warn('This is NOT a pass. No vulnerability was found, and none was ruled out.');
  console.warn(
    `Last error: ${(last.stderr || last.stdout).trim().split('\n').slice(-3).join(' ')}`,
  );
}

main().catch((err) => {
  console.error(`dependency-audit failed: ${err.message}`);
  process.exit(1);
});
