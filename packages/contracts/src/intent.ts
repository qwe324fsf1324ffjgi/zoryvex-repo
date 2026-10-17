import { z } from 'zod';

/**
 * What each side is actually offering and looking for, in fields something
 * can read.
 *
 * Zoryvex matched on proof and location and nothing else. Everything about
 * intent — whether a role pays what a candidate needs, whether either side
 * wants mentoring rather than a hire, whether both are actually interested
 * in each other — lived in free text at best and nowhere at worst. An
 * employer could pay to unlock somebody who would never have taken the
 * salary, and a candidate offering to tutor had no way to say so.
 *
 * Kept deliberately small. Every field here is one a person can answer
 * honestly in a second and a machine can compare without interpreting, which
 * is the same standard the rest of the product applies to evidence.
 */

/**
 * The kinds of working relationship either side can want.
 *
 * Mentoring, tutoring and training are first-class rather than lumped into
 * "other", because they are the arrangements this market actually runs on
 * and the ones a proof-first platform is unusually well placed to support: a
 * verified practitioner is exactly who is worth learning from.
 *
 * `employment` covers a permanent hire. `contract` covers fixed-term or
 * project work. `mentoring` is an ongoing relationship with an individual,
 * `tutoring` is paid teaching toward a specific skill or certification, and
 * `training` is delivered to a team rather than a person.
 */
export const ENGAGEMENT_KINDS = [
  'employment',
  'contract',
  'mentoring',
  'tutoring',
  'training',
] as const;
export const EngagementKindSchema = z.enum(ENGAGEMENT_KINDS);
export type EngagementKind = z.infer<typeof EngagementKindSchema>;

export const ENGAGEMENT_KIND_LABELS: Record<EngagementKind, string> = {
  employment: 'Permanent role',
  contract: 'Contract or project work',
  mentoring: 'Mentoring one person',
  tutoring: 'Tutoring toward a skill or certification',
  training: 'Training a team',
};

/**
 * The same five, phrased to sit inside a sentence.
 *
 * A label is a heading and reads as one. Lowercasing a label and dropping
 * it mid-sentence produced "This is permanent role", because only one of
 * the five needs an article and no amount of string handling knows which.
 * Written out once, here, where the labels already live.
 */
export const ENGAGEMENT_KIND_PHRASES: Record<EngagementKind, string> = {
  employment: 'a permanent role',
  contract: 'contract or project work',
  mentoring: 'mentoring one person',
  tutoring: 'tutoring toward a skill or certification',
  training: 'training a team',
};

/**
 * How often a compensation figure is paid.
 *
 * Both are kept because Nigerian salaries are usually discussed monthly
 * while contract and training work is usually quoted per day, and converting
 * one into the other silently is how a figure ends up wrong by a factor of
 * twenty.
 */
export const COMPENSATION_PERIODS = ['month', 'year', 'day'] as const;
export const CompensationPeriodSchema = z.enum(COMPENSATION_PERIODS);
export type CompensationPeriod = z.infer<typeof CompensationPeriodSchema>;

export const COMPENSATION_PERIOD_LABELS: Record<CompensationPeriod, string> = {
  month: 'per month',
  year: 'per year',
  day: 'per day',
};

/**
 * A pay range, in naira, with both ends required.
 *
 * A single number is either a ceiling pretending to be an offer or a floor
 * pretending to be a ceiling, and "competitive" is neither. Requiring both
 * ends is what makes the word "transparent" mean anything: a candidate can
 * tell, before spending their time, whether this is worth a conversation.
 *
 * Whole naira only. Kobo in a salary is noise, and a decimal here would
 * invite a float where the rest of this codebase is careful to use integers
 * for money.
 */
export const CompensationRangeSchema = z
  .object({
    minNGN: z.number().int().positive(),
    maxNGN: z.number().int().positive(),
    period: CompensationPeriodSchema,
  })
  .refine((range) => range.maxNGN >= range.minNGN, {
    message: 'The top of the range cannot be below the bottom of it',
    path: ['maxNGN'],
  });
export type CompensationRange = z.infer<typeof CompensationRangeSchema>;

/**
 * What a candidate is open to, and what they need to be paid for it.
 *
 * Optional throughout: a candidate who has not said is recorded as not
 * having said, never as a default that speaks for them. An empty
 * `openTo` means the same thing as an absent one and both are read as
 * "no preference stated", which is why matching treats a silent candidate
 * as eligible for everything rather than nothing.
 */
export const CandidateIntentSchema = z.object({
  openTo: z.array(EngagementKindSchema).max(ENGAGEMENT_KINDS.length).default([]),
  /** What they need, not what they hope for. Absent means unstated. */
  minimumCompensation: CompensationRangeSchema.optional(),
  /** Free text for anything the fields above cannot hold. Never matched on. */
  note: z.string().max(500).default(''),
});
export type CandidateIntent = z.infer<typeof CandidateIntentSchema>;

/**
 * What a role is offering.
 *
 * `engagementKind` is singular where the candidate's is plural, because a
 * role is one arrangement while a person can be open to several.
 */
export const RoleIntentSchema = z.object({
  engagementKind: EngagementKindSchema.default('employment'),
  /** Absent means the employer has not published a range. */
  compensation: CompensationRangeSchema.optional(),
});
export type RoleIntent = z.infer<typeof RoleIntentSchema>;

/**
 * Whether a side has said yes to the other.
 *
 * `unstated` is not `declined`. A candidate who has not looked yet must not
 * read as a rejection, because the whole point of recording interest is to
 * tell those two apart.
 */
