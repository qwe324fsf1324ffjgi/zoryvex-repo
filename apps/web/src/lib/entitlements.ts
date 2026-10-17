import type { DataAdapter } from '@zoryvex/local-adapters';

// Single source of truth lives in @zoryvex/contracts so the real
// services/api unlock transaction can never silently drift from this
// local-adapter-driven UI.
export { CONTACT_UNLOCK_ALLOWANCE } from '@zoryvex/contracts';

/**
 * Sums contact-unlocked matches across every one of the employer's roles.
 * Composed from already-indexed queries (listRolesByEmployer,
 * listMatchesForRole) — not a scan.
 *
 * Known and accepted demo-only limitation: this is an all-time count, not a
 * per-period one, because a local-fake `Match` carries no unlock timestamp
 * to filter on. The REAL allowance is genuinely monthly, enforced server-side
 * by a period-keyed ledger (match-repository.ts's `ledgerKey`). Do not read
 * this demo counter as evidence of how the real billing period behaves; it
 * exists to make the local walkthrough's "x / y used" label move.
 */
export function countContactUnlocksUsed(data: DataAdapter, employerId: string): number {
  const roles = data.listRolesByEmployer(employerId);
  return roles.reduce(
    (total, role) =>
      total + data.listMatchesForRole(role.id).filter((m) => m.contactUnlocked).length,
    0,
  );
}
