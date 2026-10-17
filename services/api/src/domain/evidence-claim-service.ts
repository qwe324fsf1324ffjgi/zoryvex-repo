import { randomUUID } from 'node:crypto';
import {
  MAX_EVIDENCE_PER_CANDIDATE,
  type Evidence,
  type PeerAttestation,
  type PeerRelationship,
} from '@zoryvex/contracts';

type EvidenceVisibility = Evidence['visibility'];
import { NotFoundError, ValidationError } from '../errors/typed-errors';
import type { Clock } from '../repositories/clock-repository';

/**
 * Text evidence *claims*: plain CRUD for the claim/context/actions/outcome
 * narrative a candidate writes themselves.
 *
 * Attaching an uploaded file was removed on 2026-09-09 (founder instruction,
 * "remove upload file feature"), so this service no longer reads the file
 * record and no longer sets Evidence.fileId. The upload pipeline still exists
 * and is unreachable; its deletion is a Terraform destroy awaiting approval.
 */
export interface EvidenceClaimDependencies {
  listAttestationsForEvidence(evidenceId: string): Promise<PeerAttestation[]>;
  clock: Clock;
  createEvidence(evidence: Evidence): Promise<{ evidence: Evidence; version: number }>;
  getEvidence(candidateId: string, evidenceId: string): Promise<Evidence | null>;
  getEvidenceWithVersion(
    candidateId: string,
    evidenceId: string,
  ): Promise<{ evidence: Evidence; version: number } | null>;
  listCandidateEvidence(candidateId: string): Promise<Evidence[]>;
  updateEvidence(
    candidateId: string,
    evidenceId: string,
    expectedVersion: number,
    patch: UpdateEvidenceInput,
    updatedAt: string,
  ): Promise<{ evidence: Evidence; version: number }>;
  deleteEvidence(candidateId: string, evidenceId: string): Promise<void>;
}

export interface CreateEvidenceInput {
  source: Evidence['source'];
  claim: string;
  context: string;
  actions: string;
  outcome: string;
  visibility: EvidenceVisibility;
  consentGiven: boolean;
  sourceUrl?: string | undefined;
}

/**
 * `verificationState` is never client-settable — every self-submitted claim
 * starts `unverified` (self-verification would defeat the proof-first
 * premise, CLAUDE.md "Fixed product"). The only thing that can change it is
 * services/api/src/domain/verification-service.ts, after an autonomous check
 * against an issuer has actually passed.
 */
export async function createOwnEvidence(
  candidateId: string,
  input: CreateEvidenceInput,
  deps: EvidenceClaimDependencies,
): Promise<{ evidence: Evidence; version: number }> {
  // Counted before anything is written. See MAX_EVIDENCE_PER_CANDIDATE for
  // why this is a quota rather than tidiness: matching, verification against
  // an issuer's shared rate limit, and the data export all multiply by this
  // number.
  const existing = await deps.listCandidateEvidence(candidateId);
  if (existing.length >= MAX_EVIDENCE_PER_CANDIDATE) {
    throw new ValidationError(
      `You have reached the limit of ${MAX_EVIDENCE_PER_CANDIDATE} pieces of evidence. ` +
        'Delete one you no longer need before filing another.',
    );
  }

  const now = deps.clock.now().toISOString();
  const evidence: Evidence = {
    id: randomUUID(),
    candidateId,
    source: input.source,
    claim: input.claim,
    context: input.context,
    actions: input.actions,
    outcome: input.outcome,
    verificationState: 'unverified',
    visibility: input.visibility,
    consentGiven: input.consentGiven,
    ...(input.sourceUrl ? { sourceUrl: input.sourceUrl } : {}),
    createdAt: now,
    updatedAt: now,
  };
  return deps.createEvidence(evidence);
}

export async function listOwnEvidence(
  candidateId: string,
  deps: Pick<EvidenceClaimDependencies, 'listCandidateEvidence'>,
): Promise<Evidence[]> {
  return deps.listCandidateEvidence(candidateId);
}

