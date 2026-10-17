import type {
  AuditEvent,
  Candidate,
  Evidence,
  EvidenceFile,
  LaunchTrack,
  Match,
  Role,
  AttemptHistory,
  GradedAttemptRecord,
} from '@zoryvex/contracts';
import { NotFoundError } from '../errors/typed-errors';
import { numberInOrder, summariseAttempts } from './attempt-history-service';
import {
  disablePublicProofPage,
  enablePublicProofPage,
  type PublicProofConsentDependencies,
} from './public-proof-service';
import type { Clock } from '../repositories/clock-repository';

export interface ConsentPatch {
  discoveryOptIn?: boolean | undefined;
  contactUnlockConsent?: boolean | undefined;
  /**
   * Whether this candidate has a public proof page.
   *
   * Routed through here rather than its own endpoint so every consent this
   * product takes is granted, revoked and audited in one place. It is also
   * the consent with the widest blast radius — the other two decide who
   * inside the product may see something, this one decides whether anybody
   * at all can — so it belongs where the others are reviewed.
   */
  publicProof?: boolean | undefined;
}

export interface PrivacyDependencies extends PublicProofConsentDependencies {
  clock: Clock;
  getCandidate(candidateId: string): Promise<{ candidate: Candidate; version: number } | null>;
  setDiscoveryOptIn(
    candidateId: string,
    launchTrack: LaunchTrack,
    optIn: boolean,
    updatedAt: string,
  ): Promise<void>;
  updateCandidateProfile(
    candidateId: string,
    expectedVersion: number,
    patch: { contactUnlockConsent?: boolean },
    updatedAt: string,
  ): Promise<{ candidate: Candidate; version: number }>;
  appendAuditEvent(event: AuditEvent): Promise<AuditEvent>;
  listCandidateEvidence(candidateId: string): Promise<Evidence[]>;
  listFilesForCandidate(candidateId: string): Promise<EvidenceFile[]>;
  listMatchesForCandidate(candidateId: string): Promise<Match[]>;
  getRole(roleId: string): Promise<{ role: Role } | null>;
  listGradedAttempts(candidateId: string, evidenceId: string): Promise<GradedAttemptRecord[]>;
  deleteMatch(roleId: string, candidateId: string): Promise<void>;
  generateId(): string;
}

/**
 * Explicit, versioned (each change appends an immutable AuditEvent — the
 * version/history), reversible (a later call simply supersedes the
 * previous state) — Prompt 7's exact three requirements for discovery and
 * contact-unlock consent.
 */
export async function updateConsent(
  candidateId: string,
  patch: ConsentPatch,
  deps: PrivacyDependencies,
): Promise<Candidate> {
  const existing = await deps.getCandidate(candidateId);
  if (!existing) throw new NotFoundError('Candidate not found');
  const now = deps.clock.now().toISOString();

  if (
    patch.discoveryOptIn !== undefined &&
    patch.discoveryOptIn !== existing.candidate.discoveryOptIn
  ) {
    await deps.setDiscoveryOptIn(
      candidateId,
      existing.candidate.launchTrack,
      patch.discoveryOptIn,
      now,
    );
    await deps.appendAuditEvent({
      id: deps.generateId(),
      actorId: candidateId,
      actorRole: 'candidate',
      action: patch.discoveryOptIn ? 'discovery_opt_in' : 'discovery_opt_out',
      targetType: 'candidate',
      targetId: candidateId,
      createdAt: now,
    });

    if (!patch.discoveryOptIn) await withdrawFromOpenMatches(candidateId, now, deps);
  }

  if (
    patch.contactUnlockConsent !== undefined &&
    patch.contactUnlockConsent !== existing.candidate.contactUnlockConsent
  ) {
    const latest = await deps.getCandidate(candidateId);
    await deps.updateCandidateProfile(
      candidateId,
      latest?.version ?? existing.version,
      { contactUnlockConsent: patch.contactUnlockConsent },
      now,
    );
    await deps.appendAuditEvent({
      id: deps.generateId(),
      actorId: candidateId,
      actorRole: 'candidate',
      action: patch.contactUnlockConsent
        ? 'contact_unlock_consent_given'
        : 'contact_unlock_consent_revoked',
      targetType: 'candidate',
      targetId: candidateId,
      createdAt: now,
    });
  }

  if (patch.publicProof !== undefined) {
    const alreadyOn = Boolean(existing.candidate.publicProofId);
    if (patch.publicProof && !alreadyOn) {
      await enablePublicProofPage(candidateId, deps);
    } else if (!patch.publicProof && alreadyOn) {
      await disablePublicProofPage(candidateId, deps);
    }
  }

  const result = await deps.getCandidate(candidateId);
  if (!result) throw new NotFoundError('Candidate not found');
  return result.candidate;
}

