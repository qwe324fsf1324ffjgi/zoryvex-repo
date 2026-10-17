import { describe, expect, it } from 'vitest';
import type {
  BillingInvoice,
  BillingSubscription,
  Entitlement,
  PaymentAttempt,
} from '@zoryvex/contracts';
import {
  getBillingDiagnostic,
  type BillingDiagnosticDependencies,
} from '../src/domain/billing-diagnostic-service';

const EMPLOYER_ID = 'emp_1';
const NOW = new Date('2026-09-10T12:00:00.000Z');

function subscription(overrides: Partial<BillingSubscription> = {}): BillingSubscription {
  return {
    employerId: EMPLOYER_ID,
    subscriptionCode: 'SUB_abc',
    customerCode: 'CUS_abc',
    planCode: 'PLN_abc',
    plan: 'scout',
    interval: 'monthly',
    priceTier: 'founding',
    priceNGN: 79_000,
    status: 'active',
    emailToken: 'tok_secret_value',
    nextPaymentDate: '2026-10-01T00:00:00.000Z',
    currentPeriodStart: '2026-09-01T00:00:00.000Z',
    currentPeriodEnd: '2026-10-01T00:00:00.000Z',
    graceEndsAt: null,
    lastFailureReason: null,
    card: null,
    cancelRequestedAt: null,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  };
}

function entitlement(overrides: Partial<Entitlement> = {}): Entitlement {
  return {
    employerId: EMPLOYER_ID,
    plan: 'scout',
    status: 'active',
    kitPurchasedAt: null,
    subscriptionRenewsAt: '2026-10-01T00:00:00.000Z',
    priceNGN: 79_000,
    foundingMember: true,
    ...overrides,
  };
}

function attempt(overrides: Partial<PaymentAttempt> = {}): PaymentAttempt {
  return {
    id: 'a1',
    employerId: EMPLOYER_ID,
    purpose: 'subscription',
    reference: 'sub.emp_1.a1',
    checkoutUrl: null,
    paystackTransactionId: '4099260516',
    amountNGN: 79_000,
    currency: 'NGN',
    status: 'success',
    paystackStatus: 'success',
    channel: 'card',
    gatewayResponse: 'Successful',
    failureReason: null,
    planCode: 'PLN_abc',
    plan: 'scout',
    interval: 'monthly',
    priceTier: 'founding',
    roleId: null,
    subscriptionCode: null,
    customerCode: null,
    correlationId: 'corr',
    verifiedAt: null,
    reconcileAttempts: 0,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  };
}

function invoice(overrides: Partial<BillingInvoice> = {}): BillingInvoice {
  return {
    employerId: EMPLOYER_ID,
    invoiceCode: 'INV_abc',
    subscriptionCode: 'SUB_abc',
    amountNGN: 79_000,
    periodStart: '2026-09-01T00:00:00.000Z',
    periodEnd: '2026-10-01T00:00:00.000Z',
    status: 'success',
    paid: true,
    paidAt: '2026-09-01T00:00:06.000Z',
    description: null,
    transactionReference: null,
    createdAt: '2026-09-01T00:00:02.000Z',
    updatedAt: '2026-09-01T00:00:06.000Z',
    ...overrides,
  };
}

function createDeps(state: {
  entitlement?: Entitlement | null;
  subscription?: BillingSubscription | null;
  invoices?: BillingInvoice[];
  payments?: PaymentAttempt[];
}): BillingDiagnosticDependencies {
  return {
    clock: { now: () => NOW },
    async getEntitlement() {
      return state.entitlement ?? null;
    },
    async getBillingSubscription() {
      return state.subscription ?? null;
    },
    async listBillingInvoices() {
      return state.invoices ?? [];
    },
    async listPaymentAttempts() {
      return state.payments ?? [];
    },
  };
}

