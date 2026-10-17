import { describe, expect, it } from 'vitest';
import type { AuditEvent, Candidate, Evidence, EvidenceFile, Match } from '@zoryvex/contracts';
import { deleteCandidateData, type DeletionDependencies } from '../src/domain/deletion-service';

const CANDIDATE_ID = 'cand_1';
const EMAIL = 'cand@example.com';

function candidate(): Candidate {
  return {
    id: CANDIDATE_ID,
    email: EMAIL,
    displayName: 'A',
    launchTrack: 'aws_cloud',
    discoveryOptIn: true,
    contactUnlockConsent: true,
    onboardingComplete: true,
    summary: '',
    createdAt: '2026-08-19T00:00:00.000Z',
    updatedAt: '2026-08-19T00:00:00.000Z',
  };
}

function evidenceItem(id: string): Evidence {
  return {
    id,
    candidateId: CANDIDATE_ID,
    source: 'github',
    claim: 'x',
    context: 'y',
    actions: 'z',
    outcome: 'w',
    verificationState: 'unverified',
    visibility: 'private',
    consentGiven: true,
    createdAt: '2026-08-19T00:00:00.000Z',
    updatedAt: '2026-08-19T00:00:00.000Z',
  };
}

function fileItem(id: string, acceptedKey: string | null): EvidenceFile {
  return {
    id,
    candidateId: CANDIDATE_ID,
    originalFilename: 'f.png',
    mimeType: 'image/png',
    sizeBytes: 10,
    quarantineKey: `quarantine/${CANDIDATE_ID}/${id}`,
    acceptedKey,
    scanStatus: acceptedKey ? 'clean' : 'pending',
    createdAt: '2026-08-19T00:00:00.000Z',
    scannedAt: acceptedKey ? '2026-08-19T00:01:00.000Z' : null,
  };
}

function matchItem(roleId: string): Match {
  return {
    id: `match_${roleId}`,
    roleId,
    candidateId: CANDIDATE_ID,
    matchScore: 0.5,
    status: 'suggested',
    contactUnlocked: false,
    createdAt: '2026-08-19T00:00:00.000Z',
  };
}

