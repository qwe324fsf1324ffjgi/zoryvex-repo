import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import { sendQueueMessage } from '../src/repositories/sqs-repository';

const sqsMock = mockClient(SQSClient);

describe('sendQueueMessage', () => {
  beforeEach(() => {
    sqsMock.reset();
  });
  afterEach(() => {
    sqsMock.reset();
  });

  it('sends the body JSON-serialized as the message body to the given queue URL', async () => {
    sqsMock.on(SendMessageCommand).resolves({ MessageId: 'msg_1' });
    const queueUrl = 'https://sqs.eu-west-1.amazonaws.com/111111111111/zoryvex-test-webhooks';
    await sendQueueMessage(queueUrl, { eventId: 'evt_1', type: 'kit.order.paid' });

    const call = sqsMock.commandCalls(SendMessageCommand)[0];
    expect(call!.args[0].input).toEqual({
      QueueUrl: queueUrl,
      MessageBody: JSON.stringify({ eventId: 'evt_1', type: 'kit.order.paid' }),
    });
  });

  it('propagates an SQS error rather than swallowing it', async () => {
    sqsMock.on(SendMessageCommand).rejects(new Error('QueueDoesNotExist'));
    await expect(sendQueueMessage('https://example.invalid/queue', {})).rejects.toThrow(
      'QueueDoesNotExist',
    );
  });

  it('never logs or embeds the queue URL/body outside the single SendMessageCommand call (no secondary side channel)', async () => {
    sqsMock.on(SendMessageCommand).resolves({ MessageId: 'msg_2' });
    await sendQueueMessage('https://sqs.eu-west-1.amazonaws.com/111111111111/zoryvex-test-ai', {
      candidateId: 'cand_1',
    });
    expect(sqsMock.commandCalls(SendMessageCommand)).toHaveLength(1);
  });
});
