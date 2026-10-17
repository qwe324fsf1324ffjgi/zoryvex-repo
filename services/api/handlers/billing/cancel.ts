import { toHttpResponse } from '../../src/adapter/http';
import { requireSessionContext, type AuthorizedEvent } from '../../src/http/session-context';
import { ForbiddenError } from '../../src/errors/typed-errors';
import { cancelSubscription } from '../../src/domain/subscription-service';
import { createAwsSubscriptionDependencies } from '../../src/composition/aws-billing-dependencies';

const deps = createAwsSubscriptionDependencies();

/**
 * Cancels the organization's subscription.
 *
 * Paystack is called first and the local record is updated only once it
 * confirms, so the two systems can never disagree in the direction that
 * matters: an employer told they have cancelled while the charges carry
 * on.
 *
 * The response returns the date access actually runs to. Paystack's
 * disable is not an immediate termination, so a bare "cancelled" would be
 * both incomplete and the sentence that generates the support email.
 */
export const handler = async (event: AuthorizedEvent) =>
  toHttpResponse(async () => {
    const session = requireSessionContext(event);
    if (session.role !== 'employer_admin' || !session.employerId) {
      throw new ForbiddenError('employer_admin only');
    }
    const subscription = await cancelSubscription(session.employerId, deps);
    return {
      status: subscription.status,
      accessEndsAt: subscription.currentPeriodEnd ?? subscription.nextPaymentDate,
      cancelRequestedAt: subscription.cancelRequestedAt,
    };
  });
