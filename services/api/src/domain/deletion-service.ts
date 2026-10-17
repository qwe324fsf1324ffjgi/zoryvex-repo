import type { AuditEvent, Candidate, Evidence, EvidenceFile, Match } from '@zoryvex/contracts';
import type { Clock } from '../repositories/clock-repository';

export interface DeletionDependencies {
  clock: Clock;
  getCandidate(candidateId: string): Promise<{ candidate: Candidate; version: number } | null>;
  listCandidateEvidence(candidateId: string): Promise<Evidence[]>;
  deleteEvidence(candidateId: string, evidenceId: string): Promise<void>;
  deleteGradedAttemptsForEvidence(candidateId: string, evidenceId: string): Promise<void>;
  deleteVerificationState(candidateId: string, evidenceId: string): Promise<void>;
  deleteAttestationsForEvidence(evidenceId: string): Promise<void>;
  deleteReminderSlot(candidateId: string): Promise<void>;
  disablePublicProof(candidateId: string, publicProofId: string, updatedAt: string): Promise<void>;
  listFilesForCandidate(candidateId: string): Promise<EvidenceFile[]>;
  deleteFileRecord(candidateId: string, fileId: string): Promise<void>;
  deleteS3Object(key: string): Promise<void>;
  listMatchesForCandidate(candidateId: string): Promise<Match[]>;
  deleteMatch(roleId: string, candidateId: string): Promise<void>;
  revokeAllSessions(email: string): Promise<number>;
  deleteAccount(email: string): Promise<void>;
  deleteCandidateProfile(candidateId: string): Promise<void>;
  appendAuditEvent(event: AuditEvent): Promise<AuditEvent>;
  generateId(): string;
}

/**
 * Async, auditable deletion across DynamoDB, S3, and derived artifacts
 * (Prompt 7). Idempotent — a candidate already deleted (or never existed)
 * is a silent no-op, since SQS may redeliver this message. Legally
 * required billing/audit records (AuditEvent, KitOrder) are deliberately
 * NOT deleted here — only minimized (they retain the bare candidateId, no
 * longer resolvable to a live profile once this completes), per "legally
 * required billing/audit records are minimized and retained separately."
 * Any step throwing lets the SQS message retry, and after
 * max_receive_count moves it to the DLQ, which already alarms to the
 * founder's SNS topic (infrastructure/modules/messaging) — no separate
 * deletion-failure alarm needed.
 */
export async function deleteCandidateData(
  candidateId: string,
  deps: DeletionDependencies,
): Promise<void> {
  const result = await deps.getCandidate(candidateId);
  if (!result) return;
  const { email } = result.candidate;

  // Everything hanging off an evidence item goes before the item itself,
  // because the item is what names them. Deleting the evidence first would
  // leave attempts and attestations on partitions nothing walks afterwards,
  // which is exactly how they survived deletion until 2026-09-04.
  const evidence = await deps.listCandidateEvidence(candidateId);
  for (const item of evidence) {
    await deps.deleteGradedAttemptsForEvidence(candidateId, item.id);
    await deps.deleteVerificationState(candidateId, item.id);
    await deps.deleteAttestationsForEvidence(item.id);
    await deps.deleteEvidence(candidateId, item.id);
  }

  // The pointer that resolves a public URL to this candidate. Orphaning it
  // is not a leak - getPublicProof refuses once the profile is gone - but a
  // published URL that still resolves to a row is not deleted either, and
  // revoking a link somebody may have saved should be a real delete.
  if (result.candidate.publicProofId) {
    await deps.disablePublicProof(
      candidateId,
      result.candidate.publicProofId,
      deps.clock.now().toISOString(),
    );
  }

  // One item, not per evidence: the promise is one reminder per candidate.
  await deps.deleteReminderSlot(candidateId);

  const files = await deps.listFilesForCandidate(candidateId);
  for (const file of files) {
    await deps.deleteS3Object(file.quarantineKey);
    if (file.acceptedKey) await deps.deleteS3Object(file.acceptedKey);
    await deps.deleteFileRecord(candidateId, file.id);
  }

  const matches = await deps.listMatchesForCandidate(candidateId);
  for (const match of matches) {
    await deps.deleteMatch(match.roleId, candidateId);
  }

  await deps.revokeAllSessions(email);
  await deps.deleteAccount(email);

  // Audited BEFORE the profile row goes, and with a deterministic id.
  //
  // Previously this ran last, with a random id. If the audit write failed
  // after deleteCandidateProfile had already succeeded, the SQS retry found
  // no candidate, took the early return at the top, and the deletion was
  // never recorded at all — the data was gone with no compliance evidence
  // that it had been deleted (found in a 2026-08-27 audit).
  //
  // Ordering it here is substantively honest: evidence, files, matches,
  // sessions and the account are already gone by this point, and the profile
  // row is the last remnant. The deterministic id makes appendAuditEvent's
  // unconditional Put an idempotent overwrite, so a retry re-records the same
  // single event rather than accumulating duplicates.
  await deps.appendAuditEvent({
    id: `audit_candidate_deleted_${candidateId}`,
    actorId: candidateId,
    actorRole: 'candidate',
    action: 'candidate_deleted',
    targetType: 'candidate',
    targetId: candidateId,
    createdAt: deps.clock.now().toISOString(),
  });

  await deps.deleteCandidateProfile(candidateId);
}
