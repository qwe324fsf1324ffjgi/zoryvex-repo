import { z } from 'zod';

/**
 * How strong a piece of evidence is, expressed as what was actually
 * established rather than as a score.
 *
 * A number would be worse than useless here. "87% verified" invites an
 * employer to compare two candidates on a figure whose construction they
 * cannot see, which is the opaque scoring this product exists to argue
 * against. A level names a kind of knowing, and each one a candidate reaches
 * comes with the basis for it: what was checked, against whom, and when.
 *
 * The levels are ordered by how hard they are to fake, not by how impressive
 * they sound. A claim costs nothing. A credential means somebody else tested
 * them. A passed work sample means a machine looked at what they built. Work
 * corroborated against a source they do not control means it was really
 * theirs. Each step up removes a way of being wrong.
 *
 * Two of them are deliberately unreachable today, and saying so is the point.
 * An employer who cannot tell "this candidate did not do that" from "Zoryvex
 * does not do that yet" is being misled by omission, which is the same
 * failure as overclaiming and harder to notice.
 */
/**
 * ORDER MATTERS, and it changed on 2026-09-02 when peer verification arrived.
 *
 * The brief listed these as a progression of kinds of knowing, with peer
 * verification near the top. That reading is defensible while the order is
 * only a label. It stopped being only a label when ranking began using it:
 * a match is now sorted by the strongest level behind it, so position here
 * decides who an employer sees first.
 *
 * Under the brief's order, a peer attestation would have outranked a
 * machine-verified outcome. That inverts the product's own stated
 * preference — machine-verified outcome over opinion, observed action over
 * self-report — and it puts the single most collusion-prone signal at the
 * top of the list. A candidate with one willing colleague would sort above a
 * candidate whose configuration a machine actually checked.
 *
 * So the order is resistance to faking, which is what this file always said
 * it was. Peer verification sits just above a bare claim: it is attributable
 * testimony, which is worth more than nothing and much less than a check.
 *
 * Founder-decided 2026-09-02, after the change was put to them with the
 * consequence stated: keep this order. It is not an inherited default and it
 * is not mine to change back. Reordering these levels now moves who an
 * employer sees first, so it needs a founder decision and an entry in
 * docs/DECISIONS.md, the same as a price.
 */
export const EVIDENCE_STRENGTH_LEVELS = [
  'claimed',
  'peer_verified',
  'knowledge_assessed',
  'skill_demonstrated',
  'process_observed',
  'outcome_verified',
  'work_corroborated',
  'continuously_verified',
] as const;

export const EvidenceStrengthLevelSchema = z.enum(EVIDENCE_STRENGTH_LEVELS);
export type EvidenceStrengthLevel = z.infer<typeof EvidenceStrengthLevelSchema>;

/**
 * What each level means, and — where it cannot be reached — why not.
 *
 * `supported: false` is a statement about the platform, never about the
 * candidate. It is rendered as "Zoryvex does not check this" rather than
 * left out, so an absent level cannot read as a failed one.
 */
export const EVIDENCE_STRENGTH_DEFINITIONS: Record<
  EvidenceStrengthLevel,
  { name: string; means: string; supported: boolean; whyNot?: string }
> = {
  claimed: {
    name: 'Claimed',
    means: 'The candidate says they did this. Nothing has been checked, and it counts for nothing.',
    supported: true,
  },
  knowledge_assessed: {
    name: 'Knowledge assessed',
    means:
      'Somebody other than the candidate tested them on this and issued a credential, and that credential was confirmed with the body that issued it.',
    supported: true,
  },
  skill_demonstrated: {
    name: 'Skill demonstrated',
    means:
      'They were given a realistic problem and built something, and what they built was examined against a rubric published in advance.',
    supported: true,
  },
  process_observed: {
    name: 'Process observed',
    means:
      'How they worked was watched, not only what they finished: what they investigated, what they tried, what they recovered from.',
    supported: false,
    whyNot:
      'Zoryvex grades what was submitted, not how it was reached: doing otherwise would mean running code the candidate wrote, which it deliberately never does. It does keep the sequence of graded attempts, so you can see what earlier submissions missed and whether any tripped a disqualifying check, which is where somebody was each time they stopped rather than how they worked. Nothing about this candidate is implied by the absence of this level.',
  },
  outcome_verified: {
    name: 'Outcome verified',
    means:
      'The resulting state was checked by a machine rather than judged by a person or a model: the configuration really does what it was asked to do.',
    supported: true,
  },
  work_corroborated: {
    name: 'Work corroborated',
    means:
      'The work was found where they said it was, in a source they do not control, and attributed to them.',
    supported: true,
  },
  peer_verified: {
    name: 'Peer verified',
    means:
      'Somebody at the organisation the work was done at confirmed it, in writing, from an address they proved they control. It is attributable testimony rather than a check, which is why it sits low here: a colleague can be mistaken, or a friend.',
    supported: true,
  },
  continuously_verified: {
    name: 'Continuously verified',
    means:
      'The check is not a one-off: the credential behind it has an expiry, and it stops counting the day it lapses without anyone having to remember.',
    supported: true,
  },
};

/** The levels this platform can currently establish at all. */
export const SUPPORTED_STRENGTH_LEVELS: EvidenceStrengthLevel[] = EVIDENCE_STRENGTH_LEVELS.filter(
  (level) => EVIDENCE_STRENGTH_DEFINITIONS[level].supported,
);

export const EvidenceStrengthSchema = z.object({
  /** Every level this evidence reaches, in the order above. */
  attained: z.array(EvidenceStrengthLevelSchema),
  /**
   * Why each attained level was reached, in words an employer can read.
   *
   * Partial on purpose: only attained levels carry a basis. z.record with an
   * enum key is exhaustive in Zod 4, which would demand a reason for levels
   * the evidence never reached — and inventing one is exactly the overclaim
   * this whole file exists to prevent.
   */
  basis: z.partialRecord(EvidenceStrengthLevelSchema, z.string()),
  /**
   * Levels this platform cannot establish for anybody yet. Present on every
   * response, because an employer who cannot tell "not done" from "not
   * offered" is being misled by omission.
   */
  unsupported: z.array(EvidenceStrengthLevelSchema),
});
export type EvidenceStrength = z.infer<typeof EvidenceStrengthSchema>;
