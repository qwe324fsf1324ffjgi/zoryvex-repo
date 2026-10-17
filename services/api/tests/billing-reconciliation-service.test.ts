import { describe, expect, it, vi } from 'vitest';
import type { AuditEvent, PaymentAttempt } from '@zoryvex/contracts';
import {
  ABANDON_AFTER_HOURS,
  RECONCILE_AFTER_MINUTES,
  reconcileBilling,
  type ReconciliationDependencies,
} from '../src/domain/billing-reconciliation-service';

const EMPLOYER_ID = 'emp_1';
const NOW = new Date('2026-09-01T12:00:00.000Z');
const HOUR = 60 * 60 * 1000;

function attempt(overrides: Partial<PaymentAttempt> = {}): PaymentAttempt {
  return {
    id: 'a1',
    employerId: EMPLOYER_ID,
    purpose: 'subscription',
    reference: 'sub.emp_1.a1',
    checkoutUrl: null,
    paystackTransactionId: null,
    amountNGN: 79_000,
    currency: 'NGN',
    status: 'initialized',
    paystackStatus: null,
    channel: null,
    gatewayResponse: null,
    failureReason: null,
    planCode: 'PLN_scoutfounding',
    plan: 'scout',
    interval: 'monthly',
    priceTier: 'founding',
    roleId: null,
    subscriptionCode: null,
    customerCode: null,
    correlationId: 'corr',
    verifiedAt: null,
    reconcileAttempts: 0,
    createdAt: new Date(NOW.getTime() - 2 * HOUR).toISOString(),
    updatedAt: new Date(NOW.getTime() - 2 * HOUR).toISOString(),
    ...overrides,
  };
}

function createDeps(open: PaymentAttempt[], overrides: Partial<ReconciliationDependencies> = {}) {
  const stored = new Map(open.map((a) => [a.id, a]));
  const granted: PaymentAttempt[] = [];
  const closed: PaymentAttempt[] = [];
  const audits: AuditEvent[] = [];
  const alerts: string[] = [];
  const listedBefore: string[] = [];

  const deps: ReconciliationDependencies = {
    clock: { now: () => NOW },
    async listOpenPaymentAttempts(createdBefore) {
      listedBefore.push(createdBefore);
      return [...stored.values()].filter((a) => a.createdAt < createdBefore);
    },
    async updatePaymentAttempt(_employerId, attemptId, expected, patch, updatedAt) {
      const existing = stored.get(attemptId);
      if (!existing || existing.status !== expected) return null;
      const updated = { ...existing, ...patch, updatedAt } as PaymentAttempt;
      stored.set(attemptId, updated);
      return updated;
    },
    async verifyTransaction(reference) {
      return {
        status: 'success',
        reference,
        amountKobo: 7_900_000,
        currency: 'NGN',
        transactionId: '999',
        channel: 'card',
        gatewayResponse: 'Successful',
        customerCode: 'CUS_1',
        customerEmail: 'ops@example.test',
      };
    },
    async listRemoteTransactions() {
      return [];
    },
    async findPaymentAttemptByReference(reference) {
      return [...stored.values()].find((a) => a.reference === reference) ?? null;
    },
    async applySuccessfulPayment(a) {
      granted.push(a);
    },
    async applyUnsuccessfulPayment(a) {
      closed.push(a);
    },
    async appendAuditEvent(event) {
      audits.push(event);
      return event;
    },
    async publishAlert(message) {
      alerts.push(message);
    },
    generateId: () => `id_${audits.length + 1}`,
    ...overrides,
  };

  return { deps, stored, granted, closed, audits, alerts, listedBefore };
}

