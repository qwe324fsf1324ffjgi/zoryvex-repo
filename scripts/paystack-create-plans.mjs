#!/usr/bin/env node
// Creates the six Paystack Plan objects this product needs and prints the
// exact Parameter Store value that maps them. Test mode by default; live
// mode only behind --live and an explicit confirmation token.
//
// Six plans is six chances to type an amount wrong in a dashboard, and a
// wrong amount on a Plan bills the wrong number every month for the life of
// every subscription attached to it. The amounts here are read out of
// packages/contracts (scripts/lib/plan-catalog.mjs) and never typed again,
// so the script cannot invent one.
//
// Idempotent: it lists what already exists first, creates only what is
// missing, and refuses to reuse a plan whose amount or interval does not
// match what this product expects. Running it twice is safe.
//
// It never prints, logs, or stores the secret key. It prints plan codes,
// which are not secrets and are visible in Paystack's own dashboard.
//
// In live mode the key is never typed, pasted or passed on a command line
// either: it is read from the Parameter Store entry the founder filled in
// by hand, held in memory for the duration of the run, and never written
// anywhere. A key on a command line survives in shell history; a key in an
// environment variable is visible to every child process. Reading it from
// the one place it already has to live avoids both.

import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { EXPECTED_PLAN_COUNT, planCatalog } from './lib/plan-catalog.mjs';

const root = join(import.meta.dirname, '..');
const API = 'https://api.paystack.co';

const dryRun = process.argv.includes('--dry-run');

/**
 * Live mode, gated twice.
 *
 * This script used to refuse a live key outright, on the reasoning that a
 * script which happily runs against live is a script that eventually runs
 * against live by accident. That reasoning still holds, so the refusal is
 * still the default and still fires for a live key passed the old way.
 *
 * What changed is that six plans typed by hand into a dashboard is the
 * single highest-consequence manual step at go-live: a wrong amount on a
 * Plan bills that wrong amount every month, to every subscriber attached
 * to it, for the life of the subscription, and nothing downstream can
 * catch it because Paystack is the authority on what a plan costs. The
 * amounts here come out of packages/contracts and are never retyped.
 * Automating this removes more risk than it adds.
 *
 * Both flags are required, and the token is spelled out rather than a bare
 * --yes, so it cannot be reached by tab-completion or by an idle re-run of
 * a shell-history line.
 */
const live = process.argv.includes('--live');
const confirmIndex = process.argv.indexOf('--confirm-live');
const liveConfirmed = confirmIndex !== -1 && process.argv[confirmIndex + 1] === 'CREATE-LIVE-PLANS';

const positional = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : null;
const environment = live ? 'production' : (positional ?? 'test');

const awsProfile = process.env.AWS_PROFILE ?? 'zoryvex-admin';
const awsRegion = process.env.AWS_REGION ?? 'eu-west-1';

/** Reads the live key from Parameter Store. Never printed, never stored. */
function readLiveSecretKey() {
  try {
    return execFileSync(
      'aws',
      [
        'ssm',
        'get-parameter',
        '--name',
        '/zoryvex/production/paystack/secret-key',
        '--with-decryption',
        '--query',
        'Parameter.Value',
        '--output',
        'text',
        '--profile',
        awsProfile,
        '--region',
        awsRegion,
      ],
      { encoding: 'utf8', env: { ...process.env, MSYS2_ARG_CONV_EXCL: '*' } },
    ).trim();
  } catch {
    console.error(
      'Could not read /zoryvex/production/paystack/secret-key. Check the AWS session is valid\n' +
        'and that the live key has been put in Parameter Store.',
    );
    process.exit(1);
  }
}

if (live && !liveConfirmed) {
  console.error(
    'Refusing to run: --live needs --confirm-live CREATE-LIVE-PLANS alongside it.\n' +
      'Live plans are what real customers are charged against. This is deliberate friction.',
  );
  process.exit(1);
}

const secretKey = dryRun ? null : live ? readLiveSecretKey() : process.env.PAYSTACK_TEST_SECRET_KEY;
/**
 * Writes the plan-code parameter here instead of printing a command to paste.
 *
 * Opt-in, because the ordering noted at the end of this file matters:
 * Terraform creates this parameter, and writing it by hand before that apply
 * can break it. Once the billing infrastructure exists the write is safe and
 * expected, and doing it from the codes this run just resolved removes the
 * one step where a wrong paste charges the wrong price.
 */
