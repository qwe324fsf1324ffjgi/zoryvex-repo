import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { KitOrderStatusSchema } from '@zoryvex/contracts';

/**
 * Structural guards on the rules that decide whether somebody has paid.
 *
 * Every one of these is a single expression buried somewhere unobvious,
 * and every one silently gives away a paid product if it is simplified by
 * a well-meaning reader. None of them would fail a normal test: the happy
 * path in each case is a customer who really did pay.
 *
 * This file deliberately reads source rather than behaviour. The behaviour
 * is covered elsewhere; what is pinned here is the shape that makes the
 * behaviour correct, because that is what gets refactored away.
 */

const root = join(__dirname, '..', '..', '..');
const read = (relative: string) => readFileSync(join(root, relative), 'utf8');

describe('the Kit is only downloadable once it is actually paid for', () => {
  const source = read('services/api/src/repositories/kit-order-repository.ts');

  /**
   * `getKitOrderForRole` is what the download gate consults, and the gate
   * itself only checks that it returned something. So the entire paid
   * boundary for a NGN 95,000 product is this filter. Replacing it with
   * `items[0]` would hand the Kit to anybody who opened a checkout and
   * closed the tab, and every test would still pass because the fixtures
   * all describe orders that succeeded.
   */
  it('returns only a succeeded order, never merely the first one found', () => {
    expect(source).toMatch(/status === 'succeeded'/);
    expect(source).not.toMatch(/return items\[0\]/);
  });

  it('does not treat a pending or refunded order as purchased', () => {
    const statuses = KitOrderStatusSchema.options;
    expect(statuses).toContain('pending');
    expect(statuses).toContain('refunded');
    for (const status of statuses.filter((s) => s !== 'succeeded')) {
      expect(source).not.toMatch(new RegExp(`status === '${status}'`));
    }
  });
});

describe('contact details are only released to somebody entitled to them', () => {
  const source = read('services/api/src/domain/contact-unlock-service.ts');

  /**
   * Three separate conditions, each closing a gap found the hard way:
   * the feature flag (so a kill switch actually kills reads, not just new
   * unlocks), the prior unlock, and the candidate's consent re-checked at
   * disclosure rather than only at purchase.
   */
  it('checks the flag, the unlock, and consent on the read path', () => {
    expect(source).toMatch(/flags\.contactUnlocks/);
    expect(source).toMatch(/contactUnlocked/);
    expect(source).toMatch(/contactUnlockConsent/);
  });

  /**
   * Consent is re-read at disclosure. A candidate who withdraws must stop
   * being disclosed, even though the employer's unlock stands and their
   * allowance stays spent.
   */
  it('re-checks consent when serving, not only when unlocking', () => {
    const serving = source.slice(source.indexOf('getUnlockedContactInfo'));
    expect(serving).toMatch(/contactUnlockConsent/);
  });
});

describe('a subscription is only sold against a price Paystack agrees with', () => {
  const source = read('services/api/src/domain/subscription-service.ts');

  /**
   * Passing `plan` to Paystack makes it ignore `amount` and charge the
   * plan's own price, proven against the live API. The quote shown to the
   * buyer comes from this codebase and the charge comes from Paystack, so
   * without this check the two can drift and the customer is debited a
   * number nobody displayed.
   */
  /**
   * Written twice. The first version asserted the source matched
   * /fetchPlan/, which a mutation renaming the call to `fetchPlanDISABLED`
   * sailed straight through, because the new name still contains the old
   * one. A guard that cannot fail is worse than no guard: it reports
   * safety it has not checked.
   *
   * These match the call being made and its result being compared, so
   * renaming, removing or bypassing any of it fails.
   */
  it('actually calls Paystack for the live price before opening a checkout', () => {
    expect(source).toMatch(/await deps\.fetchPlan\(/);
  });

  it('compares the live price against the quoted one', () => {
    expect(source).toMatch(/livePlan\.amountKobo !== expectedKobo/);
    expect(source).toMatch(/livePlan\.currency !== 'NGN'/);
  });

  it('refuses the sale rather than charging an unverified price', () => {
    const guard = source.slice(source.indexOf('livePlan.amountKobo !== expectedKobo'));
    expect(guard).toMatch(/throw new ConflictError/);
    expect(guard).toMatch(/Nothing has been charged/);
  });
});
