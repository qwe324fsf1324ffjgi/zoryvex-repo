import {
  PAYMENT_FAILURE_GRACE_DAYS,
  isTerminalPayment,
  type AccessState,
  type BillingSubscription,
  type EntitlementStatus,
  type PaymentStatus,
} from '@zoryvex/contracts';

/**
 * The billing state machine: three separate questions, answered
 * separately.
 *
 *   payment status        did this one charge go through
 *   subscription status   what Paystack intends to do next month
 *   access state          what the employer may do right now
 *
 * They are not the same question and they change at different moments. A
 * subscription sits at Paystack's `attention` status for a whole month
 * after one failed renewal, because Paystack does not retry; treating that
 * as "not paying" would lock out an employer whose card expired on a
 * Friday, and treating it as "paying" would hand out a free month. The
 * grace window is the answer, and it belongs to access state alone —
 * neither Paystack status changes while it runs.
 *
 * Everything here is pure and takes `now` explicitly. A billing rule whose
 * behaviour depends on the wall clock is a billing rule that cannot be
 * tested at the boundary that matters, which for grace windows is the only
 * boundary there is.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** When a grace window opened at `failedAt` runs out. */
export function graceDeadline(failedAt: Date): Date {
  return new Date(failedAt.getTime() + PAYMENT_FAILURE_GRACE_DAYS * DAY_MS);
}

/**
 * A stored ISO timestamp compared against `now`, failing closed.
 *
 * An unparseable date is treated as already past. Every caller below uses
 * this to answer "is the paid-for period over", and answering "no" for a
 * date we cannot read would extend paid access on the strength of a
 * corrupt field.
 */
function hasPassed(iso: string | null, now: Date): boolean {
  if (!iso) return false;
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return true;
  return time <= now.getTime();
}

/**
 * What the employer may do, from the subscription alone.
 *
 * Deliberately derived on every read rather than stored. A stored access
 * state would need something to wake up and change it the moment a grace
 * window closed or a cancelled period ran out, and that something would be
 * a scheduled job whose failure mode is silently serving paid access to
 * somebody who stopped paying eleven days ago.
 */
export function deriveAccess(
  subscription: Pick<
    BillingSubscription,
    'status' | 'graceEndsAt' | 'currentPeriodEnd' | 'nextPaymentDate'
  > | null,
  now: Date,
): AccessState {
  if (!subscription) return 'none';

  switch (subscription.status) {
    case 'completed':
    case 'cancelled':
      // Paystack has stopped billing and said so. There is nothing left to
      // grant: a cancelled subscription's final paid period is closed out
      // by the `non-renewing` branch below before this state is reached.
      return 'none';

    case 'non-renewing': {
      // Cancelled by the employer, but the period they already paid for is
      // theirs. Paystack sends `subscription.disable` on the next payment
      // date, which moves this to `cancelled` above; until then the paid
      // period is what decides.
      const periodOver = hasPassed(
        subscription.currentPeriodEnd ?? subscription.nextPaymentDate,
        now,
      );
      return periodOver ? 'suspended' : 'active';
    }

    case 'attention':
    case 'active': {
      // `attention` is Paystack's "we tried and could not charge the card".
      // `active` with a grace deadline set is the same situation seen from
      // our side: an `invoice.payment_failed` opened the window, and only a
      // later successful charge closes it.
      if (!subscription.graceEndsAt) return 'active';
      return hasPassed(subscription.graceEndsAt, now) ? 'suspended' : 'grace';
    }
  }
}

/**
 * The entitlement status that goes with an access state.
 *
 * `Entitlement` predates this module and is what the rest of the product
 * reads to decide whether an employer has marketplace access at all. It
 * has four states to access state's four, but they do not line up
 * one-to-one, so the mapping is written out rather than assumed:
 * `suspended` is `past_due` and not `canceled`, because the subscription
 * still exists and one successful charge brings it back.
 */
export function entitlementStatusForAccess(access: AccessState): EntitlementStatus {
  switch (access) {
    case 'active':
    case 'grace':
      return 'active';
    case 'suspended':
      return 'past_due';
    case 'none':
      return 'canceled';
  }
}

/** Whether paid marketplace features are available in this access state. */
export function grantsMarketplaceAccess(access: AccessState): boolean {
  return access === 'active' || access === 'grace';
}

/**
 * Whether a payment attempt may move from `from` to `to`.
 *
 * Payment status only ever moves forward. Without this guard, a late
 * webhook or a slow reconciliation reply can overwrite a settled outcome
 * with a stale one — the classic version of which is a `charge.success`
 * webhook that arrives after reconciliation has already marked a
 * transaction `abandoned`, or worse, an `abandoned` reading from a list
 * call landing on top of a payment that has since succeeded.
 *
 * The single exception is `success` to `reversed`: a refund or chargeback
 * is a real, later transition out of a state that is otherwise terminal,
 * and it is the transition that has to take access away.
 */
export function canTransitionPayment(from: PaymentStatus, to: PaymentStatus): boolean {
  if (from === to) return true;
  if (from === 'success') return to === 'reversed';
  if (isTerminalPayment(from)) return false;
  return true;
}

/**
 * Whether a subscription record should be replaced by what Paystack just
 * said, given the two timestamps.
 *
 * Paystack's webhook ordering is not guaranteed, and the retry schedule
 * (every 3 minutes for four attempts, then hourly for 72 hours) means a
 * redelivered old event can genuinely arrive after a newer one has been
 * processed. Comparing the event's own `created_at` against what is
 * stored, rather than trusting arrival order, is what stops a redelivered
 * `subscription.create` resurrecting a subscription that has since been
 * cancelled.
 *
 * Equal timestamps apply. Paystack's second resolution means two genuine
 * events can share one, and the alternative — dropping the later of two
 * same-second events — loses real state changes.
 */
export function isFresherThan(eventAt: string, storedAt: string): boolean {
  const event = Date.parse(eventAt);
  const stored = Date.parse(storedAt);
  // An unreadable event timestamp is not grounds to overwrite stored
  // state; an unreadable stored timestamp is not grounds to keep it.
  if (Number.isNaN(event)) return false;
  if (Number.isNaN(stored)) return true;
  return event >= stored;
}
