import { z } from 'zod';
import { BillingIntervalSchema, SUBSCRIPTION_PLANS } from '@zoryvex/contracts';
import { toHttpResponse } from '../../src/adapter/http';
import { requireSessionContext, type AuthorizedEvent } from '../../src/http/session-context';
import { ForbiddenError, ValidationError } from '../../src/errors/typed-errors';
import { startSubscriptionCheckout } from '../../src/domain/subscription-service';
import { createAwsSubscriptionDependencies } from '../../src/composition/aws-billing-dependencies';

const deps = createAwsSubscriptionDependencies();

const BodySchema = z.object({
  plan: z.enum(SUBSCRIPTION_PLANS),
  // Defaulted rather than required, so a client written before the
  // interval existed keeps working and gets the only interval on sale.
  interval: BillingIntervalSchema.default('monthly'),
});

/**
 * Starts a subscription checkout. `employer_admin` only: it is the action
 * that commits the organization to a recurring charge.
 *
 * The Idempotency-Key header is required, not optional. Without it a
 * double click, a refresh of a slow page, or a client retry after a
 * dropped connection each start a separate checkout, and a buyer who
 * completes two of them is charged twice with two subscriptions running.
 *
 * The response carries a redirect URL and says nothing about entitlement.
 * Access is granted by the webhook or by reconciliation, never by this
 * call and never by whatever the browser reports on its way back.
 */
export const handler = async (event: AuthorizedEvent) =>
  toHttpResponse(async () => {
    const session = requireSessionContext(event);
    if (session.role !== 'employer_admin' || !session.employerId) {
      throw new ForbiddenError('employer_admin only');
    }

    const idempotencyKey = event.headers['idempotency-key'];
    if (!idempotencyKey) throw new ValidationError('Idempotency-Key header is required');

    let body: unknown;
    try {
      body = JSON.parse(event.body ?? '{}');
    } catch {
      throw new ValidationError('Request body is not valid JSON');
    }

    const parsed = BodySchema.safeParse(body);
    if (!parsed.success) throw new ValidationError('plan must be scout, team or partner');

    const result = await startSubscriptionCheckout(
      session.employerId,
      parsed.data.plan,
      parsed.data.interval,
      idempotencyKey,
      deps,
    );

    return {
      authorizationUrl: result.authorizationUrl,
      reference: result.attempt.reference,
      amountNGN: result.attempt.amountNGN,
      created: result.created,
    };
  });
