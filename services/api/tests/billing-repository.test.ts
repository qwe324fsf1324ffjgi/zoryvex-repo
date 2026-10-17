import { beforeEach, describe, expect, it } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { TERMINAL_PAYMENT_STATUSES } from '@zoryvex/contracts';
import { ddb } from '../src/repositories/dynamo-client';
import {
  updateBillingSubscription,
  updatePaymentAttempt,
} from '../src/repositories/billing-repository';

process.env.TABLE_NAME = 'test-table';

const ddbMock = mockClient(ddb);

/**
 * The riskiest expression in the money path, and it had no test of its own.
 *
 * Domain-level tests exercise this through fakes, which prove the caller's
 * logic and say nothing about what is actually sent to DynamoDB. Two
 * properties here are only visible in the command itself:
 *
 * The condition is a compare-and-swap on `status`. It is what makes a
 * redelivered webhook and the reconciliation job safe to race - the loser
 * gets a ConditionalCheckFailed, this returns null, and the caller stops
 * rather than settling a payment twice.
 *
 * A settling update also REMOVEs the GSI2 keys. That index is sparse and is
 * the reconciliation job's work list, so a payment that reached a terminal
 * status has to drop off it. Losing that clause would leave every settled
 * payment on the list forever, which no assertion about return values would
 * notice.
 */

const attempt = {
  id: 'pay_1',
  employerId: 'emp_1',
  purpose: 'subscription',
  reference: 'ref_1',
  checkoutUrl: null,
  paystackTransactionId: null,
  amountNGN: 300_000,
  currency: 'NGN',
  status: 'success',
  paystackStatus: null,
  channel: null,
  gatewayResponse: null,
  failureReason: null,
  plan: 'scout',
  interval: 'monthly',
  priceTier: 'founding',
  planCode: null,
  roleId: null,
  subscriptionCode: null,
  customerCode: null,
  correlationId: 'corr_1',
  verifiedAt: null,
  reconcileAttempts: 0,
  createdAt: '2026-08-19T00:00:00.000Z',
  updatedAt: '2026-08-19T00:00:00.000Z',
};

function lastUpdate() {
  const call = ddbMock.commandCalls(UpdateCommand)[0];
  expect(call, 'no UpdateCommand was sent').toBeDefined();
  return call!.args[0].input;
}

/**
 * The guard that stops an event about an old subscription landing on the
 * one the employer actually has.
 *
 * A subscription row is keyed by employer, so there is only ever one.
 * Paystack keeps every subscription an employer has ever had and goes on
 * raising events for the abandoned ones, addressed by a code that still
 * resolves to the same employer. The condition is what separates them.
 */
describe('updateBillingSubscription', () => {
  const subscription = {
    employerId: 'emp_1',
    subscriptionCode: 'SUB_current1',
    customerCode: 'CUS_1',
    planCode: 'PLN_1',
    plan: 'scout',
    interval: 'monthly',
    priceTier: 'founding',
    priceNGN: 800_000,
    status: 'active',
    emailToken: 'tok',
    nextPaymentDate: null,
    currentPeriodStart: null,
    currentPeriodEnd: null,
    graceEndsAt: null,
    lastFailureReason: null,
    card: null,
    cancelRequestedAt: null,
    createdAt: '2026-08-19T00:00:00.000Z',
    updatedAt: '2026-08-19T00:00:00.000Z',
  };

  beforeEach(() => ddbMock.reset());

  it('applies unconditionally when no subscription code is given', async () => {
    ddbMock.on(UpdateCommand).resolves({ Attributes: subscription });
    await updateBillingSubscription('emp_1', { status: 'active' }, '2026-09-10T00:00:00.000Z');
    expect(lastUpdate().ConditionExpression).toBe('attribute_exists(PK)');
  });

  it('applies only to the named subscription when one is given', async () => {
    ddbMock.on(UpdateCommand).resolves({ Attributes: subscription });
    await updateBillingSubscription(
      'emp_1',
      { status: 'cancelled' },
      '2026-09-10T00:00:00.000Z',
      'SUB_current1',
    );

    const input = lastUpdate();
    expect(input.ConditionExpression).toBe(
      'attribute_exists(PK) AND #subscriptionCode = :expectedSubscriptionCode',
    );
    expect(input.ExpressionAttributeValues?.[':expectedSubscriptionCode']).toBe('SUB_current1');
    expect(input.ExpressionAttributeNames?.['#subscriptionCode']).toBe('subscriptionCode');
  });

  it('returns null rather than throwing when the code no longer matches', async () => {
    ddbMock.on(UpdateCommand).rejects(
      Object.assign(new Error('The conditional request failed'), {
        name: 'ConditionalCheckFailedException',
      }),
    );

    await expect(
      updateBillingSubscription(
        'emp_1',
        { status: 'cancelled' },
        '2026-09-10T00:00:00.000Z',
        'SUB_old1',
      ),
    ).resolves.toBeNull();
  });
});