describe('reconcileBilling', () => {
  /**
   * The gap that makes this job mandatory rather than nice to have:
   * Paystack sends webhooks for successful transactions only, so a
   * `charge.success` whose delivery failed leaves a customer charged with
   * nothing to show for it, and nothing arrives to say so.
   */
  it('recovers a payment that succeeded but whose webhook never arrived', async () => {
    const { deps, stored, granted, audits, alerts } = createDeps([attempt()]);
    const report = await reconcileBilling(deps);

    expect(stored.get('a1')?.status).toBe('success');
    expect(granted).toHaveLength(1);
    expect(report.granted).toBe(1);
    expect(audits.map((a) => a.action)).toContain('payment_recovered_by_reconciliation');
    // Worth telling a person: a payment only reconciliation caught means
    // webhook delivery is broken, and it will break again.
    expect(alerts.join(' ')).toContain('no webhook was processed');
  });

  it('only looks at attempts old enough that a buyer would have finished', async () => {
    const { deps, listedBefore } = createDeps([]);
    await reconcileBilling(deps);

    const cutoff = Date.parse(listedBefore[0] ?? '');

    // Thirty minutes, written out rather than taken from the constant the
    // code under test uses. Comparing the cutoff against
    // RECONCILE_AFTER_MINUTES moved both sides of the assertion together,
    // so the test held for any value including zero — a mutation run set
    // it to 0 and nothing went red.
    //
    // The number is not arbitrary. Paystack's hosted checkout lets a buyer
    // leave to authorise a transfer in a banking app, and asking too early
    // finds an attempt that is still genuinely in progress. This is the
    // window that keeps reconciliation from forming an opinion about a
    // payment that has not finished happening.
    expect(NOW.getTime() - cutoff).toBe(30 * 60 * 1000);
    expect(RECONCILE_AFTER_MINUTES).toBe(30);
  });

  it('grants nothing when Paystack reports a different amount', async () => {
    const { deps, stored, granted, alerts } = createDeps([attempt()], {
      verifyTransaction: async (reference) => ({
        status: 'success',
        reference,
        amountKobo: 100,
        currency: 'NGN',
        transactionId: '999',
        channel: 'card',
        gatewayResponse: 'Successful',
        customerCode: null,
        customerEmail: null,
      }),
    });

    const report = await reconcileBilling(deps);
    expect(stored.get('a1')?.status).toBe('initialized');
    expect(granted).toEqual([]);
    expect(report.discrepancies).toHaveLength(1);
    expect(alerts.join(' ')).toContain('expected 7900000 NGN');
  });

  it('grants nothing when Paystack reports a different currency', async () => {
    const { deps, granted } = createDeps([attempt()], {
      verifyTransaction: async (reference) => ({
        status: 'success',
        reference,
        amountKobo: 7_900_000,
        currency: 'USD',
        transactionId: '999',
        channel: null,
        gatewayResponse: null,
        customerCode: null,
        customerEmail: null,
      }),
    });

    await reconcileBilling(deps);
    expect(granted).toEqual([]);
  });

  /**
   * Seen in production. A real buyer's card was declined; reconciliation
   * settled the payment attempt to `failed` and nothing touched the Kit
   * order, which had been written `pending` before Paystack was
   * contacted. An hour later the role page still read "Payment pending."
   *
   * Not a loss of money, and not something that blocks buying again —
   * `getKitOrderForRole` only treats a succeeded order as a purchase. It
   * is the product telling a customer something untrue and never
   * correcting itself, which is the definition of a stale state.
   */
  it('closes the Kit order when its payment definitively failed', async () => {
    const { deps, closed } = createDeps([attempt({ purpose: 'kit', roleId: 'role_1' })], {
      verifyTransaction: async (reference) => ({
        status: 'failed',
        reference,
        amountKobo: 9_500_000,
        currency: 'NGN',
        transactionId: '999',
        channel: 'card',
        gatewayResponse: 'Insufficient Funds',
        customerCode: null,
        customerEmail: null,
      }),
    });

    await reconcileBilling(deps);
    expect(closed.map((a) => a.id)).toEqual(['a1']);
    expect(closed[0]?.status).toBe('failed');
  });

  it('closes it when an unfinished checkout is finally aged out', async () => {
    const old = attempt({
      purpose: 'kit',
      roleId: 'role_1',
      createdAt: new Date(NOW.getTime() - 48 * HOUR).toISOString(),
    });
    const { deps, closed } = createDeps([old], {
      verifyTransaction: async (reference) => ({
        status: 'pending',
        reference,
        amountKobo: 9_500_000,
        currency: 'NGN',
        transactionId: null,
        channel: null,
        gatewayResponse: null,
        customerCode: null,
        customerEmail: null,
      }),
    });

    await reconcileBilling(deps);
    expect(closed).toHaveLength(1);
    expect(closed[0]?.status).toBe('abandoned');
  });

  it('leaves a successful payment to the success path, not this one', async () => {
    const { deps, closed, granted } = createDeps([attempt({ purpose: 'kit', roleId: 'role_1' })]);
    await reconcileBilling(deps);
    expect(granted).toHaveLength(1);
    expect(closed).toEqual([]);
  });

  it('settles a card that was declined at the hosted checkout', async () => {
    const { deps, stored } = createDeps([attempt()], {
      verifyTransaction: async (reference) => ({
        status: 'failed',
        reference,
        amountKobo: 7_900_000,
        currency: 'NGN',
        transactionId: '999',
        channel: 'card',
        gatewayResponse: 'Insufficient Funds',
        customerCode: null,
        customerEmail: null,
      }),
    });

    await reconcileBilling(deps);
    expect(stored.get('a1')?.status).toBe('failed');
    expect(stored.get('a1')?.failureReason).toBe('Insufficient Funds');
  });

  it('mirrors an in-flight payment without settling it', async () => {
    const { deps, stored } = createDeps([attempt()], {
      verifyTransaction: async (reference) => ({
        status: 'ongoing',
        reference,
        amountKobo: 7_900_000,
        currency: 'NGN',
        transactionId: null,
        channel: 'bank_transfer',
        gatewayResponse: null,
        customerCode: null,
        customerEmail: null,
      }),
    });

    const report = await reconcileBilling(deps);
    expect(stored.get('a1')?.status).toBe('ongoing');
    expect(report.abandoned).toBe(0);
  });

  it("takes Paystack's own abandoned verdict as a settlement", async () => {
    const { deps, stored } = createDeps([attempt()], {
      verifyTransaction: async (reference) => ({
        status: 'abandoned',
        reference,
        amountKobo: 7_900_000,
        currency: 'NGN',
        transactionId: null,
        channel: null,
        gatewayResponse: null,
        customerCode: null,
        customerEmail: null,
      }),
    });

    const report = await reconcileBilling(deps);
    expect(stored.get('a1')?.status).toBe('abandoned');
    // Settled by Paystack, not aged out by us. The two counters are
    // different signals: one says a checkout ended, the other says this job
    // gave up waiting, and only the second is worth investigating.
    expect(report.settled).toBe(1);
    expect(report.abandoned).toBe(0);
  });

  it('ages out a payment Paystack still calls pending long after anyone stopped waiting', async () => {
    const stale = attempt({
      createdAt: new Date(NOW.getTime() - (ABANDON_AFTER_HOURS + 1) * HOUR).toISOString(),
    });
    const { deps, stored } = createDeps([stale], {
      verifyTransaction: async (reference) => ({
        status: 'pending',
        reference,
        amountKobo: 7_900_000,
        currency: 'NGN',
        transactionId: null,
        channel: null,
        gatewayResponse: null,
        customerCode: null,
        customerEmail: null,
      }),
    });

    const report = await reconcileBilling(deps);
    expect(stored.get('a1')?.status).toBe('abandoned');
    expect(report.abandoned).toBe(1);
  });

  it('leaves a recent pending payment pending rather than aging it out early', async () => {
    const { deps, stored } = createDeps([attempt()], {
      verifyTransaction: async (reference) => ({
        status: 'pending',
        reference,
        amountKobo: 7_900_000,
        currency: 'NGN',
        transactionId: null,
        channel: null,
        gatewayResponse: null,
        customerCode: null,
        customerEmail: null,
      }),
    });

    const report = await reconcileBilling(deps);
    expect(stored.get('a1')?.status).toBe('pending');
    expect(report.abandoned).toBe(0);
  });

  /**
   * Refusing to guess is the point. The only two available guesses for a
   * status nobody has read about are "revoke paid access" and "grant paid
   * access", and both are wrong more often than a report is.
   */
  it('reports rather than maps a status Paystack has added since', async () => {
    const { deps, stored, alerts } = createDeps([attempt()], {
      verifyTransaction: async (reference) => ({
        status: 'held_for_review',
        reference,
        amountKobo: 7_900_000,
        currency: 'NGN',
        transactionId: null,
        channel: null,
        gatewayResponse: null,
        customerCode: null,
        customerEmail: null,
      }),
    });

    const report = await reconcileBilling(deps);
    expect(stored.get('a1')?.status).toBe('initialized');
    expect(report.discrepancies[0]).toContain('unrecognized status');
    expect(alerts).toHaveLength(1);
  });

  it('leaves an attempt exactly as it was when Paystack is unreachable', async () => {
    const { deps, stored } = createDeps([attempt()], {
      verifyTransaction: vi.fn().mockRejectedValue(new Error('network down')),
    });

    const report = await reconcileBilling(deps);
    expect(stored.get('a1')?.status).toBe('initialized');
    expect(stored.get('a1')?.reconcileAttempts).toBe(1);
    expect(report.unreachable).toBe(1);
  });

  /**
   * The race with the webhook. Both routes end at the same conditional
   * write, so whichever arrives second loses its condition and must stop
   * rather than granting a second time.
   */
  it('stops when a webhook settled the same payment a moment earlier', async () => {
    const { deps, granted } = createDeps([attempt()], {
      // Simulates the conditional update failing because the stored status
      // is no longer what was read.
      updatePaymentAttempt: async () => null,
    });

    const report = await reconcileBilling(deps);
    expect(granted).toEqual([]);
    expect(report.granted).toBe(0);
  });

  it('never moves a settled payment backwards', async () => {
    const { deps, stored } = createDeps([attempt({ status: 'success' })], {
      verifyTransaction: async (reference) => ({
        status: 'abandoned',
        reference,
        amountKobo: 7_900_000,
        currency: 'NGN',
        transactionId: null,
        channel: null,
        gatewayResponse: null,
        customerCode: null,
        customerEmail: null,
      }),
    });

    await reconcileBilling(deps);
    expect(stored.get('a1')?.status).toBe('success');
  });

  describe('the other direction: money Paystack has that we do not', () => {
    it('reports a successful payment with no local record at all', async () => {
      const { deps, alerts } = createDeps([], {
        listRemoteTransactions: async () => [
          { reference: 'sub.emp_9.unknown', status: 'success', amountKobo: 7_900_000 },
        ],
        findPaymentAttemptByReference: async () => null,
      });

      const report = await reconcileBilling(deps);
      expect(report.discrepancies[0]).toContain('no record in this system');
      expect(alerts).toHaveLength(1);
    });

    it('ignores Paystack-generated renewal references, which never have an attempt row', async () => {
      const { deps } = createDeps([], {
        listRemoteTransactions: async () => [
          { reference: '9cfbae6e-bbf3-5b41-8aef-d72c1a17650g', status: 'success', amountKobo: 1 },
        ],
      });

      const report = await reconcileBilling(deps);
      expect(report.discrepancies).toEqual([]);
    });

    /**
     * The Kit is the case that matters most. Its order record only ever
     * moves to `succeeded` from a webhook, so before it had a payment
     * attempt beside it, a Kit that was paid for and never webhooked was
     * unrecoverable: the employer had paid and had nothing.
     */
    it('reports a paid Kit reference with no record here', async () => {
      const { deps, alerts } = createDeps([], {
        listRemoteTransactions: async () => [
          {
            reference: '2f1a7c34-1b6e-4d0a-9f2c-5c9a1b2d3e4f.9b8c7d6e-5f4a-3b2c-1d0e-9f8a7b6c5d4e',
            status: 'success',
            amountKobo: 9_500_000,
          },
        ],
        findPaymentAttemptByReference: async () => null,
      });

      const report = await reconcileBilling(deps);
      expect(report.discrepancies[0]).toContain('no record in this system');
      expect(alerts).toHaveLength(1);
    });

    it('does not fail the whole run when Paystack cannot be listed', async () => {
      const { deps } = createDeps([], {
        listRemoteTransactions: vi.fn().mockRejectedValue(new Error('rate limited')),
      });

      await expect(reconcileBilling(deps)).resolves.toMatchObject({ unreachable: 1 });
    });
  });

  it('says nothing to anybody when there is nothing to say', async () => {
    const { deps, alerts } = createDeps([]);
    const report = await reconcileBilling(deps);
    expect(report.checked).toBe(0);
    expect(alerts).toEqual([]);
  });
});
