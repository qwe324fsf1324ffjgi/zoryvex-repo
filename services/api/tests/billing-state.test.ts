import { describe, expect, it } from 'vitest';
import type { BillingSubscription } from '@zoryvex/contracts';
import { PAYMENT_FAILURE_GRACE_DAYS } from '@zoryvex/contracts';
import {
  canTransitionPayment,
  deriveAccess,
  entitlementStatusForAccess,
  graceDeadline,
  grantsMarketplaceAccess,
  isFresherThan,
} from '../src/domain/billing-state';

type SubscriptionState = Pick<
  BillingSubscription,
  'status' | 'graceEndsAt' | 'currentPeriodEnd' | 'nextPaymentDate'
>;

const at = (iso: string) => new Date(iso);
const NOW = at('2026-09-01T12:00:00.000Z');

function subscription(overrides: Partial<SubscriptionState> = {}): SubscriptionState {
  return {
    status: 'active',
    graceEndsAt: null,
    currentPeriodEnd: '2026-10-01T00:00:00.000Z',
    nextPaymentDate: '2026-10-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('deriveAccess', () => {
  it('grants nothing when there is no subscription', () => {
    expect(deriveAccess(null, NOW)).toBe('none');
  });

  it('grants access to a healthy subscription', () => {
    expect(deriveAccess(subscription(), NOW)).toBe('active');
  });

  /**
   * The case the grace window exists for. Paystack does not retry a failed
   * subscription charge, so without a window an employer whose card was
   * declined on a Saturday would lose access instantly and not get another
   * attempt for a month.
   */
  it('keeps access inside the grace window after a failed charge', () => {
    const graceEndsAt = graceDeadline(NOW).toISOString();
    expect(deriveAccess(subscription({ status: 'attention', graceEndsAt }), NOW)).toBe('grace');
  });

  it('suspends once the grace window has closed', () => {
    const closed = at('2026-08-01T00:00:00.000Z').toISOString();
    expect(deriveAccess(subscription({ status: 'attention', graceEndsAt: closed }), NOW)).toBe(
      'suspended',
    );
  });

  it('treats the moment the window closes as closed', () => {
    // A boundary that has to fall one way on purpose: the deadline is the
    // last instant of grace, not the first instant after it.
    const exactly = NOW.toISOString();
    expect(deriveAccess(subscription({ status: 'active', graceEndsAt: exactly }), NOW)).toBe(
      'suspended',
    );
  });

  it('sets the window exactly the documented number of days out', () => {
    const deadline = graceDeadline(NOW);
    const days = (deadline.getTime() - NOW.getTime()) / (24 * 60 * 60 * 1000);
    expect(days).toBe(PAYMENT_FAILURE_GRACE_DAYS);
  });

  it('serves the period a cancelling employer already paid for', () => {
    expect(deriveAccess(subscription({ status: 'non-renewing' }), NOW)).toBe('active');
  });

  it('suspends a cancelled subscription once its paid period has run out', () => {
    const past = '2026-08-01T00:00:00.000Z';
    expect(
      deriveAccess(
        subscription({ status: 'non-renewing', currentPeriodEnd: past, nextPaymentDate: past }),
        NOW,
      ),
    ).toBe('suspended');
  });

  it.each(['completed', 'cancelled'] as const)('grants nothing once %s', (status) => {
    expect(deriveAccess(subscription({ status }), NOW)).toBe('none');
  });

  /**
   * Fails closed. A date we cannot read is not grounds to keep serving a
   * paid product, and the alternative reading — "unparseable means not yet
   * expired" — extends access on the strength of a corrupt field.
   */
  it('treats an unreadable grace deadline as already past', () => {
    expect(
      deriveAccess(subscription({ status: 'attention', graceEndsAt: 'sometime soon' }), NOW),
    ).toBe('suspended');
  });

  it('treats an unreadable period end as already past', () => {
    expect(
      deriveAccess(
        subscription({
          status: 'non-renewing',
          currentPeriodEnd: 'next month',
          nextPaymentDate: null,
        }),
        NOW,
      ),
    ).toBe('suspended');
  });

  it('falls back to the next payment date when no period end was recorded', () => {
    expect(
      deriveAccess(
        subscription({
          status: 'non-renewing',
          currentPeriodEnd: null,
          nextPaymentDate: '2026-08-01T00:00:00.000Z',
        }),
        NOW,
      ),
    ).toBe('suspended');
  });
});

describe('entitlementStatusForAccess', () => {
  it.each([
    ['active', 'active'],
    ['grace', 'active'],
    ['suspended', 'past_due'],
    ['none', 'canceled'],
  ] as const)('maps %s access to %s', (access, expected) => {
    expect(entitlementStatusForAccess(access)).toBe(expected);
  });

  it('marks a suspended subscription past_due rather than canceled', () => {
    // The distinction matters: `past_due` is recoverable by one successful
    // charge and keeps the plan on record, `canceled` is not.
    expect(entitlementStatusForAccess('suspended')).not.toBe('canceled');
  });
});

describe('grantsMarketplaceAccess', () => {
  it('is true exactly while the employer is paid up or inside the grace window', () => {
    expect(grantsMarketplaceAccess('active')).toBe(true);
    expect(grantsMarketplaceAccess('grace')).toBe(true);
    expect(grantsMarketplaceAccess('suspended')).toBe(false);
    expect(grantsMarketplaceAccess('none')).toBe(false);
  });
});

describe('canTransitionPayment', () => {
  it('lets an unsettled payment reach any outcome', () => {
    expect(canTransitionPayment('initialized', 'success')).toBe(true);
    expect(canTransitionPayment('pending', 'failed')).toBe(true);
    expect(canTransitionPayment('ongoing', 'abandoned')).toBe(true);
  });

  /**
   * The race this guard exists for: a `charge.success` webhook arriving
   * after reconciliation has already written `abandoned`, or a stale
   * `abandoned` reading landing on a payment that has since succeeded.
   */
  it('refuses to move a settled payment backwards', () => {
    expect(canTransitionPayment('abandoned', 'success')).toBe(false);
    expect(canTransitionPayment('failed', 'pending')).toBe(false);
    expect(canTransitionPayment('success', 'abandoned')).toBe(false);
    expect(canTransitionPayment('success', 'failed')).toBe(false);
  });

  it('allows the one real transition out of success: a refund or chargeback', () => {
    expect(canTransitionPayment('success', 'reversed')).toBe(true);
  });

  it('treats a repeat of the same status as harmless', () => {
    expect(canTransitionPayment('success', 'success')).toBe(true);
    expect(canTransitionPayment('abandoned', 'abandoned')).toBe(true);
  });
});

describe('isFresherThan', () => {
  it('accepts a genuinely newer event', () => {
    expect(isFresherThan('2026-09-01T12:00:01.000Z', '2026-09-01T12:00:00.000Z')).toBe(true);
  });

  it('rejects a redelivered older event', () => {
    expect(isFresherThan('2026-09-01T11:00:00.000Z', '2026-09-01T12:00:00.000Z')).toBe(false);
  });

  it('accepts an equal timestamp, because Paystack resolves to the second', () => {
    const same = '2026-09-01T12:00:00.000Z';
    expect(isFresherThan(same, same)).toBe(true);
  });

  it('will not overwrite stored state from an unreadable event timestamp', () => {
    expect(isFresherThan('not a date', '2026-09-01T12:00:00.000Z')).toBe(false);
  });

  it('will overwrite an unreadable stored timestamp', () => {
    expect(isFresherThan('2026-09-01T12:00:00.000Z', 'corrupt')).toBe(true);
  });
});
