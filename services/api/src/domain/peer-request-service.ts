import type { PeerAttestation, PeerRelationship } from '@zoryvex/contracts';
import { NotFoundError, TooManyRequestsError, ValidationError } from '../errors/typed-errors';
import type { Clock } from '../repositories/clock-repository';
import {
  emailDomain,
  isAnonymousDomain,
  recordPeerAttestation,
  type PeerAttestationDependencies,
} from './peer-attestation-service';

/**
 * Asking a colleague to confirm a claim, and letting them do it.
 *
 * The round trip is what makes an attestation worth anything. A candidate
 * types an address; a message goes to that address; only somebody who can
 * read that inbox can complete the confirmation. Everything the rules in
 * peer-attestation-service enforce rests on the address being genuinely
 * theirs, and nothing but a delivered token establishes that.
 *
 * Modelled on the sign-in flow rather than invented, because that flow has
 * already been through this: a long single-purpose token, hashed with a
 * pepper at rest, short expiry, single-use by conditional update, delivered
 * in a URL fragment so it never lands in a request path anything might log.
 * Every failure on the way back is the same generic error, so a stranger
 * with a guessed token learns nothing from which way it is refused.
 *
 * Two things are checked before an email is sent rather than after. An
 * anonymous domain and a candidate's own address are both refused up front,
 * so the product never sends a message it was always going to reject the
 * answer to. That is a courtesy to the recipient more than a security
 * property: nobody should be asked to fill in a form whose result was
 * predetermined.
 */

export const PEER_TOKEN_TTL_HOURS = 72;
const REQUESTS_PER_CANDIDATE_LIMIT = 10;
const REQUESTS_PER_CANDIDATE_WINDOW_SECONDS = 24 * 60 * 60;

export interface PeerRequestRecord {
  tokenHash: string;
  evidenceId: string;
  candidateId: string;
  verifierEmail: string;
  createdAt: string;
  expiresAt: string;
  consumed: boolean;
}

export interface PeerRequestDependencies extends PeerAttestationDependencies {
  clock: Clock;
  /** Same construction as the sign-in tokens: long, random, single-purpose. */
  generateToken(): string;
  hashToken(token: string): string;
  createPeerRequest(input: PeerRequestRecord & { ttlEpochSeconds: number }): Promise<void>;
  /** Reads without consuming, so a verifier can see what they are confirming. */
  getPeerRequest(tokenHash: string): Promise<PeerRequestRecord | null>;
  /** Atomic single-use consume. Returns null if unknown, expired or already used. */
  consumePeerRequest(tokenHash: string): Promise<PeerRequestRecord | null>;
  checkRateLimit(input: {
    kind: string;
    key: string;
    windowSeconds: number;
    limit: number;
    now: Date;
  }): Promise<{ allowed: boolean }>;
  getEvidenceClaim(
    evidenceId: string,
    candidateId: string,
  ): Promise<{ claim: string; candidateName: string } | null>;
  sendPeerRequestEmail(input: {
    to: string;
    candidateName: string;
    claim: string;
    confirmUrl: string;
  }): Promise<void>;
  /**
   * Tells the candidate somebody confirmed one of their claims.
   *
   * Nothing did. A colleague completed the round trip and the result landed
   * silently: the only way to discover it was to reopen that exact claim and
   * notice a section that was not there before. So the person who asked for
   * the favour could not tell whether it had been done, and the obvious
   * repair from their side is to ask the colleague again.
   *
   * This is not the unsolicited-mail case the reminder job worries about.
   * The candidate started this exchange themselves by naming the address, so
   * the answer to it is the half of a conversation they are already in.
   */
  sendAttestationRecordedEmail(input: {
    to: string;
    candidateName: string;
    claim: string;
    verifierDomain: string;
    relationship: PeerRelationship;
  }): Promise<void>;
}