/**
 * Opting out of discovery has to remove the candidate from employers' match
 * lists, not merely stop new scores being written.
 *
 * matching-service.ts skips opted-out candidates on recompute but
 * deliberately leaves any existing Match row in place, and getMatchesForRole
 * returns every row stored against the role. The result was that revoking
 * discovery consent had no visible effect at all: the candidate stayed in
 * the employer's list indefinitely, which is the one thing opting out is
 * supposed to prevent (found in a 2026-08-27 audit — the same shape as the
 * aiMatching bug, where consent gated the write path but not the read path).
 *
 * Done on the write path, once per opt-out, rather than by filtering every
 * match-list read against the discovery index — that would add a query to a
 * hot path forever to undo a state change that happens rarely.
 *
 * A match whose contact was already unlocked is deliberately kept. That
 * disclosure already happened under its own separate consent and cost the
 * employer part of a paid allowance; deleting it would silently destroy the
 * record of something they paid for, and would not un-disclose anything.
 * Contact re-disclosure is separately gated on live consent by
 * contact-unlock-service's getUnlockedContactInfo.
 */
async function withdrawFromOpenMatches(
  candidateId: string,
  now: string,
  deps: PrivacyDependencies,
): Promise<void> {
  const matches = await deps.listMatchesForCandidate(candidateId);
  const withdrawn = matches.filter((match) => !match.contactUnlocked);
  if (withdrawn.length === 0) return;

  for (const match of withdrawn) {
    await deps.deleteMatch(match.roleId, candidateId);
  }

  await deps.appendAuditEvent({
    id: deps.generateId(),
    actorId: candidateId,
    actorRole: 'candidate',
    action: 'discovery_matches_withdrawn',
    targetType: 'candidate',
    targetId: candidateId,
    reason: `${withdrawn.length} match(es) removed on discovery opt-out`,
    createdAt: now,
  });
}

export interface CandidateExport {
  candidate: Candidate;
  evidence: Evidence[];
  files: Array<
    Pick<EvidenceFile, 'id' | 'originalFilename' | 'mimeType' | 'scanStatus' | 'createdAt'>
  >;
  /**
   * Which roles an employer paid to see this candidate's contact details
   * for. The most privacy-sensitive thing the platform records about a
   * person, and until 2026-09-04 the export omitted it entirely while the
   * account page offered to "download everything Zoryvex holds about you".
   *
   * The role title is included because the candidate has already been told
   * it: the unlock notification email names the role. The employer is not
   * named, for the reason recorded in contact-unlock-service - an employer
   * that paid to reach a candidate has not agreed to have its hiring plans
   * disclosed, and the candidate learns who it is from the approach that
   * follows. This export discloses exactly what the email already did, and
   * nothing further.
   *
   * No timestamp: a Match carries no unlock time, and inventing one from
   * `createdAt` would date the match rather than the unlock. Reporting a
   * wrong date is worse than reporting none.
   */
  contactUnlocks: Array<{ roleId: string; roleTitle: string }>;
  /**
   * Every graded-task attempt behind this candidate's evidence, summarised
   * exactly as an employer sees it.
   *
   * Employers have been shown this since attempt recording shipped: which
   * attempt number, whether it passed, which checks were outstanding, and
   * whether any attempt tripped a disqualifying check. The candidate could
   * see none of it - not in the app, and not in an export that offered
   * "everything Zoryvex holds about you".
   *
   * A person should be able to read what is being said about them to the
   * people deciding whether to hire them. Included in the same shape the
   * employer view uses, so the two cannot drift into telling different
   * stories about the same attempts.
   */
  gradedAttempts: Array<{ evidenceId: string; history: AttemptHistory }>;
  exportedAt: string;
}

