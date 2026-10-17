export type CheckoutKind = 'kit' | 'scout' | 'team' | 'partner';
export type CheckoutStatus = 'pending' | 'succeeded' | 'failed' | 'refunded';

export interface Checkout {
  id: string;
  employerId: string;
  kind: CheckoutKind;
  /** Only set for kind === 'kit' — the Kit is purchased per role. */
  roleId?: string;
  amountNGN: number;
  status: CheckoutStatus;
  createdAt: string;
}

/**
 * Never calls real Paystack. Local implementation simulates the same
 * shape docs/PAYMENTS.md describes: a checkout is created pending, then a
 * separate "webhook" event resolves it, processed idempotently through
 * DataAdapter.recordWebhookEventOnce so replay-safety is provably real,
 * not assumed.
 */
export interface PaymentsAdapter {
  createKitCheckout(employerId: string, roleId: string): Checkout;
  createSubscriptionCheckout(employerId: string, plan: Exclude<CheckoutKind, 'kit'>): Checkout;
  /** Simulates the Paystack webhook resolving a checkout. Idempotent by eventId. */
  resolveCheckout(checkoutId: string, eventId: string, outcome: 'succeeded' | 'failed'): void;
  getCheckout(checkoutId: string): Checkout | null;
  cancelSubscription(employerId: string): void;
}
