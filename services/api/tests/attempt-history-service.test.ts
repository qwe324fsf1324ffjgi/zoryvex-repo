import { describe, expect, it } from 'vitest';
import type { GradedAttempt, GradedAttemptRecord } from '@zoryvex/contracts';
import {
  describeAttempts,
  numberInOrder,
  summariseAttempts,
} from '../src/domain/attempt-history-service';

const attempt = (over: Partial<GradedAttempt> = {}): GradedAttempt => ({
  evidenceId: 'ev_1',
  taskId: 'task_least_privilege_role_v1',
  attemptNumber: 1,
  passed: false,
  failedCheckIds: [],
  disqualified: false,
  at: '2026-09-01T10:00:00.000Z',
  ...over,
});

describe('what the history says', () => {
  it('separates passing first time from passing eventually', () => {
    const clean = summariseAttempts([attempt({ passed: true })]);
    expect(clean.passedFirstTime).toBe(true);

    const eventual = summariseAttempts([
      attempt({ attemptNumber: 1, failedCheckIds: ['no_wildcard_action'] }),
      attempt({ attemptNumber: 2, passed: true }),
    ]);
    expect(eventual.passedFirstTime).toBe(false);
  });

  /**
   * The distinction this whole record exists for. A single pass or fail
   * cannot separate "correct result and good engineering" from "correct
   * result after being told about a wildcard permission", and until now an
   * employer saw the same green tick for both.
   */
  it('names what earlier attempts missed', () => {
    const history = summariseAttempts([
      attempt({ attemptNumber: 1, failedCheckIds: ['no_wildcard_action', 'scoped_resources'] }),
      attempt({ attemptNumber: 2, failedCheckIds: ['scoped_resources'] }),
      attempt({ attemptNumber: 3, passed: true }),
    ]);
    const line = describeAttempts(history);
    expect(line).toContain('attempt 3 of 3');
    expect(line).toContain('no_wildcard_action');
    expect(line).toContain('scoped_resources');
  });

  it('does not repeat a check that failed more than once', () => {
    const history = summariseAttempts([
      attempt({ attemptNumber: 1, failedCheckIds: ['encryption'] }),
      attempt({ attemptNumber: 2, failedCheckIds: ['encryption'] }),
      attempt({ attemptNumber: 3, passed: true }),
    ]);
    const line = describeAttempts(history);
    expect(line.match(/encryption/g)).toHaveLength(1);
  });

  it('orders by attempt number whatever order they arrive in', () => {
    const history = summariseAttempts([
      attempt({ attemptNumber: 3, passed: true }),
      attempt({ attemptNumber: 1, failedCheckIds: ['a'] }),
      attempt({ attemptNumber: 2, failedCheckIds: ['b'] }),
    ]);
    expect(history.attempts.map((a) => a.attemptNumber)).toEqual([1, 2, 3]);
    expect(history.passedFirstTime).toBe(false);
  });

  /**
   * Surfaced even when a later attempt passed. "Wrote a credential into the
   * configuration, then removed it" is something an employer may reasonably
   * want to know, and hiding it behind an eventual pass chooses for them.
   */
  it('reports a disqualifying attempt even after a later pass', () => {
    const history = summariseAttempts([
      attempt({ attemptNumber: 1, disqualified: true, failedCheckIds: ['no_hardcoded_secret'] }),
      attempt({ attemptNumber: 2, passed: true }),
    ]);
    expect(history.everDisqualified).toBe(true);
    expect(describeAttempts(history)).toContain('disqualifying check');
  });

  it('says plainly when nothing has passed yet', () => {
    const history = summariseAttempts([
      attempt({ attemptNumber: 1, failedCheckIds: ['x'] }),
      attempt({ attemptNumber: 2, failedCheckIds: ['x'] }),
    ]);
    expect(describeAttempts(history)).toContain('none passing yet');
  });

  it('handles no attempts without inventing one', () => {
    const history = summariseAttempts([]);
    expect(history.attempts).toEqual([]);
    expect(history.passedFirstTime).toBe(false);
    expect(describeAttempts(history)).toBe('No graded attempt recorded.');
  });
});

