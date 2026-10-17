import { createHash, randomBytes } from 'node:crypto';
import { PEER_RELATIONSHIP_LABELS, type PeerRelationship } from '@zoryvex/contracts';
import { SystemClock } from '../repositories/clock-repository';
import { getAuthTokenPepper } from '../repositories/ssm-secure-repository';
import { getCandidate } from '../repositories/candidate-repository';
import { getEvidence } from '../repositories/evidence-repository';
import { incrementAndCheck } from '../repositories/rate-limit-repository';
import { sendPlainTextEmail } from '../repositories/ses-repository';
import {
  consumePeerRequest,
  createPeerRequest,
  getPeerRequest,
  hasCandidateVouchedFor,
  listAttestationsForEvidence,
  putAttestation,
  recordVouch,
} from '../repositories/peer-attestation-repository';
import type { PeerRequestDependencies } from '../domain/peer-request-service';

/**
 * The one email in this product that goes to somebody who never signed up.
 *
 * Everything else SES sends here was asked for: a magic link somebody
 * requested, a reminder to a candidate about their own evidence. This one
 * arrives because a stranger typed an address, and that changes what the
 * message has to do.
 *
 * It names who is asking and what they claimed, in the subject and the first
 * line, so the recipient can decide whether to open the link at all rather
 * than being asked to click to find out. It says plainly that ignoring it
 * ends the matter, because the honest alternative to confirming is doing
 * nothing and a message that does not say so invites a reluctant yes. And it
 * gives an address for somebody who thinks they should not have received it,
 * because the person who can tell us that is the recipient and nobody else.
 *
 * The stakes are concrete rather than theoretical. This identity also sends
 * the sign-in links. SES suspends sending above a 0.1% complaint rate, the
 * alarm on that threshold is already wired, and a peer-request message that
 * reads like spam would take sign-in down for everybody.
 */
function peerRequestEmailText(input: {
  candidateName: string;
  claim: string;
  confirmUrl: string;
  supportEmail: string;
}): string {
  return [
    `${input.candidateName} has asked you to confirm something they say they did.`,
    '',
    'What they claimed:',
    `  "${input.claim}"`,
    '',
    'If you can confirm it, this link opens a short form. It works once and',
    'expires in three days:',
    `  ${input.confirmUrl}`,
    '',
    'You will be asked how you worked with them and what you can confirm, in',
    'your own words. Zoryvex records the organisation your email address',
    'belongs to and never your address itself.',
    '',
    'If you would rather not, or you do not recognise this person, ignore this',
    'message. Nothing happens and nobody is told you declined. If you think you',
    `should not have been contacted at all, reply to ${input.supportEmail}.`,
  ].join('\n');
}

/**
 * The answer to a favour the candidate asked for.
 *
 * It reports the organisation and the relationship and stops there. The
 * verifier's address is never in it, and neither is their name, because the
 * candidate was never given either: the product records the domain an address
 * belongs to precisely so a confirmation cannot be turned into a contact the
 * candidate did not have before. Putting it in this message would hand over
 * through the back door exactly what the storage rule refuses at the front.
 *
 * The words themselves are left on the claim rather than quoted here. A
 * colleague wrote them for an employer reading the proof, and the candidate
 * can read them in the app, but a copy sitting in an inbox is one forward
 * away from being shown to the person who wrote it as leverage.
 */
function attestationRecordedEmailText(input: {
  candidateName: string;
  claim: string;
  verifierDomain: string;
  relationship: PeerRelationship;
}): string {
  return [
    `${input.candidateName},`,
    '',
    `Somebody at ${input.verifierDomain} has confirmed a claim of yours. They`,
    `described themselves as: ${PEER_RELATIONSHIP_LABELS[input.relationship].toLowerCase()}.`,
    '',
    'The claim:',
    `  "${input.claim}"`,
    '',
    'You can read what they wrote on the claim itself, where employers see it',
    'too. It is recorded as their account of your work rather than as a check',
    'we ran, and it is shown that way to anybody reading it.',
    '',
    'We do not pass on their email address, only the organisation it belongs',
    'to. That is deliberate, and it is the same for everyone.',
  ].join('\n');
}

