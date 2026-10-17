import { toHttpResponse } from '../../src/adapter/http';
import {
  requireFounderStepUp,
  requireSessionContext,
  type AuthorizedEvent,
} from '../../src/http/session-context';
import { ValidationError } from '../../src/errors/typed-errors';
import { getBillingDiagnostic } from '../../src/domain/billing-diagnostic-service';
import { SystemClock } from '../../src/repositories/clock-repository';
import { getEntitlement } from '../../src/repositories/employer-repository';
import {
  getBillingSubscription,
  listBillingInvoices,
  listPaymentAttempts,
} from '../../src/repositories/billing-repository';

const deps = {
  clock: new SystemClock(),
  getEntitlement,
  getBillingSubscription,
  listBillingInvoices,
  listPaymentAttempts,
};

/**
 * One organization's complete billing timeline, for the founder.
 *
 * `founder_admin` and a recent WebAuthn step-up, the same gate as the
 * exception queue — this reads another organization's payment history,
 * which is the most sensitive non-candidate data in the system, and a
 * long-lived session cookie is not a strong enough claim to it.
 *
 * The employer id is a query parameter rather than a path segment so the
 * route stays a single, obviously-admin URL rather than looking like part
 * of the employer-facing API surface.
 */
export const handler = async (event: AuthorizedEvent) =>
  toHttpResponse(async () => {
    const session = requireSessionContext(event);
    requireFounderStepUp(session, new Date());

    const employerId = event.queryStringParameters?.employerId;
    if (!employerId) throw new ValidationError('employerId is required');

    return getBillingDiagnostic(employerId, deps);
  });
