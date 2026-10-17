import { GetParameterCommand, ParameterNotFound, SSMClient } from '@aws-sdk/client-ssm';
import {
  PlanCodeRegistrySchema,
  planKey,
  type BillingInterval,
  type PlanCodeRegistry,
  type PriceTier,
  type SubscriptionPlan,
} from '@zoryvex/contracts';

const ssm = new SSMClient({});

/**
 * Which Paystack Plan each of our plan keys maps to, read from
 * `/zoryvex/<env>/paystack/plan-codes`.
 *
 * Configuration rather than code for one reason that is not negotiable:
 * the plan codes in Paystack test mode and the plan codes in live mode are
 * different strings for the same product. A code committed to this
 * repository would be a live/test mix-up waiting for the switchover, and
 * the failure mode of that mix-up is charging a real customer against a
 * test plan or the reverse.
 *
 * A plain String parameter, not a SecureString: a plan code is not a
 * secret, it appears in Paystack's own dashboard, and it is not usable
 * without the secret key. Same treatment as the feature flags.
 *
 * Deliberately not cached. A plan code is added by the founder in the
 * Paystack dashboard and then written here, and a warm Lambda serving the
 * previous (empty) registry for the rest of its life would make that
 * change look like it had not worked.
 */
export async function getPlanCodeRegistry(): Promise<PlanCodeRegistry> {
  const paramName = process.env.PAYSTACK_PLAN_CODES_PARAM;
  if (!paramName) return {};

  try {
    const result = await ssm.send(new GetParameterCommand({ Name: paramName }));
    const raw = result.Parameter?.Value;
    if (!raw) return {};
    const parsed = PlanCodeRegistrySchema.safeParse(JSON.parse(raw));
    // An unparseable registry fails to empty, which makes every checkout
    // refuse with "this plan is not configured". That is the right
    // direction: the alternative to refusing is guessing a plan code, and
    // a guessed plan code bills the wrong amount on a recurring schedule.
    return parsed.success ? parsed.data : {};
  } catch (error) {
    if (error instanceof ParameterNotFound) return {};
    if (error instanceof SyntaxError) return {};
    throw error;
  }
}

/**
 * The plan code for one (tier, price tier, interval), or null when the
 * founder has not created that Paystack Plan yet.
 *
 * Null rather than a throw, so the caller can tell the employer something
 * true ("this plan is not open yet") instead of surfacing a 500 for a
 * configuration state that is expected before launch.
 */
export function planCodeFor(
  registry: PlanCodeRegistry,
  plan: SubscriptionPlan,
  priceTier: PriceTier,
  interval: BillingInterval,
): string | null {
  return registry[planKey(plan, priceTier, interval)] ?? null;
}
