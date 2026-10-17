import { beforeEach, describe, expect, it } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { ddb } from '../src/repositories/dynamo-client';
import { consumeAuthToken, createAuthToken } from '../src/repositories/auth-token-repository';

process.env.TABLE_NAME = 'test-table';

const ddbMock = mockClient(ddb);

describe('createAuthToken', () => {
  beforeEach(() => ddbMock.reset());

  it('writes the AUTHTOKEN item at the exact key docs/DATA_MODEL.md specifies', async () => {
    ddbMock.on(PutCommand).resolves({});
    await createAuthToken({
      tokenHash: 'hash123',
      email: 'a@example.com',
      intendedRole: 'candidate',
      existingAccountId: null,
      createdAt: '2026-08-19T00:00:00.000Z',
      expiresAt: '2026-08-19T00:10:00.000Z',
      ttlEpochSeconds: 1_000_000,
    });
    const call = ddbMock.commandCalls(PutCommand)[0];
    expect(call).toBeDefined();
    expect(call!.args[0].input.Item).toMatchObject({
      PK: 'AUTHTOKEN#hash123',
      SK: 'AUTHTOKEN',
      consumed: false,
    });
  });
});

describe('consumeAuthToken', () => {
  beforeEach(() => ddbMock.reset());

  it('sends the exact consume-once conditional expression, with "consumed" aliased (DynamoDB reserved word)', async () => {
    ddbMock.on(UpdateCommand).resolves({
      Attributes: {
        email: 'a@example.com',
        intendedRole: 'candidate',
        existingAccountId: null,
        createdAt: '2026-08-19T00:00:00.000Z',
        expiresAt: '2026-08-19T00:10:00.000Z',
      },
    });
    const result = await consumeAuthToken('hash123');
    const call = ddbMock.commandCalls(UpdateCommand)[0];
    expect(call).toBeDefined();
    expect(call!.args[0].input.UpdateExpression).toBe('SET #consumed = :true');
    expect(call!.args[0].input.ConditionExpression).toBe(
      'attribute_exists(PK) AND #consumed = :false',
    );
    expect(call!.args[0].input.ExpressionAttributeNames).toEqual({ '#consumed': 'consumed' });
    expect(call!.args[0].input.Key).toEqual({ PK: 'AUTHTOKEN#hash123', SK: 'AUTHTOKEN' });
    expect(result?.consumed).toBe(true);
  });

  it('never uses the literal, unaliased attribute name "consumed" in an expression string (the real DynamoDB-reserved-word bug)', async () => {
    ddbMock.on(UpdateCommand).resolves({
      Attributes: {
        email: 'a@example.com',
        intendedRole: 'candidate',
        existingAccountId: null,
        createdAt: '2026-08-19T00:00:00.000Z',
        expiresAt: '2026-08-19T00:10:00.000Z',
      },
    });
    await consumeAuthToken('hash123');
    const call = ddbMock.commandCalls(UpdateCommand)[0]!;
    const { UpdateExpression, ConditionExpression } = call.args[0].input;
    expect(UpdateExpression).not.toMatch(/(?<!#)\bconsumed\b/);
    expect(ConditionExpression).not.toMatch(/(?<!#)\bconsumed\b/);
  });

  it('returns null (never throws) when the condition fails — already consumed or never existed', async () => {
    const error = Object.assign(new Error('conditional check failed'), {
      name: 'ConditionalCheckFailedException',
    });
    ddbMock.on(UpdateCommand).rejects(error);
    const result = await consumeAuthToken('hash123');
    expect(result).toBeNull();
  });

  it('propagates a genuine, unrelated DynamoDB error rather than swallowing it', async () => {
    const error = Object.assign(new Error('throttled'), {
      name: 'ProvisionedThroughputExceededException',
    });
    ddbMock.on(UpdateCommand).rejects(error);
    await expect(consumeAuthToken('hash123')).rejects.toThrow('throttled');
  });
});
