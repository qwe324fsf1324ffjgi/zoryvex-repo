#!/usr/bin/env node
// Phase 7 slice 10: set reserved concurrency on the 37 currently-deployed TEST
// Lambda functions, and nothing else.
//
// Terraform cannot do this narrowly. Its aws_lambda_function resource carries
// filename and source_code_hash alongside reserved_concurrent_executions, and
// the bundles on disk differ from what TEST runs, so any apply touching these
// functions also redeploys their code. That was inspected in a saved plan and
// rejected: a concurrency change is not authorization to ship code.
//
// So this does the one attribute directly through the Lambda API, and proves
// afterwards that nothing else moved, including the code hash and last
// modified timestamp, which is exactly what Terraform would have changed.
//
// The rollback baseline lives outside the repository and its path must be
// given explicitly. There is deliberately no in-repository default: one would
// put deployment-identifying hashes into version control by accident, and a
// silent fallback is how an operation ends up reading a stale baseline that no
// longer describes the account it is about to change.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PROFILE = 'zoryvex-admin';
const REGION = 'eu-west-1';
const TARGET_RESERVATION = 5;
const FUNCTION_LIST = 'scripts/slice10-functions.txt';

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Expected account totals, so a surprise is caught rather than absorbed. */
export const EXPECTED = {
  functions: 37,
  reservedAfter: 37 * TARGET_RESERVATION, // 185
  accountPool: 1000,
  unreservedBefore: 1000,
  unreservedAfter: 1000 - 37 * TARGET_RESERVATION, // 815
  minimumUnreserved: 100,
};

