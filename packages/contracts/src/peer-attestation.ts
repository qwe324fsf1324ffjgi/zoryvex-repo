import { z } from 'zod';

/**
 * Somebody who worked with a candidate confirming what they did.
 *
 * This is the weakest thing in the product that is not simply a claim, and
 * the design exists almost entirely to keep it from being worthless. Every
 * other check here asks a machine or an issuer. This one asks a person, and
 * a person can be a friend.
 *
 * So the useful question is never "what did they say" but "who is saying it,
 * and can that be established without taking anybody's word". Four rules
 * follow from that, and they are enforced in
 * services/api/src/domain/peer-attestation-service.ts rather than trusted to
 * a form:
 *
 *   the verifier proves control of an address at a real organisation's
 *   domain, by receiving a code there. Free webmail is refused: an
 *   attestation from an anonymous address is testimony with no source, which
 *   is the thing this product exists to refuse.
 *
 *   the verifier cannot be the candidate, however the address is spelled.
 *
 *   two candidates cannot verify each other. A reciprocity ring is the
 *   cheapest attack available and the one nobody would notice.
 *
 *   one attestation per verifier per claim, so a single willing colleague
 *   cannot be spent repeatedly.
 *
 * None of that makes an attestation proof. It makes it attributable, which
 * is a different and smaller thing, and the strength model prices it
 * accordingly rather than flattering it.
 */

export const PeerRelationshipSchema = z.enum([
  'managed_them',
  'worked_alongside',
  'was_their_client',
  'reviewed_their_work',
]);
export type PeerRelationship = z.infer<typeof PeerRelationshipSchema>;

export const PEER_RELATIONSHIP_LABELS: Record<PeerRelationship, string> = {
  managed_them: 'Managed them',
  worked_alongside: 'Worked alongside them',
  was_their_client: 'Was their client',
  reviewed_their_work: 'Reviewed their work',
};

export const PeerAttestationSchema = z.object({
  id: z.string(),
  evidenceId: z.string(),
  candidateId: z.string(),
  /**
   * The organisation's domain, and deliberately not the person's address.
   *
   * An employer needs to know an attestation came from someone at the
   * company the work was done at. They do not need, and should not be given,
   * a third party's personal email — that person consented to confirm a
   * claim, not to have their address handed to strangers.
   */
  verifierDomain: z.string().min(3),
  /**
   * A keyed hash of the address, held only so the rules above can be
   * enforced: the same person cannot attest twice, and a reciprocity ring
   * can be detected. Never rendered, never returned by any read route.
   */
  verifierEmailHash: z.string(),
  relationship: PeerRelationshipSchema,
  /** What they say they can confirm, in their own words. */
  statement: z.string().min(1).max(600),
  /** When they proved control of an address at that domain. */
  confirmedAt: z.string().datetime(),
});
export type PeerAttestation = z.infer<typeof PeerAttestationSchema>;

/**
 * What an employer is shown. The hash never leaves the database and the
 * address never enters it.
 */
export const PublicPeerAttestationSchema = PeerAttestationSchema.omit({
  verifierEmailHash: true,
  candidateId: true,
});
export type PublicPeerAttestation = z.infer<typeof PublicPeerAttestationSchema>;

/**
 * Domains where an address proves nothing about where somebody works.
 *
 * Not a completeness claim — it cannot be, there are thousands — which is
 * why the rule is written as a floor rather than a guarantee, and why the
 * employer is always told the domain rather than being handed a verdict.
 * A determined faker can register a domain; the point is that doing so costs
 * something and leaves a trace, where a free address costs nothing.
 */
export const ANONYMOUS_EMAIL_DOMAINS: readonly string[] = [
  'gmail.com',
  'googlemail.com',
  'yahoo.com',
  'yahoo.co.uk',
  'outlook.com',
  'hotmail.com',
  'hotmail.co.uk',
  'live.com',
  'msn.com',
  'icloud.com',
  'me.com',
  'aol.com',
  'proton.me',
  'protonmail.com',
  'gmx.com',
  'mail.com',
  'yandex.com',
  'zoho.com',
  'tutanota.com',
  'fastmail.com',
];