export const INTEREST_STATES = ['unstated', 'interested', 'declined'] as const;
export const InterestStateSchema = z.enum(INTEREST_STATES);
export type InterestState = z.infer<typeof InterestStateSchema>;

/**
 * A match is mutual when both sides have actively said yes.
 *
 * Deliberately strict: silence on either side is not agreement. An employer
 * paying to unlock a contact is buying a conversation, and this is what
 * makes it a conversation somebody wants to have rather than a cold
 * approach the candidate never invited.
 */
export function isMutualMatch(
  candidateInterest: InterestState | undefined,
  employerInterest: InterestState | undefined,
): boolean {
  return candidateInterest === 'interested' && employerInterest === 'interested';
}

/**
 * Whether a role's pay clears what a candidate said they need.
 *
 * Unknown on either side is not a mismatch. Most of the market does not
 * publish pay and most candidates have not filled this in, so treating
 * silence as a failure would empty every shortlist on day one. Only a stated
 * range that genuinely falls short counts against a match, and the caller
 * shows the reason rather than dropping the candidate.
 *
 * Periods are compared only when they agree. Converting a daily rate into a
 * monthly salary needs an assumption about working days that neither side
 * has made, and inventing one here would produce a confident number nobody
 * agreed to.
 */
export function compensationClears(
  offered: CompensationRange | undefined,
  required: CompensationRange | undefined,
): { clears: true } | { clears: false; reasonForEmployer: string; reasonForCandidate: string } {
  if (!offered || !required) return { clears: true };
  if (offered.period !== required.period) return { clears: true };
  if (offered.maxNGN >= required.minNGN) return { clears: true };

  const ceiling = `${formatNGN(offered.maxNGN)} ${COMPENSATION_PERIOD_LABELS[offered.period]}`;
  return {
    clears: false,
    // The employer is told there is a gap and not how big it is. The
    // figure belongs to the candidate, who was told when they entered it
    // that it is never shown to an employer as a demand, and a shortlist
    // that printed it would break that on the screen the employer already
    // has open. What the employer needs in order to act is the same
    // either way: this pays less than this person said they need.
    reasonForEmployer: `This role pays up to ${ceiling}, which is below what they said they need.`,
    // Their own number, shown back to them.
    reasonForCandidate:
      `This role pays up to ${ceiling}, and you said you need at least ` +
      `${formatNGN(required.minNGN)}.`,
  };
}

/** Naira with thousands separators and no decimals. */
export function formatNGN(amount: number): string {
  return `NGN ${amount.toLocaleString('en-NG')}`;
}

/** A pay range as one readable phrase, for a screen rather than a log. */
export function formatCompensationRange(range: CompensationRange): string {
  const period = COMPENSATION_PERIOD_LABELS[range.period];
  if (range.minNGN === range.maxNGN) return `${formatNGN(range.minNGN)} ${period}`;
  return `${formatNGN(range.minNGN)} to ${formatNGN(range.maxNGN)} ${period}`;
}

/**
 * A pay range part-way through being typed.
 *
 * A form cannot hold a `CompensationRange` while somebody is filling it
 * in: between the first keystroke in "From" and the last one in "To"
 * there is no valid range, and there is no honest number to stand in.
 * Writing 0 into the missing end is the tempting shortcut and it is the
 * one thing that must not happen, because 0 is a claim about pay and an
 * empty box is not.
 *
 * So the draft is the form's state and the range is what gets saved.
 * Both ends are separately optional, which also gives clearing a box a
 * representation of its own: `undefined` here means the box is empty,
 * not that this edit left the field alone.
 */
export interface CompensationDraft {
  minNGN: number | undefined;
  maxNGN: number | undefined;
  period: CompensationPeriod;
}

/** A blank draft, for a form nobody has filled in yet. */
export function emptyCompensationDraft(): CompensationDraft {
  return { minNGN: undefined, maxNGN: undefined, period: 'month' };
}

/** Opens a stored range for editing, or a blank draft when none is stored. */
export function draftFromRange(range: CompensationRange | undefined): CompensationDraft {
  if (!range) return emptyCompensationDraft();
  return { minNGN: range.minNGN, maxNGN: range.maxNGN, period: range.period };
}

/**
 * What a draft means: a range to save, nothing to save, or a reason it
 * cannot be saved yet.
 *
 * Empty on both ends is the "not stated" answer and is how a published
 * range is taken back down, so it is a success with no range rather than
 * a problem. One end alone is the problem: a lone figure reads as a
 * ceiling to the employer and a floor to the candidate, which is the
 * ambiguity transparent pay exists to remove.
 *
 * The inverted-range message is worded to match
 * `CompensationRangeSchema`'s own refinement, so the form and the API
 * say the same thing rather than two things.
 */
export function compensationFromDraft(draft: CompensationDraft): {
  range?: CompensationRange;
  problem?: string;
} {
  const hasMin = typeof draft.minNGN === 'number' && draft.minNGN > 0;
  const hasMax = typeof draft.maxNGN === 'number' && draft.maxNGN > 0;

  if (!hasMin && !hasMax) return {};
  if (!hasMin) return { problem: 'Add the bottom of the pay range, or clear both boxes.' };
  if (!hasMax) return { problem: 'Add the top of the pay range, or clear both boxes.' };

  const parsed = CompensationRangeSchema.safeParse({
    minNGN: draft.minNGN,
    maxNGN: draft.maxNGN,
    period: draft.period,
  });
  if (!parsed.success) {
    return { problem: `${parsed.error.issues[0]?.message ?? 'That pay range is not valid'}.` };
  }
  return { range: parsed.data };
}
