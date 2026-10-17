import {
  FOUNDING_SLOTS_TOTAL,
  KIT_PRICE_NGN,
  SUBSCRIPTION_PRICES_NGN,
  subscriptionPrice,
} from '@zoryvex/contracts';
import { beforeEach, describe, expect, it } from 'vitest';
import { LocalDataAdapter } from '../src/local/local-data-adapter';
import { LocalPaymentsAdapter } from '../src/local/local-payments-adapter';

beforeEach(() => {
  window.localStorage.clear();
});

describe('LocalPaymentsAdapter — Kit (per-role, one-time)', () => {
  it('creates a kit checkout at the current Kit price, tagged with the role', () => {
    const data = new LocalDataAdapter();
    const payments = new LocalPaymentsAdapter(data);
    const checkout = payments.createKitCheckout('emp_1', 'role_1');
    expect(checkout.amountNGN).toBe(KIT_PRICE_NGN);
    expect(checkout.status).toBe('pending');
    expect(checkout.roleId).toBe('role_1');
  });

  it('resolving to succeeded creates a per-role KitOrder, never the employer-wide entitlement', () => {
    const data = new LocalDataAdapter();
    const payments = new LocalPaymentsAdapter(data);
    const checkout = payments.createKitCheckout('emp_1', 'role_1');

    payments.resolveCheckout(checkout.id, 'evt_1', 'succeeded');

    expect(payments.getCheckout(checkout.id)?.status).toBe('succeeded');
    const order = data.getKitOrderForRole('role_1');
    expect(order?.status).toBe('succeeded');
    expect(order?.amountNGN).toBe(KIT_PRICE_NGN);
    // The Kit must never be labeled recurring — it never touches the
    // employer's subscription entitlement.
    expect(data.getEntitlement('emp_1')).toBeNull();
  });

  it("a second role's Kit purchase does not affect the first role's KitOrder", () => {
    const data = new LocalDataAdapter();
    const payments = new LocalPaymentsAdapter(data);
    const checkoutA = payments.createKitCheckout('emp_1', 'role_a');
    const checkoutB = payments.createKitCheckout('emp_1', 'role_b');
    payments.resolveCheckout(checkoutA.id, 'evt_a', 'succeeded');
    payments.resolveCheckout(checkoutB.id, 'evt_b', 'failed');

    expect(data.getKitOrderForRole('role_a')?.status).toBe('succeeded');
    expect(data.getKitOrderForRole('role_b')?.status).toBe('failed');
    expect(data.listKitOrdersForEmployer('emp_1')).toHaveLength(2);
  });

  it('resolving to failed never creates a successful KitOrder', () => {
    const data = new LocalDataAdapter();
    const payments = new LocalPaymentsAdapter(data);
    const checkout = payments.createKitCheckout('emp_1', 'role_1');

    payments.resolveCheckout(checkout.id, 'evt_1', 'failed');

    expect(payments.getCheckout(checkout.id)?.status).toBe('failed');
    expect(data.getKitOrderForRole('role_1')?.status).toBe('failed');
  });

  it('replaying the same webhook event id never double-applies the KitOrder', () => {
    const data = new LocalDataAdapter();
    const payments = new LocalPaymentsAdapter(data);
    const checkout = payments.createKitCheckout('emp_1', 'role_1');

    payments.resolveCheckout(checkout.id, 'evt_1', 'succeeded');
    const firstOrder = data.getKitOrderForRole('role_1');

    // Replay: same event id, this time claiming failure — must be ignored.
    payments.resolveCheckout(checkout.id, 'evt_1', 'failed');

    expect(payments.getCheckout(checkout.id)?.status).toBe('succeeded');
    expect(data.getKitOrderForRole('role_1')).toEqual(firstOrder);
  });
});

