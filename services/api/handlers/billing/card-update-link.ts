import { toHttpResponse } from '../../src/adapter/http';
import { requireSessionContext, type AuthorizedEvent } from '../../src/http/session-context';
import { ForbiddenError } from '../../src/errors/typed-errors';
import { getCardUpdateLink } from '../../src/domain/subscription-service';
import { createAwsSubscriptionDependencies } from '../../src/composition/aws-billing-dependencies';

const deps = createAwsSubscriptionDependencies();

/**
 * A short-lived link to Paystack's own hosted page for replacing the card
 * on a subscription.
 *
 * This is the whole card-update story, deliberately. No card number,
 * expiry or security code is ever collected by, posted to, or logged in
 * this product, so there is nothing here to intercept and nothing for the
 * founder to be liable for. Paystack's link expires, which is why one is
 * generated per request rather than stored.
 */
export const handler = async (event: AuthorizedEvent) =>
  toHttpResponse(async () => {
    const session = requireSessionContext(event);
    if (session.role !== 'employer_admin' || !session.employerId) {
      throw new ForbiddenError('employer_admin only');
    }
    return { link: await getCardUpdateLink(session.employerId, deps) };
  });
