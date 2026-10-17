import type {
  AuditEvent,
  Candidate,
  Evidence,
  PeerAttestation,
  PublicProof,
} from '@zoryvex/contracts';
import { NotFoundError } from '../errors/typed-errors';
import type { Clock } from '../repositories/clock-repository';
import { isVerified } from './matching-service';
import { evidenceStrength } from './evidence-strength-service';

/**
 * The public proof page: the one shape in this product that leaves the
 * authenticated boundary.
 *
 * Everything here is written to fail closed. A stranger with a URL gets a
 * page only if a candidate turned this on and has not turned it off, and the
 * page carries only what survived a machine-re-runnable check. Every other
 * path returns the same not-found, so the URL cannot be used to discover
 * whether an account exists.
 *
 * Three rules do most of the work.
 *
 * The URL is not derived from anything permanent. `publicProofId` is minted
 * on opt-in and destroyed on opt-out, and the pointer item that resolves it
 * is deleted in the same breath, so revoking consent breaks every link that
 * was ever shared rather than merely hiding the page behind a flag. Opting
 * back in issues a different id, which means a revoked link stays dead.
 *
 * Verification is re-checked at read time, never trusted from storage. A
 * credential that lapsed this morning stops appearing this morning, on the
 * same `isVerified` the marketplace uses, rather than at the next recompute.
 * A public page that outlived its own proof would be the exact thing this
 * product exists to argue against.
 *
 * Nothing unverified appears at all. Not greyed out, not "pending" — absent.
 * A page listing what somebody claims alongside what they proved would hand a
 * reader the job of telling them apart, which is the job the product is for.
 */

export interface PublicProofDependencies {
  clock: Clock;
  /** Resolves a public id to a candidate id, or null. Never reveals why. */
  getCandidateIdByPublicProofId(publicProofId: string): Promise<string | null>;
  getCandidate(candidateId: string): Promise<{ candidate: Candidate; version: number } | null>;
  listCandidateEvidence(candidateId: string): Promise<Evidence[]>;
  listAttestationsForEvidence(evidenceId: string): Promise<PeerAttestation[]>;
  /**
   * A short-lived link to the candidate's photo, minted per request.
   *
   * Optional on the dependency so a caller that has no photo pipeline (the
   * local fake) simply never produces one, rather than every such caller
   * having to stub a function it will not use.
   */
}

export interface PublicProofConsentDependencies {
  clock: Clock;
  getCandidate(candidateId: string): Promise<{ candidate: Candidate; version: number } | null>;
  /** Mints the pointer item and stamps the id on the candidate, atomically enough. */
  enablePublicProof(candidateId: string, publicProofId: string, updatedAt: string): Promise<void>;
  /** Deletes the pointer item and clears the id. */
  disablePublicProof(candidateId: string, publicProofId: string, updatedAt: string): Promise<void>;
  appendAuditEvent(event: AuditEvent): Promise<AuditEvent>;
  generateId(): string;
}

/**
 * Reads a public proof page. Unauthenticated by design; the id is the only
 * credential, which is why it is opaque, single-purpose, and revocable.
 */