function createFakes(input: {
  candidateExists?: boolean;
  evidence?: Evidence[];
  files?: EvidenceFile[];
  matches?: Match[];
}) {
  const deletedEvidenceIds: string[] = [];
  const deletedS3Keys: string[] = [];
  const deletedFileRecordIds: string[] = [];
  const deletedMatches: Array<{ roleId: string; candidateId: string }> = [];
  const revokedSessionsFor: string[] = [];
  const deletedAccountEmails: string[] = [];
  let candidateProfileDeleted = false;
  const auditEvents: AuditEvent[] = [];
  const deletedAttempts: Array<{ candidateId: string; evidenceId: string }> = [];
  const deletedVerificationState: Array<{ candidateId: string; evidenceId: string }> = [];
  const deletedAttestations: string[] = [];
  const deletedReminderSlots: string[] = [];
  const disabledProofs: Array<{ candidateId: string; publicProofId: string }> = [];

  const deps: DeletionDependencies = {
    clock: { now: () => new Date('2026-08-19T03:00:00.000Z') },
    async getCandidate() {
      return input.candidateExists === false ? null : { candidate: candidate(), version: 1 };
    },
    async listCandidateEvidence() {
      return input.evidence ?? [];
    },
    async deleteGradedAttemptsForEvidence(candidateId, evidenceId) {
      deletedAttempts.push({ candidateId, evidenceId });
    },
    async deleteVerificationState(candidateId, evidenceId) {
      deletedVerificationState.push({ candidateId, evidenceId });
    },
    async deleteAttestationsForEvidence(evidenceId) {
      deletedAttestations.push(evidenceId);
    },
    async deleteReminderSlot(candidateId) {
      deletedReminderSlots.push(candidateId);
    },
    async disablePublicProof(candidateId, publicProofId) {
      disabledProofs.push({ candidateId, publicProofId });
    },
    async deleteEvidence(_candidateId, evidenceId) {
      deletedEvidenceIds.push(evidenceId);
    },
    async listFilesForCandidate() {
      return input.files ?? [];
    },
    async deleteFileRecord(_candidateId, fileId) {
      deletedFileRecordIds.push(fileId);
    },
    async deleteS3Object(key) {
      deletedS3Keys.push(key);
    },
    async listMatchesForCandidate() {
      return input.matches ?? [];
    },
    async deleteMatch(roleId, candidateId) {
      deletedMatches.push({ roleId, candidateId });
    },
    async revokeAllSessions(email) {
      revokedSessionsFor.push(email);
      return 1;
    },
    async deleteAccount(email) {
      deletedAccountEmails.push(email);
    },
    async deleteCandidateProfile() {
      candidateProfileDeleted = true;
    },
    async appendAuditEvent(event) {
      // Mirrors the real repository, which is an unconditional PutCommand
      // keyed on `AUDIT#<id>` — writing the same id twice overwrites rather
      // than appending. A fake that blindly pushed would hide exactly the
      // retry-duplication behaviour these tests exist to pin down.
      const existing = auditEvents.findIndex((e) => e.id === event.id);
      if (existing >= 0) auditEvents[existing] = event;
      else auditEvents.push(event);
      return event;
    },
    generateId: () => 'audit_1',
  };

  return {
    deps,
    deletedEvidenceIds,
    deletedS3Keys,
    deletedFileRecordIds,
    deletedMatches,
    revokedSessionsFor,
    deletedAccountEmails,
    isCandidateProfileDeleted: () => candidateProfileDeleted,
    auditEvents,
    deletedAttempts,
    deletedVerificationState,
    deletedAttestations,
    deletedReminderSlots,
    disabledProofs,
  };
}

