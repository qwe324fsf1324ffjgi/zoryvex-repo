import type { KitOrder } from '@zoryvex/contracts';
import type { ProofGapPreview } from '@zoryvex/kit-templates';
import { apiRequest, apiRequestRawText } from './client';

export async function getPreview(roleId: string): Promise<ProofGapPreview> {
  return apiRequest(`/roles/${roleId}/kit-preview`);
}

/** 'succeeded' means a paid Kit exists for this role; 'none' covers pending/failed/never-attempted alike. */
export async function getStatus(roleId: string): Promise<{ status: 'succeeded' | 'none' }> {
  return apiRequest(`/roles/${roleId}/kit-status`);
}

/**
 * Idempotency-Key is required by the real handler (Prompt 7: "idempotency
 * keys for ... billing event application") — a double-click/retry must
 * never create a second pending order. Generate a fresh key per checkout
 * attempt, not per render.
 */
export async function createOrder(
  roleId: string,
  idempotencyKey: string,
): Promise<{ order: KitOrder; created: boolean; authorizationUrl: string }> {
  return apiRequest(`/roles/${roleId}/kit-orders`, {
    method: 'POST',
    headers: { 'idempotency-key': idempotencyKey },
  });
}

/** Raw HTML, not JSON — the real Kit document itself (services/api/handlers/kit/download.ts). */
export async function getDownloadHtml(roleId: string): Promise<string> {
  return apiRequestRawText(`/roles/${roleId}/kit`);
}

/** employer_admin only. Always a new version, never overwrites the paid original. */
export async function regenerate(
  roleId: string,
): Promise<{ version: number; generatedAt: string }> {
  return apiRequest(`/roles/${roleId}/kit/regenerate`, { method: 'POST' });
}
