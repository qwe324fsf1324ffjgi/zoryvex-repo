import { DeleteCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { GradedAttemptRecordSchema, type GradedAttemptRecord } from '@zoryvex/contracts';
import { ddb, tableName } from './dynamo-client';

/**
 * What happened each time a candidate submitted a graded task.
 *
 * One item per attempt rather than a counter, because the point is the
 * sequence: which checks were outstanding at each stop. A count cannot tell
 * an employer the difference between passing first time and passing after
 * being told about a wildcard permission.
 *
 * Sorted by time inside the key, so a Query returns them in the order they
 * happened without the caller sorting or the store keeping a number. See
 * numberInOrder in domain/attempt-history-service for why the number is
 * derived on the way out rather than written down.
 *
 * Bounded by construction: verification-service refuses a sixth attempt per
 * evidence item, so this list can never exceed five entries and the Query
 * below needs no pagination.
 *
 * The submission itself is deliberately not among the attributes written.
 */

const PREFIX = 'GRADEDATTEMPT#';

function sortKey(evidenceId: string, at: string, id: string) {
  return `${PREFIX}${evidenceId}#${at}#${id}`;
}

export async function recordGradedAttempt(
  candidateId: string,
  id: string,
  attempt: GradedAttemptRecord,
): Promise<void> {
  await ddb.send(
    new PutCommand({
      TableName: tableName(),
      Item: {
        PK: `CANDIDATE#${candidateId}`,
        SK: sortKey(attempt.evidenceId, attempt.at, id),
        evidenceId: attempt.evidenceId,
        taskId: attempt.taskId,
        passed: attempt.passed,
        failedCheckIds: attempt.failedCheckIds,
        disqualified: attempt.disqualified,
        at: attempt.at,
      },
    }),
  );
}

export async function listGradedAttempts(
  candidateId: string,
  evidenceId: string,
): Promise<GradedAttemptRecord[]> {
  const result = await ddb.send(
    new QueryCommand({
      TableName: tableName(),
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: {
        ':pk': `CANDIDATE#${candidateId}`,
        ':sk': `${PREFIX}${evidenceId}#`,
      },
    }),
  );

  // Parsed rather than cast. A row written by an older shape that no longer
  // satisfies the contract is dropped instead of being handed to an employer
  // as a half-populated attempt.
  return (result.Items ?? []).flatMap((item) => {
    const parsed = GradedAttemptRecordSchema.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  });
}

/**
 * Removes every attempt recorded against one evidence item.
 *
 * Deletion left these behind until 2026-09-04. They sit on the candidate's
 * own partition and describe how they performed - which checks were
 * outstanding at each stop, and whether any attempt tripped a disqualifying
 * one - so an account deleted on request kept the most pointed record the
 * platform held about that person.
 *
 * No pagination, for the same reason the read has none: verification refuses
 * a sixth attempt per evidence item, so this can never exceed five.
 */
export async function deleteGradedAttemptsForEvidence(
  candidateId: string,
  evidenceId: string,
): Promise<void> {
  const result = await ddb.send(
    new QueryCommand({
      TableName: tableName(),
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: {
        ':pk': `CANDIDATE#${candidateId}`,
        ':sk': `${PREFIX}${evidenceId}#`,
      },
      ProjectionExpression: 'PK, SK',
    }),
  );

  for (const item of result.Items ?? []) {
    await ddb.send(
      new DeleteCommand({ TableName: tableName(), Key: { PK: item.PK, SK: item.SK } }),
    );
  }
}