describe('LocalPaymentsAdapter — subscriptions', () => {
  it('subscription checkouts carry the correct fixed founding price', () => {
    const data = new LocalDataAdapter();
    const payments = new LocalPaymentsAdapter(data);
    expect(payments.createSubscriptionCheckout('emp_1', 'scout').amountNGN).toBe(800000);
    expect(payments.createSubscriptionCheckout('emp_1', 'team').amountNGN).toBe(1400000);
    expect(payments.createSubscriptionCheckout('emp_1', 'partner').amountNGN).toBe(2400000);
  });

  it('resolving a subscription checkout to succeeded activates the entitlement', () => {
    const data = new LocalDataAdapter();
    const payments = new LocalPaymentsAdapter(data);
    const checkout = payments.createSubscriptionCheckout('emp_1', 'scout');

    payments.resolveCheckout(checkout.id, 'evt_1', 'succeeded');

    const entitlement = data.getEntitlement('emp_1');
    expect(entitlement?.plan).toBe('scout');
    expect(entitlement?.status).toBe('active');
  });

  it('resolving a subscription checkout to failed never activates an entitlement', () => {
    const data = new LocalDataAdapter();
    const payments = new LocalPaymentsAdapter(data);
    const checkout = payments.createSubscriptionCheckout('emp_1', 'scout');

    payments.resolveCheckout(checkout.id, 'evt_1', 'failed');

    expect(data.getEntitlement('emp_1')).toBeNull();
  });

  it('cancelSubscription sets status to canceled without deleting the entitlement', () => {
    const data = new LocalDataAdapter();
    const payments = new LocalPaymentsAdapter(data);
    const checkout = payments.createSubscriptionCheckout('emp_1', 'scout');
    payments.resolveCheckout(checkout.id, 'evt_1', 'succeeded');

    payments.cancelSubscription('emp_1');

    expect(data.getEntitlement('emp_1')?.status).toBe('canceled');
    expect(data.getEntitlement('emp_1')?.plan).toBe('scout');
  });

  it('a Kit purchase does not disturb an existing subscription entitlement', () => {
    const data = new LocalDataAdapter();
    const payments = new LocalPaymentsAdapter(data);
    const sub = payments.createSubscriptionCheckout('emp_1', 'team');
    payments.resolveCheckout(sub.id, 'evt_sub', 'succeeded');

    const kit = payments.createKitCheckout('emp_1', 'role_1');
    payments.resolveCheckout(kit.id, 'evt_kit', 'succeeded');

    expect(data.getEntitlement('emp_1')?.plan).toBe('team');
    expect(data.getKitOrderForRole('role_1')?.status).toBe('succeeded');
  });
});

