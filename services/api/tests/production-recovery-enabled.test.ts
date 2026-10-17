import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Production must be able to recover a payment whose webhook never came.
 *
 * Paystack sends no webhook at all for an abandoned checkout, and a
 * delivered webhook can still be lost to a timeout, a deploy, or a 5xx.
 * Reconciliation is the only thing that closes that gap: it asks Paystack
 * directly about every attempt still open after thirty minutes, grants
 * what was genuinely paid, and ages out what was not.
 *
 * It was disabled in production. The comment beside it said it MUST be
 * switched on at go-live, production went live on live keys on
 * 2026-09-11, and it stayed off — the go-live script flips feature flags
 * and this is Terraform, so nothing carried it across.
 *
 * What makes it worse than a missing job is that the product promises it.
 * When confirmation is slow the billing page tells the buyer "we check
 * again automatically every hour and your access will start without you
 * doing anything." A page that says that while nothing checks is telling
 * somebody their money is safe when it is not.
 *
 * Read from Terraform rather than from AWS so it fails in CI, before an
 * apply, rather than after one.
 */

const PRODUCTION_TF = join(
  import.meta.dirname,
  '..',
  '..',
  '..',
  'infrastructure',
  'envs',
  'production',
  'main.tf',
);
const BILLING_PAGE = join(
  import.meta.dirname,
  '..',
  '..',
  '..',
  'apps',
  'web',
  'src',
  'components',
  'billing',
  'RealBillingPage.tsx',
);

/** The `module "<name>" { ... }` block, brace-counted. */
function moduleBlock(source: string, name: string): string {
  const start = source.indexOf(`module "${name}"`);
  if (start === -1) return '';
  const open = source.indexOf('{', start);
  let depth = 0;
  let end = open;
  for (; end < source.length; end += 1) {
    if (source[end] === '{') depth += 1;
    else if (source[end] === '}') {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  return source.slice(open, end + 1);
}

describe('payment recovery runs in production', () => {
  const tf = readFileSync(PRODUCTION_TF, 'utf8');
  const block = moduleBlock(tf, 'billing_reconciliation_job');

  it('finds the reconciliation job in the production environment', () => {
    expect(block, 'production should declare a billing reconciliation job').not.toBe('');
  });

  it('has it enabled', () => {
    // `enabled = false` here means a paid customer whose webhook was lost
    // never gets the access they paid for, and nothing reports it.
    expect(block).toMatch(/enabled\s*=\s*true/);
    expect(block).not.toMatch(/enabled\s*=\s*false/);
  });

  it('runs at the interval the billing page promises a buyer', () => {
    const page = readFileSync(BILLING_PAGE, 'utf8');
    const promisesHourly = /check again automatically every hour/.test(page);
    if (promisesHourly) {
      expect(
        block,
        'the page promises an hourly check; the schedule must actually be hourly',
      ).toMatch(/schedule_expression\s*=\s*"rate\(1 hour\)"/);
    }
    expect(promisesHourly, 'the billing page should still make this promise').toBe(true);
  });
});
