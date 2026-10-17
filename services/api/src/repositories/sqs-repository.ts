import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';

const sqs = new SQSClient({});

export async function sendQueueMessage(queueUrl: string, body: unknown): Promise<void> {
  await sqs.send(new SendMessageCommand({ QueueUrl: queueUrl, MessageBody: JSON.stringify(body) }));
}
