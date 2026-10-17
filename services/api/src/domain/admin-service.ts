import type { AuditEvent } from '@zoryvex/contracts';

export interface AdminDependencies {
  listRecentAuditEvents(limit?: number): Promise<AuditEvent[]>;
}

const DEFAULT_LIMIT = 50;

/**
 * The founder's "exception queue" (CLAUDE.md: "an exception queue, not a
 * daily ops dashboard — never promise zero moderation/legal work").
 * Deliberately just the recent audit-event stream (docs/DATA_MODEL.md
 * access pattern #27, built in slice 2 with exactly this endpoint already
 * named in its own comment) rather than a curated allow-list of "exception"
 * action types — every audit event is already something a human is meant
 * to be able to explain, so surfacing all of them (newest first, bounded)
 * is the honest minimal version of this feature, not a stub.
 */
export async function getExceptionQueue(
  deps: AdminDependencies,
  limit = DEFAULT_LIMIT,
): Promise<AuditEvent[]> {
  const events = await deps.listRecentAuditEvents(limit);
  return sortNeedsAHumanFirst(events);
}

/**
 * Events that carry a `reason` first, newest within each group.
 *
 * `reason` is only ever set by something that went wrong and needs a person:
 * a rejected evidence file, or a candidate who was not told their contact had
 * been shared. Everything else — an unlock, a consent change — is a normal
 * event that happens to be worth recording. Ordering by recency alone let a
 * busy hour of ordinary unlocks push the one line that needed action to the
 * bottom of the page.
 *
 * This orders within the window; it does not widen it. The queue is still the
 * most recent `limit` events and a flagged event older than those is not in
 * the list at all, which is why the page says it is a recent stream rather
 * than a complete list of outstanding items. Making that guarantee real needs
 * an index of its own, and inventing one quietly here would be worse than
 * saying so.
 */
export function sortNeedsAHumanFirst(events: AuditEvent[]): AuditEvent[] {
  const needsAHuman = (event: AuditEvent) => (event.reason ? 0 : 1);
  return [...events].sort(
    (a, b) =>
      needsAHuman(a) - needsAHuman(b) ||
      Date.parse(b.createdAt) - Date.parse(a.createdAt) ||
      a.id.localeCompare(b.id),
  );
}
