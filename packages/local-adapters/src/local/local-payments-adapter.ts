import {
  KIT_PRICE_NGN,
  SUBSCRIPTION_PRICES_NGN,
  subscriptionPrice,
  type KitOrder,
} from '@zoryvex/contracts';
import type { DataAdapter } from '../interfaces/data';
import type { Checkout, CheckoutKind, PaymentsAdapter } from '../interfaces/payments';
import { getJSON, setJSON } from './storage';

const checkoutKey = (id: string) => `CHECKOUT#${id}`;

function newCheckout(
  employerId: string,
  kind: CheckoutKind,
  amountNGN: number,
  roleId?: string,
): Checkout {
  return {
    id: `chk_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    employerId,
    kind,
    amountNGN,
    status: 'pending',
    createdAt: new Date().toISOString(),
    ...(roleId !== undefined ? { roleId } : {}),
  };
}

export class LocalPaymentsAdapter implements PaymentsAdapter {
  constructor(private readonly data: DataAdapter) {}

  createKitCheckout(employerId: string, roleId: string): Checkout {
    const checkout = newCheckout(employerId, 'kit', KIT_PRICE_NGN, roleId);
    setJSON(checkoutKey(checkout.id), checkout);
    return checkout;
  }

  /**
   * Prices the plan from how many founding places are gone, rather than from
   * a table of the founding prices. The table this replaced listed only the
   * founding three, so the twenty-sixth organization would have been charged
   * the founding price for as long as it kept the subscription, on a page
   * that said it would pay the standard one.
   */
  createSubscriptionCheckout(employerId: string, plan: Exclude<CheckoutKind, 'kit'>): Checkout {
    // An employer who already holds a founding place keeps the founding
    // price, even once the places are gone. Their place is still counted
    // against the cap of twenty-five, so quoting them the standard price
    // would spend a place and lose the founding member who occupies it.
    const placesTaken = this.data.holdsFoundingPlace(employerId)
      ? 0
      : this.data.countFoundingPlacesTaken();
    const { amountNGN } = subscriptionPrice(plan, placesTaken);
    const checkout = newCheckout(employerId, plan, amountNGN);
    setJSON(checkoutKey(checkout.id), checkout);
    return checkout;
  }

  getCheckout(checkoutId: string): Checkout | null {
    return getJSON<Checkout>(checkoutKey(checkoutId));
  }

  resolveCheckout(checkoutId: string, eventId: string, outcome: 'succeeded' | 'failed'): void {
    const isNewEvent = this.data.recordWebhookEventOnce(eventId);
    if (!isNewEvent) return; // already processed — idempotent no-op

    const checkout = this.getCheckout(checkoutId);
    if (!checkout) return;

    const updated: Checkout = { ...checkout, status: outcome };
    setJSON(checkoutKey(checkout.id), updated);

    if (checkout.kind === 'kit') {
      this.resolveKitCheckout(checkout, outcome);
      return;
    }

    if (outcome !== 'succeeded') return;
    const now = new Date().toISOString();
    const existing = this.data.getEntitlement(checkout.employerId);

    // Founding status follows the amount actually charged, not a fresh look
    // at the counter. A checkout quoted at the founding price is a promise
    // already made to that buyer; if the last place went while they were on
    // Paystack, honouring the quote is the only fair outcome, and it can
    // over-issue by at most the number of checkouts in flight. Charging
    // founding and then denying it would be the worse failure.
    const founding =
      checkout.amountNGN === SUBSCRIPTION_PRICES_NGN[checkout.kind].founding ||
      (existing?.foundingMember ?? false);

    if (founding) this.data.recordFoundingPlaceTaken(checkout.employerId);

    this.data.upsertEntitlement({
      employerId: checkout.employerId,
      plan: checkout.kind,
      status: 'active',
      kitPurchasedAt: existing?.kitPurchasedAt ?? null,
      subscriptionRenewsAt: now,
      // What this subscription is billed at, for its life. Read back on the
      // billing page so a member can see the price they hold, which until
      // now was recorded nowhere and shown nowhere.
      priceNGN: checkout.amountNGN,
      foundingMember: founding,
    });
  }

  /**
   * The Kit is a one-time, per-role purchase — it never changes the
   * employer's subscription entitlement (CLAUDE.md: never label the Kit
   * recurring). Recorded as its own KitOrder, keyed by role.
   */
  private resolveKitCheckout(checkout: Checkout, outcome: 'succeeded' | 'failed'): void {
    if (!checkout.roleId) return;
    const order: KitOrder = {
      id: `kit_${checkout.id}`,
      employerId: checkout.employerId,
      roleId: checkout.roleId,
      // What this checkout actually charged, never the current price. The
      // two are the same today and will not be after any price change, and
      // an order is a record of what happened.
      amountNGN: checkout.amountNGN,
      checkoutUrl: null,
      status: outcome,
      paystackReference: checkout.id,
      createdAt: checkout.createdAt,
    };
    this.data.upsertKitOrder(order);
  }

  cancelSubscription(employerId: string): void {
    const existing = this.data.getEntitlement(employerId);
    if (!existing) return;
    this.data.upsertEntitlement({ ...existing, status: 'canceled' });
  }
}
