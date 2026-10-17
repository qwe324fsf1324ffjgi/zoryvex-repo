#!/usr/bin/env node
// Reads one environment's live feature-flag document and reports how it
// differs from what that environment's Terraform declares.
//
// Read-only. It makes exactly one AWS call, `ssm get-parameter` against a
// plain String parameter that holds no secret, and it writes nothing. There
// is deliberately no --fix: the whole reason this document is exempt from
// Terraform (`ignore_changes = [value]`) is that changing it is a decision,
// not a deploy step, and a script that quietly reconciled it would put the
// decision back in the pipeline where it does not belong.
//
// Exit codes follow the same three-outcome convention as
// scripts/load-quota-check.mjs, for the same reason: "could not measure"
// and "measured, and it is wrong" are different facts and must not share a
// code.
//
//   0  live matches what Terraform declares
//   1  drift
//   2  could not be measured (no session, parameter missing, AWS unreachable)

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  compareFeatureFlags,
  describeFeatureFlagDrift,
  hasFeatureFlagDrift,
  hasUnsafeFeatureFlagDrift,
  parseDeclaredFlags,
} from './lib/feature-flag-drift.mjs';

const ROOT = join(import.meta.dirname, '..');
const REGION = 'eu-west-1';

// Mirrors packages/config's FeatureFlagsSchema. scripts/lib/feature-flag-
// drift.test.mjs asserts this list equals the schema's own keys, so adding a
// flag there without adding it here fails the suite rather than quietly
// narrowing what this checks.
export const SCHEMA_FLAG_KEYS = [
  'payments',
  'aiMatching',
  'publicDiscovery',
  'contactUnlocks',
  'verificationReminders',
];

export function declaredFlagsForEnvironment(environment, { root = ROOT } = {}) {
  const mainTf = join(root, 'infrastructure', 'envs', environment, 'main.tf');
  return parseDeclaredFlags(readFileSync(mainTf, 'utf8'));
}

/** Thrown for "could not measure", never for "measured and it is wrong". */
export class FlagReadError extends Error {}

export function readLiveFlags(environment, { profile, exec = execFileSync } = {}) {
  const name = `/zoryvex/${environment}/feature-flags`;
  let raw;
  try {
    raw = exec(
      'aws',
      [
        'ssm',
        'get-parameter',
        '--name',
        name,
        '--region',
        REGION,
        '--output',
        'json',
        ...(profile ? ['--profile', profile] : []),
      ],
      {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        // Git Bash rewrites a leading-slash argument into a Windows path
        // before the AWS CLI ever sees it, which turns a real parameter name
        // into a ParameterNotFound that looks like the parameter is missing.
        // Cost a diagnosis once already.
        env: { ...process.env, MSYS_NO_PATHCONV: '1' },
      },
    );
  } catch (error) {
    const detail = String(error.stderr ?? error.message ?? '').trim();
    throw new FlagReadError(`Could not read ${name}: ${detail || 'unknown error'}`);
  }

  let value;
  try {
    value = JSON.parse(raw).Parameter?.Value;
  } catch {
    throw new FlagReadError(`The AWS CLI returned something that is not JSON for ${name}.`);
  }
  if (typeof value !== 'string') throw new FlagReadError(`${name} has no value.`);

  try {
    const parsed = JSON.parse(value);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('not an object');
    }
    return parsed;
  } catch {
    // This one is drift, not an unreadable environment — but it is drift so
    // severe that the running system reads every flag as false. Surfaced as
    // an unparseable document rather than swallowed.
    throw new FlagReadError(
      `${name} does not hold a JSON object. Every flag in the running system reads as false.`,
    );
  }
}

/**
 * Best-effort drift report for callers that must not fail because of it —
 * scripts/deploy.mjs after a successful smoke test. Never throws, never
 * changes an exit code; the worst case is one line saying it could not look.
 */
export function reportFeatureFlagDrift(environment, { profile } = {}) {
  let result;
  try {
    result = compareFeatureFlags({
      declared: declaredFlagsForEnvironment(environment),
      live: readLiveFlags(environment, { profile }),
      schemaKeys: SCHEMA_FLAG_KEYS,
    });
  } catch (error) {
    console.log(`\nCould not check feature-flag drift (${error.message}). Deploy is unaffected.`);
    return null;
  }

  console.log(`\n${describeFeatureFlagDrift(result, { environment })}`);
  if (hasUnsafeFeatureFlagDrift(result)) {
    console.log(
      'A flag is on live that this repository says is off. Nothing here turns a flag on out ' +
        'of band, so somebody did — check it before trusting this environment.',
    );
  }
  return result;
}

function parseArgs(argv) {
  const args = { environment: 'test', profile: process.env.AWS_PROFILE ?? null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--env') args.environment = argv[++i];
    else if (argv[i] === '--profile') args.profile = argv[++i];
  }
  return args;
}

function main() {
  const { environment, profile } = parseArgs(process.argv.slice(2));

  let declared;
  try {
    declared = declaredFlagsForEnvironment(environment);
  } catch (error) {
    console.error(`Could not read the declared flags for "${environment}": ${error.message}`);
    process.exit(2);
  }

  let live;
  try {
    live = readLiveFlags(environment, { profile });
  } catch (error) {
    console.error(error.message);
    console.error('Reporting this as unmeasured rather than as a pass.');
    process.exit(2);
  }

  const result = compareFeatureFlags({ declared, live, schemaKeys: SCHEMA_FLAG_KEYS });
  console.log(describeFeatureFlagDrift(result, { environment }));

  if (!hasFeatureFlagDrift(result)) process.exit(0);

  if (hasUnsafeFeatureFlagDrift(result)) {
    console.error(
      '\nThis is the direction that is never routine. Treat it as an incident until somebody ' +
        'can say who made the change and why.',
    );
  } else {
    console.error(
      '\nFix it with one deliberate `aws ssm put-parameter --overwrite` writing the complete ' +
        'document, and record it in docs/MANUAL_ACTIONS.md. Never a partial write: the document ' +
        'is replaced whole, and a partial one deletes the flags it omits.',
    );
  }
  process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
