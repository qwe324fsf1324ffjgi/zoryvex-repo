import { describe, expect, it } from 'vitest';
import {
  compensationFromDraft,
  draftFromRange,
  emptyCompensationDraft,
  type CompensationDraft,
} from '../src/intent';

/**
 * The gap between what a pay field holds while it is being typed and what
 * is allowed to be saved.
 *
 * Two defects came out of not having this. The form held a
 * `CompensationRange`, so an empty box had to be written as 0, and that
 * made clearing a box indistinguishable from leaving it alone: an employer
 * who deleted both figures and pressed save still had the old range
 * stored, under a hint that promised the opposite. The same shortcut let a
 * half finished range through, where one end was the figure somebody typed
 * and the other was a zero nobody meant, which on a role reads as work
 * that pays nothing.
 *
 * Every case below fails against that earlier shape, which is the only
 * reason this file is worth its length.
 */
describe('compensationFromDraft', () => {
  const draft = (over: Partial<CompensationDraft> = {}): CompensationDraft => ({
    ...emptyCompensationDraft(),
    ...over,
  });

  it('treats both ends empty as nothing stated rather than a problem', () => {
    const result = compensationFromDraft(draft());
    expect(result.range).toBeUndefined();
    expect(result.problem).toBeUndefined();
  });

  it('returns the range when both ends are filled in', () => {
    const result = compensationFromDraft(draft({ minNGN: 700000, maxNGN: 1100000 }));
    expect(result.problem).toBeUndefined();
    expect(result.range).toEqual({ minNGN: 700000, maxNGN: 1100000, period: 'month' });
  });

  it('keeps the period the draft was edited with', () => {
    const result = compensationFromDraft(draft({ minNGN: 40000, maxNGN: 60000, period: 'day' }));
    expect(result.range?.period).toBe('day');
  });

  /**
   * The case that used to save a zero. One end alone is not a range, and
   * the answer is a reason rather than a figure invented to fill the gap.
   */
  it('refuses a bottom with no top, and never invents a zero', () => {
    const result = compensationFromDraft(draft({ minNGN: 700000 }));
    expect(result.range).toBeUndefined();
    expect(result.problem).toMatch(/top of the pay range/);
  });

  it('refuses a top with no bottom', () => {
    const result = compensationFromDraft(draft({ maxNGN: 1100000 }));
    expect(result.range).toBeUndefined();
    expect(result.problem).toMatch(/bottom of the pay range/);
  });

  /** The schema owns this rule; the form must not contradict it. */
  it('refuses an inverted range with the schema own wording', () => {
    const result = compensationFromDraft(draft({ minNGN: 900000, maxNGN: 400000 }));
    expect(result.range).toBeUndefined();
    expect(result.problem).toBe('The top of the range cannot be below the bottom of it.');
  });

  it('refuses a zero typed by hand, the same as an empty box refuses to become one', () => {
    const result = compensationFromDraft(draft({ minNGN: 0, maxNGN: 0 }));
    expect(result.range).toBeUndefined();
    expect(result.problem).toBeUndefined();
  });

  it('round-trips a stored range through the editor and back unchanged', () => {
    const stored = { minNGN: 250000, maxNGN: 400000, period: 'year' } as const;
    expect(compensationFromDraft(draftFromRange(stored)).range).toEqual(stored);
  });

  /**
   * Withdrawal, which is the behaviour the old code could not express at
   * all: a draft opened from a stored range and then emptied must resolve
   * to no range, so the caller writes an absence rather than the figures
   * it started with.
   */
  it('resolves to no range once a stored range is emptied', () => {
    const opened = draftFromRange({ minNGN: 700000, maxNGN: 1100000, period: 'month' });
    const emptied: CompensationDraft = { ...opened, minNGN: undefined, maxNGN: undefined };
    const result = compensationFromDraft(emptied);
    expect(result.range).toBeUndefined();
    expect(result.problem).toBeUndefined();
  });

  it('opens a blank draft when nothing is stored', () => {
    expect(draftFromRange(undefined)).toEqual({
      minNGN: undefined,
      maxNGN: undefined,
      period: 'month',
    });
  });
});
