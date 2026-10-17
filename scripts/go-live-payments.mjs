#!/usr/bin/env node
// Everything between "the live secret key is in Parameter Store" and
// "production can take a real payment", in one run.
//
// Each step is separately runnable and each one is idempotent, but doing
// them by hand means doing them in the right order, and the order is the
// part that bites: plan codes written before the plans exist point at
// nothing, and payments switched on before the codes are written gives
// every buyer "that plan is not open for subscription yet" at the moment
// they press Subscribe.
//
// Nothing here prints the secret key. It is read by the scripts that need
// it, from the one place it lives.
//
// Refuses to do anything on a key that is not live. Turning payments on
// against test-mode plans is the failure this ordering exists to prevent:
// every real checkout would fail against a plan Paystack cannot find.

import { execFileSync } from 'node:child_process';

const AWS_PROFILE = process.env.AWS_PROFILE ?? 'zoryvex-admin';
const AWS_REGION = process.env.AWS_REGION ?? 'eu-west-1';
const dryRun = process.argv.includes('--dry-run');

const confirmIndex = process.argv.indexOf('--confirm');
const confirmed = confirmIndex !== -1 && process.argv[confirmIndex + 1] === 'GO-LIVE';

function aws(args) {
  return execFileSync('aws', [...args, '--profile', AWS_PROFILE, '--region', AWS_REGION], {
    encoding: 'utf8',
    env: { ...process.env, MSYS2_ARG_CONV_EXCL: '*' },
  }).trim();
}

function run(command, args) {
  execFileSync(command, args, {
    stdio: 'inherit',
    env: { ...process.env, MSYS2_ARG_CONV_EXCL: '*' },
  });
}

function step(n, title) {
  console.log(`\n${'='.repeat(64)}\n${n}. ${title}\n${'='.repeat(64)}`);
}

// --- Preflight ------------------------------------------------------------
// Read once, to check the shape only. The value is compared against a
// prefix and then goes out of scope; it is never printed or stored.
step(0, 'Preflight');

let keyIsLive = false;
try {
  const key = aws([
    'ssm',
    'get-parameter',
    '--name',
    '/zoryvex/production/paystack/secret-key',
    '--with-decryption',
    '--query',
    'Parameter.Value',
    '--output',
    'text',
  ]);
  keyIsLive = key.startsWith('sk_live_');
  if (key.includes('REPLACE-IN-AWS-CONSOLE')) {
    console.error('The live secret key is still the placeholder Terraform created.');
    console.error('Put the real live key in /zoryvex/production/paystack/secret-key first.');
    process.exit(1);
  }
} catch {
  console.error('Could not read the production Paystack key. Is the AWS session still valid?');
  process.exit(1);
}

if (!keyIsLive) {
  console.error('Refusing to continue: the stored production key is not an sk_live_ key.');
  console.error('Turning payments on against test plans fails every real checkout.');
  process.exit(1);
}
console.log('  live secret key present (value not read beyond its prefix)');

if (!dryRun && !confirmed) {
  console.error('\nThis takes real money from real cards once complete.');
  console.error('Re-run with --confirm GO-LIVE, or --dry-run to see the steps.');
  process.exit(1);
}

if (dryRun) {
  console.log('\nWould now: create six live plans, write their codes, verify every price');
  console.log('against what the site quotes, then switch payments and contact unlocks on.');
  console.log('Nothing was changed.');
  process.exit(0);
}

// --- 1. Plans -------------------------------------------------------------
step(1, 'Create the six live plans and write their codes');
run(process.execPath, [
  'scripts/paystack-create-plans.mjs',
  '--live',
  '--confirm-live',
  'CREATE-LIVE-PLANS',
  '--write-parameter',
]);

// --- 2. Prices ------------------------------------------------------------
// The check that matters most. Paystack is the authority on what a plan
// charges, so a plan whose amount disagrees with the site's quote bills the
// customer the wrong number with nothing downstream able to correct it.
step(2, 'Verify every live plan charges what the site quotes');
run(process.execPath, ['scripts/check-plan-prices.mjs', 'production']);

// --- 3. Flags -------------------------------------------------------------
// contactUnlocks goes on with payments, deliberately. It gates the only
// thing a subscription buys, on both the unlock and the read, so payments
// without it sells access to a feature that answers "temporarily
// unavailable" — a refund with extra steps.
//
// aiMatching stays off. Its evaluation gate has not been passed, and
// CLAUDE.md is explicit that hiring must keep working on the deterministic
// path alone until it is.
step(3, 'Switch payments and contact unlocks on');
const current = JSON.parse(
  aws([
    'ssm',
    'get-parameter',
    '--name',
    '/zoryvex/production/feature-flags',
    '--query',
    'Parameter.Value',
    '--output',
    'text',
  ]),
);
const next = {
  ...current,
  payments: true,
  contactUnlocks: true,
  verificationReminders: true,
  aiMatching: false,
};
aws([
  'ssm',
  'put-parameter',
  '--name',
  '/zoryvex/production/feature-flags',
  '--type',
  'String',
  '--overwrite',
  '--value',
  JSON.stringify(next),
]);
console.log(`  ${JSON.stringify(next)}`);

// --- 4. Read back ---------------------------------------------------------
step(4, 'Read back what production actually holds');
const readBack = JSON.parse(
  aws([
    'ssm',
    'get-parameter',
    '--name',
    '/zoryvex/production/feature-flags',
    '--query',
    'Parameter.Value',
    '--output',
    'text',
  ]),
);
const codes = JSON.parse(
  aws([
    'ssm',
    'get-parameter',
    '--name',
    '/zoryvex/production/paystack/plan-codes',
    '--query',
    'Parameter.Value',
    '--output',
    'text',
  ]),
);

const flagsOk =
  readBack.payments === true && readBack.contactUnlocks === true && readBack.aiMatching === false;
const codesOk = Object.keys(codes).length === 6;

console.log(`  flags       : ${flagsOk ? 'correct' : 'WRONG'} — ${JSON.stringify(readBack)}`);
console.log(`  plan codes  : ${Object.keys(codes).length} of 6 ${codesOk ? '' : '— INCOMPLETE'}`);

if (!flagsOk || !codesOk) {
  console.error('\nProduction is not in the intended state. Do not announce launch.');
  process.exit(1);
}

console.log('\nPayments are live. Nothing else is required for a real card to be charged.');
console.log('Paystack is not the only gate: the webhook URL must point at');
console.log('https://api.zoryvex.space/webhooks/paystack or access will not open after payment.');
