import type { SQSHandler } from 'aws-lambda';
import { deleteCandidateData } from '../../src/domain/deletion-service';
import { createAwsDeletionDependencies } from '../../src/composition/aws-privacy-dependencies';

const deps = createAwsDeletionDependencies();

interface DeletionMessage {
  candidateId: string;
  requestedAt: string;
}

/**
 * SQS-triggered. A thrown error here lets SQS redeliver the message (up to
 * the queue's max_receive_count) and eventually move it to the DLQ, which
 * already alarms to the founder's SNS topic
 * (infrastructure/modules/messaging) — this is the "deletion-failure
 * alarm" Prompt 7 asks for, not a bespoke one.
 */
export const handler: SQSHandler = async (event) => {
  for (const record of event.Records) {
    const message = JSON.parse(record.body) as DeletionMessage;
    await deleteCandidateData(message.candidateId, deps);
  }
};
