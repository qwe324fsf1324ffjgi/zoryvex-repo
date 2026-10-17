import type { Evidence } from '@zoryvex/contracts';
import { apiRequest } from './client';

export interface CreateEvidenceInput {
  source: Evidence['source'];
  claim: string;
  context: string;
  actions: string;
  outcome: string;
  visibility: Evidence['visibility'];
  consentGiven: boolean;
  sourceUrl?: string;
  /** The id returned by requestUpload, once the file has been sent to S3. */
  fileId?: string;
}

/** verificationState is never client-settable — every self-submitted claim starts unverified. */
export async function createEvidence(
  input: CreateEvidenceInput,
): Promise<{ evidence: Evidence; version: number }> {
  return apiRequest('/candidates/me/evidence', { method: 'POST', body: input });
}

export async function listEvidence(): Promise<Evidence[]> {
  return apiRequest('/candidates/me/evidence');
}

export async function getEvidence(evidenceId: string): Promise<{
  evidence: Evidence;
  version: number;
}> {
  return apiRequest(`/candidates/me/evidence/${evidenceId}`);
}

export interface UpdateEvidenceInput {
  claim?: string;
  context?: string;
  actions?: string;
  outcome?: string;
  visibility?: Evidence['visibility'];
  consentGiven?: boolean;
}

export async function updateEvidence(
  evidenceId: string,
  version: number,
  patch: UpdateEvidenceInput,
): Promise<{ evidence: Evidence; version: number }> {
  return apiRequest(`/candidates/me/evidence/${evidenceId}`, {
    method: 'PATCH',
    body: { version, ...patch },
  });
}

export async function deleteEvidence(evidenceId: string): Promise<void> {
  await apiRequest(`/candidates/me/evidence/${evidenceId}`, { method: 'DELETE' });
}

export interface RepoVerificationChallenge {
  nonce: string;
  fileName: string;
  instructions: string[];
  expiresInMinutes: number;
}

/** Issues the one-time code the candidate publishes in a public gist. */
export async function beginRepoVerification(
  evidenceId: string,
): Promise<RepoVerificationChallenge> {
  return apiRequest(`/candidates/me/evidence/${evidenceId}/verify/begin`, { method: 'POST' });
}

/**
 * The two proofs a claim can actually be checked with.
 *
 * `graded_task` was a third variant here long after the method was retired
 * (ADR 0005). Nothing built one, because no claim type maps to it and the
 * server refuses it, so this was a shape the client could still express and
 * the product would never honour. Removing it means a future edit that tried
 * to offer a graded task does not compile, which is a better guard than a
 * comment saying not to.
 */
export type VerificationProof =
  | { method: 'issuer_badge'; badgeUrl: string }
  | { method: 'repo_ownership'; gistUrl: string; repoUrl: string };

/**
 * Mirrors services/api/src/domain/verification-service.ts's own result
 * exactly. A check that does not pass resolves normally rather than throwing:
 * it is a result the candidate needs to read, not an error.
 *
 * `retryable` separates "we checked and it did not pass" from "we could not
 * check right now" (an upstream rate limit). The UI must not tell someone
 * their real work failed verification because GitHub was busy.
 */
export type VerificationResult =
  | { verified: true; method: string; verificationRef: string; detail: string }
  | { verified: false; retryable: boolean; reason: string; whatToDo: string };

export async function verifyEvidence(
  evidenceId: string,
  proof: VerificationProof,
): Promise<VerificationResult> {
  return apiRequest(`/candidates/me/evidence/${evidenceId}/verify`, {
    method: 'POST',
    body: proof,
  });
}