export async function requestPeerAttestation(
  input: { candidateId: string; evidenceId: string; verifierEmail: string; appOrigin: string },
  deps: PeerRequestDependencies,
): Promise<{ requested: true }> {
  const now = deps.clock.now();
  const email = input.verifierEmail.trim().toLowerCase();
  const domain = emailDomain(email);

  if (!domain || !domain.includes('.')) {
    throw new ValidationError('That does not look like an email address.');
  }

  // Refused before anything is sent. A message asking somebody to fill in a
  // form we were always going to reject is worse than no message.
  if (isAnonymousDomain(domain)) {
    throw new ValidationError(
      'Ask somebody at the organisation you did the work for, using their work address. ' +
        'A confirmation from a personal address establishes that somebody exists, which was never in question.',
    );
  }

  const candidateEmail = await deps.getCandidateEmail(input.candidateId);
  if (candidateEmail && candidateEmail.trim().toLowerCase() === email) {
    throw new ValidationError('You cannot confirm your own claim.');
  }

  // Bounded per candidate rather than per recipient. The abuse worth
  // preventing is one person emailing many addresses, and a per-recipient
  // bound would let that run freely while punishing a popular colleague.
  const limit = await deps.checkRateLimit({
    kind: 'peer-request-candidate',
    key: input.candidateId,
    windowSeconds: REQUESTS_PER_CANDIDATE_WINDOW_SECONDS,
    limit: REQUESTS_PER_CANDIDATE_LIMIT,
    now,
  });
  if (!limit.allowed) {
    throw new TooManyRequestsError(
      'You have asked for a lot of confirmations today. Try again tomorrow.',
    );
  }

  // Ownership, and the claim's own words for the email. A candidate cannot
  // request a confirmation of somebody else's evidence.
  const evidence = await deps.getEvidenceClaim(input.evidenceId, input.candidateId);
  if (!evidence) throw new NotFoundError('Claim not found');

  const token = deps.generateToken();
  const expiresAt = new Date(now.getTime() + PEER_TOKEN_TTL_HOURS * 60 * 60_000);

  await deps.createPeerRequest({
    tokenHash: deps.hashToken(token),
    evidenceId: input.evidenceId,
    candidateId: input.candidateId,
    verifierEmail: email,
    createdAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    consumed: false,
    ttlEpochSeconds: Math.floor(expiresAt.getTime() / 1000) + 60,
  });

  // Fragment, not query. A token in a path or a query string ends up in
  // access logs, referrer headers, and browser history; a fragment is never
  // sent to a server at all.
  await deps.sendPeerRequestEmail({
    to: email,
    candidateName: evidence.candidateName,
    claim: evidence.claim,
    confirmUrl: `${input.appOrigin}/confirm-work#token=${token}`,
  });

  return { requested: true };
}

export interface PeerRequestPreview {
  candidateName: string;
  claim: string;
}

/**
 * What a verifier is being asked to confirm, before they confirm it.
 *
 * Deliberately does not consume the token. Somebody should be able to read
 * the claim, close the tab, think about it, and come back — asking a person
 * to vouch for something they were shown once and cannot re-read would be a
 * way of collecting careless confirmations.
 */
export async function previewPeerRequest(
  token: string,
  deps: PeerRequestDependencies,
): Promise<PeerRequestPreview> {
  const record = await deps.getPeerRequest(deps.hashToken(token));
  const now = deps.clock.now();

  // One error for every reason. A stranger with a guessed token learns
  // nothing from which way it was refused.
  const refuse = () => new NotFoundError('That link is not valid.');
  if (!record) throw refuse();
  if (record.consumed) throw refuse();
  if (new Date(record.expiresAt).getTime() <= now.getTime()) throw refuse();

  const evidence = await deps.getEvidenceClaim(record.evidenceId, record.candidateId);
  if (!evidence) throw refuse();

  return { candidateName: evidence.candidateName, claim: evidence.claim };
}

/**
 * Consumes the token and records the attestation.
 *
 * The email address comes from the stored request, never from the request
 * body: the whole point is that it is the address the message went to.
 * Accepting one from the client would make the round trip decorative.
 */
export async function confirmPeerAttestation(
  input: { token: string; relationship: PeerRelationship; statement: string },
  deps: PeerRequestDependencies,
): Promise<PeerAttestation> {
  const record = await deps.consumePeerRequest(deps.hashToken(input.token));
  if (!record) throw new NotFoundError('That link is not valid.');

  const attestation = await recordPeerAttestation(
    {
      evidenceId: record.evidenceId,
      candidateId: record.candidateId,
      confirmedVerifierEmail: record.verifierEmail,
      relationship: input.relationship,
      statement: input.statement,
    },
    deps,
  );

  /**
   * Told after the fact, and never at the colleague's expense.
   *
   * The confirmation is already recorded and durable by this point. The
   * person on the other end of this request is the verifier, who has done
   * what was asked of them and is owed a success; turning a bounced
   * notification to a third party into a failure on their screen would
   * invite them to submit the form again, which the one-per-verifier rule
   * would then refuse. So every failure here is swallowed on purpose. The
   * confirmation is visible on the claim either way, which is what makes
   * losing the message survivable.
   */
  try {
    const [candidateEmail, claim] = await Promise.all([
      deps.getCandidateEmail(record.candidateId),
      deps.getEvidenceClaim(record.evidenceId, record.candidateId),
    ]);
    if (candidateEmail && claim) {
      await deps.sendAttestationRecordedEmail({
        to: candidateEmail,
        candidateName: claim.candidateName,
        claim: claim.claim,
        verifierDomain: attestation.verifierDomain,
        relationship: attestation.relationship,
      });
    }
  } catch {
    // Deliberately silent. See above.
  }

  return attestation;
}
