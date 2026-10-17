import { beforeEach, describe, expect, it } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { GetCommand, QueryCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { ddb } from '../src/repositories/dynamo-client';
import {
  createKitOrderIfNotExists,
  getKitOrderForRole,
  listKitOrdersForEmployer,
} from '../src/repositories/kit-order-repository';
import type { KitOrder } from '@zoryvex/contracts';

process.env.TABLE_NAME = 'test-table';

const ddbMock = mockClient(ddb);

const order: KitOrder = {
  id: 'kit_1',
  employerId: 'emp_1',
  roleId: 'role_1',
  amountNGN: 29000,
  checkoutUrl: null,
  status: 'pending',
  paystackReference: 'ref_1',
  createdAt: '2026-08-19T00:00:00.000Z',
};

describe('createKitOrderIfNotExists', () => {
  beforeEach(() => ddbMock.reset());

  it('writes the idempotency-key guard item and the order atomically in one transaction', async () => {
    ddbMock.on(TransactWriteCommand).resolves({});
    const result = await createKitOrderIfNotExists(order, 'idem-key-1');
    expect(result.created).toBe(true);
    const call = ddbMock.commandCalls(TransactWriteCommand)[0];
    expect(call).toBeDefined();
    const items = call!.args[0].input.TransactItems ?? [];
    expect(items).toHaveLength(2);
    expect(items[0]?.Put?.Item).toMatchObject({
      PK: 'ROLE#role_1',
      SK: 'KITORDER_IDEMPOTENCY#idem-key-1',
      kitOrderId: 'kit_1',
    });
    expect(items[0]?.Put?.ConditionExpression).toBe('attribute_not_exists(PK)');
    expect(items[1]?.Put?.Item).toMatchObject({ PK: 'ROLE#role_1', SK: 'KITORDER#kit_1' });
  });

  it('on a replayed idempotency key, returns the original order instead of creating a second one', async () => {
    const error = Object.assign(new Error('transaction canceled'), {
      name: 'TransactionCanceledException',
    });
    ddbMock.on(TransactWriteCommand).rejects(error);
    ddbMock.on(GetCommand).callsFake((input) => {
      if (input.Key.SK === 'KITORDER_IDEMPOTENCY#idem-key-1') {
        return { Item: { kitOrderId: 'kit_1' } };
      }
      if (input.Key.SK === 'KITORDER#kit_1') {
        return { Item: order };
      }
      return {};
    });
    const result = await createKitOrderIfNotExists(order, 'idem-key-1');
    expect(result.created).toBe(false);
    expect(result.order.id).toBe('kit_1');
    // Only ever one attempt at the transaction — never a silent retry that
    // could create a second entitlement.
    expect(ddbMock.commandCalls(TransactWriteCommand)).toHaveLength(1);
  });
});

describe('getKitOrderForRole', () => {
  beforeEach(() => ddbMock.reset());

  it('returns the succeeded order when multiple attempts exist for the same role', async () => {
    ddbMock.on(QueryCommand).resolves({
      Items: [
        { ...order, id: 'kit_failed', status: 'failed' },
        { ...order, id: 'kit_succeeded', status: 'succeeded' },
      ],
    });
    const result = await getKitOrderForRole('role_1');
    expect(result?.id).toBe('kit_succeeded');
  });

  it('returns null when no order has succeeded yet', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [{ ...order, status: 'pending' }] });
    expect(await getKitOrderForRole('role_1')).toBeNull();
  });
});

describe('listKitOrdersForEmployer', () => {
  beforeEach(() => ddbMock.reset());

  it('queries GSI2 with an EMPLOYER# prefix, reused from the Paystack-customer-lookup index', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [order] });
    await listKitOrdersForEmployer('emp_1');
    const call = ddbMock.commandCalls(QueryCommand)[0];
    expect(call).toBeDefined();
    expect(call!.args[0].input.IndexName).toBe('GSI2');
    expect(call!.args[0].input.ExpressionAttributeValues).toEqual({
      ':pk': 'EMPLOYER#emp_1',
      ':prefix': 'KITORDER#',
    });
  });
});
