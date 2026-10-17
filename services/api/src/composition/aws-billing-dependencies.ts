import { randomUUID } from 'node:crypto';
import { FOUNDING_SLOTS_TOTAL, type PaymentAttempt } from '@zoryvex/contracts';
import { SystemClock } from '../repositories/clock-repository';
import { getFeatureFlags } from '../repositories/feature-flags-repository';
import { appendAuditEvent } from '../repositories/audit-event-repository';
import { publishAlert } from '../repositories/sns-repository';
import { getPaystackSecretKey } from '../repositories/ssm-secure-repository';
import { getPlanCodeRegistry } from '../repositories/plan-code-repository';
import { listRolesByEmployer } from '../repositories/role-repository';
import {
  contactUnlockPeriod,
  countContactUnlocksInPeriod,
  listMatchesForRole,
} from '../repositories/match-repository';
import {
  getEmployer,
  getEntitlement,
  updateEntitlement,
} from '../repositories/employer-repository';
import {
  countFoundingPlacesTaken,
  holdsFoundingPlace,
  recordFoundingPlaceTaken,
} from '../repositories/founding-places-repository';
import {
  createPaymentAttemptIfNotExists,
  setPaymentAttemptCheckoutUrl,
  findPaymentAttemptByReference,
  getBillingSubscription,
  getPaymentAttempt,
  listBillingInvoices,
  listOpenPaymentAttempts,
  listPaymentAttempts,
  putBillingCustomer,
  putBillingInvoice,
  putBillingSubscription,
  employerIdForCustomerCode,
  employerIdForSubscriptionCode,
  updateBillingSubscription,
  updatePaymentAttempt,
} from '../repositories/billing-repository';
import { getKitOrder, transitionKitOrderStatus } from '../repositories/kit-order-repository';
import { forgetWebhookEvent, recordWebhookEventOnce } from '../repositories/webhook-repository';
import {
  disablePaystackSubscription,
  fetchPaystackPlan,
  generateSubscriptionManageLink,
  initializePaystackTransaction,
  listPaystackTransactions,
  verifyPaystackTransaction,
} from '../lib/paystack-client';
import { requireEnv } from '../lib/require-env';
import { NotFoundError } from '../errors/typed-errors';
import { generateKitArtifact } from '../domain/kit-service';
import { createAwsKitDependencies } from './aws-kit-dependencies';
import type { SubscriptionDependencies } from '../domain/subscription-service';
import type { PaystackWebhookDependencies } from '../domain/paystack-webhook-service';
import type { ReconciliationDependencies } from '../domain/billing-reconciliation-service';
import { billingLog } from '../lib/billing-log';

/**
 * Wires the billing domain to AWS and to Paystack.
 *
 * Nothing in here makes a decision. Every rule about what a payment means,
 * what access it buys and when it lapses lives in the domain modules,
 * which take these as plain functions and are tested without AWS or
 * Paystack anywhere near them.
 */

async function employerEmail(employerId: string): Promise<string> {
  const employer = await getEmployer(employerId);
  if (!employer) throw new NotFoundError('Employer not found');
  return employer.contactEmail;
}

/**
 * The verify call, shaped for the domain.
 *
 * The secret key is read per call rather than cached: it is a
 * founder-replaced Parameter Store value, and a warm Lambda holding the
 * pre-replacement placeholder would fail every payment until it happened
 * to go cold.
 */
async function verifyTransaction(reference: string) {
  const secretKey = await getPaystackSecretKey();
  return verifyPaystackTransaction(reference, secretKey);
}

