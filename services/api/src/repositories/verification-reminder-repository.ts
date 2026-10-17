import { DeleteCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, tableName } from './dynamo-client';
import { isConditionalCheckFailed } from './dynamo-errors';

/**
 * The record that makes "one reminder, ever" true.
 *
 * A conditional put on a permanent item, not a counter and not a TTL'd one:
 * the promise made in the email is that this is the only reminder we will
 * send, and an expiring record would quietly turn that into a recurring one
 * some months later.
 */
export async function claimReminderSlot(candidateId: string, at: string): Promise<boolean> {
  try {
    await ddb.send(
      new PutCommand({
        TableName: tableName(),
        Item: {
          PK: `CANDIDATE#${candidateId}`,
          SK: 'VERIFYREMINDER',
          sentAt: at,
        },
        ConditionExpression: 'attribute_not_exists(PK)',
      }),
    );
    return true;
  } catch (error) {
    // Already reminded. Not an error, and the single most important branch
    // in this file.
    if (isConditionalCheckFailed(error)) return false;
    throw error;
  }
}

/**
 * Releases the reminder slot, so a deleted account leaves no record that it
 * was ever reminded.
 *
 * Deliberately not TTL'd in normal life - the promise is one reminder ever,
 * and an expiring record would quietly make it recurring - which is exactly
 * why deletion has to remove it explicitly.
 */
export async function deleteReminderSlot(candidateId: string): Promise<void> {
  await ddb.send(
    new DeleteCommand({
      TableName: tableName(),
      Key: { PK: `CANDIDATE#${candidateId}`, SK: 'VERIFYREMINDER' },
    }),
  );
}
