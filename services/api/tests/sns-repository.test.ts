import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { PublishCommand, SNSClient } from '@aws-sdk/client-sns';
import { publishAlert } from '../src/repositories/sns-repository';

const snsMock = mockClient(SNSClient);

describe('publishAlert', () => {
  beforeEach(() => {
    snsMock.reset();
    process.env.ALERTS_TOPIC_ARN = 'arn:aws:sns:eu-west-1:111111111111:zoryvex-test-alerts';
  });
  afterEach(() => {
    delete process.env.ALERTS_TOPIC_ARN;
  });

  it('publishes the message to the configured alerts topic', async () => {
    snsMock.on(PublishCommand).resolves({});
    await publishAlert('something happened');
    const call = snsMock.commandCalls(PublishCommand)[0];
    expect(call!.args[0].input).toEqual({
      TopicArn: 'arn:aws:sns:eu-west-1:111111111111:zoryvex-test-alerts',
      Message: 'something happened',
    });
  });

  it('throws when ALERTS_TOPIC_ARN is not set, without calling SNS', async () => {
    delete process.env.ALERTS_TOPIC_ARN;
    await expect(publishAlert('x')).rejects.toThrow('ALERTS_TOPIC_ARN');
    expect(snsMock.commandCalls(PublishCommand)).toHaveLength(0);
  });
});