describe('updatePaymentAttempt', () => {
  beforeEach(() => ddbMock.reset());

  it('only applies while the attempt is still in the status the caller read', async () => {
    ddbMock.on(UpdateCommand).resolves({ Attributes: attempt });
    await updatePaymentAttempt('emp_1', 'pay_1', 'initialized', { status: 'success' }, 'now');

    const input = lastUpdate();
    expect(input.ConditionExpression).toBe('attribute_exists(PK) AND #status = :expected');
    expect(input.ExpressionAttributeValues?.[':expected']).toBe('initialized');
  });

  it('addresses the attempt by its own key', async () => {
    ddbMock.on(UpdateCommand).resolves({ Attributes: attempt });
    await updatePaymentAttempt('emp_1', 'pay_1', 'initialized', { status: 'success' }, 'now');
    expect(lastUpdate().Key).toMatchObject({ PK: 'EMPLOYER#emp_1' });
  });

  /**
   * The clause that keeps the reconciliation list finite. Asserted for every
   * terminal status rather than one, because the rule is the status being
   * terminal and not any particular value.
   */
  it.each(TERMINAL_PAYMENT_STATUSES)(
    'drops a %s payment off the reconciliation index',
    async (status) => {
      ddbMock.on(UpdateCommand).resolves({ Attributes: { ...attempt, status } });
      await updatePaymentAttempt('emp_1', 'pay_1', 'initialized', { status }, 'now');

      const input = lastUpdate();
      expect(input.UpdateExpression).toContain('REMOVE #gsi2pk, #gsi2sk');
      expect(input.ExpressionAttributeNames).toMatchObject({
        '#gsi2pk': 'GSI2PK',
        '#gsi2sk': 'GSI2SK',
      });
    },
  );

  it('leaves a still-open payment on the index', async () => {
    // The other direction. Removing the keys before a payment settles would
    // hide it from the job that exists to chase it.
    ddbMock.on(UpdateCommand).resolves({ Attributes: attempt });
    await updatePaymentAttempt('emp_1', 'pay_1', 'initialized', { reconcileAttempts: 1 }, 'now');
    expect(lastUpdate().UpdateExpression).not.toContain('REMOVE');
  });

  it('returns null rather than throwing when another writer got there first', async () => {
    // How a redelivered webhook and the reconciliation job are safe to race:
    // the loser is told it lost and stops, instead of settling twice.
    const conditionalFailure = Object.assign(new Error('conditional'), {
      name: 'ConditionalCheckFailedException',
    });
    ddbMock.on(UpdateCommand).rejects(conditionalFailure);

    await expect(
      updatePaymentAttempt('emp_1', 'pay_1', 'initialized', { status: 'success' }, 'now'),
    ).resolves.toBeNull();
  });

  it('rethrows anything that is not a lost race', async () => {
    // A throttle or an AccessDenied must not read as "somebody else won".
    ddbMock.on(UpdateCommand).rejects(new Error('ProvisionedThroughputExceededException'));
    await expect(
      updatePaymentAttempt('emp_1', 'pay_1', 'initialized', { status: 'success' }, 'now'),
    ).rejects.toThrow();
  });

  it('always stamps updatedAt, so a row cannot look untouched', async () => {
    ddbMock.on(UpdateCommand).resolves({ Attributes: attempt });
    await updatePaymentAttempt('emp_1', 'pay_1', 'initialized', { status: 'success' }, 'stamp');
    expect(lastUpdate().ExpressionAttributeValues?.[':updatedAt']).toBe('stamp');
  });
});
