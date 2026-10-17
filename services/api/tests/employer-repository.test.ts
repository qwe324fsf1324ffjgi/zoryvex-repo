import { beforeEach, describe, expect, it } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { GetCommand, TransactWriteCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { ddb } from '../src/repositories/dynamo-client';
import {
  createEmployerProfile,
  getEmployer,
  getEntitlement,
  updateEntitlement,
} from '../src/repositories/employer-repository';

process.env.TABLE_NAME = 'test-table';

const ddbMock = mockClient(ddb);

describe('createEmployerProfile', () => {
  beforeEach(() => ddbMock.reset());

  it('writes the profile and a none/none entitlement atomically', async () => {
    ddbMock.on(TransactWriteCommand).resolves({});
    await createEmployerProfile({
      employerId: 'emp_1',
      organizationName: 'Acme',
      contactEmail: 'a@acme.example',
      createdAt: '2026-08-19T00:00:00.000Z',
    });
    const call = ddbMock.commandCalls(TransactWriteCommand)[0];
    const items = call!.args[0].input.TransactItems ?? [];
    expect(items[0]?.Put?.Item).toMatchObject({ PK: 'EMPLOYER#emp_1', SK: 'PROFILE' });
    expect(items[1]?.Put?.Item).toMatchObject({
      PK: 'EMPLOYER#emp_1',
      SK: 'ENTITLEMENT',
      plan: 'none',
      status: 'none',
    });
  });
});

describe('getEmployer / getEntitlement', () => {
  beforeEach(() => ddbMock.reset());

  it('returns null when no profile exists', async () => {
    ddbMock.on(GetCommand).resolves({ Item: undefined });
    expect(await getEmployer('nonexistent')).toBeNull();
  });

  it('returns null when no entitlement item exists', async () => {
    ddbMock.on(GetCommand).resolves({ Item: undefined });
    expect(await getEntitlement('nonexistent')).toBeNull();
  });
});

describe('updateEntitlement', () => {
  beforeEach(() => ddbMock.reset());

  it('updates only the provided fields, requiring the item to already exist', async () => {
    ddbMock.on(UpdateCommand).resolves({
      Attributes: {
        employerId: 'emp_1',
        plan: 'kit',
        status: 'active',
        kitPurchasedAt: '2026-08-19T00:00:00.000Z',
        subscriptionRenewsAt: null,
      },
    });
    const result = await updateEntitlement('emp_1', {
      plan: 'kit',
      status: 'active',
      kitPurchasedAt: '2026-08-19T00:00:00.000Z',
    });
    const call = ddbMock.commandCalls(UpdateCommand)[0];
    expect(call!.args[0].input.ConditionExpression).toBe('attribute_exists(PK)');
    expect(result.plan).toBe('kit');
    expect(result.status).toBe('active');
  });
});
