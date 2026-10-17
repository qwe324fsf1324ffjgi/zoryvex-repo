import { describe, expect, it } from 'vitest';
import type { AuditEvent } from '@zoryvex/contracts';
import { getExceptionQueue, sortNeedsAHumanFirst } from '../src/domain/admin-service';

function auditEvent(id: string): AuditEvent {
  return {
    id,
    actorId: 'system',
    actorRole: 'admin',
    action: 'evidence_file_rejected',
    targetType: 'evidence_file',
    targetId: 'file_1',
    createdAt: '2026-08-19T00:00:00.000Z',
  };
}

describe('getExceptionQueue', () => {
  it('returns every audit event the repository gave it, filtering nothing out', async () => {
    // Nothing is dropped: every audit event is something a human is meant to
    // be able to explain. What changed is the order, not the contents.
    const events = [auditEvent('a2'), auditEvent('a1')];
    const result = await getExceptionQueue({ listRecentAuditEvents: async () => events });
    expect(result).toHaveLength(2);
    expect(result.map((event) => event.id).sort()).toEqual(['a1', 'a2']);
  });

  it('lists anything carrying a reason before the routine events', async () => {
    const flagged: AuditEvent = {
      ...auditEvent('needs-a-human'),
      action: 'contact_unlock_notice_failed',
      createdAt: '2026-08-18T00:00:00.000Z',
      reason: 'The candidate was not told their contact was shared.',
    };
    const result = await getExceptionQueue({
      listRecentAuditEvents: async () => [auditEvent('routine'), flagged],
    });
    expect(result[0]?.id).toBe('needs-a-human');
  });

  it('passes a custom limit through to the repository call', async () => {
    let requestedLimit: number | undefined;
    await getExceptionQueue(
      {
        async listRecentAuditEvents(limit) {
          requestedLimit = limit;
          return [];
        },
      },
      10,
    );
    expect(requestedLimit).toBe(10);
  });

  it('defaults to a limit of 50 when none is given', async () => {
    let requestedLimit: number | undefined;
    await getExceptionQueue({
      async listRecentAuditEvents(limit) {
        requestedLimit = limit;
        return [];
      },
    });
    expect(requestedLimit).toBe(50);
  });
});

describe('sortNeedsAHumanFirst', () => {
  const event = (id: string, createdAt: string, reason?: string): AuditEvent => ({
    id,
    actorId: 'emp_1',
    actorRole: 'employer',
    action: 'contact_unlock',
    targetType: 'match',
    targetId: 'cand_1',
    createdAt,
    ...(reason === undefined ? {} : { reason }),
  });

  it('puts events that carry a reason first', () => {
    // `reason` is only set by something that went wrong and needs a person.
    // Ordering by recency alone let a busy hour of ordinary unlocks push the
    // one line that needed action to the bottom of the page.
    const events = [
      event('a', '2026-08-31T10:00:00.000Z'),
      event('b', '2026-08-31T09:00:00.000Z', 'The candidate was not told.'),
      event('c', '2026-08-31T11:00:00.000Z'),
    ];
    expect(sortNeedsAHumanFirst(events).map((e) => e.id)).toEqual(['b', 'c', 'a']);
  });

  it('keeps each group newest first', () => {
    const events = [
      event('old-flagged', '2026-08-30T10:00:00.000Z', 'x'),
      event('new-flagged', '2026-08-31T10:00:00.000Z', 'y'),
      event('routine', '2026-08-31T12:00:00.000Z'),
    ];
    expect(sortNeedsAHumanFirst(events).map((e) => e.id)).toEqual([
      'new-flagged',
      'old-flagged',
      'routine',
    ]);
  });

  it('breaks ties on id so the order holds between reads', () => {
    const events = [event('b', '2026-08-31T10:00:00.000Z'), event('a', '2026-08-31T10:00:00.000Z')];
    expect(sortNeedsAHumanFirst(events).map((e) => e.id)).toEqual(['a', 'b']);
  });

  it('does not mutate the array it was given', () => {
    const events = [event('a', '2026-08-30T10:00:00.000Z'), event('b', '2026-08-31T10:00:00.000Z')];
    sortNeedsAHumanFirst(events);
    expect(events.map((e) => e.id)).toEqual(['a', 'b']);
  });
});
