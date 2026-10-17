import { createHmac } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import type {
  AuditEvent,
  BillingInvoice,
  BillingSubscription,
  Entitlement,
  KitOrder,
  PaymentAttempt,
} from '@zoryvex/contracts';
import {
  PAYSTACK_SUPPORTED_EVENTS,
  processPaystackWebhook,
  type PaystackWebhookDependencies,
} from '../src/domain/paystack-webhook-service';
import { UnauthorizedError, ValidationError } from '../src/errors/typed-errors';

// Not a real credential — a fixed fixture used only to compute an HMAC
// inside this file, the same convention as tests/paystack-signature.test.ts.
const FIXTURE_SIGNING_VALUE = 'unit-test-hmac-fixture-not-a-real-credential';
const ROLE_ID = 'role_1';
const KIT_ORDER_ID = 'kit_1';
const EMPLOYER_ID = 'emp_1';
const ATTEMPT_ID = 'attempt_1';
const SUB_CODE = 'SUB_testsubscription1';
const CUS_CODE = 'CUS_testcustomer1';
const PLAN_CODE = 'PLN_scoutfounding1';
const NOW = '2026-08-19T01:00:00.000Z';

function sign(body: string): string {
  return createHmac('sha512', FIXTURE_SIGNING_VALUE).update(body).digest('hex');
}

/**
 * Every payload below is shaped from Paystack's own published samples
 * (docs read 2026-09-01), including the fields that are *absent*: no
 * subscription or invoice event carries a `data.id`, and
 * `subscription.expiring_cards` carries an array. Those absences are what
 * the old idempotency key crashed on, so they are the point of the
 * fixtures rather than an oversight in them.
 */
const payloads = {
  kitCharge: () => ({
    event: 'charge.success',
    data: {
      id: 4099260516,
      reference: `${ROLE_ID}.${KIT_ORDER_ID}`,
      status: 'success',
      amount: 9_500_000,
      currency: 'NGN',
      channel: 'card',
      gateway_response: 'Successful',
      customer: { customer_code: CUS_CODE, email: 'ops@example.test' },
    },
  }),
  subscriptionCharge: () => ({
    event: 'charge.success',
    data: {
      id: 4099260517,
      reference: `sub.${EMPLOYER_ID}.${ATTEMPT_ID}`,
      status: 'success',
      amount: 7_900_000,
      currency: 'NGN',
      channel: 'card',
      gateway_response: 'Successful',
      customer: { customer_code: CUS_CODE, email: 'ops@example.test' },
    },
  }),
  renewalCharge: () => ({
    event: 'charge.success',
    data: {
      id: 4099260518,
      // Paystack's own reference for a recurring debit. Deliberately not
      // parseable: this is the case that must resolve through the customer
      // pointer or not at all.
      reference: '9cfbae6e-bbf3-5b41-8aef-d72c1a17650g',
      status: 'success',
      amount: 7_900_000,
      currency: 'NGN',
      customer: { customer_code: CUS_CODE, email: 'ops@example.test' },
    },
  }),
  subscriptionCreate: () => ({
    event: 'subscription.create',
    data: {
      domain: 'test',
      status: 'active',
      subscription_code: SUB_CODE,
      email_token: 'd7gofp6yppn3qz7',
      amount: 7_900_000,
      cron_expression: '0 0 28 * *',
      next_payment_date: '2026-09-19T00:00:00.000Z',
      open_invoice: null,
      plan: { plan_code: PLAN_CODE, interval: 'monthly', amount: 7_900_000 },
      customer: { customer_code: CUS_CODE, email: 'ops@example.test' },
      authorization: {
        last4: '4081',
        brand: 'visa',
        exp_month: '12',
        exp_year: '2030',
        channel: 'card',
      },
      created_at: '2026-08-19T00:30:00.000Z',
    },
  }),
  invoiceFailed: () => ({
    event: 'invoice.payment_failed',
    data: {
      invoice_code: 'INV_failedone1',
      amount: 7_900_000,
      period_start: '2026-09-19T00:00:00.000Z',
      period_end: '2026-10-19T00:00:00.000Z',
      status: 'pending',
      paid: false,
      paid_at: null,
      description: 'Insufficient Funds',
      subscription: {
        status: 'active',
        subscription_code: SUB_CODE,
        next_payment_date: '2026-10-19T00:00:00.000Z',
      },
      customer: { customer_code: CUS_CODE, email: 'ops@example.test' },
      transaction: {},
      created_at: '2026-09-19T00:00:03.000Z',
    },
  }),
  invoicePaid: () => ({
    event: 'invoice.update',
    data: {
      invoice_code: 'INV_paidone1',
      amount: 7_900_000,
      period_start: '2026-09-19T00:00:00.000Z',
      period_end: '2026-10-19T00:00:00.000Z',
      status: 'success',
      paid: true,
      paid_at: '2026-09-19T00:00:06.000Z',
      subscription: {
        status: 'active',
        subscription_code: SUB_CODE,
        next_payment_date: '2026-10-19T00:00:00.000Z',
      },
      authorization: {
        last4: '4081',
        brand: 'visa',
        exp_month: '12',
        exp_year: '2030',
        channel: 'card',
      },
      transaction: { reference: 'paystack-generated-ref', status: 'success' },
      created_at: '2026-09-19T00:00:02.000Z',
    },
  }),
  notRenewing: () => ({
    event: 'subscription.not_renew',
    data: {
      id: 317617,
      status: 'non-renewing',
      subscription_code: SUB_CODE,
      email_token: 'd7gofp6yppn3qz7',
      next_payment_date: '2026-09-19T00:00:00.000Z',
      plan: { plan_code: PLAN_CODE, interval: 'monthly' },
      customer: { customer_code: CUS_CODE },
    },
  }),
  disabled: () => ({
    event: 'subscription.disable',
    data: {
      status: 'complete',
      subscription_code: SUB_CODE,
      email_token: 'd7gofp6yppn3qz7',
      next_payment_date: '2026-09-19T00:00:00.000Z',
      plan: { plan_code: PLAN_CODE, interval: 'monthly' },
      customer: { customer_code: CUS_CODE },
    },
  }),
  expiringCards: () => ({
    event: 'subscription.expiring_cards',
    // An array, not an object. The old handler read `data.id` off this and
    // threw.
    data: [
      {
        expiry_date: '12/2026',
        description: 'visa ending with 4081',
        brand: 'visa',
        subscription: { subscription_code: SUB_CODE, amount: 7_900_000 },
        customer: { customer_code: CUS_CODE, email: 'ops@example.test' },
      },
    ],
  }),
  dispute: () => ({
    event: 'charge.dispute.create',
    data: { id: 88, status: 'awaiting-merchant-feedback' },
  }),
  refundProcessed: () => ({
    event: 'refund.processed',
    data: { transaction_reference: `sub.${EMPLOYER_ID}.${ATTEMPT_ID}`, status: 'processed' },
  }),
};

