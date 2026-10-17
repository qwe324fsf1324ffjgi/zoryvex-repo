#!/usr/bin/env node
// Checks that the price the app shows, the plan code it sends, and the
// amount Paystack actually bills all agree.
//
//   AWS_PROFILE=zoryvex-admin node scripts/check-plan-prices.mjs test
//
// Needs the environment's Paystack secret key and Parameter Store, so it is
// an operator check rather than part of `validate:all` - CI has neither.
// The pure comparison it performs is unit-tested in
// scripts/lib/plan-price-reconciliation.test.mjs, which does run there.
//
// Run it after any price change, and after repointing the plan-code
// parameter. A disagreement here charges a real customer a number they were
// never shown, and nothing in the application would throw.
//
// The secret key is read into the process environment and never printed.
// Plan codes are printed: they are identifiers, not secrets.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { reconcilePlanPrices } from './lib/plan-price-reconciliation.mjs';

const root = join(import.meta.dirname, '..');
const environment = process.argv[2] ?? 'test';

if (!['test', 'production'].includes(environment)) {
  console.error(`Unknown environment "${environment}". Expected test or production.`);
  process.exit(2);
}

function ssm(name) {
  return execFileSync(
    'aws',
    [
      'ssm',
      'get-parameter',
      '--name',
      name,
      '--with-decryption',
      '--query',
      'Parameter.Value',
      '--output',
      'text',
    ],
    { encoding: 'utf8', env: { ...process.env, MSYS2_ARG_CONV_EXCL: '*' } },
  ).trim();
}

/**
 * Prices straight out of the contracts source, parsed the same way
 * scripts/lib/plan-catalog.mjs parses it - scripts/ has no TypeScript
 * loader, and a second hand-typed copy of an amount is the one place a typo
 * would be invisible.
 */
function contractsPrices() {
  const source = readFileSync(join(root, 'packages', 'contracts', 'src', 'domain.ts'), 'utf8');
  const entry = /(\w+)\s*:\s*\{\s*founding\s*:\s*([\d_]+)\s*,\s*standard\s*:\s*([\d_]+)\s*,?\s*\}/g;
  const prices = {};
  for (const match of source.matchAll(entry)) {
    const tier = match[1];
    if (!['scout', 'team', 'partner'].includes(tier)) continue;
    prices[tier] = {
      founding: Number(match[2].replace(/_/g, '')),
      standard: Number(match[3].replace(/_/g, '')),
    };
  }
  return prices;
}

async function main() {
  const prices = contractsPrices();
  if (Object.keys(prices).length !== 3) {
    console.error(
      `Read ${Object.keys(prices).length} tiers out of packages/contracts, expected 3. ` +
        'The shape of SUBSCRIPTION_PRICES_NGN changed and this parser did not.',
    );
    process.exit(1);
  }

  const planCodes = JSON.parse(ssm(`/zoryvex/${environment}/paystack/plan-codes`));
  const secretKey = ssm(`/zoryvex/${environment}/paystack/secret-key`);

  const res = await fetch('https://api.paystack.co/plan?perPage=100', {
    headers: { Authorization: `Bearer ${secretKey}` },
  });
  if (!res.ok) {
    console.error(`Paystack returned ${res.status} listing plans. Nothing was checked.`);
    process.exit(1);
  }
  const body = await res.json();
  const liveAmountsByCode = Object.fromEntries(
    (body.data ?? []).map((plan) => [plan.plan_code, plan.amount / 100]),
  );

  const problems = reconcilePlanPrices({ prices, planCodes, liveAmountsByCode });

  console.log(`Plan prices in ${environment}:\n`);
  for (const [key, code] of Object.entries(planCodes)) {
    const [tier, priceTier] = key.split('_');
    const expected = prices[tier]?.[priceTier];
    const live = liveAmountsByCode[code];
    const agrees = expected !== undefined && live === expected;
    console.log(
      `  ${agrees ? 'ok  ' : 'BAD '} ${key.padEnd(26)} ${code.padEnd(22)} ` +
        `app ${String(expected ?? '?').padStart(10)}  paystack ${String(live ?? 'missing').padStart(10)}`,
    );
  }

  if (problems.length) {
    console.error(`\n${problems.length} problem(s):`);
    for (const problem of problems) console.error(`  - ${problem}`);
    console.error(
      '\nA buyer would be charged an amount they were never shown. Fix before any checkout.',
    );
    // exitCode rather than exit(): the fetch above leaves a handle open, and
    // tearing the loop down under it makes libuv print an assertion failure
    // after the report, which reads like a crash rather than a finding.
    process.exitCode = 1;
    return;
  }
  console.log('\nAll three sources agree: contracts, the plan-code parameter, and Paystack.');
}

main().catch((err) => {
  console.error(`check-plan-prices failed: ${err.message}`);
  process.exit(1);
});