/**
 * Self-service export (Prompt 7). Never includes a raw S3 key/URL — files
 * are listed by metadata only, matching the same "search results never
 * expose storage keys" rule applied everywhere else in this codebase.
 */
export async function exportCandidateData(
  candidateId: string,
  deps: Pick<
    PrivacyDependencies,
    | 'clock'
    | 'getCandidate'
    | 'listCandidateEvidence'
    | 'listFilesForCandidate'
    | 'listMatchesForCandidate'
    | 'getRole'
    | 'listGradedAttempts'
  >,
): Promise<CandidateExport> {
  const result = await deps.getCandidate(candidateId);
  if (!result) throw new NotFoundError('Candidate not found');

  const [evidence, files, matches] = await Promise.all([
    deps.listCandidateEvidence(candidateId),
    deps.listFilesForCandidate(candidateId),
    deps.listMatchesForCandidate(candidateId),
  ]);

  // A role that has since been deleted still had the contact. Its title is
  // gone, so it is reported as unavailable rather than dropped: omitting the
  // row would understate who received the candidate's details.
  const unlocked = matches.filter((match) => match.contactUnlocked);
  const contactUnlocks = await Promise.all(
    unlocked.map(async (match) => {
      const role = await deps.getRole(match.roleId);
      return { roleId: match.roleId, roleTitle: role?.role.title ?? '(role no longer exists)' };
    }),
  );

  // Every evidence item, deliberately, and not the filter the employer view
  // uses.
  //
  // match-evidence-service asks only where `verificationMethod` is
  // 'graded_task', which is right for it: that runs on every match render,
  // and a badge has no attempts. But the method is set only when
  // verification SUCCEEDS, while attempts are recorded at every graded exit
  // including failures. A candidate who attempted a task five times and
  // never passed has five records held about them and no verificationMethod
  // at all, so the employer's filter would drop exactly the history they
  // have most reason to want to see.
  //
  // That is the same omission this export was written to fix, narrowed
  // rather than removed, and I introduced it here by copying the employer
  // rule without checking that it meant the same thing on this side.
  //
  // The extra reads are affordable where they would not be there: an export
  // is a rare thing a person asks for, evidence is capped at
  // MAX_EVIDENCE_PER_CANDIDATE, and completeness is the entire purpose of
  // the document.
  const attemptsByEvidence = await Promise.all(
    evidence.map(async (item) => ({
      evidenceId: item.id,
      records: await deps.listGradedAttempts(candidateId, item.id),
    })),
  );
  const gradedAttempts = attemptsByEvidence
    .filter(({ records }) => records.length > 0)
    .map(({ evidenceId, records }) => ({
      evidenceId,
      history: summariseAttempts(numberInOrder(records)),
    }));

  return {
    candidate: result.candidate,
    evidence,
    gradedAttempts,
    files: files.map((f) => ({
      id: f.id,
      originalFilename: f.originalFilename,
      mimeType: f.mimeType,
      scanStatus: f.scanStatus,
      createdAt: f.createdAt,
    })),
    contactUnlocks,
    exportedAt: deps.clock.now().toISOString(),
  };
}
