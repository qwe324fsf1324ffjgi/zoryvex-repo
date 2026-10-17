import type {
  BillingInterval,
  BillingOverview,
  PaymentHistoryEntry,
  PriceTier,
  SubscriptionPlan,
  SubscriptionStatus,
} from '@zoryvex/contracts';
import { apiRequest } from './client';

/**
 * The employer-facing billing API.
 *
 * Nothing here decides anything. The browser never computes a price, never
 * concludes that a payment succeeded, and never grants itself access: it
 * asks the server what the state is and renders that. The one thing it
 * does decide is where to send the buyer next, and even that URL comes
 * from Paystack by way of the server.
 */

export interface SubscriptionQuote {
  plan: SubscriptionPlan;
  interval: BillingInterval;
  priceTier: PriceTier;
  amountNGN: number;
  foundingPlacesLeft: number;
  /**
   * Candidates this organization's best role matches right now.
   *
   * Shown before the buyer pays, never after. The floor for buying is one
   * match, so this number can legitimately be small, and a buyer entitled to
   * decide for themselves is entitled to know which.
   */
  marketplaceCandidates: number;
  /** False when no Paystack Plan exists for that tier yet, so it cannot be bought. */
  available: boolean;
}

export interface BillingSnapshot {
  overview: BillingOverview;
  history: PaymentHistoryEntry[];
  quotes: SubscriptionQuote[];
}

export async function getBilling(): Promise<BillingSnapshot> {
  return apiRequest('/billing');
}

/**
 * Starts a checkout and returns the Paystack URL to redirect to.
 *
 * The idempotency key must be generated once per checkout attempt, not per
 * render. Reusing one across two genuinely separate attempts would return
 * the first attempt's URL; generating a new one on every render would
 * defeat the guard entirely and let a double click open two checkouts.
 */
export async function startSubscription(
  plan: SubscriptionPlan,
  idempotencyKey: string,
  interval: BillingInterval = 'monthly',
): Promise<{
  authorizationUrl: string;
  reference: string;
  amountNGN: number;
  created: boolean;
}> {
  return apiRequest('/billing/subscription', {
    method: 'POST',
    headers: { 'idempotency-key': idempotencyKey },
    body: { plan, interval },
  });
}

export async function cancel(): Promise<{
  status: SubscriptionStatus;
  accessEndsAt: string | null;
  cancelRequestedAt: string | null;
}> {
  return apiRequest('/billing/cancel', { method: 'POST' });
}

/**
 * A short-lived link to Paystack's own hosted card-update page.
 *
 * Generated on demand rather than stored, because Paystack's expires. No
 * card detail passes through this product at any point.
 */
export async function getCardUpdateLink(): Promise<{ link: string }> {
  return apiRequest('/billing/card-update-link', { method: 'POST' });
}
