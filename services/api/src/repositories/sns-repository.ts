import { PublishCommand, SNSClient } from '@aws-sdk/client-sns';

const sns = new SNSClient({});

/** Publishes to the environment's existing alerts topic (infrastructure/modules/observability) — SNS → founder's personal Gmail. */
export async function publishAlert(message: string): Promise<void> {
  const topicArn = process.env.ALERTS_TOPIC_ARN;
  if (!topicArn) throw new Error('ALERTS_TOPIC_ARN environment variable is not set');
  await sns.send(new PublishCommand({ TopicArn: topicArn, Message: message }));
}