describe('numbering', () => {
  const record = (at: string, over: Partial<GradedAttempt> = {}): GradedAttemptRecord => {
    const full = attempt({ at, ...over });
    return {
      evidenceId: full.evidenceId,
      taskId: full.taskId,
      passed: full.passed,
      failedCheckIds: full.failedCheckIds,
      disqualified: full.disqualified,
      at: full.at,
    };
  };

  it('numbers by when they happened, not by the order they were read', () => {
    const numbered = numberInOrder([
      record('2026-09-01T12:00:00.000Z', { passed: true }),
      record('2026-09-01T10:00:00.000Z', { failedCheckIds: ['a'] }),
      record('2026-09-01T11:00:00.000Z', { failedCheckIds: ['b'] }),
    ]);
    expect(numbered.map((a) => a.attemptNumber)).toEqual([1, 2, 3]);
    expect(numbered.map((a) => a.at)).toEqual([
      '2026-09-01T10:00:00.000Z',
      '2026-09-01T11:00:00.000Z',
      '2026-09-01T12:00:00.000Z',
    ]);
  });

  /**
   * The reason the number is derived rather than stored. Two submissions
   * landing together would otherwise each read the same count and each write
   * themselves the same number; derived, the sequence cannot duplicate one or
   * leave a gap however the rows arrive.
   */
  it('cannot produce a duplicate or a gap, even on identical timestamps', () => {
    const same = '2026-09-01T10:00:00.000Z';
    const numbered = numberInOrder([
      record(same, { failedCheckIds: ['a'] }),
      record(same, { failedCheckIds: ['b'] }),
      record(same, { passed: true }),
    ]);
    expect(numbered.map((a) => a.attemptNumber)).toEqual([1, 2, 3]);
    // Stable: rows sharing a timestamp keep the order the store returned them
    // in rather than being shuffled into an arbitrary one.
    expect(numbered.map((a) => a.failedCheckIds)).toEqual([['a'], ['b'], []]);
  });

  it('reads end to end as a history', () => {
    const history = summariseAttempts(
      numberInOrder([
        record('2026-09-01T12:00:00.000Z', { passed: true }),
        record('2026-09-01T10:00:00.000Z', { failedCheckIds: ['no_wildcard_action'] }),
      ]),
    );
    expect(history.passedFirstTime).toBe(false);
    expect(describeAttempts(history)).toContain('no_wildcard_action');
  });
});

describe('what it deliberately does not do', () => {
  /**
   * Three attempts is not worse than one. Good engineers get things wrong,
   * are told, and fix them; a product that framed that as a failing would be
   * teaching people to submit once and guess, which is worse evidence and
   * worse engineering.
   */
  it('scores nothing and judges nothing', () => {
    const history = summariseAttempts([
      attempt({ attemptNumber: 1, failedCheckIds: ['a'] }),
      attempt({ attemptNumber: 2, passed: true }),
    ]);
    expect(history).not.toHaveProperty('score');
    expect(history).not.toHaveProperty('rating');
    const line = describeAttempts(history);
    for (const judgement of ['poor', 'weak', 'struggled', 'only', 'failed to']) {
      expect(line.toLowerCase(), `history reads as a judgement: ${judgement}`).not.toContain(
        judgement,
      );
    }
  });

  /**
   * The naming rule, asserted so it cannot drift. This is the sequence of
   * checkpoints, not a record of how somebody worked, and calling it process
   * observation would be the overclaim the strength model exists to prevent.
   */
  it('never describes itself as process observation', () => {
    const line = describeAttempts(summariseAttempts([attempt({ attemptNumber: 1, passed: true })]));
    expect(line.toLowerCase()).not.toContain('process');
    expect(line.toLowerCase()).not.toContain('observed');
  });

  it('never carries the submission itself', () => {
    // The candidate's work can contain anything they pasted into it, and
    // keeping it would create a store of other people's code with nobody
    // accountable for what is in it. Which checks failed is the whole signal.
    const history = summariseAttempts([attempt({ passed: true })]);
    expect(JSON.stringify(history)).not.toContain('resource "aws');
    for (const a of history.attempts) {
      expect(a).not.toHaveProperty('submission');
    }
  });
});
