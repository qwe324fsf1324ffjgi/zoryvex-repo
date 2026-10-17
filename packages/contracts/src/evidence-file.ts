import { z } from 'zod';

/**
 * Single source of truth for evidence-upload constraints — both
 * packages/local-adapters' local fake and services/api's real S3-backed
 * implementation import these, so the fake can never silently drift from
 * what the real pipeline actually enforces.
 */
export const MAX_EVIDENCE_FILE_BYTES = 5 * 1024 * 1024; // 5 MB
export const ALLOWED_EVIDENCE_MIME_TYPES = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'text/plain',
] as const;
export type AllowedEvidenceMimeType = (typeof ALLOWED_EVIDENCE_MIME_TYPES)[number];

/**
 * File-safety lifecycle — deliberately separate from EvidenceVerificationState
 * (which is about whether a *claim* is verified true, not whether a *file*
 * is safe to serve). See docs/DATA_MODEL.md's EvidenceFile entity.
 */
export const EvidenceFileScanStatusSchema = z.enum([
  'pending',
  'clean',
  'infected',
  'unsupported',
  'failed',
  'rejected',
]);
export type EvidenceFileScanStatus = z.infer<typeof EvidenceFileScanStatusSchema>;

export const EvidenceFileSchema = z.object({
  id: z.string(),
  candidateId: z.string(),
  originalFilename: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number().int().positive(),
  quarantineKey: z.string(),
  acceptedKey: z.string().nullable(),
  scanStatus: EvidenceFileScanStatusSchema,
  rejectionReason: z.string().optional(),
  createdAt: z.string().datetime(),
  scannedAt: z.string().datetime().nullable(),
});
export type EvidenceFile = z.infer<typeof EvidenceFileSchema>;
