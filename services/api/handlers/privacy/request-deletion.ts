import { httpResult, toHttpResponse } from '../../src/adapter/http';
import { requireSessionContext, type AuthorizedEvent } from '../../src/http/session-context';
import { ForbiddenError } from '../../src/errors/typed-errors';
import { sendQueueMessage } from '../../src/repositories/sqs-repository';

/**
 * candidate only, own record only. Deliberately asynchronous (Prompt 7:
 * "Deletion is asynchronous, auditable") — enqueues onto the deletion
 * queue and returns immediately; src/domain/deletion-service.ts does the
 * actual work via handlers/privacy/deletion-worker.ts.
 */
export const handler = async (event: AuthorizedEvent) =>
  toHttpResponse(async () => {
    const session = requireSessionContext(event);
    if (session.role !== 'candidate' || !session.candidateId)
      throw new ForbiddenError('candidate only');

    const queueUrl = process.env.DELETION_QUEUE_URL;
    if (!queueUrl) throw new Error('DELETION_QUEUE_URL environment variable is not set');

    await sendQueueMessage(queueUrl, {
      candidateId: session.candidateId,
      requestedAt: new Date().toISOString(),
    });

    return httpResult({ statusCode: 202, body: { accepted: true } });
  });