describe('LocalPaymentsAdapter — founding places and the standard price', () => {
  /**
   * The pricing page says the first FOUNDING_SLOTS_TOTAL organizations pay
   * the founding price and every organization after the twenty-fifth pays
   * the standard price. Until these tests, nothing implemented the second
   * half of that sentence: the adapter held its own copy of the three
   * founding prices, had no copy of the standard prices at all, and charged
   * founding rates to every buyer for the life of the subscription.
   */
  function subscribe(
    data: LocalDataAdapter,
    payments: LocalPaymentsAdapter,
    employerId: string,
    plan: 'scout' | 'team' | 'partner' = 'scout',
  ) {
    const checkout = payments.createSubscriptionCheckout(employerId, plan);
    payments.resolveCheckout(checkout.id, `evt_${checkout.id}`, 'succeeded');
    return { checkout, entitlement: data.getEntitlement(employerId) };
  }

  function fillFoundingPlaces(data: LocalDataAdapter, payments: LocalPaymentsAdapter) {
    for (let i = 0; i < FOUNDING_SLOTS_TOTAL; i += 1) subscribe(data, payments, `emp_f${i}`);
  }

  it('charges the twenty-sixth organization the standard price', () => {
    const data = new LocalDataAdapter();
    const payments = new LocalPaymentsAdapter(data);
    fillFoundingPlaces(data, payments);
    expect(data.countFoundingPlacesTaken()).toBe(FOUNDING_SLOTS_TOTAL);

    const { checkout, entitlement } = subscribe(data, payments, 'emp_late', 'team');
    expect(checkout.amountNGN).toBe(SUBSCRIPTION_PRICES_NGN.team.standard);
    expect(entitlement?.priceNGN).toBe(SUBSCRIPTION_PRICES_NGN.team.standard);
    expect(entitlement?.foundingMember).toBe(false);
  });

  it('gives the twenty-fifth organization the last founding place', () => {
    const data = new LocalDataAdapter();
    const payments = new LocalPaymentsAdapter(data);
    for (let i = 0; i < FOUNDING_SLOTS_TOTAL - 1; i += 1) subscribe(data, payments, `emp_f${i}`);

    const { checkout, entitlement } = subscribe(data, payments, 'emp_25', 'partner');
    expect(checkout.amountNGN).toBe(SUBSCRIPTION_PRICES_NGN.partner.founding);
    expect(entitlement?.foundingMember).toBe(true);
    expect(data.countFoundingPlacesTaken()).toBe(FOUNDING_SLOTS_TOTAL);
  });

  it('records the price a member holds, which is what "kept for life" needs', () => {
    const data = new LocalDataAdapter();
    const payments = new LocalPaymentsAdapter(data);
    const { entitlement } = subscribe(data, payments, 'emp_early', 'scout');
    expect(entitlement?.priceNGN).toBe(SUBSCRIPTION_PRICES_NGN.scout.founding);
    expect(entitlement?.foundingMember).toBe(true);

    // Everyone else arrives and the founding places go.
    for (let i = 0; i < FOUNDING_SLOTS_TOTAL; i += 1) subscribe(data, payments, `emp_f${i}`);

    // The early member's stamped price is untouched by what happened after.
    const held = data.getEntitlement('emp_early');
    expect(held?.priceNGN).toBe(SUBSCRIPTION_PRICES_NGN.scout.founding);
    expect(held?.foundingMember).toBe(true);
  });

  it('does not spend a founding place on an account that never subscribes', () => {
    const data = new LocalDataAdapter();
    const payments = new LocalPaymentsAdapter(data);
    data.upsertEntitlement({
      employerId: 'emp_curious',
      plan: 'none',
      status: 'none',
      kitPurchasedAt: null,
      subscriptionRenewsAt: null,
      priceNGN: null,
      foundingMember: false,
    });
    expect(data.countFoundingPlacesTaken()).toBe(0);
    // And a failed payment does not take one either.
    const checkout = payments.createSubscriptionCheckout('emp_declined', 'scout');
    payments.resolveCheckout(checkout.id, 'evt_declined', 'failed');
    expect(data.countFoundingPlacesTaken()).toBe(0);
  });

  it('does not spend a second place when a webhook is replayed', () => {
    const data = new LocalDataAdapter();
    const payments = new LocalPaymentsAdapter(data);
    const checkout = payments.createSubscriptionCheckout('emp_1', 'scout');
    payments.resolveCheckout(checkout.id, 'evt_1', 'succeeded');
    payments.resolveCheckout(checkout.id, 'evt_1', 'succeeded');
    expect(data.countFoundingPlacesTaken()).toBe(1);
  });

  it('does not spend a second place when a member upgrades tier', () => {
    // There are twenty-five places, not twenty-five subscriptions. An
    // organization moving Scout to Team is still one organization.
    const data = new LocalDataAdapter();
    const payments = new LocalPaymentsAdapter(data);
    subscribe(data, payments, 'emp_1', 'scout');
    const { entitlement } = subscribe(data, payments, 'emp_1', 'team');
    expect(data.countFoundingPlacesTaken()).toBe(1);
    expect(entitlement?.plan).toBe('team');
    expect(entitlement?.priceNGN).toBe(SUBSCRIPTION_PRICES_NGN.team.founding);
  });

  it('keeps a founding member founding if they cancel and come back', () => {
    // Their place was never released, so re-subscribing must not price them
    // as a new arrival — and must not consume a twenty-sixth place either.
    const data = new LocalDataAdapter();
    const payments = new LocalPaymentsAdapter(data);
    subscribe(data, payments, 'emp_1', 'scout');
    payments.cancelSubscription('emp_1');
    expect(data.getEntitlement('emp_1')?.status).toBe('canceled');
    // Others arrive while they are away. Their place was never released, so
    // only FOUNDING_SLOTS_TOTAL - 1 of these can be founding and the rest
    // pay standard — the count stops at the cap rather than passing it.
    for (let i = 0; i < FOUNDING_SLOTS_TOTAL; i += 1) subscribe(data, payments, `emp_f${i}`);
    expect(data.countFoundingPlacesTaken()).toBe(FOUNDING_SLOTS_TOTAL);

    const { entitlement } = subscribe(data, payments, 'emp_1', 'scout');
    expect(entitlement?.foundingMember).toBe(true);
    expect(entitlement?.priceNGN).toBe(SUBSCRIPTION_PRICES_NGN.scout.founding);
    expect(data.countFoundingPlacesTaken()).toBe(FOUNDING_SLOTS_TOTAL);
  });

  it('honours the price actually quoted if the last place goes mid-checkout', () => {
    // Charging a buyer the founding price and then telling them they are on
    // standard is the one outcome that must not happen. The cost is that
    // concurrent checkouts can over-issue founding places by the number in
    // flight, which is bounded and visible.
    const data = new LocalDataAdapter();
    const payments = new LocalPaymentsAdapter(data);
    for (let i = 0; i < FOUNDING_SLOTS_TOTAL - 1; i += 1) subscribe(data, payments, `emp_f${i}`);

    const inFlight = payments.createSubscriptionCheckout('emp_slow', 'scout');
    expect(inFlight.amountNGN).toBe(SUBSCRIPTION_PRICES_NGN.scout.founding);

    // Someone else takes the last place while emp_slow is on Paystack.
    subscribe(data, payments, 'emp_fast', 'scout');
    payments.resolveCheckout(inFlight.id, `evt_${inFlight.id}`, 'succeeded');

    const entitlement = data.getEntitlement('emp_slow');
    expect(entitlement?.priceNGN).toBe(SUBSCRIPTION_PRICES_NGN.scout.founding);
    expect(entitlement?.foundingMember).toBe(true);
  });
});

