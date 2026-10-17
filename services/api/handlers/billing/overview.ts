import { OFFERED_BILLING_INTERVALS, SUBSCRIPTION_PLANS } from '@zoryvex/contracts';
import { toHttpResponse } from '../../src/adapter/http';
import { requireSessionContext, type AuthorizedEvent } from '../../src/http/session-context';
import { ForbiddenError } from '../../src/errors/typed-errors';
import {
  getBillingOverview,
  listPaymentHistory,
  quoteSubscription,
} from '../../src/domain/subscription-service';
import { createAwsSubscriptionDependencies } from '../../src/composition/aws-billing-dependencies';

const deps = createAwsSubscriptionDependencies();

/**
 * Everything the billing page renders, in one request: the subscription,
 * the derived access state, the payment history, and a live quote per plan.
 *
 * The quotes come from here rather than from a price table in the browser
 * for the same reason the checkout re-quotes before charging. Whether this
 * organization gets the founding price depends on a global count only the
 * server can read, and a page that decided it locally would eventually
 * show one price and charge another.
 */
export const handler = async (event: AuthorizedEvent) =>
  toHttpResponse(async () => {
    const session = requireSessionContext(event);
    if (session.role !== 'employer_admin' || !session.employerId) {
      throw new ForbiddenError('employer_admin only');
    }
    const employerId = session.employerId;
    const interval = OFFERED_BILLING_INTERVALS[0] ?? 'monthly';

    const [overview, history, quotes] = await Promise.all([
      getBillingOverview(employerId, deps),
      listPaymentHistory(employerId, deps),
      Promise.all(
        SUBSCRIPTION_PLANS.map((plan) => quoteSubscription(employerId, plan, interval, deps)),
      ),
    ]);

    return {
      overview,
      history,
      // `planCode` is deliberately dropped, and it is the only one. It is
      // Paystack configuration identifying our integration's own objects,
      // and a browser has no use for it; `available` is the same fact in
      // the form the page actually needs.
      //
      // Everything else the quote carries has to be listed here. This is a
      // hand-written subset, which is the shape of mistake that has now
      // cost this codebase six fields across five files, and it cost one
      // here too: `marketplaceCandidates` was computed, typed, documented
      // as belonging in front of the buyer before they pay, and then left
      // out of this object. The billing page rendered "Your strongest role
      // currently matches undefined candidates" to an employer deciding
      // whether to spend NGN 800,000 a month. Nothing threw, because the
      // field is only read in a template string.
      quotes: quotes.map((quote) => ({
        plan: quote.plan,
        interval: quote.interval,
        priceTier: quote.priceTier,
        amountNGN: quote.amountNGN,
        foundingPlacesLeft: quote.foundingPlacesLeft,
        marketplaceCandidates: quote.marketplaceCandidates,
        available: quote.planCode !== null,
      })),
    };
  });
