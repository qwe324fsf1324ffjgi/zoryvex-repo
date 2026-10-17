#!/usr/bin/env node
// docs/COST_GUARDRAILS.md: "a documented emergency script that disables AI,
// contact unlock and expensive jobs, and can set vulnerable Lambda reserved
// concurrency to zero without destroying data." Reviewed, never yet
// exercised (nothing is deployed — docs/DEPLOYMENT_STATUS.md) — the exact
// SSM parameter path this script writes to
// (`/zoryvex/<env>/feature-flags`) is this script's own proposed
// convention (consistent with infrastructure/modules/ci-deploy-role's
// existing `arn:aws:ssm:...:parameter/zoryvex/<env>/*` scoping), not yet
// confirmed against real config-loading Lambda code, which doesn't exist
// yet either. Confirm/adjust the path when that code is written, before
// relying on this script for a real incident.
//
// Deliberately does NOT touch DynamoDB, S3, or any Terraform-managed
// resource's existence — reserved-concurrency=0 rejects new invocations
// without deleting the function, and a feature-flag flip is a value
// change, not a resource change. Both are reversible in seconds by
// re-running with --restore, and neither requires a `terraform apply`.
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { DeployInputError, validateEnvironment } from './lib/deploy-lib.mjs';

// Named here, not discovered dynamically — an incident is not the moment to
// be surprised by which functions this script touches. Update this list
// when infrastructure/envs/{test,production}/main.tf gains more routes.
const LOCKDOWN_FUNCTION_NAME_SUFFIXES = ['authorizer', 'health'];

// The two flags this script's own documentation says it turns off. It must
// not silently change the others.
const LOCKDOWN_FLAG_VALUES = { aiMatching: false, contactUnlocks: false };

// Every flag `packages/config`'s FeatureFlagsSchema defines. The parameter is
// a single JSON document, so a `put-parameter --overwrite` writes the WHOLE
// document — writing only the two keys above silently deleted `payments` and
// `publicDiscovery`. That is not hypothetical: it is the recorded cause of a
// real feature-flag drift incident in this project, where the live parameter
// ended up holding a two-key document that contradicted the four-key one
// Terraform manages, and a human had to notice and repair it by hand.
//
// Safe fallback if the current document cannot be read: every flag off. For
// an emergency cost lockdown, off is the fail-safe direction.
const ALL_FLAGS_OFF = {
  payments: false,
  aiMatching: false,
  publicDiscovery: false,
  contactUnlocks: false,
  verificationReminders: false,
};

function ssmFeatureFlagsPath(env) {
  return `/zoryvex/${env}/feature-flags`;
}

/**
 * Read-modify-write, so the lockdown changes exactly the flags it claims to
 * and preserves the rest. A read failure is never fatal here — an incident is
 * the worst possible moment to abort a kill switch — so it falls back to the
 * all-off document instead.
 */
function lockdownFlagDocument(env) {
  let current;
  try {
    const raw = execFileSync(
      'aws',
      [
        'ssm',
        'get-parameter',
        '--name',
        ssmFeatureFlagsPath(env),
        '--query',
        'Parameter.Value',
        '--output',
        'text',
      ],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    ).trim();
    current = JSON.parse(raw);
  } catch {
    console.warn(
      `Could not read the current flags at ${ssmFeatureFlagsPath(env)} — writing every flag off, ` +
        'which is the fail-safe direction for a lockdown.',
    );
    return { ...ALL_FLAGS_OFF };
  }

  if (current === null || typeof current !== 'object' || Array.isArray(current)) {
    console.warn('Current flag document was not a JSON object — writing every flag off instead.');
    return { ...ALL_FLAGS_OFF };
  }

  // Start from the full schema shape so a previously-truncated document is
  // repaired rather than propagated, keep whatever the live values are, then
  // force the two this script owns.
  return { ...ALL_FLAGS_OFF, ...current, ...LOCKDOWN_FLAG_VALUES };
}

function functionNames(env) {
  return LOCKDOWN_FUNCTION_NAME_SUFFIXES.map((suffix) => `zoryvex-${env}-${suffix}`);
}

function parseArgs(argv) {
  const args = { env: null, confirm: null, restore: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--env') args.env = argv[++i];
    else if (arg === '--confirm') args.confirm = argv[++i];
    else if (arg === '--restore') args.restore = true;
  }
  return args;
}

function usageAndExit(message) {
  console.error(message);
  console.error(
    '\nUsage: node scripts/emergency-cost-lockdown.mjs --env <test|production> --confirm <env-name> [--restore]\n' +
      '  Without --restore: sets aiMatching/contactUnlocks off and the named Lambdas’ reserved concurrency to 0.\n' +
      '  With --restore: removes the reserved-concurrency override (back to unreserved) — does NOT\n' +
      '  automatically re-enable the feature flags, since whatever triggered the lockdown should be\n' +
      '  reviewed by a human before AI/contact-unlock traffic resumes.',
  );
  process.exit(1);
}

function run(cmd, args) {
  console.log(`$ ${cmd} ${args.join(' ')}`);
  return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  let env;
  try {
    env = validateEnvironment(args.env);
  } catch (err) {
    if (err instanceof DeployInputError) usageAndExit(err.message);
    throw err;
  }

  if (args.confirm !== env) {
    usageAndExit(`BLOCKED: --confirm must exactly equal the environment name ("${env}").`);
  }

  if (args.restore) {
    for (const fn of functionNames(env)) {
      run('aws', ['lambda', 'delete-function-concurrency', '--function-name', fn]);
    }
    console.log(
      'Reserved-concurrency override removed for: ' +
        functionNames(env).join(', ') +
        '. Feature flags were NOT automatically restored — review the incident, then set them back ' +
        'deliberately.',
    );
    return;
  }

  for (const fn of functionNames(env)) {
    run('aws', [
      'lambda',
      'put-function-concurrency',
      '--function-name',
      fn,
      '--reserved-concurrent-executions',
      '0',
    ]);
  }

  run('aws', [
    'ssm',
    'put-parameter',
    '--name',
    ssmFeatureFlagsPath(env),
    '--type',
    'String',
    '--overwrite',
    '--value',
    JSON.stringify(lockdownFlagDocument(env)),
  ]);

  console.log(
    `Emergency lockdown applied to ${env}: ${functionNames(env).join(', ')} reserved concurrency set to 0; ` +
      `aiMatching/contactUnlocks flags forced off at ${ssmFeatureFlagsPath(env)}. ` +
      'No data was touched. Re-run with --restore once the incident is resolved.',
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