describe('what the billing page and the checkout must agree on', () => {
  /**
   * The offer cards quote a price and the checkout charges one. If those two
   * ever disagree the employer is shown a number and billed a different one,
   * which is the exact defect the Kit price had before KIT_PRICE_NGN moved
   * into contracts.
   */
  function quoteShownToEmployer(data: LocalDataAdapter, employerId: string) {
    const placesTaken = data.holdsFoundingPlace(employerId) ? 0 : data.countFoundingPlacesTaken();
    return subscriptionPrice('scout', placesTaken).amountNGN;
  }

  it('quotes and charges the same amount to a first-time buyer', () => {
    const data = new LocalDataAdapter();
    const payments = new LocalPaymentsAdapter(data);
    expect(quoteShownToEmployer(data, 'emp_1')).toBe(
      payments.createSubscriptionCheckout('emp_1', 'scout').amountNGN,
    );
  });

  it('quotes and charges the same amount once the founding places are gone', () => {
    const data = new LocalDataAdapter();
    const payments = new LocalPaymentsAdapter(data);
    for (let i = 0; i < FOUNDING_SLOTS_TOTAL; i += 1) {
      const checkout = payments.createSubscriptionCheckout(`emp_f${i}`, 'scout');
      payments.resolveCheckout(checkout.id, `evt_${checkout.id}`, 'succeeded');
    }
    expect(quoteShownToEmployer(data, 'emp_late')).toBe(SUBSCRIPTION_PRICES_NGN.scout.standard);
    expect(quoteShownToEmployer(data, 'emp_late')).toBe(
      payments.createSubscriptionCheckout('emp_late', 'scout').amountNGN,
    );
  });

  it('quotes a returning founding member the price they will actually be charged', () => {
    // The page read the raw counter, so a member who had cancelled saw the
    // standard price on the card and would have been charged the founding
    // one. Under-charging, but still a number on a screen that was not the
    // number on the invoice.
    const data = new LocalDataAdapter();
    const payments = new LocalPaymentsAdapter(data);
    const first = payments.createSubscriptionCheckout('emp_early', 'scout');
    payments.resolveCheckout(first.id, `evt_${first.id}`, 'succeeded');
    payments.cancelSubscription('emp_early');
    for (let i = 0; i < FOUNDING_SLOTS_TOTAL; i += 1) {
      const checkout = payments.createSubscriptionCheckout(`emp_f${i}`, 'scout');
      payments.resolveCheckout(checkout.id, `evt_${checkout.id}`, 'succeeded');
    }

    expect(quoteShownToEmployer(data, 'emp_early')).toBe(SUBSCRIPTION_PRICES_NGN.scout.founding);
    expect(quoteShownToEmployer(data, 'emp_early')).toBe(
      payments.createSubscriptionCheckout('emp_early', 'scout').amountNGN,
    );
  });
});
