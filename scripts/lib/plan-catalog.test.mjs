import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EXPECTED_PLAN_COUNT, OFFERED_INTERVAL, planCatalog } from './plan-catalog.mjs';

const root = join(import.meta.dirname, '..', '..');
const contractsSource = readFileSync(
  join(root, 'packages', 'contracts', 'src', 'domain.ts'),
  'utf8',
);

describe('planCatalog', () => {
  const plans = planCatalog(contractsSource);

  /**
   * Guards the guard. A regex that stopped matching would make
   * `paystack-create-plans.mjs` create nothing and report success, which is
   * the worst possible outcome for a script whose job is to make sure six
   * billing objects exist.
   */
  it('finds exactly the six plans that have to exist', () => {
    expect(plans).toHaveLength(EXPECTED_PLAN_COUNT);
    expect(plans.map((plan) => plan.planKey).sort()).toEqual([
      'partner_founding_monthly',
      'partner_standard_monthly',
      'scout_founding_monthly',
      'scout_standard_monthly',
      'team_founding_monthly',
      'team_standard_monthly',
    ]);
  });

  /**
   * The amounts are read from packages/contracts and never typed here. A
   * second copy of a price in the tool that creates the Plan is the one
   * place a typo is invisible: the Plan would be created, look right, and
   * bill the wrong number every month for the life of every subscription
   * attached to it.
   */
  it('reads the founder-fixed amounts rather than carrying its own copy', () => {
    const byKey = Object.fromEntries(plans.map((plan) => [plan.planKey, plan]));
    expect(byKey.scout_founding_monthly?.amountNGN).toBe(800_000);
    expect(byKey.scout_standard_monthly?.amountNGN).toBe(1_200_000);
    expect(byKey.team_founding_monthly?.amountNGN).toBe(1_400_000);
    expect(byKey.team_standard_monthly?.amountNGN).toBe(2_000_000);
    expect(byKey.partner_founding_monthly?.amountNGN).toBe(2_400_000);
    expect(byKey.partner_standard_monthly?.amountNGN).toBe(4_000_000);
  });

  it('converts to kobo, which is what Paystack charges in', () => {
    for (const plan of plans) {
      expect(plan.amountKobo).toBe(plan.amountNGN * 100);
      expect(Number.isInteger(plan.amountKobo)).toBe(true);
    }
  });

  it('creates monthly plans only, because that is the only interval on sale', () => {
    expect(OFFERED_INTERVAL).toBe('monthly');
    for (const plan of plans) expect(plan.interval).toBe('monthly');
  });

  it('names each plan so a person can tell six of them apart in a dashboard', () => {
    const names = plans.map((plan) => plan.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toContain('Zoryvex Scout (Founding, monthly, NGN 800,000)');
    expect(names).toContain('Zoryvex Partner (Standard, monthly, NGN 4,000,000)');
  });

  /**
   * The amount belongs in the name for a reason beyond readability, and it
   * is worth pinning: a Paystack Plan's amount cannot be edited, and the
   * creation script matches an existing Plan by name and then refuses to
   * reuse one charging something else. A name without the price means the
   * next raise finds its name already taken by a Plan at the old amount and
   * can neither reuse nor replace it - which is exactly what happened on
   * 2026-09-02 and had to be unstuck by renaming three plans by hand.
   */
  it('puts the amount in every plan name, so a price change cannot deadlock', () => {
    for (const plan of plans) {
      expect(plan.name, plan.planKey).toContain(plan.amountNGN.toLocaleString('en-US'));
    }
  });

  it('charges in naira', () => {
    for (const plan of plans) expect(plan.currency).toBe('NGN');
  });

  it('returns nothing rather than guessing when the source shape changes', () => {
    expect(planCatalog('export const SOMETHING_ELSE = 1;')).toEqual([]);
  });
});