function createFakes() {
  const markers = new Set<string>();
  const auditEvents: AuditEvent[] = [];
  const alerts: string[] = [];
  const artifactsFor: string[] = [];
  const foundingPlaces: string[] = [];
  const invoices = new Map<string, BillingInvoice>();
  const customers = new Map<string, string>();
  const subscriptions = new Map<string, BillingSubscription>();
  // Production stores one subscription per employer and a separate
  // code -> employer pointer per subscription code, which it never
  // deletes. Both halves are modelled here: without the second, an event
  // about a superseded subscription would simply fail to resolve, and the
  // tests would pass for a reason production does not have.
  const subscriptionPointers = new Map<string, string>();
  const planCodeRegistry: Record<string, string> = { scout_founding_monthly: PLAN_CODE };

  const kitOrders = new Map<string, KitOrder>([
    [
      `${ROLE_ID}#${KIT_ORDER_ID}`,
      {
        id: KIT_ORDER_ID,
        employerId: EMPLOYER_ID,
        roleId: ROLE_ID,
        amountNGN: 95_000,
        checkoutUrl: null,
        status: 'pending',
        paystackReference: `${ROLE_ID}.${KIT_ORDER_ID}`,
        createdAt: '2026-08-19T00:00:00.000Z',
      },
    ],
  ]);

  const attempts = new Map<string, PaymentAttempt>([
    [
      ATTEMPT_ID,
      {
        id: ATTEMPT_ID,
        employerId: EMPLOYER_ID,
        purpose: 'subscription',
        reference: `sub.${EMPLOYER_ID}.${ATTEMPT_ID}`,
        checkoutUrl: null,
        paystackTransactionId: null,
        amountNGN: 79_000,
        currency: 'NGN',
        status: 'initialized',
        paystackStatus: null,
        channel: null,
        gatewayResponse: null,
        failureReason: null,
        planCode: PLAN_CODE,
        plan: 'scout',
        interval: 'monthly',
        priceTier: 'founding',
        roleId: null,
        subscriptionCode: null,
        customerCode: null,
        correlationId: 'corr_1',
        verifiedAt: null,
        reconcileAttempts: 0,
        createdAt: '2026-08-19T00:00:00.000Z',
        updatedAt: '2026-08-19T00:00:00.000Z',
      },
    ],
  ]);

  let entitlement: Entitlement = {
    employerId: EMPLOYER_ID,
    plan: 'none',
    status: 'none',
    kitPurchasedAt: null,
    subscriptionRenewsAt: null,
    priceNGN: null,
    foundingMember: false,
  };

  const verify = {
    result: null as Record<string, unknown> | null,
    error: null as Error | null,
    calls: [] as string[],
  };
  const failures = {
    transitionKitOrder: false,
    putSubscription: false,
    forget: false,
    // The order reads as pending, and the conditional transition then
    // refuses — which is exactly what a second concurrent delivery sees
    // when the first one has already moved it.
    kitTransitionLosesRace: false,
  };

  const deps: PaystackWebhookDependencies = {
    clock: { now: () => new Date(NOW) },
    async recordWebhookEventOnce(key) {
      if (markers.has(key)) return false;
      markers.add(key);
      return true;
    },
    async forgetWebhookEvent(key) {
      if (failures.forget) throw new Error('dynamo unavailable');
      markers.delete(key);
    },
    async getKitOrder(roleId, kitOrderId) {
      return kitOrders.get(`${roleId}#${kitOrderId}`) ?? null;
    },
    async transitionKitOrderStatus(roleId, kitOrderId, expected, next) {
      if (failures.transitionKitOrder) throw new Error('dynamo throttled');
      if (failures.kitTransitionLosesRace) return null;
      const key = `${roleId}#${kitOrderId}`;
      const existing = kitOrders.get(key);
      if (!existing || existing.status !== expected) return null;
      const updated = { ...existing, status: next };
      kitOrders.set(key, updated);
      return updated;
    },
    async generateKitArtifact(roleId) {
      artifactsFor.push(roleId);
      return undefined;
    },
    async hasKitArtifact(roleId) {
      return artifactsFor.includes(roleId);
    },
    async getPaymentAttempt(_employerId, attemptId) {
      return attempts.get(attemptId) ?? null;
    },
    async listPaymentAttempts() {
      return [...attempts.values()];
    },
    async updatePaymentAttempt(_employerId, attemptId, expected, patch, updatedAt) {
      const existing = attempts.get(attemptId);
      if (!existing || existing.status !== expected) return null;
      const updated = { ...existing, ...patch, updatedAt } as PaymentAttempt;
      attempts.set(attemptId, updated);
      return updated;
    },
    async employerIdForSubscriptionCode(code) {
      return subscriptionPointers.get(code) ?? null;
    },
    async employerIdForCustomerCode(code) {
      return customers.get(code) ?? null;
    },
    async getBillingSubscription(employerId) {
      return [...subscriptions.values()].find((s) => s.employerId === employerId) ?? null;
    },
    async putBillingSubscription(subscription) {
      if (failures.putSubscription) throw new Error('dynamo throttled');
      // One record per employer, as in DynamoDB, where the item is keyed
      // by employer id alone. Keyed by code here only so the assertions
      // below can read it that way.
      for (const [code, held] of subscriptions) {
        if (held.employerId === subscription.employerId) subscriptions.delete(code);
      }
      subscriptions.set(subscription.subscriptionCode, subscription);
      subscriptionPointers.set(subscription.subscriptionCode, subscription.employerId);
      return subscription;
    },
    async updateBillingSubscription(employerId, patch, updatedAt, expectedSubscriptionCode) {
      const existing = [...subscriptions.values()].find((s) => s.employerId === employerId);
      if (!existing) return null;
      // The repository's ConditionExpression, in the one shape that
      // matters: refuse the write when the caller is talking about a
      // subscription this employer no longer has.
      if (
        expectedSubscriptionCode !== undefined &&
        existing.subscriptionCode !== expectedSubscriptionCode
      ) {
        return null;
      }
      const updated = { ...existing, ...patch, updatedAt } as BillingSubscription;
      subscriptions.set(existing.subscriptionCode, updated);
      return updated;
    },
    async putBillingInvoice(invoice) {
      invoices.set(invoice.invoiceCode, invoice);
      return invoice;
    },
    async putBillingCustomer(input) {
      customers.set(input.customerCode, input.employerId);
      return input;
    },
    async getPlanCodeRegistry() {
      return planCodeRegistry;
    },
    async getEntitlement() {
      return entitlement;
    },
    async updateEntitlement(_employerId, patch) {
      entitlement = { ...entitlement, ...patch } as Entitlement;
      return entitlement;
    },
    async recordFoundingPlaceTaken(employerId) {
      if (!foundingPlaces.includes(employerId)) foundingPlaces.push(employerId);
    },
    async appendAuditEvent(event) {
      auditEvents.push(event);
      return event;
    },
    async publishAlert(message) {
      alerts.push(message);
    },
    generateId: () => `id_${auditEvents.length + 1}`,
    async verifyTransaction(reference) {
      verify.calls.push(reference);
      if (verify.error) throw verify.error;
      return {
        status: 'success',
        reference,
        amountKobo: reference.startsWith('sub.') ? 7_900_000 : 9_500_000,
        currency: 'NGN',
        transactionId: '4099260516',
        channel: 'card',
        gatewayResponse: 'Successful',
        customerCode: CUS_CODE,
        customerEmail: 'ops@example.test',
        ...(verify.result ?? {}),
      };
    },
  };

  const send = (payload: unknown) => {
    const rawBody = JSON.stringify(payload);
    return processPaystackWebhook(
      { rawBody, signatureHeader: sign(rawBody), secretKey: FIXTURE_SIGNING_VALUE },
      deps,
    );
  };

  return {
    deps,
    send,
    markers,
    auditEvents,
    alerts,
    artifactsFor,
    foundingPlaces,
    invoices,
    customers,
    subscriptions,
    subscriptionPointers,
    planCodeRegistry,
    kitOrders,
    attempts,
    failures,
    verify,
    entitlement: () => entitlement,
  };
}

