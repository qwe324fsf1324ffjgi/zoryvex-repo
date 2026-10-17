import type { AccessState, BillingInvoice, Entitlement, PaymentAttempt } from '@zoryvex/contracts';
import { apiRequest } from './client';

/**
 * The founder's billing diagnostic.
 *
 * `founder_admin` plus a recent WebAuthn step-up, enforced server-side —
 * this reads another organisation's payment history, which is the most
 * sensitive non-candidate data in the system.
 *
 * `subscription` deliberately has no `emailToken`. That token can cancel
 * somebody's subscription, and the server strips it before this response is
 * built, so it never reaches a browser or a log.
 */

export interface BillingTimelineEntry {
  at: string;
  kind: 'payment' | 'invoice' | 'subscription';
  summary: string;
  detail: string | null;
}

export interface AdminBillingDiagnostic {
  employerId: string;
  access: AccessState;
  entitlementStatus: Entitlement['status'] | null;
  expectedEntitlementStatus: Entitlement['status'] | null;
  inSync: boolean;
  subscription: (Record<string, unknown> & { hasCancellationToken: boolean }) | null;
  invoices: BillingInvoice[];
  payments: PaymentAttempt[];
  timeline: BillingTimelineEntry[];
  findings: string[];
}

export async function getDiagnostic(employerId: string): Promise<AdminBillingDiagnostic> {
  return apiRequest(`/admin/billing?employerId=${encodeURIComponent(employerId)}`);
}