export async function getPublicProof(
  publicProofId: string,
  deps: PublicProofDependencies,
): Promise<PublicProof> {
  // One error for every failure below. An id that never existed, an id whose
  // consent was withdrawn, and a candidate that was deleted must be
  // indistinguishable, or the URL becomes a way to ask questions about
  // people who did not agree to answer any.
  const notFound = () => new NotFoundError('No public proof page here');

  const candidateId = await deps.getCandidateIdByPublicProofId(publicProofId);
  if (!candidateId) throw notFound();

  const found = await deps.getCandidate(candidateId);
  if (!found) throw notFound();
  const { candidate } = found;

  // Belt and braces against a stale pointer. The pointer is deleted on
  // opt-out, so this should be unreachable; it is checked anyway because the
  // failure it guards against is publishing somebody who said no.
  if (!candidate.publicProofId || candidate.publicProofId !== publicProofId) {
    throw notFound();
  }

  const now = deps.clock.now();
  const evidence = await deps.listCandidateEvidence(candidateId);

  const live = evidence
    .filter((item) => item.visibility !== 'private')
    .filter((item) => isVerified(item, now))
    // A verified item without a summary would render as a proof nobody can
    // check, which is a "trust me" with better typography.
    .filter((item) => Boolean(item.verificationDetail) && Boolean(item.verifiedAt));

  const proofs = (
    await Promise.all(
      live.map(async (item) => {
        const attestations = await deps.listAttestationsForEvidence(item.id);
        return {
          claim: item.claim,
          verificationMethod: item.verificationMethod!,
          verificationDetail: item.verificationDetail!,
          verifiedAt: item.verifiedAt!,
          ...(item.verificationExpiresAt
            ? { verificationExpiresAt: item.verificationExpiresAt }
            : {}),
          // Same clock as the filter above, so the strength shown can never
          // disagree with the decision to show the proof at all.
          strength: evidenceStrength(item, now, { peerAttested: attestations.length > 0 }),
          // The domain and the words, never the address. The verifier is told
          // on the confirm page, before they write, that this appears here.
          peerAttestations: attestations.map((a) => ({
            verifierDomain: a.verifierDomain,
            relationship: a.relationship,
            statement: a.statement,
            confirmedAt: a.confirmedAt,
          })),
        };
      }),
    )
  )
    // Newest check first: the freshest evidence is the most useful, and it
    // makes a stale page obvious rather than something to work out.
    .sort((a, b) => b.verifiedAt.localeCompare(a.verifiedAt));

  return {
    displayName: candidate.displayName,
    launchTrack: candidate.launchTrack,
    proofs,
    generatedAt: now.toISOString(),
  };
}

/**
 * Turns the page on. Returns the new public id.
 *
 * Idempotent in the useful direction: calling it twice returns the id the
 * candidate already has rather than minting a second one and orphaning the
 * first, because a second live URL for the same person is a link they cannot
 * revoke.
 */
export async function enablePublicProofPage(
  candidateId: string,
  deps: PublicProofConsentDependencies,
): Promise<{ publicProofId: string }> {
  const found = await deps.getCandidate(candidateId);
  if (!found) throw new NotFoundError('Candidate not found');
  if (found.candidate.publicProofId) {
    return { publicProofId: found.candidate.publicProofId };
  }

  const publicProofId = deps.generateId();
  const now = deps.clock.now().toISOString();
  await deps.enablePublicProof(candidateId, publicProofId, now);
  await deps.appendAuditEvent({
    id: deps.generateId(),
    actorId: candidateId,
    actorRole: 'candidate',
    action: 'public_proof_opt_in',
    targetType: 'candidate',
    targetId: candidateId,
    createdAt: now,
  });
  return { publicProofId };
}

/**
 * Turns the page off, and destroys the id rather than parking it.
 *
 * Withdrawing consent has to be worth something. Deleting the pointer means
 * a link somebody saved last week stops resolving, which is the only version
 * of revocation that means anything once a URL has been shared.
 */
export async function disablePublicProofPage(
  candidateId: string,
  deps: PublicProofConsentDependencies,
): Promise<void> {
  const found = await deps.getCandidate(candidateId);
  if (!found) throw new NotFoundError('Candidate not found');
  const existing = found.candidate.publicProofId;
  if (!existing) return;

  const now = deps.clock.now().toISOString();
  await deps.disablePublicProof(candidateId, existing, now);
  await deps.appendAuditEvent({
    id: deps.generateId(),
    actorId: candidateId,
    actorRole: 'candidate',
    action: 'public_proof_opt_out',
    targetType: 'candidate',
    targetId: candidateId,
    createdAt: now,
  });
}