describe('getBillingDiagnostic', () => {
  it('reports a healthy organization as in sync with nothing to fix', async () => {
    const diagnostic = await getBillingDiagnostic(
      EMPLOYER_ID,
      createDeps({
        entitlement: entitlement(),
        subscription: subscription(),
        invoices: [invoice()],
        payments: [attempt()],
      }),
    );

    expect(diagnostic.inSync).toBe(true);
    expect(diagnostic.findings).toEqual([]);
    expect(diagnostic.access).toBe('active');
  });

  /**
   * The single hardest rule in this file: a diagnostic page is not a
   * reason to put the credential that cancels somebody's subscription on
   * a screen.
   */
  it('never returns the cancellation token, only whether one exists', async () => {
    const diagnostic = await getBillingDiagnostic(
      EMPLOYER_ID,
      createDeps({ entitlement: entitlement(), subscription: subscription() }),
    );

    expect(JSON.stringify(diagnostic)).not.toContain('tok_secret_value');
    expect(diagnostic.subscription?.hasCancellationToken).toBe(true);
    expect(diagnostic.subscription).not.toHaveProperty('emailToken');
  });

  it('flags a subscription with no cancellation token as uncancellable', async () => {
    const diagnostic = await getBillingDiagnostic(
      EMPLOYER_ID,
      createDeps({ entitlement: entitlement(), subscription: subscription({ emailToken: '' }) }),
    );

    expect(diagnostic.subscription?.hasCancellationToken).toBe(false);
    expect(diagnostic.findings.join(' ')).toContain('cancelling from inside the product will fail');
  });

  it('names the drift when the entitlement and the subscription disagree', async () => {
    const diagnostic = await getBillingDiagnostic(
      EMPLOYER_ID,
      createDeps({
        // Says active; the subscription's grace window closed nine days ago.
        entitlement: entitlement({ status: 'active' }),
        subscription: subscription({
          status: 'attention',
          graceEndsAt: '2026-09-01T00:00:00.000Z',
        }),
      }),
    );

    expect(diagnostic.access).toBe('suspended');
    expect(diagnostic.expectedEntitlementStatus).toBe('past_due');
    expect(diagnostic.inSync).toBe(false);
    expect(diagnostic.findings.join(' ')).toContain('A webhook was probably missed');
  });

  it('explains why a failed renewal is not being retried', async () => {
    const diagnostic = await getBillingDiagnostic(
      EMPLOYER_ID,
      createDeps({
        entitlement: entitlement(),
        subscription: subscription({
          status: 'attention',
          graceEndsAt: '2026-09-14T00:00:00.000Z',
          lastFailureReason: 'Insufficient Funds',
        }),
      }),
    );

    expect(diagnostic.findings.join(' ')).toContain('It does not retry');
  });

  it('explains that unfinished checkouts settle through reconciliation, not on their own', async () => {
    const diagnostic = await getBillingDiagnostic(
      EMPLOYER_ID,
      createDeps({
        entitlement: entitlement(),
        subscription: subscription(),
        payments: [attempt({ id: 'a1', status: 'initialized' })],
      }),
    );

    expect(diagnostic.findings.join(' ')).toContain('sends no webhook');
  });

  it('flags a reversal without pretending access has been dealt with', async () => {
    const diagnostic = await getBillingDiagnostic(
      EMPLOYER_ID,
      createDeps({
        entitlement: entitlement(),
        subscription: subscription(),
        payments: [attempt({ status: 'reversed' })],
      }),
    );

    expect(diagnostic.findings.join(' ')).toContain('never removed automatically');
  });

  it('flags an entitlement granting a plan with no subscription behind it', async () => {
    const diagnostic = await getBillingDiagnostic(
      EMPLOYER_ID,
      createDeps({ entitlement: entitlement({ plan: 'team' }), subscription: null }),
    );

    expect(diagnostic.findings.join(' ')).toContain('Nothing will renew');
  });

  it('orders the timeline newest first, across payments, invoices and the subscription', async () => {
    const diagnostic = await getBillingDiagnostic(
      EMPLOYER_ID,
      createDeps({
        entitlement: entitlement(),
        subscription: subscription(),
        invoices: [invoice({ createdAt: '2026-09-05T00:00:00.000Z' })],
        payments: [attempt({ createdAt: '2026-09-03T00:00:00.000Z' })],
      }),
    );

    const timestamps = diagnostic.timeline.map((entry) => entry.at);
    expect([...timestamps].sort((a, b) => b.localeCompare(a))).toEqual(timestamps);
    expect(diagnostic.timeline.map((entry) => entry.kind)).toContain('subscription');
  });

  it('reports an organization that has never paid without inventing findings', async () => {
    const diagnostic = await getBillingDiagnostic(EMPLOYER_ID, createDeps({}));
    expect(diagnostic.subscription).toBeNull();
    expect(diagnostic.access).toBe('none');
    expect(diagnostic.findings).toEqual([]);
  });
});