const writeParameter = process.argv.includes('--write-parameter');

if (!dryRun && !secretKey) {
  console.error(
    'No secret key available. For test mode set PAYSTACK_TEST_SECRET_KEY (sk_test_...); for live\n' +
      'mode pass --live --confirm-live CREATE-LIVE-PLANS and put the key in Parameter Store first.\n' +
      'Pass --dry-run to see exactly what would be created without contacting Paystack at all.',
  );
  process.exit(1);
}

// The key must match the mode asked for, in both directions. A live key
// reached without --live is the old accident this guard was written for; a
// test key reached with --live would quietly create test plans and write
// them into the production registry, where every real checkout would then
// fail against a plan that does not exist in live mode.
if (!dryRun) {
  const expectedPrefix = live ? 'sk_live_' : 'sk_test_';
  if (!secretKey.startsWith(expectedPrefix)) {
    console.error(
      `Refusing to run: the secret key does not start with ${expectedPrefix}, which is what ` +
        `${live ? 'live' : 'test'} mode requires. Nothing was contacted.`,
    );
    process.exit(1);
  }
}

const contractsSource = readFileSync(
  join(root, 'packages', 'contracts', 'src', 'domain.ts'),
  'utf8',
);
const wanted = planCatalog(contractsSource);

if (wanted.length !== EXPECTED_PLAN_COUNT) {
  console.error(
    `Refusing to run: read ${wanted.length} plans out of packages/contracts, expected ` +
      `${EXPECTED_PLAN_COUNT}. The price table's shape has changed and scripts/lib/plan-catalog.mjs ` +
      'needs updating before this can create anything.',
  );
  process.exit(1);
}

function formatNGN(amount) {
  return `NGN ${amount.toLocaleString('en-NG')}`;
}

if (dryRun) {
  console.log(
    `Would create these six Paystack plans (${live ? 'LIVE' : 'test'} mode), and nothing else:\n`,
  );
  for (const plan of wanted) {
    console.log(
      `  ${plan.planKey.padEnd(26)} ${plan.name.padEnd(42)} ${formatNGN(plan.amountNGN)}/month`,
    );
  }
  console.log('\nNothing was contacted. Re-run without --dry-run to create them.');
  process.exit(0);
}