export function createAwsSubscriptionDependencies(): SubscriptionDependencies {
  return {
    clock: new SystemClock(),
    getFeatureFlags,
    getPlanCodeRegistry,
    getEmployerEmail: employerEmail,
    getEntitlement,
    updateEntitlement,
    countFoundingPlacesTaken,
    holdsFoundingPlace,
    /**
     * The best role's match count, not the first role that clears the bar.
     *
     * This used to stop at the first eligible role, which was cheaper and
     * was the right shape while the answer was a yes or no. The answer is a
     * number now, shown to the buyer before they pay, so an early exit would
     * report whichever role happened to be first rather than the strongest
     * one, and understate the product to the person deciding whether to buy
     * it.
     *
     * The cost is one query per role, run once at checkout rather than on
     * every page view. An organization with thirty roles pays thirty-one
     * queries once, which is a fair price for quoting them honestly.
     */
    async marketplaceCandidateCount(employerId: string) {
      const roles = await listRolesByEmployer(employerId);
      let best = 0;
      for (const role of roles) {
        const matches = await listMatchesForRole(role.id);
        if (matches.length > best) best = matches.length;
      }
      return best;
    },
    getBillingSubscription,
    countContactUnlocksThisPeriod: (employerId: string) =>
      countContactUnlocksInPeriod(employerId, contactUnlockPeriod(new Date())),
    updateBillingSubscription: (employerId, patch, expectedSubscriptionCode) =>
      updateBillingSubscription(
        employerId,
        patch,
        new Date().toISOString(),
        expectedSubscriptionCode,
      ),
    listPaymentAttempts,
    listBillingInvoices,
    createPaymentAttemptIfNotExists,
    setPaymentAttemptCheckoutUrl,
    getPaymentAttempt,
    async initializeTransaction(input) {
      const secretKey = await getPaystackSecretKey();
      return initializePaystackTransaction(
        {
          email: input.email,
          amountKobo: input.amountKobo,
          reference: input.reference,
          callbackUrl: input.callbackUrl,
          ...(input.planCode ? { planCode: input.planCode } : {}),
          ...(input.metadata ? { metadata: input.metadata } : {}),
        },
        secretKey,
        input.correlationId,
      );
    },
    // Reads the plan's real price so createSubscriptionCheckout can refuse
    // to open a checkout that would charge something other than the quote.
    async fetchPlan(planCode) {
      const secretKey = await getPaystackSecretKey();
      const summary = await fetchPaystackPlan(planCode, secretKey);
      return { amountKobo: summary.amountKobo, currency: summary.currency };
    },
    publishAlert,
    async disableSubscription(subscriptionCode, emailToken) {
      const secretKey = await getPaystackSecretKey();
      await disablePaystackSubscription(subscriptionCode, emailToken, secretKey);
    },
    async generateManageLink(subscriptionCode) {
      const secretKey = await getPaystackSecretKey();
      return generateSubscriptionManageLink(subscriptionCode, secretKey);
    },
    // A getter, so a route that never redirects a buyer does not fail to
    // start over a variable it has no use for.
    get appOrigin() {
      return requireEnv('APP_ORIGIN');
    },
  };
}

export function createAwsPaystackWebhookDependencies(): PaystackWebhookDependencies {
  const kitDeps = createAwsKitDependencies();
  return {
    clock: new SystemClock(),
    recordWebhookEventOnce,
    forgetWebhookEvent,

    getKitOrder,
    transitionKitOrderStatus,
    generateKitArtifact: (roleId: string) => generateKitArtifact(roleId, kitDeps),
    hasKitArtifact: async (roleId: string) => (await kitDeps.getLatestArtifact(roleId)) !== null,

    getPaymentAttempt,
    listPaymentAttempts,
    updatePaymentAttempt,

    employerIdForSubscriptionCode,
    employerIdForCustomerCode,
    getBillingSubscription,
    putBillingSubscription,
    updateBillingSubscription,
    putBillingInvoice,
    putBillingCustomer: (input) => putBillingCustomer(input),

    getPlanCodeRegistry,
    getEntitlement,
    updateEntitlement,
    async recordFoundingPlaceTaken(employerId: string) {
      const result = await recordFoundingPlaceTaken(employerId, FOUNDING_SLOTS_TOTAL);
      if (result.overCap) {
        // Reported rather than refused. The employer was quoted the
        // founding price and has already paid it; taking the status back
        // now would be worse than briefly having more founding members
        // than places, which can only happen by the number of checkouts
        // that were in flight when the last one went.
        await publishAlert(
          `Founding places are over the cap: ${result.count} of ${FOUNDING_SLOTS_TOTAL} are ` +
            'now held. Checkouts already quoted the founding price are honoured, so this is ' +
            'expected if several completed at once. No further founding quotes will be issued.',
        );
      }
    },

    appendAuditEvent,
    publishAlert,
    generateId: randomUUID,
    verifyTransaction,
  };
}