describe('processPaystackWebhook', () => {
  let fakes: ReturnType<typeof createFakes>;

  beforeEach(() => {
    fakes = createFakes();
  });

  describe('authenticity', () => {
    it('refuses a body whose signature does not match', async () => {
      const rawBody = JSON.stringify(payloads.kitCharge());
      await expect(
        processPaystackWebhook(
          { rawBody, signatureHeader: 'deadbeef', secretKey: FIXTURE_SIGNING_VALUE },
          fakes.deps,
        ),
      ).rejects.toBeInstanceOf(UnauthorizedError);
    });

    it('refuses a request with no signature header at all', async () => {
      const rawBody = JSON.stringify(payloads.kitCharge());
      await expect(
        processPaystackWebhook(
          { rawBody, signatureHeader: undefined, secretKey: FIXTURE_SIGNING_VALUE },
          fakes.deps,
        ),
      ).rejects.toBeInstanceOf(UnauthorizedError);
    });

    it('refuses a correctly signed body that is not JSON', async () => {
      const rawBody = 'not json';
      await expect(
        processPaystackWebhook(
          { rawBody, signatureHeader: sign(rawBody), secretKey: FIXTURE_SIGNING_VALUE },
          fakes.deps,
        ),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it('refuses a payload with no event name', async () => {
      const rawBody = JSON.stringify({ data: { id: 1 } });
      await expect(
        processPaystackWebhook(
          { rawBody, signatureHeader: sign(rawBody), secretKey: FIXTURE_SIGNING_VALUE },
          fakes.deps,
        ),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it('does not touch any state before the signature is verified', async () => {
      const rawBody = JSON.stringify(payloads.kitCharge());
      await processPaystackWebhook(
        { rawBody, signatureHeader: 'wrong', secretKey: FIXTURE_SIGNING_VALUE },
        fakes.deps,
      ).catch(() => undefined);
      expect(fakes.markers.size).toBe(0);
      expect(fakes.kitOrders.get(`${ROLE_ID}#${KIT_ORDER_ID}`)?.status).toBe('pending');
    });
  });

  /**
   * The regression the whole rewrite exists for. Under the old `data.id`
   * key every one of these threw "missing data.id", answered 500, and was
   * retried by Paystack every three minutes and then hourly for
   * seventy-two hours.
   */
  describe('events that carry no data.id', () => {
    it.each([
      ['subscription.create', payloads.subscriptionCreate],
      ['subscription.disable', payloads.disabled],
      ['invoice.payment_failed', payloads.invoiceFailed],
      ['invoice.update', payloads.invoicePaid],
      ['subscription.expiring_cards', payloads.expiringCards],
    ])('accepts %s without throwing', async (_name, build) => {
      await expect(fakes.send(build())).resolves.toMatchObject({ duplicate: false });
    });
  });

  describe('duplicate delivery', () => {
    it('applies a redelivered event exactly once', async () => {
      const payload = payloads.kitCharge();
      const first = await fakes.send(payload);
      const second = await fakes.send(payload);

      expect(first.duplicate).toBe(false);
      expect(second.duplicate).toBe(true);
      expect(fakes.artifactsFor).toEqual([ROLE_ID]);
      expect(fakes.kitOrders.get(`${ROLE_ID}#${KIT_ORDER_ID}`)?.status).toBe('succeeded');
    });

    it('treats two different events for the same transaction as different events', async () => {
      // Both of these would have hashed to the same `data.id` key under the
      // old scheme and the second would have been silently dropped.
      await fakes.send(payloads.subscriptionCreate());
      const second = await fakes.send(payloads.notRenewing());
      expect(second.duplicate).toBe(false);
    });
  });

  describe('the Kit one-time purchase', () => {
    it('verifies independently before granting anything', async () => {
      await fakes.send(payloads.kitCharge());
      expect(fakes.verify.calls).toEqual([`${ROLE_ID}.${KIT_ORDER_ID}`]);
      expect(fakes.entitlement().plan).toBe('kit');
      expect(fakes.entitlement().kitPurchasedAt).toBe(NOW);
    });

    it('grants nothing when the independent verify disagrees about the amount', async () => {
      fakes.verify.result = { amountKobo: 100 };
      await fakes.send(payloads.kitCharge());

      expect(fakes.kitOrders.get(`${ROLE_ID}#${KIT_ORDER_ID}`)?.status).toBe('failed');
      expect(fakes.entitlement().plan).toBe('none');
      expect(fakes.artifactsFor).toEqual([]);
      expect(fakes.alerts.join(' ')).toContain('verification mismatch');
    });

    /**
     * Four guards stand between a webhook and a granted Kit, and a
     * mutation run found that four of them could be deleted with the
     * suite still green. Two were redundant with each other, so removing
     * either one alone changed nothing observable — which is good design
     * and bad evidence. Each test below isolates what one guard uniquely
     * does, so its removal is caught on its own.
     */
    it('grants nothing when the transaction is not actually successful', async () => {
      // The webhook body says charge.success. The independent verify says
      // otherwise, and the verify is what counts: a body is a claim.
      fakes.verify.result = { status: 'failed' };
      await fakes.send(payloads.kitCharge());

      expect(fakes.kitOrders.get(`${ROLE_ID}#${KIT_ORDER_ID}`)?.status).toBe('failed');
      expect(fakes.entitlement().plan).toBe('none');
      expect(fakes.artifactsFor).toEqual([]);
    });

    it('grants nothing when the money arrived in another currency', async () => {
      // The same number of minor units in a different currency is a
      // different amount of money. 9,500,000 kobo is the Kit price;
      // 9,500,000 cents is not.
      fakes.verify.result = { currency: 'USD' };
      await fakes.send(payloads.kitCharge());

      expect(fakes.kitOrders.get(`${ROLE_ID}#${KIT_ORDER_ID}`)?.status).toBe('failed');
      expect(fakes.entitlement().plan).toBe('none');
      expect(fakes.artifactsFor).toEqual([]);
      expect(fakes.alerts.join(' ')).toContain('verification mismatch');
    });

    /**
     * Observed for real against the deployed test environment, with a real
     * NGN 95,000 test-mode payment.
     *
     * The webhook settled the order, then `updateEntitlement` threw
     * ConditionalCheckFailedException. It did the right thing with the
     * failure — cleared the dedupe marker and returned 5xx so Paystack
     * would retry — and the retry was useless, because the order now read
     * `succeeded` and the handler returned immediately on that alone.
     * Reconciliation could not help either: it only examines payment
     * attempts still open, and this one had settled.
     *
     * The customer had paid, Paystack said success, the order said
     * succeeded, and there was no entitlement and no Kit. Permanently.
     */
    it('finishes delivering a paid order whose delivery failed part-way', async () => {
      let failEntitlement = true;
      const deps = {
        ...fakes.deps,
        async updateEntitlement(employerId: string, patch: Record<string, unknown>) {
          if (failEntitlement) throw new Error('The conditional request failed');
          return fakes.deps.updateEntitlement(employerId, patch);
        },
      };

      // First delivery: settles the order, then falls over on the way to
      // the entitlement, exactly as it did in the real environment.
      await expect(
        processPaystackWebhook(
          {
            rawBody: JSON.stringify(payloads.kitCharge()),
            signatureHeader: sign(JSON.stringify(payloads.kitCharge())),
            secretKey: FIXTURE_SIGNING_VALUE,
          },
          deps,
        ),
      ).rejects.toThrow();

      expect(fakes.kitOrders.get(`${ROLE_ID}#${KIT_ORDER_ID}`)?.status).toBe('succeeded');
      expect(fakes.artifactsFor).toEqual([]);
      expect(fakes.entitlement().plan).toBe('none');

      // Paystack retries. The order is already succeeded, and the Kit still
      // does not exist, so the retry must finish the job rather than treat
      // a settled order as a delivered one.
      failEntitlement = false;
      await fakes.send(payloads.kitCharge());

      expect(fakes.entitlement().plan).toBe('kit');
      expect(fakes.entitlement().kitPurchasedAt).toBe(NOW);
      expect(fakes.artifactsFor).toEqual([ROLE_ID]);
    });

    it('does not re-verify an order it has already granted', async () => {
      await fakes.send(payloads.kitCharge());
      expect(fakes.verify.calls).toHaveLength(1);
      expect(fakes.artifactsFor).toEqual([ROLE_ID]);

      // A replay with a different body gets past the dedupe hash. The
      // order is already succeeded, so this must stop before spending a
      // call on Paystack, which is the observable difference between this
      // guard and the conditional transition below it.
      await fakes.send({
        ...payloads.kitCharge(),
        data: { ...payloads.kitCharge().data, gateway_response: 'Approved' },
      });
      expect(fakes.verify.calls).toHaveLength(1);
      expect(fakes.artifactsFor).toEqual([ROLE_ID]);
    });

    it('generates nothing when another delivery won the race', async () => {
      // The order still reads pending, and the conditional write refuses
      // because the other delivery moved it first. Without that check the
      // loser carries on and generates a second Kit for one payment.
      fakes.failures.kitTransitionLosesRace = true;
      await fakes.send(payloads.kitCharge());

      expect(fakes.artifactsFor).toEqual([]);
      expect(fakes.entitlement().plan).toBe('none');
    });

    it('does not generate a second Kit when the same order is resolved twice', async () => {
      await fakes.send(payloads.kitCharge());
      // A different body for the same order — passes the dedupe hash, must
      // still not produce a second artifact.
      await fakes.send({
        ...payloads.kitCharge(),
        data: { ...payloads.kitCharge().data, gateway_response: 'Approved' },
      });
      expect(fakes.artifactsFor).toEqual([ROLE_ID]);
    });
  });

  describe('subscription lifecycle', () => {
    it('records the subscription, its cancellation token and the founding place', async () => {
      await fakes.send(payloads.subscriptionCharge());
      await fakes.send(payloads.subscriptionCreate());

      const subscription = fakes.subscriptions.get(SUB_CODE);
      expect(subscription).toBeDefined();
      expect(subscription?.emailToken).toBe('d7gofp6yppn3qz7');
      expect(subscription?.plan).toBe('scout');
      expect(subscription?.priceTier).toBe('founding');
      expect(subscription?.priceNGN).toBe(79_000);
      expect(subscription?.card?.last4).toBe('4081');
      expect(fakes.foundingPlaces).toEqual([EMPLOYER_ID]);
      expect(fakes.entitlement().plan).toBe('scout');
      expect(fakes.entitlement().foundingMember).toBe(true);
    });

    it('alerts rather than failing silently when no email token arrives', async () => {
      const payload = payloads.subscriptionCreate();
      const data = { ...payload.data };
      delete (data as Record<string, unknown>).email_token;
      await fakes.send(payloads.subscriptionCharge());
      await fakes.send({ ...payload, data });

      expect(fakes.alerts.join(' ')).toContain('email_token');
    });

    it('never grants access for a subscription whose customer is unknown here', async () => {
      // No prior charge, so no customer pointer exists.
      await fakes.send(payloads.subscriptionCreate());
      expect(fakes.subscriptions.size).toBe(0);
      expect(fakes.entitlement().plan).toBe('none');
      expect(fakes.alerts.join(' ')).toContain('does not match any organization');
    });

    it('moves to non-renewing on cancellation without opening a grace window', async () => {
      await fakes.send(payloads.subscriptionCharge());
      await fakes.send(payloads.subscriptionCreate());
      await fakes.send(payloads.notRenewing());

      const subscription = fakes.subscriptions.get(SUB_CODE);
      expect(subscription?.status).toBe('non-renewing');
      expect(subscription?.graceEndsAt).toBeNull();
    });

    it('ends marketplace access on disable but keeps a purchased Kit', async () => {
      await fakes.send(payloads.kitCharge());
      await fakes.send(payloads.subscriptionCharge());
      await fakes.send(payloads.subscriptionCreate());
      await fakes.send(payloads.disabled());

      expect(fakes.subscriptions.get(SUB_CODE)?.status).toBe('completed');
      expect(fakes.entitlement().plan).toBe('kit');
      expect(fakes.entitlement().status).toBe('active');
      expect(fakes.entitlement().subscriptionRenewsAt).toBeNull();
    });

    it('cancels outright for an organization that never bought a Kit', async () => {
      await fakes.send(payloads.subscriptionCharge());
      await fakes.send(payloads.subscriptionCreate());
      await fakes.send(payloads.disabled());

      expect(fakes.entitlement().plan).toBe('none');
      expect(fakes.entitlement().status).toBe('canceled');
    });
  });

  describe('naming the tier a subscription actually bought', () => {
    /**
     * Paystack knows the plan code and the amount; only this system knows
     * that a code means "Scout, founding, monthly". Defaulting would record
     * a Partner founding subscriber as a Scout on the standard price, wrong
     * in both directions at once and invisible until they complained.
     */
    it('resolves the tier from the plan-code registry', async () => {
      await fakes.send(payloads.subscriptionCharge());
      await fakes.send(payloads.subscriptionCreate());

      const subscription = fakes.subscriptions.get(SUB_CODE);
      expect(subscription?.plan).toBe('scout');
      expect(subscription?.priceTier).toBe('founding');
      expect(subscription?.interval).toBe('monthly');
    });

    it('records nothing when the plan code matches neither the registry nor an attempt', async () => {
      fakes.deps.getPlanCodeRegistry = async () => ({});
      // No prior charge, so there is no payment attempt to fall back to.
      fakes.customers.set(CUS_CODE, EMPLOYER_ID);
      fakes.attempts.clear();

      await fakes.send(payloads.subscriptionCreate());

      expect(fakes.subscriptions.size).toBe(0);
      expect(fakes.entitlement().plan).toBe('none');
      expect(fakes.alerts.join(' ')).toContain('not in the plan-code registry');
    });

    it('falls back to the checkout that opened it when the registry has moved on', async () => {
      await fakes.send(payloads.subscriptionCharge());
      fakes.deps.getPlanCodeRegistry = async () => ({});
      await fakes.send(payloads.subscriptionCreate());

      expect(fakes.subscriptions.get(SUB_CODE)?.priceTier).toBe('founding');
    });
  });

  describe('renewals', () => {
    beforeEach(async () => {
      await fakes.send(payloads.subscriptionCharge());
      await fakes.send(payloads.subscriptionCreate());
    });

    it('attributes a renewal charge through the customer code, not the reference', async () => {
      const outcome = await fakes.send(payloads.renewalCharge());
      expect(outcome.handled).toBe(true);
      expect(fakes.auditEvents.map((e) => e.action)).toContain('subscription_renewal_charged');
    });

    it('alerts when a renewal arrives for a customer this system does not know', async () => {
      fakes.customers.clear();
      await fakes.send(payloads.renewalCharge());
      expect(fakes.alerts.join(' ')).toContain('does not match any organization');
    });

    it('opens a grace window on a failed renewal without cutting access off', async () => {
      await fakes.send(payloads.invoiceFailed());

      const subscription = fakes.subscriptions.get(SUB_CODE);
      expect(subscription?.status).toBe('attention');
      expect(subscription?.lastFailureReason).toBe('Insufficient Funds');
      // Seven days from the failure, per PAYMENT_FAILURE_GRACE_DAYS.
      expect(subscription?.graceEndsAt).toBe('2026-08-26T01:00:00.000Z');
      // Still active: access is decided by deriveAccess, not by cutting the
      // entitlement the moment a bank says no.
      expect(fakes.entitlement().status).not.toBe('past_due');
      expect(fakes.alerts.join(' ')).toContain('does not retry');
    });

    it('records the failed invoice with the reason the bank gave', async () => {
      await fakes.send(payloads.invoiceFailed());
      const invoice = fakes.invoices.get('INV_failedone1');
      expect(invoice?.paid).toBe(false);
      expect(invoice?.description).toBe('Insufficient Funds');
    });

    /**
     * Paystack's card-update page takes a small amount to confirm the new
     * card works and refunds it immediately. That is a successful charge
     * on this customer, delivered through this same branch, because the
     * reference is Paystack's rather than one this system wrote.
     *
     * Treating it as a renewal meant an employer whose renewal had failed
     * could clear their grace window, flip back to active and keep a
     * month of paid access by adding a card. A charge created by hand in
     * the Paystack dashboard did the same thing.
     */
    it('does not treat a small card-confirmation charge as a renewal', async () => {
      await fakes.send(payloads.invoiceFailed());

      const confirmation = payloads.renewalCharge();
      confirmation.data.amount = 5_000; // NGN 50, not the NGN 79,000 plan
      confirmation.data.reference = 'cardupdate-confirm-0001';
      await fakes.send(confirmation);

      const subscription = fakes.subscriptions.get(SUB_CODE);
      expect(subscription?.status).toBe('attention');
      expect(subscription?.graceEndsAt).toBe('2026-08-26T01:00:00.000Z');
    });

    it('does not record a card-confirmation charge as a renewal in the audit trail', async () => {
      const confirmation = payloads.renewalCharge();
      confirmation.data.amount = 5_000;
      confirmation.data.reference = 'cardupdate-confirm-0002';
      await fakes.send(confirmation);

      expect(fakes.auditEvents.map((e) => e.action)).not.toContain('subscription_renewal_charged');
    });

    it('stays quiet about a small card-confirmation charge', async () => {
      const confirmation = payloads.renewalCharge();
      confirmation.data.amount = 5_000;
      confirmation.data.reference = 'cardupdate-confirm-0003';
      await fakes.send(confirmation);

      expect(fakes.alerts.join(' ')).not.toContain('do not match');
    });

    /**
     * The other half of the amount check. A few naira is a card being
     * confirmed; most of the price of the plan is either Paystack billing
     * an amount this system does not expect, or somebody paying for a
     * month they will not receive. The second must reach a person.
     */
    it('alerts when a substantial charge does not match the price held', async () => {
      const partial = payloads.renewalCharge();
      partial.data.amount = 7_000_000; // NGN 70,000 against a NGN 79,000 plan
      partial.data.reference = 'partial-charge-0001';
      await fakes.send(partial);

      expect(fakes.alerts.join(' ')).toContain('do not match');
    });

    it('still treats a charge for the price actually held as a renewal', async () => {
      await fakes.send(payloads.invoiceFailed());
      await fakes.send(payloads.renewalCharge());

      const subscription = fakes.subscriptions.get(SUB_CODE);
      expect(subscription?.status).toBe('active');
      expect(subscription?.graceEndsAt).toBeNull();
    });

    it('closes the grace window when a later invoice is paid', async () => {
      await fakes.send(payloads.invoiceFailed());
      await fakes.send(payloads.invoicePaid());

      const subscription = fakes.subscriptions.get(SUB_CODE);
      expect(subscription?.status).toBe('active');
      expect(subscription?.graceEndsAt).toBeNull();
      expect(subscription?.lastFailureReason).toBeNull();
      expect(subscription?.nextPaymentDate).toBe('2026-10-19T00:00:00.000Z');
    });
  });

  /**
   * Cancelling and then taking a different plan.
   *
   * Founder instruction, 2026-09-09: "make sure when subscription is
   * cancelled they can still resubscribe to any plan". They can, and that
   * is what creates the situation tested here. Cancelling does not end a
   * subscription at Paystack; it marks it non-renewing and lets it run to
   * the end of the period already paid for. An employer who then
   * subscribes to another plan has two subscriptions at Paystack, and the
   * old one goes on raising events, in the employer's name, for weeks.
   *
   * The events that matter are addressed by subscription code, and
   * resolve to the employer through a pointer this system writes per code
   * and never deletes. The subscription record itself is one per employer.
   * So an event about the abandoned plan lands on the current one unless
   * something compares the two codes.
   *
   * The worst case is `subscription.disable` on the old plan's next
   * payment date: weeks after the employer paid for a new plan, Paystack
   * says the old one is finished, and access bought and paid for is taken
   * away. Nobody would connect the two events, and the employer's own
   * evidence would be a billing page saying cancelled next to a card
   * statement saying charged.
   */
  describe('an employer who cancels and then takes another plan', () => {
    const NEW_SUB_CODE = 'SUB_secondsubscript';
    const NEW_PLAN_CODE = 'PLN_teamfounding1';

    const resubscribe = () => ({
      event: 'subscription.create',
      data: {
        domain: 'test',
        status: 'active',
        subscription_code: NEW_SUB_CODE,
        email_token: 'k2mnbv6yppn3qz9',
        amount: 14_000_00,
        next_payment_date: '2026-09-19T00:00:00.000Z',
        plan: { plan_code: NEW_PLAN_CODE, interval: 'monthly', amount: 14_000_00 },
        customer: { customer_code: CUS_CODE, email: 'ops@example.test' },
        created_at: '2026-08-19T00:45:00.000Z',
      },
    });

    beforeEach(async () => {
      await fakes.send(payloads.subscriptionCharge());
      await fakes.send(payloads.subscriptionCreate());
      await fakes.send(payloads.notRenewing());
      // The registry has to know the second plan, or subscription.create
      // refuses to record a tier it would have to guess.
      fakes.planCodeRegistry.team_founding_monthly = NEW_PLAN_CODE;
      await fakes.send(resubscribe());
    });

    it('replaces the record rather than keeping two subscriptions', () => {
      expect(fakes.subscriptions.get(SUB_CODE)).toBeUndefined();
      expect(fakes.subscriptions.get(NEW_SUB_CODE)?.status).toBe('active');
      expect(fakes.subscriptions.get(NEW_SUB_CODE)?.plan).toBe('team');
    });

    it('keeps the new subscription when the old one is disabled weeks later', async () => {
      const outcome = await fakes.send(payloads.disabled());

      expect(outcome.handled).toBe(false);
      expect(fakes.subscriptions.get(NEW_SUB_CODE)?.status).toBe('active');
      expect(fakes.entitlement().status).toBe('active');
    });

    it('does not record the old plan ending as this employer ending', async () => {
      await fakes.send(payloads.disabled());
      expect(fakes.auditEvents.map((e) => e.action)).not.toContain('subscription_ended');
    });

    it('ignores a late not_renew for the plan they left', async () => {
      // A different body from the one already sent, or the redelivery
      // check answers this before the handler ever sees it and the test
      // proves nothing.
      const late = payloads.notRenewing();
      late.data.next_payment_date = '2026-09-20T00:00:00.000Z';
      await fakes.send(late);

      expect(fakes.subscriptions.get(NEW_SUB_CODE)?.status).toBe('active');
    });

    it('does not suspend the new plan when the old one fails to collect', async () => {
      await fakes.send(payloads.invoiceFailed());

      const current = fakes.subscriptions.get(NEW_SUB_CODE);
      expect(current?.status).toBe('active');
      expect(current?.graceEndsAt).toBeNull();
      // Kept, because it happened, and it is the old subscription's
      // history rather than the new one's.
      expect(fakes.invoices.get('INV_failedone1')?.subscriptionCode).toBe(SUB_CODE);
    });

    it('does not move the new renewal date when the old plan pays an invoice', async () => {
      const before = fakes.subscriptions.get(NEW_SUB_CODE)?.nextPaymentDate;
      await fakes.send(payloads.invoicePaid());
      expect(fakes.subscriptions.get(NEW_SUB_CODE)?.nextPaymentDate).toBe(before);
    });
  });

  describe('a cancelled subscription is not resurrected by a late charge', () => {
    beforeEach(async () => {
      await fakes.send(payloads.subscriptionCharge());
      await fakes.send(payloads.subscriptionCreate());
      await fakes.send(payloads.notRenewing());
    });

    /**
     * The race: a cancel request, then a renewal charge that was already in
     * flight. Setting `active` unconditionally would show the employer as
     * subscribed again, on the page they cancelled from.
     */
    it('leaves non-renewing alone when a renewal charge lands after the cancel', async () => {
      await fakes.send(payloads.renewalCharge());
      expect(fakes.subscriptions.get(SUB_CODE)?.status).toBe('non-renewing');
    });

    it('leaves non-renewing alone when a paid invoice lands after the cancel', async () => {
      await fakes.send(payloads.invoicePaid());
      expect(fakes.subscriptions.get(SUB_CODE)?.status).toBe('non-renewing');
    });
  });

  describe('disputes and refunds', () => {
    it('never moves money or access on a dispute', async () => {
      await fakes.send(payloads.dispute());
      expect(fakes.entitlement().plan).toBe('none');
      expect(fakes.alerts.join(' ')).toContain('Nothing has been changed automatically');
    });

    it('marks a refunded payment reversed but leaves access for a person to decide', async () => {
      await fakes.send(payloads.subscriptionCharge());
      await fakes.send(payloads.subscriptionCreate());
      await fakes.send(payloads.refundProcessed());

      expect(fakes.attempts.get(ATTEMPT_ID)?.status).toBe('reversed');
      expect(fakes.alerts.join(' ')).toContain('NOT been removed automatically');
    });
  });

  describe('failure handling', () => {
    it('clears the marker and rethrows so Paystack retries', async () => {
      fakes.failures.transitionKitOrder = true;
      await expect(fakes.send(payloads.kitCharge())).rejects.toThrow('dynamo throttled');
      expect(fakes.markers.size).toBe(0);

      // The retry now genuinely re-attempts rather than being swallowed as
      // a duplicate, which is the entire point of clearing the marker.
      fakes.failures.transitionKitOrder = false;
      const retry = await fakes.send(payloads.kitCharge());
      expect(retry.duplicate).toBe(false);
      expect(fakes.kitOrders.get(`${ROLE_ID}#${KIT_ORDER_ID}`)?.status).toBe('succeeded');
    });

    it('alerts a human only when the marker itself cannot be cleared', async () => {
      fakes.failures.transitionKitOrder = true;
      fakes.failures.forget = true;
      await expect(fakes.send(payloads.kitCharge())).rejects.toThrow();
      expect(fakes.alerts.join(' ')).toContain('will be ignored as a duplicate');
    });

    it('does not alert for a failure Paystack will retry into', async () => {
      fakes.failures.transitionKitOrder = true;
      await expect(fakes.send(payloads.kitCharge())).rejects.toThrow();
      expect(fakes.alerts).toEqual([]);
      expect(fakes.auditEvents.map((e) => e.action)).toContain('paystack_event_failed_will_retry');
    });
  });

  describe('events this product has no stake in', () => {
    it('acknowledges without acting', async () => {
      const outcome = await fakes.send({ event: 'transfer.success', data: { id: 1 } });
      expect(outcome).toMatchObject({ handled: false, duplicate: false });
      expect(fakes.alerts).toEqual([]);
    });
  });
});

/**
 * The list Paystack publishes, copied verbatim from its webhooks page on
 * 2026-09-01.
 *
 * Kept here rather than imported so it is a genuine second source: a test
 * that compares the code against itself proves nothing. When Paystack adds
 * an event, this list is updated by hand from their documentation and the
 * test says whether this system has decided what to do about it.
 */
const PAYSTACK_DOCUMENTED_EVENTS = [
  'charge.dispute.create',
  'charge.dispute.remind',
  'charge.dispute.resolve',
  'charge.success',
  'customeridentification.failed',
  'customeridentification.success',
  'dedicatedaccount.assign.failed',
  'dedicatedaccount.assign.success',
  'invoice.create',
  'invoice.payment_failed',
  'invoice.update',
  'paymentrequest.pending',
  'paymentrequest.success',
  'refund.failed',
  'refund.pending',
  'refund.processed',
  'refund.processing',
  'subscription.create',
  'subscription.disable',
  'subscription.expiring_cards',
  'subscription.not_renew',
  'transfer.failed',
  'transfer.success',
  'transfer.reversed',
] as const;

/**
 * The events this product has deliberately decided not to act on, with the
 * reason. Being on this list is a decision, not an oversight, which is the
 * whole difference the test below is checking for.
 */
const DELIBERATELY_IGNORED: Record<string, string> = {
  'customeridentification.failed': 'no customer identity verification is performed by this product',
  'customeridentification.success': 'as above',
  'dedicatedaccount.assign.failed': 'no dedicated virtual accounts are used',
  'dedicatedaccount.assign.success': 'as above',
  'paymentrequest.pending': 'no payment requests are issued; checkout is a hosted redirect',
  'paymentrequest.success': 'as above',
  'transfer.failed': 'this product never transfers money out',
  'transfer.success': 'as above',
  'transfer.reversed': 'as above',
};

describe('coverage of Paystack events', () => {
  it('has decided what to do about every event Paystack documents', () => {
    const handled = new Set<string>(PAYSTACK_SUPPORTED_EVENTS);
    const undecided = PAYSTACK_DOCUMENTED_EVENTS.filter(
      (event) => !handled.has(event) && !(event in DELIBERATELY_IGNORED),
    );
    expect(undecided).toEqual([]);
  });

  it('does not claim to handle an event Paystack does not send', () => {
    // `charge.failed` lived in this handler for months and is not on
    // Paystack's list at all: it webhooks successful transactions only.
    const documented = new Set<string>(PAYSTACK_DOCUMENTED_EVENTS);
    const imaginary = PAYSTACK_SUPPORTED_EVENTS.filter((event) => !documented.has(event));
    expect(imaginary).toEqual([]);
  });

  it('acknowledges an ignored event with 200 and no effect', async () => {
    const fakes = createFakes();
    for (const event of Object.keys(DELIBERATELY_IGNORED)) {
      const outcome = await fakes.send({ event, data: { id: 1 } });
      expect(outcome).toMatchObject({ event, handled: false, duplicate: false });
    }
    expect(fakes.alerts).toEqual([]);
  });
});
