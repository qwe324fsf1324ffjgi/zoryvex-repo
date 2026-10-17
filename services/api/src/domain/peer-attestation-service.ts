import {
  ANONYMOUS_EMAIL_DOMAINS,
  type PeerAttestation,
  type PeerRelationship,
} from '@zoryvex/contracts';
import { ConflictError, ValidationError } from '../errors/typed-errors';
import type { Clock } from '../repositories/clock-repository';

/**
 * Recording that somebody who worked with a candidate confirmed what they
 * did.
 *
 * The rules below are the feature. Without them this is a form where a
 * candidate types a friend's address, and a shortlist where the best-
 * connected person wins — which would be worse than not having it, because
 * it would put this platform's name on the result.
 *
 * What this can and cannot establish is worth being blunt about. It cannot
 * establish that the work happened: only that somebody at a real
 * organisation's domain was willing to say so, in writing, attributably. An
 * employer is shown the domain and the stated relationship precisely so they
 * can weigh that themselves rather than being handed a verdict.
 */

export interface PeerAttestationDependencies {
  clock: Clock;
  generateId(): string;
  /** Keyed hash, same construction as the auth tokens. Never reversible. */
  hashEmail(email: string): string;
  /** The candidate's own address, to refuse self-attestation. */
  getCandidateEmail(candidateId: string): Promise<string | null>;
  /** Attestations already recorded against this evidence item. */
  listAttestationsForEvidence(evidenceId: string): Promise<PeerAttestation[]>;
  /**
   * Whether the candidate has already vouched for the person now vouching
   * for them. A reciprocity ring is the cheapest attack available here.
   */
  hasCandidateAttestedFor(candidateId: string, verifierEmailHash: string): Promise<boolean>;
  putAttestation(attestation: PeerAttestation): Promise<PeerAttestation>;
}

export interface RecordAttestationInput {
  evidenceId: string;
  candidateId: string;
  /**
   * Only reaches this function after the verifier proved control of it by
   * receiving a code there. Nothing here trusts a typed address: an
   * unconfirmed address is a claim about a claim.
   */
  confirmedVerifierEmail: string;
  relationship: PeerRelationship;
  statement: string;
}

/** Everything after the last @, lowercased. */
export function emailDomain(email: string): string {
  const at = email.lastIndexOf('@');
  return at === -1
    ? ''
    : email
        .slice(at + 1)
        .toLowerCase()
        .trim();
}

/**
 * Whether an address says anything about where somebody works.
 *
 * A free webmail address is anonymous testimony: it establishes that a human
 * exists, which was never in doubt. Refusing it is a floor rather than a
 * guarantee — a determined faker can register a domain — but registering one
 * costs money and leaves a trail, and a free address costs nothing.
 */
export function isAnonymousDomain(domain: string): boolean {
  return ANONYMOUS_EMAIL_DOMAINS.includes(domain.toLowerCase());
}

export async function recordPeerAttestation(
  input: RecordAttestationInput,
  deps: PeerAttestationDependencies,
): Promise<PeerAttestation> {
  const email = input.confirmedVerifierEmail.trim().toLowerCase();
  const domain = emailDomain(email);

  if (!domain || !domain.includes('.')) {
    throw new ValidationError('That does not look like an email address.');
  }

  if (isAnonymousDomain(domain)) {
    throw new ValidationError(
      'A confirmation has to come from an address at the organisation the work was done at. ' +
        'A personal address establishes that somebody exists, which was never in question.',
    );
  }

  // Self-attestation, however the address is spelled. Compared on the hash
  // rather than the string so a candidate cannot slip past on case or
  // whitespace, both of which are normalised into the same hash.
  const verifierEmailHash = deps.hashEmail(email);
  const candidateEmail = await deps.getCandidateEmail(input.candidateId);
  if (candidateEmail && deps.hashEmail(candidateEmail.trim().toLowerCase()) === verifierEmailHash) {
    throw new ValidationError('A candidate cannot confirm their own claim.');
  }

  // The cheapest attack, and the one nobody would notice: two candidates
  // confirming each other's work. Refused rather than flagged, because a
  // flag on a shortlist is something somebody has to read and act on.
  if (await deps.hasCandidateAttestedFor(input.candidateId, verifierEmailHash)) {
    throw new ConflictError(
      'This person has already had a claim of theirs confirmed by this candidate. ' +
        'Two people cannot confirm each other.',
    );
  }

  // One per verifier per claim, so a single willing colleague cannot be
  // spent repeatedly on the same item to make it look widely corroborated.
  const existing = await deps.listAttestationsForEvidence(input.evidenceId);
  if (existing.some((a) => a.verifierEmailHash === verifierEmailHash)) {
    throw new ConflictError('This person has already confirmed this claim.');
  }

  const statement = input.statement.trim();
  if (statement.length === 0) {
    throw new ValidationError('Say what you can confirm, in your own words.');
  }
  if (statement.length > 600) {
    throw new ValidationError('Keep it under 600 characters.');
  }

  return deps.putAttestation({
    id: deps.generateId(),
    evidenceId: input.evidenceId,
    candidateId: input.candidateId,
    verifierDomain: domain,
    verifierEmailHash,
    relationship: input.relationship,
    statement,
    confirmedAt: deps.clock.now().toISOString(),
  });
}

/**
 * Whether an evidence item has a usable attestation behind it.
 *
 * Deliberately not a count. "Three people confirmed this" invites an
 * employer to read agreement as strength, and three colleagues at one
 * company agreeing is one organisation's opinion however many people typed
 * it. What matters is that at least one attributable person put their name
 * to it; the employer reads the rest and decides.
 */
export function hasPeerAttestation(attestations: PeerAttestation[]): boolean {
  return attestations.length > 0;
}
