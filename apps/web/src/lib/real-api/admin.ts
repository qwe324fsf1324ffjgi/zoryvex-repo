import type { AuditEvent } from '@zoryvex/contracts';
import { apiRequest } from './client';

/**
 * founder_admin only, and only within a recent WebAuthn step-up window
 * server-side (requireFounderStepUp) — a non-founder or an un-stepped-up
 * founder session gets a 403, surfaced as a RealApiError by client.ts.
 */
export async function listExceptions(): Promise<AuditEvent[]> {
  return apiRequest('/admin/exceptions');
}