/**
 * The prerequisite `updateOwnEvidence` was always missing: a client needs
 * this item's current `version` before it can call update at all, and
 * `listOwnEvidence` never carried it (deliberately — version is a
 * persistence detail stripped from the general `Evidence` contract). Added
 * 2026-08-26 alongside the first UI that actually calls update.
 */
export async function getOwnEvidence(
  candidateId: string,
  evidenceId: string,
  deps: Pick<EvidenceClaimDependencies, 'getEvidenceWithVersion' | 'listAttestationsForEvidence'>,
): Promise<{
  evidence: Evidence;
  version: number;
  /**
   * Confirmations somebody has written about this claim.
   *
   * Here because this is the page a candidate asked from, and asking without
   * ever seeing the answer is half a loop. They see the same thing an
   * employer sees — the organisation, the relationship, the words — and not
   * the address, which belongs to the person who wrote it and was never
   * theirs to be given.
   */
  peerAttestations: {
    verifierDomain: string;
    relationship: PeerRelationship;
    statement: string;
    confirmedAt: string;
  }[];
}> {
  const result = await deps.getEvidenceWithVersion(candidateId, evidenceId);
  if (!result) throw new NotFoundError('Evidence not found');
  const attestations = await deps.listAttestationsForEvidence(evidenceId);
  return {
    ...result,
    peerAttestations: attestations.map((a) => ({
      verifierDomain: a.verifierDomain,
      relationship: a.relationship,
      statement: a.statement,
      confirmedAt: a.confirmedAt,
    })),
  };
}

export interface UpdateEvidenceInput {
  claim?: string | undefined;
  context?: string | undefined;
  actions?: string | undefined;
  outcome?: string | undefined;
  visibility?: EvidenceVisibility | undefined;
  consentGiven?: boolean | undefined;
  /**
   * Set by updateOwnEvidence alone, never by a client — the repository
   * clears verificationState/Method/Ref/verifiedAt when it sees this.
   */
  resetVerification?: boolean | undefined;
}

/**
 * Editing the substance of a verified claim resets it to `unverified`.
 *
 * Without this, verification is trivially launderable: get one real
 * credential verified, then rewrite claim/context/actions/outcome into
 * whatever an employer's role asks for and keep the "Verified" badge. The
 * badge would then attest to text nobody ever checked, which is worse than
 * having no badge at all — an employer is paying precisely for the promise
 * that it means something.
 *
 * Visibility and consent are deliberately NOT substance: hiding an item or
 * withdrawing consent to share it changes who can see the claim, not what
 * the claim says, so neither costs the candidate their verification.
 */
const SUBSTANTIVE_EVIDENCE_FIELDS = ['claim', 'context', 'actions', 'outcome'] as const;

export function editChangesSubstance(patch: UpdateEvidenceInput, existing: Evidence): boolean {
  return SUBSTANTIVE_EVIDENCE_FIELDS.some(
    (field) => patch[field] !== undefined && patch[field] !== existing[field],
  );
}

export async function updateOwnEvidence(
  candidateId: string,
  evidenceId: string,
  expectedVersion: number,
  patch: UpdateEvidenceInput,
  deps: EvidenceClaimDependencies,
): Promise<{ evidence: Evidence; version: number }> {
  const now = deps.clock.now().toISOString();

  const existing = await deps.getEvidence(candidateId, evidenceId);
  if (!existing) throw new NotFoundError('Evidence not found');

  const resetVerification =
    existing.verificationState === 'verified' && editChangesSubstance(patch, existing);

  return deps.updateEvidence(
    candidateId,
    evidenceId,
    expectedVersion,
    resetVerification ? { ...patch, resetVerification: true } : patch,
    now,
  );
}

/** The item's own PK already scopes by candidateId — an evidenceId under a different candidate simply isn't found. */
export async function deleteOwnEvidence(
  candidateId: string,
  evidenceId: string,
  deps: Pick<EvidenceClaimDependencies, 'getEvidence' | 'deleteEvidence'>,
): Promise<void> {
  const existing = await deps.getEvidence(candidateId, evidenceId);
  if (!existing) throw new NotFoundError('Evidence not found');
  await deps.deleteEvidence(candidateId, evidenceId);
}
