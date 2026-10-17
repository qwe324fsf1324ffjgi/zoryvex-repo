import { KIT_PRICE_NGN } from '@zoryvex/contracts';
import type { Checkout } from '../interfaces/payments';

const now = '2026-08-03T00:00:00.000Z';

/** One fixed fixture per payment state, so every state has a demoable example. */
export const CHECKOUTS: Checkout[] = [
  {
    id: 'chk_pending_demo',
    employerId: 'emp_delta',
    kind: 'kit',
    roleId: 'role_sre',
    amountNGN: KIT_PRICE_NGN,
    status: 'pending',
    createdAt: now,
  },
  {
    id: 'chk_succeeded_demo',
    employerId: 'emp_northwind',
    kind: 'kit',
    roleId: 'role_platform_lead',
    amountNGN: KIT_PRICE_NGN,
    status: 'succeeded',
    createdAt: now,
  },
  {
    id: 'chk_failed_demo',
    employerId: 'emp_delta',
    kind: 'scout',
    amountNGN: 79000,
    status: 'failed',
    createdAt: now,
  },
  {
    id: 'chk_refunded_demo',
    employerId: 'emp_atlas',
    kind: 'kit',
    roleId: 'role_secops',
    // Deliberately the old price, not KIT_PRICE_NGN. A refund is by
    // definition historical, and this fixture is what proves the billing
    // history renders the amount an order was charged rather than whatever
    // the Kit costs today — the exact thing `amountNGN: z.literal(29000)`
    // used to make impossible to represent.
    amountNGN: 29_000,
    status: 'refunded',
    createdAt: now,
  },
];
