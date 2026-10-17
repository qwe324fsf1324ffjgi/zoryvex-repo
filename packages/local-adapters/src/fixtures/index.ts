import type { DataAdapter } from '../interfaces/data';
import { getJSON, setJSON } from '../local/storage';
import { ALL_CANDIDATES } from './candidates';
import { CHECKOUTS } from './checkouts';
import { EMPLOYERS, ENTITLEMENTS } from './employers';
import { EVIDENCE } from './evidence';
import { KIT_ORDERS } from './kitOrders';
import { MATCHES } from './matches';
import { ROLES } from './roles';

export { AUTH_ACCOUNTS } from './users';
export {
  ALL_CANDIDATES,
  AWS_CLOUD_CANDIDATES,
  DEVOPS_PLATFORM_CANDIDATES,
  CLOUD_SECURITY_CANDIDATES,
} from './candidates';
export { EMPLOYERS, ENTITLEMENTS } from './employers';
export { ROLES } from './roles';
export { MATCHES } from './matches';
export { EVIDENCE } from './evidence';
export { CHECKOUTS } from './checkouts';
export { KIT_ORDERS } from './kitOrders';

const SEED_MARKER_KEY = 'SEED#VERSION';
const SEED_VERSION = 3;

const checkoutKey = (id: string) => `CHECKOUT#${id}`;

/** Idempotent: safe to call on every app load, only writes once per SEED_VERSION. */
export function seedIfNeeded(data: DataAdapter): void {
  if (getJSON<number>(SEED_MARKER_KEY) === SEED_VERSION) return;

  for (const candidate of ALL_CANDIDATES) data.upsertCandidate(candidate);
  for (const evidence of EVIDENCE) data.upsertEvidence(evidence);
  for (const employer of EMPLOYERS) data.upsertEmployer(employer);
  for (const entitlement of ENTITLEMENTS) data.upsertEntitlement(entitlement);
  for (const role of ROLES) data.upsertRole(role);
  for (const match of MATCHES) data.upsertMatch(match);
  for (const checkout of CHECKOUTS) setJSON(checkoutKey(checkout.id), checkout);
  for (const order of KIT_ORDERS) data.upsertKitOrder(order);

  setJSON(SEED_MARKER_KEY, SEED_VERSION);
}
