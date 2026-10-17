import { z } from 'zod';

/**
 * What happened across a candidate's attempts at a graded task.
 *
 * THIS IS NOT PROCESS OBSERVATION, and the name says so deliberately.
 *
 * The brief asks for process observed: what somebody investigated, what they
 * tried, what they recovered from. Doing that properly means watching them
 * work, which means running their code, which this architecture does not do
 * and CLAUDE.md's infrastructure rules do not permit. Calling this by that
 * name would be exactly the overclaim the strength model exists to prevent,
 * so `process_observed` stays unsupported and this sits beside it.
 *
 * What this is, precisely: the sequence of checkpoints. Each submission is
 * graded against a rubric published in advance, and the record keeps which
 * checks failed and when. That is not how somebody worked. It is where they
 * were each time they stopped and asked.
 *
 * It is still worth having, because it separates two things a single pass
 * or fail cannot. The brief asks to distinguish "correct result + good
 * engineering" from "correct result + dangerous process". A candidate who
 * passed first time and a candidate who wrote a wildcard permission, was
 * told, and fixed it are not the same candidate, and until now an employer
 * saw the same green tick for both.
 *
 * The submission itself is deliberately never stored. It is the candidate's
 * work, it can contain anything they pasted into it, and keeping it would
 * create a store of other people's code with no one accountable for what is
 * in it. Which checks failed is the whole signal without the payload.
 */
export const GradedAttemptSchema = z.object({
  evidenceId: z.string(),
  taskId: z.string(),
  /** 1 for the first submission, counting up. */
  attemptNumber: z.number().int().positive(),
  passed: z.boolean(),
  /** Rubric check ids that did not pass, in the rubric's own order. */
  failedCheckIds: z.array(z.string()),
  /**
   * Whether a disqualifying check fired: writing a credential into
   * configuration, or submitting work set for somebody else. Recorded
   * separately because it is categorical rather than a low score, and an
   * employer reading the history should not have to know which rubric ids
   * carry that weight.
   */
  disqualified: z.boolean(),
  at: z.string().datetime(),
});
export type GradedAttempt = z.infer<typeof GradedAttemptSchema>;

/**
 * The history as an employer reads it.
 *
 * Deliberately not a score and not a judgement. Three attempts is not worse
 * than one — plenty of good engineers get something wrong, are told, and fix
 * it, and a product that punished that would be teaching people to submit
 * once and guess. What the employer gets is the sequence, and their own
 * reading of it.
 */
export const AttemptHistorySchema = z.object({
  attempts: z.array(GradedAttemptSchema),
  /** True when the first submission passed with nothing outstanding. */
  passedFirstTime: z.boolean(),
  /**
   * True when any attempt tripped a disqualifying check, even if a later one
   * passed. Surfaced because "wrote a credential into the config, then
   * removed it" is a thing an employer may reasonably want to know, and
   * hiding it behind an eventual pass would be choosing for them.
   */
  everDisqualified: z.boolean(),
});
export type AttemptHistory = z.infer<typeof AttemptHistorySchema>;

/**
 * One attempt as it is stored, which is the same record without its number.
 *
 * The number is deliberately not written down. It is a statement about
 * position in a sequence, not a fact about the submission, and storing it
 * would mean two submissions landing at the same moment could each read the
 * same count and each write themselves the same number. Order is what the
 * store keeps; the number is derived from it on the way out, so it cannot be
 * duplicated, cannot skip, and cannot disagree with the sequence it describes.
 */
export const GradedAttemptRecordSchema = GradedAttemptSchema.omit({ attemptNumber: true });
export type GradedAttemptRecord = z.infer<typeof GradedAttemptRecordSchema>;
