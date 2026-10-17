/**
 * The transaction reference: the only piece of our own data that survives
 * a round trip through Paystack's hosted checkout.
 *
 * Paystack allows alphanumerics plus `-`, `.` and `=` in a reference, and
 * rejects anything else — a `:` separator was tried on 2026-08-26 and came
 * back "Invalid character in transaction reference". `-` is unusable as a
 * separator because every id here is a UUID and UUIDs are full of them, so
 * `.` is the separator throughout.
 *
 * There are two shapes, and the older one is kept exactly as it was:
 *
 *   <roleId>.<kitOrderId>            a Kit purchase
 *   sub.<employerId>.<attemptId>     a subscription checkout
 *
 * The Kit form predates this module and has real transactions against it,
 * including one live TEST purchase from 2026-08-26. Changing it would
 * orphan those. It is unambiguous against the new form because a roleId is
 * a UUID and can never be the literal `sub`.
 *
 * A reference Paystack generated itself — every subscription renewal
 * charge carries one — parses as neither, which is correct: those are
 * attributed through the subscription and customer codes instead.
 */

export interface KitReference {
  kind: 'kit';
  roleId: string;
  kitOrderId: string;
}

export interface SubscriptionReference {
  kind: 'subscription';
  employerId: string;
  attemptId: string;
}

export type ParsedReference = KitReference | SubscriptionReference;

const SUBSCRIPTION_PREFIX = 'sub';

/** Rejects anything Paystack would reject, before it can be sent. */
const ALLOWED_REFERENCE = /^[A-Za-z0-9\-.=]+$/;

export function isValidPaystackReference(reference: string): boolean {
  return reference.length > 0 && reference.length <= 100 && ALLOWED_REFERENCE.test(reference);
}

export function buildKitReference(roleId: string, kitOrderId: string): string {
  return `${roleId}.${kitOrderId}`;
}

export function buildSubscriptionReference(employerId: string, attemptId: string): string {
  return `${SUBSCRIPTION_PREFIX}.${employerId}.${attemptId}`;
}

/**
 * Parses a reference back to what it was for, or null.
 *
 * Null is a normal outcome, not an error: Paystack's own renewal
 * references land here, and so would a transaction somebody created by
 * hand in the dashboard. Callers report those as unattributed rather than
 * failing.
 */
export function parsePaymentReference(reference: string): ParsedReference | null {
  if (!reference) return null;
  const parts = reference.split('.');

  if (parts[0] === SUBSCRIPTION_PREFIX) {
    // Exactly three parts. A longer one is not a reference this service
    // built, and salvaging the first three segments of something else is
    // how a payment gets attributed to the wrong employer.
    if (parts.length !== 3) return null;
    const [, employerId, attemptId] = parts;
    if (!employerId || !attemptId) return null;
    return { kind: 'subscription', employerId, attemptId };
  }

  if (parts.length !== 2) return null;
  const [roleId, kitOrderId] = parts;
  if (!roleId || !kitOrderId) return null;
  return { kind: 'kit', roleId, kitOrderId };
}
