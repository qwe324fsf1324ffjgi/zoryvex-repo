/**
 * Maximum lengths for the free text a person types.
 *
 * Shared rather than written twice, for the reason this codebase keeps
 * relearning: a limit the API enforces and the form does not is a wall a
 * candidate hits only after writing the whole thing, and a limit the form
 * enforces and the API does not is not a limit at all.
 *
 * These bound INPUT, deliberately, and are not applied to the entity schemas
 * that read rows back. A row stored before a limit existed must still parse;
 * refusing to read it would turn a validation change into data loss.
 *
 * Sizing: a DynamoDB item cannot exceed 400KB, and an Evidence row carries
 * four of these fields at once. The four together come to about 6KB of text,
 * which leaves the limit an order of magnitude away rather than close enough
 * for a long submission to fail the write after the fact. They are generous
 * for what each field is actually for - a claim is a sentence, not an essay -
 * and the point is to have a ceiling at all, not to police length.
 *
 * `mustHaveWork` is capped in both directions because matching scores every
 * requirement against every piece of a candidate's evidence, so an unbounded
 * list is unbounded work per candidate, not just a large row.
 */
export const TEXT_LIMITS = {
  /** Evidence: the one-line statement of what was done. */
  claim: 300,
  /** Evidence: where it happened. */
  context: 1_500,
  /** Evidence: what the person actually did. The longest of the four. */
  actions: 3_000,
  /** Evidence: what resulted. */
  outcome: 1_500,

  /** Candidate profile. */
  displayName: 120,
  summary: 1_000,

  /** Role authoring. */
  roleTitle: 200,
  roleOutcomes: 3_000,
  roleConstraints: 1_000,
  mustHaveWorkItem: 300,
  mustHaveWorkCount: 20,

  /**
   * Upload request metadata. 255 is the practical filename ceiling on every
   * filesystem this could touch, and a MIME type longer than that is not a
   * MIME type.
   */
  fileName: 255,
  mimeType: 255,

  /**
   * Single-use tokens. Bounded so a caller cannot post megabytes at an
   * unauthenticated route; the real check is the lookup, which fails for
   * anything that is not a token this system issued.
   */
  token: 512,
} as const;

export type TextLimitField = keyof typeof TEXT_LIMITS;