describe('deleteCandidateData', () => {
  it('is a silent no-op for a candidate that no longer exists (idempotent against SQS redelivery)', async () => {
    const fakes = createFakes({ candidateExists: false });
    await expect(deleteCandidateData(CANDIDATE_ID, fakes.deps)).resolves.toBeUndefined();
    expect(fakes.auditEvents).toHaveLength(0);
    expect(fakes.isCandidateProfileDeleted()).toBe(false);
  });

  it('deletes every evidence claim item', async () => {
    const fakes = createFakes({ evidence: [evidenceItem('ev_1'), evidenceItem('ev_2')] });
    await deleteCandidateData(CANDIDATE_ID, fakes.deps);
    expect(fakes.deletedEvidenceIds.sort()).toEqual(['ev_1', 'ev_2']);
  });

  it('deletes both quarantine and accepted S3 objects for a clean file, plus its DynamoDB record', async () => {
    const fakes = createFakes({ files: [fileItem('file_1', 'accepted/cand_1/file_1')] });
    await deleteCandidateData(CANDIDATE_ID, fakes.deps);
    expect(fakes.deletedS3Keys).toEqual(
      expect.arrayContaining(['quarantine/cand_1/file_1', 'accepted/cand_1/file_1']),
    );
    expect(fakes.deletedFileRecordIds).toEqual(['file_1']);
  });

  it('deletes only the quarantine object for a file that never had an accepted key', async () => {
    const fakes = createFakes({ files: [fileItem('file_2', null)] });
    await deleteCandidateData(CANDIDATE_ID, fakes.deps);
    expect(fakes.deletedS3Keys).toEqual(['quarantine/cand_1/file_2']);
  });

  it('deletes every match across every role the candidate appeared in (derived AI artifacts)', async () => {
    const fakes = createFakes({ matches: [matchItem('role_1'), matchItem('role_2')] });
    await deleteCandidateData(CANDIDATE_ID, fakes.deps);
    expect(fakes.deletedMatches).toEqual([
      { roleId: 'role_1', candidateId: CANDIDATE_ID },
      { roleId: 'role_2', candidateId: CANDIDATE_ID },
    ]);
  });

  it('revokes all sessions, deletes the account, and deletes the candidate profile, in that order', async () => {
    const order: string[] = [];
    const fakes = createFakes({});
    fakes.deps.revokeAllSessions = async (email) => {
      order.push('revokeAllSessions');
      expect(email).toBe(EMAIL);
      return 1;
    };
    fakes.deps.deleteAccount = async (email) => {
      order.push('deleteAccount');
      expect(email).toBe(EMAIL);
    };
    fakes.deps.deleteCandidateProfile = async () => {
      order.push('deleteCandidateProfile');
    };
    const originalAppend = fakes.deps.appendAuditEvent;
    fakes.deps.appendAuditEvent = async (event) => {
      order.push('appendAuditEvent');
      return originalAppend(event);
    };
    await deleteCandidateData(CANDIDATE_ID, fakes.deps);
    // The audit event lands before the profile row is removed, so a failure
    // of the final delete retries into an already-recorded deletion rather
    // than an unrecorded one.
    expect(order).toEqual([
      'revokeAllSessions',
      'deleteAccount',
      'appendAuditEvent',
      'deleteCandidateProfile',
    ]);
  });

  it('still records the deletion when the audit write fails once and SQS retries', async () => {
    const fakes = createFakes({});

    // Model the real store faithfully: once the profile row is gone,
    // getCandidate returns null, which is what makes deleteCandidateData
    // take its early return on redelivery. Without this the scenario cannot
    // reproduce at all.
    let profileDeleted = false;
    fakes.deps.deleteCandidateProfile = async () => {
      profileDeleted = true;
    };
    fakes.deps.getCandidate = async () =>
      profileDeleted ? null : { candidate: candidate(), version: 1 };

    const originalAppend = fakes.deps.appendAuditEvent;
    let appendAttempts = 0;
    fakes.deps.appendAuditEvent = async (event) => {
      appendAttempts += 1;
      if (appendAttempts === 1) throw new Error('transient DynamoDB failure');
      return originalAppend(event);
    };

    await expect(deleteCandidateData(CANDIDATE_ID, fakes.deps)).rejects.toThrow(
      'transient DynamoDB failure',
    );
    await deleteCandidateData(CANDIDATE_ID, fakes.deps);

    // Exactly one, not zero and not two. Zero was the original bug: the
    // audit used to run after the profile delete, so the retry hit the early
    // return and the deletion went unrecorded forever. Two would mean the id
    // was not deterministic.
    const deletionEvents = fakes.auditEvents.filter((e) => e.action === 'candidate_deleted');
    expect(deletionEvents).toHaveLength(1);
    expect(deletionEvents[0]?.targetId).toBe(CANDIDATE_ID);
  });

  it('appends exactly one final audit event after every deletion step completes', async () => {
    const fakes = createFakes({
      evidence: [evidenceItem('ev_1')],
      files: [fileItem('file_1', 'accepted/cand_1/file_1')],
      matches: [matchItem('role_1')],
    });
    await deleteCandidateData(CANDIDATE_ID, fakes.deps);
    expect(fakes.auditEvents).toHaveLength(1);
    expect(fakes.auditEvents[0]).toMatchObject({
      action: 'candidate_deleted',
      targetType: 'candidate',
      targetId: CANDIDATE_ID,
      actorId: CANDIDATE_ID,
    });
  });

  it('never deletes anything (evidence/files/matches/account) when the candidate no longer exists', async () => {
    const fakes = createFakes({
      candidateExists: false,
      evidence: [evidenceItem('ev_1')],
      files: [fileItem('file_1', 'accepted/x')],
      matches: [matchItem('role_1')],
    });
    await deleteCandidateData(CANDIDATE_ID, fakes.deps);
    expect(fakes.deletedEvidenceIds).toHaveLength(0);
    expect(fakes.deletedS3Keys).toHaveLength(0);
    expect(fakes.deletedMatches).toHaveLength(0);
    expect(fakes.deletedAccountEmails).toHaveLength(0);
  });

  it('propagates an error from any step (e.g. S3 delete) so SQS can retry rather than silently succeeding', async () => {
    const fakes = createFakes({ files: [fileItem('file_1', 'accepted/cand_1/file_1')] });
    fakes.deps.deleteS3Object = async () => {
      throw new Error('S3 throttled');
    };
    await expect(deleteCandidateData(CANDIDATE_ID, fakes.deps)).rejects.toThrow('S3 throttled');
    // The final audit event must never be written if an earlier step failed.
    expect(fakes.auditEvents).toHaveLength(0);
  });
});

