import type { AttemptHistory, Candidate, Evidence } from '@zoryvex/contracts';
import { apiRequest } from './client';

export interface ConsentPatch {
  discoveryOptIn?: boolean;
  contactUnlockConsent?: boolean;
  /**
   * Whether this candidate has a public proof page. Turning it off destroys
   * the id, so every link already shared stops resolving; turning it back on
   * issues a different one.
   */
  publicProof?: boolean;
}

/** Explicit, versioned (every real change appends an audit event server-side), reversible. */
export async function updateConsent(patch: ConsentPatch): Promise<Candidate> {
  return apiRequest('/candidates/me/consent', { method: 'PATCH', body: patch });
}

export interface CandidateExport {
  candidate: Candidate;
  evidence: Evidence[];
  files: Array<{
    id: string;
    originalFilename: string;
    mimeType: string;
    scanStatus: string;
    createdAt: string;
  }>;
  /** Roles an employer unlocked this candidate's contact details for. */
  contactUnlocks: Array<{ roleId: string; roleTitle: string }>;
  /** Graded-task attempts, in the same shape employers are shown. */
  gradedAttempts: Array<{ evidenceId: string; history: AttemptHistory }>;
  exportedAt: string;
}

export async function exportData(): Promise<CandidateExport> {
  return apiRequest('/candidates/me/export');
}

/** Asynchronous (Prompt 7) — enqueues and returns immediately; the real deletion happens off-request. */
export async function requestDeletion(): Promise<{ accepted: true }> {
  return apiRequest('/candidates/me/delete', { method: 'POST' });
}