export function createAwsPeerAttestationDependencies(): PeerRequestDependencies {
  return {
    clock: new SystemClock(),
    generateId: () => `att_${randomBytes(12).toString('hex')}`,
    // 256 bits, same as the sign-in token. Single-purpose and never reused.
    generateToken: () => randomBytes(32).toString('base64url'),
    hashToken: (token) => hmac(token),
    hashEmail: (email) => hmac(email.trim().toLowerCase()),
    createPeerRequest,
    getPeerRequest,
    consumePeerRequest,
    listAttestationsForEvidence,
    checkRateLimit: incrementAndCheck,

    async getCandidateEmail(candidateId) {
      const found = await getCandidate(candidateId);
      return found?.candidate.email ?? null;
    },

    async getEvidenceClaim(evidenceId, candidateId) {
      // Keyed by candidate, so ownership is structural rather than a check
      // somebody could forget: a candidate cannot read, and therefore cannot
      // solicit confirmation of, somebody else's claim.
      const evidence = await getEvidence(candidateId, evidenceId);
      if (!evidence) return null;
      const found = await getCandidate(candidateId);
      if (!found) return null;
      return { claim: evidence.claim, candidateName: found.candidate.displayName };
    },

    /**
     * Asks the reciprocity question in the direction that makes it a ring:
     * has this CANDIDATE previously vouched for the person now vouching for
     * them. Both sides keyed by email hash, because a verifier usually has
     * no candidate id at all.
     */
    async hasCandidateAttestedFor(candidateId, verifierEmailHash) {
      const found = await getCandidate(candidateId);
      if (!found) return false;
      const candidateEmailHash = hmac(found.candidate.email.trim().toLowerCase());
      return hasCandidateVouchedFor(candidateEmailHash, verifierEmailHash);
    },

    async putAttestation(attestation) {
      const saved = await putAttestation(attestation);
      // The marker that lets the next reciprocity check work. Written after
      // the attestation rather than before, so a failure here leaves a
      // recorded confirmation and a missing guard rather than a guard
      // against a confirmation that does not exist.
      const found = await getCandidate(attestation.candidateId);
      if (found) {
        await recordVouch(
          attestation.verifierEmailHash,
          hmac(found.candidate.email.trim().toLowerCase()),
        );
      }
      return saved;
    },

    async sendAttestationRecordedEmail(input) {
      const from = process.env.SIGN_IN_EMAIL_FROM;
      if (!from) throw new Error('SIGN_IN_EMAIL_FROM environment variable is not set');
      await sendPlainTextEmail({
        to: input.to,
        from,
        subject: 'Someone confirmed one of your claims',
        text: attestationRecordedEmailText(input),
        configurationSetName: process.env.SES_CONFIGURATION_SET_NAME,
      });
    },

    async sendPeerRequestEmail(input) {
      const from = process.env.SIGN_IN_EMAIL_FROM;
      if (!from) throw new Error('SIGN_IN_EMAIL_FROM environment variable is not set');
      await sendPlainTextEmail({
        to: input.to,
        from,
        // Names the person in the subject. A recipient should be able to
        // decide from the inbox list, without opening anything.
        subject: `${input.candidateName} asked you to confirm some work`,
        text: peerRequestEmailText({ ...input, supportEmail: from }),
        configurationSetName: process.env.SES_CONFIGURATION_SET_NAME,
      });
    },
  };
}

/**
 * Keyed hash, reusing the auth token pepper.
 *
 * Deliberately not a bare SHA-256. An unkeyed hash of an email address is
 * reversible in practice — the space of real addresses is small enough to
 * enumerate — and these hashes sit next to the domain, which narrows it
 * further. The pepper is the thing that makes the stored value useless to
 * somebody who reads the table.
 */
let cachedPepper: string | null = null;
function hmac(value: string): string {
  if (!cachedPepper) throw new Error('Peer attestation pepper not loaded');
  return createHash('sha256').update(`${cachedPepper}:${value}`).digest('hex');
}

/** Loaded once per container, the same way the auth handlers load theirs. */
export async function loadPeerAttestationPepper(): Promise<void> {
  cachedPepper ??= await getAuthTokenPepper();
}