/**
 * Reconciliation reuses the webhook's own grant path rather than
 * reimplementing it.
 *
 * That reuse is the guarantee against double-granting: both routes end at
 * the same conditional writes, so whichever gets there second loses its
 * condition and stops.
 */
export function createAwsReconciliationDependencies(): ReconciliationDependencies {
  const webhookDeps = createAwsPaystackWebhookDependencies();

  return {
    clock: new SystemClock(),
    listOpenPaymentAttempts,
    updatePaymentAttempt,
    verifyTransaction,
    async listRemoteTransactions(input) {
      const secretKey = await getPaystackSecretKey();
      const transactions = await listPaystackTransactions(input, secretKey);
      return transactions.map((transaction) => ({
        reference: transaction.reference,
        status: transaction.status,
        amountKobo: transaction.amountKobo,
      }));
    },
    findPaymentAttemptByReference,
    async applyUnsuccessfulPayment(attempt: PaymentAttempt) {
      // A Kit order is written pending before Paystack is contacted, so
      // something has to close it when the payment does not happen.
      // Nothing did: the attempt settled and the order stayed pending,
      // leaving "Payment pending." on the role page of somebody whose
      // card had been declined. Conditional on it still being pending, so
      // this can never contradict a webhook that settled it first.
      if (attempt.purpose !== 'kit' || !attempt.roleId) return;
      await transitionKitOrderStatus(attempt.roleId, attempt.id, 'pending', 'failed');
    },
    async applySuccessfulPayment(attempt: PaymentAttempt) {
      // A Kit recovered here is the case that matters most: the employer
      // paid, the webhook never arrived, and without this they would have
      // nothing. The transition is conditional on the order still being
      // pending, which is the same guard the webhook uses, so the two
      // routes cannot both grant.
      if (attempt.purpose === 'kit') {
        if (!attempt.roleId) return;
        const granted = await transitionKitOrderStatus(
          attempt.roleId,
          attempt.id,
          'pending',
          'succeeded',
        );
        if (!granted) return;

        const entitlement = await getEntitlement(granted.employerId);
        await updateEntitlement(granted.employerId, {
          kitPurchasedAt: new Date().toISOString(),
          ...(!entitlement || entitlement.plan === 'none'
            ? { plan: 'kit' as const, status: 'active' as const }
            : {}),
        });
        await generateKitArtifact(attempt.roleId, createAwsKitDependencies());
        return;
      }

      // A subscription payment recovered here has already been marked
      // `success` by the caller. What is left is the entitlement, and the
      // subscription record itself — which only Paystack's
      // `subscription.create` carries the email token for, so a
      // reconciled-but-never-webhooked subscription is granted access and
      // flagged for a person rather than assembled from guesses.
      if (attempt.purpose !== 'subscription' || !attempt.plan) return;

      await updateEntitlement(attempt.employerId, {
        plan: attempt.plan,
        status: 'active',
        priceNGN: attempt.amountNGN,
        foundingMember: attempt.priceTier === 'founding',
      });

      const subscription = await getBillingSubscription(attempt.employerId);
      if (!subscription) {
        billingLog.warn('reconciled payment has no subscription record', {
          employerId: attempt.employerId,
          reference: attempt.reference,
        });
        await publishAlert(
          `Payment ${attempt.reference} was recovered by reconciliation and access granted, ` +
            'but no subscription record exists for it — the subscription.create webhook never ' +
            'arrived, so the cancellation token is missing. Fetch the subscription from the ' +
            'Paystack dashboard before this organization tries to cancel.',
        );
      }
    },
    appendAuditEvent: webhookDeps.appendAuditEvent,
    publishAlert,
    generateId: randomUUID,
  };
}