/**
 * Five categories of candidate-linked data survived account deletion until
 * 2026-09-04. The docblock on deleteCandidateData named only AuditEvent and
 * KitOrder as deliberate retentions, so these were not a policy - they were
 * partitions nobody walked.
 *
 * Graded attempts are the worst of them: a record of how somebody performed,
 * including which checks they failed and whether any attempt tripped a
 * disqualifying one, kept after they asked to be forgotten. They became more
 * obviously wrong the same day, when the data export started showing that
 * record to the candidate.
 */
describe('deleteCandidateData removes everything keyed to the candidate', () => {
  it('deletes graded attempts for every evidence item', async () => {
    const { deps, deletedAttempts } = createFakes({
      evidence: [evidenceItem('ev_1'), evidenceItem('ev_2')],
    });
    await deleteCandidateData(CANDIDATE_ID, deps);
    expect(deletedAttempts.map((a) => a.evidenceId).sort()).toEqual(['ev_1', 'ev_2']);
  });

  it('deletes verification counters and challenges', async () => {
    const { deps, deletedVerificationState } = createFakes({
      evidence: [evidenceItem('ev_1'), evidenceItem('ev_2')],
    });
    await deleteCandidateData(CANDIDATE_ID, deps);
    expect(deletedVerificationState.map((v) => v.evidenceId).sort()).toEqual(['ev_1', 'ev_2']);
  });

  /**
   * Attestations live on the EVIDENCE partition rather than the candidate's,
   * which is precisely why deletion missed them: it deleted the evidence row
   * and left somebody else's written statement about the candidate behind.
   */
  it('deletes peer attestations, which live on a different partition', async () => {
    const { deps, deletedAttestations } = createFakes({
      evidence: [evidenceItem('ev_1'), evidenceItem('ev_2')],
    });
    await deleteCandidateData(CANDIDATE_ID, deps);
    expect(deletedAttestations.sort()).toEqual(['ev_1', 'ev_2']);
  });

  it('releases the reminder slot', async () => {
    const { deps, deletedReminderSlots } = createFakes({});
    await deleteCandidateData(CANDIDATE_ID, deps);
    expect(deletedReminderSlots).toEqual([CANDIDATE_ID]);
  });

  /**
   * Ordering, not just coverage. Everything hanging off an evidence item has
   * to go before the item does, because the item is what names them - delete
   * the evidence first and the attempts are on a partition nothing walks.
   */
  it('removes what hangs off an evidence item before removing the item', async () => {
    const order: string[] = [];
    const { deps } = createFakes({ evidence: [evidenceItem('ev_1')] });
    const realAttempts = deps.deleteGradedAttemptsForEvidence.bind(deps);
    const realEvidence = deps.deleteEvidence.bind(deps);
    deps.deleteGradedAttemptsForEvidence = async (candidateId, evidenceId) => {
      order.push(`attempts:${evidenceId}`);
      await realAttempts(candidateId, evidenceId);
    };
    deps.deleteEvidence = async (candidateId, evidenceId) => {
      order.push(`evidence:${evidenceId}`);
      await realEvidence(candidateId, evidenceId);
    };
    await deleteCandidateData(CANDIDATE_ID, deps);
    expect(order.indexOf('attempts:ev_1')).toBeLessThan(order.indexOf('evidence:ev_1'));
  });
});