async function paystack(path, init = {}) {
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${secretKey}`,
      'Content-Type': 'application/json',
      ...init.headers,
    },
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.status) {
    throw new Error(body?.message ?? `${response.status} ${response.statusText}`);
  }
  return body.data;
}

// Existing plans first, so a re-run creates nothing and a half-finished run
// picks up where it stopped.
const existing = [];
for (let page = 1; page <= 10; page += 1) {
  const batch = await paystack(`/plan?perPage=50&page=${page}`);
  existing.push(...batch);
  if (batch.length < 50) break;
}
const byName = new Map(existing.map((plan) => [plan.name, plan]));

const registry = {};
const problems = [];

for (const plan of wanted) {
  const found = byName.get(plan.name);

  if (found) {
    // Never silently reuse a plan that bills a different amount. That is
    // the exact failure this script exists to prevent, and finding it
    // already in the dashboard makes it more dangerous, not less.
    if (found.amount !== plan.amountKobo || found.interval !== plan.interval) {
      problems.push(
        `"${plan.name}" already exists as ${found.plan_code} charging ${found.amount} kobo ` +
          `${found.interval}, but this product expects ${plan.amountKobo} kobo ${plan.interval}. ` +
          'Fix or rename it in the Paystack dashboard; this script will not touch it.',
      );
      continue;
    }
    registry[plan.planKey] = found.plan_code;
    console.log(`ok      ${plan.planKey.padEnd(26)} already exists (${found.plan_code})`);
    continue;
  }

  const created = await paystack('/plan', {
    method: 'POST',
    body: JSON.stringify({
      name: plan.name,
      amount: plan.amountKobo,
      interval: plan.interval,
      currency: plan.currency,
    }),
  });
  registry[plan.planKey] = created.plan_code;
  console.log(
    `created ${plan.planKey.padEnd(26)} ${formatNGN(plan.amountNGN)}/month (${created.plan_code})`,
  );
}

if (problems.length > 0) {
  console.error('\nSome plans could not be used:\n');
  for (const problem of problems) console.error(`  - ${problem}`);
  console.error('\nNo parameter value is printed while any plan is wrong.');
  process.exit(1);
}

const parameterName = `/zoryvex/${environment}/paystack/plan-codes`;
const value = JSON.stringify(registry);

// The profile and the region are both printed on purpose.
//
// This project deliberately has no default AWS profile: a stray static key
// was found under `[default]` during Phase 6 and removed, and a command with
// no `--profile` now correctly fails with "Unable to locate credentials"
// rather than silently succeeding as some other identity. SSM is also
// regional, so a write without `--region` can quietly create a second
// parameter somewhere nothing reads. A command that has to be edited before
// it works is a command that gets edited wrong.
const profile = process.env.AWS_PROFILE ?? 'zoryvex-admin';
const region = process.env.AWS_REGION ?? 'eu-west-1';

function aws(args) {
  return execFileSync('aws', args, {
    encoding: 'utf8',
    env: { ...process.env, MSYS2_ARG_CONV_EXCL: '*' },
  }).trim();
}

if (writeParameter) {
  console.log(`\nAll ${EXPECTED_PLAN_COUNT} plans exist. Writing ${parameterName}...`);
  aws([
    'ssm',
    'put-parameter',
    '--name',
    parameterName,
    '--type',
    'String',
    '--overwrite',
    '--profile',
    profile,
    '--region',
    region,
    '--value',
    value,
  ]);

  // Read back rather than trust the write. A plan code is not a secret,
  // so printing what landed is the cheapest proof it is what was sent.
  const readBack = aws([
    'ssm',
    'get-parameter',
    '--name',
    parameterName,
    '--profile',
    profile,
    '--region',
    region,
    '--query',
    'Parameter.Value',
    '--output',
    'text',
  ]);

  if (readBack !== value) {
    console.error('The parameter does not match what was sent. Nothing else was changed.');
    console.error(`  sent: ${value}`);
    console.error(`  read: ${readBack}`);
    process.exit(1);
  }

  console.log('Written and read back identical.');
  console.log(`  ${readBack}`);
  console.log(
    `Now run \`npm run plans:check ${environment}\` to confirm the contracts prices, this ` +
      'parameter and Paystack all agree.',
  );
  process.exit(0);
}

console.log(`\nAll ${EXPECTED_PLAN_COUNT} plans exist. Keep this command for after the deploy:\n`);
console.log(`  aws ssm put-parameter --name ${parameterName} \\`);
console.log(`    --type String --overwrite \\`);
console.log(`    --profile ${profile} --region ${region} \\`);
console.log(`    --value '${value}'`);
console.log(
  '\nThen read it back to confirm. Safe to print: a plan code is not a secret.\n' +
    `\n  aws ssm get-parameter --name ${parameterName} \\` +
    `\n    --profile ${profile} --region ${region} --query Parameter.Value --output text`,
);
// Ordering, stated here because getting it wrong is quiet and annoying.
//
// Terraform owns this parameter and creates it empty. The AWS provider
// deprecated `overwrite` in v5 with the note that "attempting to create an
// existing parameter will fail", so writing it by hand first risks breaking
// the very apply that would have created it. Writing it afterwards is safe
// and is the intended flow: the resource carries
// `lifecycle { ignore_changes = [value] }` precisely so a founder-set value
// survives every later apply.
console.log(
  '\nRun that AFTER the billing infrastructure is applied, not before. Terraform creates this\n' +
    'parameter empty, and creating it by hand first can make that apply fail. Afterwards the\n' +
    'write is safe and expected: the resource ignores changes to its own value, so it will not\n' +
    'be reverted.',
);
console.log(
  '\nUntil the parameter holds these codes, every subscription checkout refuses with "That plan\n' +
    'is not open for subscription yet. Nothing has been charged." — which is correct, because\n' +
    'initializing without a plan code would take one payment and set nothing recurring up.',
);
