import { beforeEach, describe, expect, it } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { PutCommand } from '@aws-sdk/lib-dynamodb';
import { ddb } from '../src/repositories/dynamo-client';
import { recordWebhookEventOnce } from '../src/repositories/webhook-repository';

process.env.TABLE_NAME = 'test-table';

const ddbMock = mockClient(ddb);

describe('recordWebhookEventOnce', () => {
  beforeEach(() => ddbMock.reset());

  it('returns true and writes PK=WEBHOOK#<id>/SK=EVENT the first time', async () => {
    ddbMock.on(PutCommand).resolves({});
    const result = await recordWebhookEventOnce('evt_1', '2026-08-19T00:00:00.000Z', 'emp_1');
    expect(result).toBe(true);
    const call = ddbMock.commandCalls(PutCommand)[0];
    expect(call).toBeDefined();
    expect(call!.args[0].input.Item).toMatchObject({
      PK: 'WEBHOOK#evt_1',
      SK: 'EVENT',
      employerId: 'emp_1',
    });
    expect(call!.args[0].input.ConditionExpression).toBe('attribute_not_exists(PK)');
  });

  it('returns false on a replayed event id, never throwing — caller must skip re-applying the effect', async () => {
    const error = Object.assign(new Error('conditional check failed'), {
      name: 'ConditionalCheckFailedException',
    });
    ddbMock.on(PutCommand).rejects(error);
    const result = await recordWebhookEventOnce('evt_1', '2026-08-19T00:00:00.000Z');
    expect(result).toBe(false);
  });

  it('propagates a genuine unrelated DynamoDB error instead of masking it as a duplicate', async () => {
    const error = Object.assign(new Error('throttled'), {
      name: 'ProvisionedThroughputExceededException',
    });
    ddbMock.on(PutCommand).rejects(error);
    await expect(recordWebhookEventOnce('evt_1', '2026-08-19T00:00:00.000Z')).rejects.toThrow(
      'throttled',
    );
  });
});
