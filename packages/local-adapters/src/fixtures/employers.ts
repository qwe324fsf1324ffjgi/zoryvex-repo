import type { Employer, Entitlement } from '@zoryvex/contracts';

/** FICTIONAL TEST DATA — invented organizations, not real employers. */

const now = '2026-08-01T00:00:00.000Z';

export const EMPLOYERS: Employer[] = [
  {
    id: 'emp_northwind',
    organizationName: 'Northwind Cloud Ltd (fictional test employer)',
    contactEmail: 'hiring.demo@example.com',
    createdAt: now,
  },
  {
    id: 'emp_delta',
    organizationName: 'Delta Systems (fictional test employer)',
    contactEmail: 'talent.demo@example.com',
    createdAt: now,
  },
  {
    id: 'emp_atlas',
    organizationName: 'Atlas Security Partners (fictional test employer)',
    contactEmail: 'people.demo@example.com',
    createdAt: now,
  },
];

export const ENTITLEMENTS: Entitlement[] = [
  {
    // The Kit is per-role, tracked as its own KitOrder (see kitOrders.ts) —
    // not a subscription entitlement. Northwind has bought a Kit but has
    // no ongoing marketplace subscription.
    employerId: 'emp_northwind',
    plan: 'none',
    status: 'none',
    kitPurchasedAt: null,
    subscriptionRenewsAt: null,
    priceNGN: null,
    foundingMember: false,
  },
  {
    employerId: 'emp_delta',
    plan: 'none',
    status: 'none',
    kitPurchasedAt: null,
    subscriptionRenewsAt: null,
    priceNGN: null,
    foundingMember: false,
  },
  {
    // Atlas took a founding place, so it is billed at the founding Scout
    // price and keeps it for the life of this subscription even after the
    // standard price applies to everyone else. Written out rather than
    // computed, because a fixture that recomputes its own price cannot show
    // a member holding a price the current rules would not give them.
    employerId: 'emp_atlas',
    plan: 'scout',
    status: 'active',
    kitPurchasedAt: null,
    subscriptionRenewsAt: '2026-09-01T00:00:00.000Z',
    priceNGN: 79_000,
    foundingMember: true,
  },
];