function realAws(args) {
  const out = execFileSync(
    'aws',
    [...args, '--profile', PROFILE, '--region', REGION, '--output', 'json'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );
  return out.trim() ? JSON.parse(out) : null;
}

/**
 * Shows a path without the user-specific part of it.
 *
 * The baseline sits under a temp directory whose name carries the account name
 * and a session id, neither of which is needed to know which file is meant.
 */
export function redactPath(p) {
  const parts = String(p).split(/[\\/]/).filter(Boolean);
  return parts.length <= 2 ? String(p) : `<redacted>${sep}${parts.slice(-2).join(sep)}`;
}

export function isInside(child, parent) {
  const c = resolve(child);
  const p = resolve(parent);
  return c === p || c.startsWith(p + sep);
}

/**
 * Resolves --baseline-file, refusing everything that could put the baseline
 * back inside the repository.
 *
 * Canonicalized rather than string-matched, because a symlink sitting outside
 * the tree and pointing into it passes a textual check and still writes hashes
 * into a working copy.
 */
export function resolveBaselinePath(argv, { repoRoot = REPO_ROOT, mustExist = true } = {}) {
  const i = argv.indexOf('--baseline-file');
  const given = i === -1 ? undefined : argv[i + 1];
  if (!given || given.startsWith('--')) {
    throw new Error('--baseline-file <absolute-path> is required. There is no default.');
  }
  if (!isAbsolute(given)) {
    throw new Error('--baseline-file must be an absolute path.');
  }
  if (isInside(given, repoRoot)) {
    throw new Error('--baseline-file must be outside the repository.');
  }

  if (mustExist) {
    if (!existsSync(given)) throw new Error('Baseline file does not exist.');
    const real = realpathSync(given);
    if (isInside(real, repoRoot)) {
      throw new Error('--baseline-file resolves inside the repository via a link.');
    }
    return real;
  }

  // Capture writes a file that does not exist yet, so its directory is what
  // gets canonicalized.
  const parent = dirname(given);
  if (!existsSync(parent)) throw new Error('Directory for --baseline-file does not exist.');
  if (isInside(realpathSync(parent), repoRoot)) {
    throw new Error('--baseline-file resolves inside the repository via a link.');
  }
  return given;
}

export function readFunctionNames(path = resolve(REPO_ROOT, FUNCTION_LIST)) {
  const names = readFileSync(path, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  if (names.length !== EXPECTED.functions) {
    throw new Error(`Expected ${EXPECTED.functions} function names, found ${names.length}.`);
  }
  const strays = names.filter((n) => !n.startsWith('zoryvex-test-'));
  if (strays.length > 0) {
    throw new Error(`Refusing: names outside the TEST prefix: ${strays.join(', ')}`);
  }
  return names;
}

export function loadBaseline(path) {
  let raw;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    throw new Error('Baseline file could not be read.');
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error('Baseline file is not valid JSON.');
  }
}

/**
 * Refuses a baseline that does not describe exactly the approved set.
 *
 * Each clause is a way the operation could touch something nobody approved: a
 * name that drifted in, one that dropped out, a duplicate that makes the count
 * look right while covering 36 functions, or an entry with no recorded prior
 * state, which cannot be rolled back to anything.
 */
export function validateBaseline(baseline, approvedNames) {
  if (!baseline || !Array.isArray(baseline.functions)) {
    throw new Error('Baseline is malformed: no functions array.');
  }
  const problems = [];
  const fns = baseline.functions;
  const names = fns.map((f) => f?.name);

  if (fns.length !== EXPECTED.functions) {
    problems.push(`expected ${EXPECTED.functions} functions, baseline has ${fns.length}`);
  }
  const dupes = names.filter((n, i) => names.indexOf(n) !== i);
  if (dupes.length > 0) problems.push(`duplicate functions: ${[...new Set(dupes)].join(', ')}`);

  const approved = new Set(approvedNames);
  const extra = names.filter((n) => !approved.has(n));
  const missing = approvedNames.filter((n) => !names.includes(n));
  if (extra.length > 0) problems.push(`not in the approved set: ${extra.join(', ')}`);
  if (missing.length > 0) problems.push(`missing from baseline: ${missing.join(', ')}`);

  const strays = names.filter((n) => typeof n !== 'string' || !n.startsWith('zoryvex-test-'));
  if (strays.length > 0) problems.push(`names outside the TEST prefix: ${strays.join(', ')}`);

  for (const f of fns) {
    if (!f || typeof f !== 'object') {
      problems.push('a baseline entry is not an object');
      continue;
    }
    if (!Object.hasOwn(f, 'reservedConcurrentExecutions')) {
      problems.push(`${f.name}: no recorded prior concurrency state`);
    }
    if (typeof f.codeSha256 !== 'string' || f.codeSha256.length === 0) {
      problems.push(`${f.name}: missing CodeSha256`);
    }
    if (typeof f.lastModified !== 'string' || f.lastModified.length === 0) {
      problems.push(`${f.name}: missing LastModified`);
    }
  }

  if (problems.length > 0) {
    throw new Error(`Baseline rejected:\n  ${problems.join('\n  ')}`);
  }
  return true;
}

/**
 * Compares live AWS against the baseline and refuses on any difference.
 *
 * Runs standalone, and runs again inside --apply immediately before the first
 * mutation. The second run is the one that matters: a baseline captured days
 * earlier describes an account that may have moved since, and changing
 * concurrency against a stale picture means the rollback restores a state that
 * is no longer true.
 *
 * It never rewrites the baseline. Refreshing it automatically would erase the
 * evidence that something drifted, which is the one thing this exists to show.
 */
export function preflight(baseline, { awsImpl = realAws } = {}) {
  const problems = [];
  const deployed = new Map();
  let marker = null;
  do {
    const page = awsImpl(['lambda', 'list-functions', ...(marker ? ['--marker', marker] : [])]);
    for (const f of page?.Functions ?? []) {
      deployed.set(f.FunctionName, { codeSha256: f.CodeSha256, lastModified: f.LastModified });
    }
    marker = page?.NextMarker ?? null;
  } while (marker);

  let unreservedCount = 0;
  for (const before of baseline.functions) {
    const live = deployed.get(before.name);
    if (!live) {
      problems.push(`${before.name}: no longer exists`);
      continue;
    }
    if (live.codeSha256 !== before.codeSha256) problems.push(`${before.name}: CodeSha256 drifted`);
    if (live.lastModified !== before.lastModified) {
      problems.push(`${before.name}: LastModified drifted`);
    }
    const conc = awsImpl(['lambda', 'get-function-concurrency', '--function-name', before.name]);
    const now = conc?.ReservedConcurrentExecutions ?? null;
    if (now !== (before.reservedConcurrentExecutions ?? null)) {
      problems.push(`${before.name}: concurrency drifted`);
    }
    if (now === null) unreservedCount += 1;
  }

  const account = awsImpl(['lambda', 'get-account-settings']);
  const limit = account?.AccountLimit?.ConcurrentExecutions;
  const unreserved = account?.AccountLimit?.UnreservedConcurrentExecutions;
  if (limit !== EXPECTED.accountPool) {
    problems.push(`account limit is ${limit}, expected ${EXPECTED.accountPool}`);
  }
  if (unreserved !== EXPECTED.unreservedBefore) {
    problems.push(`account unreserved is ${unreserved}, expected ${EXPECTED.unreservedBefore}`);
  }
  if (unreservedCount !== EXPECTED.functions) {
    problems.push(
      `${unreservedCount} of ${EXPECTED.functions} functions are unreserved, expected all`,
    );
  }

  return { passed: problems.length === 0, problems, limit, unreserved, unreservedCount };
}

export function rollbackPlanFor(functions) {
  return functions.map((f) =>
    (f.reservedConcurrentExecutions ?? null) === null
      ? { name: f.name, action: 'delete-function-concurrency' }
      : {
          name: f.name,
          action: 'put-function-concurrency',
          value: f.reservedConcurrentExecutions,
        },
  );
}

function rollback(functions, awsImpl) {
  const failures = [];
  for (const step of rollbackPlanFor(functions)) {
    try {
      if (step.action === 'delete-function-concurrency') {
        awsImpl(['lambda', 'delete-function-concurrency', '--function-name', step.name]);
      } else {
        awsImpl([
          'lambda',
          'put-function-concurrency',
          '--function-name',
          step.name,
          '--reserved-concurrent-executions',
          String(step.value),
        ]);
      }
    } catch (err) {
      // Collected rather than thrown, so one failure does not abandon the rest
      // of the rollback half-done.
      failures.push(`${step.name}: ${err.message}`);
    }
  }
  return failures;
}

/**
 * Sets the reservation, after rerunning preflight, and puts everything back if
 * any single change fails.
 */
export function applyConcurrency(baseline, { awsImpl = realAws } = {}) {
  const pre = preflight(baseline, { awsImpl });
  if (!pre.passed) {
    // Deliberately before the first mutation. Nothing has changed at this
    // point and nothing will.
    return { applied: 0, aborted: true, preflight: pre, rollbackFailures: [] };
  }

  const done = [];
  try {
    for (const f of baseline.functions) {
      awsImpl([
        'lambda',
        'put-function-concurrency',
        '--function-name',
        f.name,
        '--reserved-concurrent-executions',
        String(TARGET_RESERVATION),
      ]);
      done.push(f);
    }
    return { applied: done.length, aborted: false, preflight: pre, rollbackFailures: [] };
  } catch (err) {
    const failures = rollback(done, awsImpl);
    return {
      applied: 0,
      aborted: true,
      rolledBackFrom: done.length,
      rollbackFailures: failures,
      error: err.message,
      preflight: pre,
    };
  }
}

function capture(names, awsImpl = realAws) {
  const functions = [];
  for (const name of names) {
    const cfg = awsImpl(['lambda', 'get-function-configuration', '--function-name', name]);
    const conc = awsImpl(['lambda', 'get-function-concurrency', '--function-name', name]);
    functions.push({
      name,
      reservedConcurrentExecutions: conc?.ReservedConcurrentExecutions ?? null,
      codeSha256: cfg.CodeSha256,
      lastModified: cfg.LastModified,
    });
  }
  const account = awsImpl(['lambda', 'get-account-settings']);
  return {
    capturedAt: new Date().toISOString(),
    region: REGION,
    accountLimit: account.AccountLimit.ConcurrentExecutions,
    accountUnreserved: account.AccountLimit.UnreservedConcurrentExecutions,
    functions,
  };
}

/**
 * Proves the change did what was authorized and nothing more.
 *
 * Reserved concurrency reading 5 only says the intended change happened.
 * Unchanged CodeSha256 and LastModified are what say no code shipped with it.
 */
export function verifyAfterApply(baseline, { awsImpl = realAws } = {}) {
  const problems = [];
  for (const before of baseline.functions) {
    const cfg = awsImpl(['lambda', 'get-function-configuration', '--function-name', before.name]);
    const conc = awsImpl(['lambda', 'get-function-concurrency', '--function-name', before.name]);
    if (conc?.ReservedConcurrentExecutions !== TARGET_RESERVATION) {
      problems.push(`${before.name}: reservation is ${conc?.ReservedConcurrentExecutions}`);
    }
    if (cfg.CodeSha256 !== before.codeSha256) problems.push(`${before.name}: CodeSha256 CHANGED`);
    if (cfg.LastModified !== before.lastModified) {
      problems.push(`${before.name}: LastModified CHANGED`);
    }
  }
  const account = awsImpl(['lambda', 'get-account-settings']);
  const unreserved = account.AccountLimit.UnreservedConcurrentExecutions;
  if (unreserved !== EXPECTED.unreservedAfter) {
    problems.push(`account unreserved is ${unreserved}, expected ${EXPECTED.unreservedAfter}`);
  }
  return { passed: problems.length === 0, problems, unreserved };
}

function main() {
  const args = process.argv.slice(2);
  const names = readFunctionNames();

  if (args.includes('--preview')) {
    console.log(
      `Would set reserved concurrency to ${TARGET_RESERVATION} on these ${names.length}:`,
    );
    names.forEach((n, i) => console.log(`  ${String(i + 1).padStart(2)}. ${n}`));
    console.log(
      `\nAfter: ${EXPECTED.reservedAfter} reserved, ${EXPECTED.unreservedAfter} unreserved, ` +
        `floor ${EXPECTED.minimumUnreserved}.`,
    );
    console.log('The 8 undeployed functions are not in this list and are not touched.');
    return;
  }

  if (args.includes('--capture')) {
    const path = resolveBaselinePath(args, { mustExist: false });
    const baseline = capture(names);
    writeFileSync(path, JSON.stringify(baseline, null, 2) + '\n');
    console.log(`Captured ${baseline.functions.length} functions to ${redactPath(path)}`);
    console.log('  CodeSha256 and LastModified recorded to the file, not printed.');
    return;
  }

  if (args.includes('--preflight')) {
    const path = resolveBaselinePath(args);
    const baseline = loadBaseline(path);
    validateBaseline(baseline, names);
    const result = preflight(baseline);
    const matched = EXPECTED.functions - new Set(result.problems.map((p) => p.split(':')[0])).size;
    console.log(`Preflight against ${redactPath(path)}`);
    console.log(`  functions matching baseline : ${Math.max(0, matched)}/${EXPECTED.functions}`);
    console.log(`  account limit               : ${result.limit}`);
    console.log(`  account unreserved          : ${result.unreserved}`);
    console.log(`  functions unreserved        : ${result.unreservedCount}/${EXPECTED.functions}`);
    if (!result.passed) {
      console.error('\nPreflight FAILED. The baseline no longer describes this account:');
      for (const p of result.problems) console.error(`  ${p}`);
      console.error('\nThe baseline was not refreshed. Investigate before any apply.');
      process.exitCode = 1;
      return;
    }
    console.log('\nPreflight: PASS');
    return;
  }

  if (args.includes('--apply')) {
    const path = resolveBaselinePath(args);
    const baseline = loadBaseline(path);
    validateBaseline(baseline, names);
    const result = applyConcurrency(baseline);
    if (result.aborted) {
      console.error('Aborted before any mutation.');
      for (const p of result.preflight?.problems ?? []) console.error(`  ${p}`);
      for (const f of result.rollbackFailures) console.error(`  rollback FAILED: ${f}`);
      process.exitCode = 1;
      return;
    }
    console.log(
      `Set reserved concurrency to ${TARGET_RESERVATION} on ${result.applied} functions.`,
    );
    const check = verifyAfterApply(baseline);
    console.log(`  account unreserved: ${check.unreserved} (expected ${EXPECTED.unreservedAfter})`);
    if (!check.passed) {
      for (const p of check.problems) console.error(`  ${p}`);
      process.exitCode = 1;
    }
    return;
  }

  if (args.includes('--verify')) {
    const path = resolveBaselinePath(args);
    const baseline = loadBaseline(path);
    validateBaseline(baseline, names);
    if (!verifyAfterApply(baseline).passed) process.exitCode = 1;
    return;
  }

  console.log(
    'Usage: --preview | --capture --baseline-file <abs> | --preflight --baseline-file <abs> | ' +
      '--apply --baseline-file <abs> | --verify --baseline-file <abs>',
  );
}

// pathToFileURL rather than building the URL by hand: on Windows argv[1] is a
// backslashed drive path, a hand-made file:// comparison never matches, and
// the script silently does nothing. It ran as a no-op once before this.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
