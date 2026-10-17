import { KIT_PRICE_NGN, type KitOrder } from '@zoryvex/contracts';

const now = '2026-08-03T00:00:00.000Z';

/**
 * One fixed fixture per Kit order state, keyed by role (the Kit is a
 * one-time, per-role purchase — never a subscription).
 */
export const KIT_ORDERS: KitOrder[] = [
  {
    id: 'kit_role_platform_lead',
    employerId: 'emp_northwind',
    roleId: 'role_platform_lead',
    amountNGN: KIT_PRICE_NGN,
    checkoutUrl: null,
    status: 'succeeded',
    paystackReference: 'chk_succeeded_demo',
    createdAt: now,
  },
  {
    id: 'kit_role_sre',
    employerId: 'emp_delta',
    roleId: 'role_sre',
    amountNGN: KIT_PRICE_NGN,
    checkoutUrl: null,
    status: 'pending',
    paystackReference: 'chk_pending_demo',
    createdAt: now,
  },
];
