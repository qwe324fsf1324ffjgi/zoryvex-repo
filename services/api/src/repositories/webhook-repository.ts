import { DeleteCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, tableName } from './dynamo-client';
import { isConditionalCheckFailed } from './dynamo-errors';

/**
 * docs/DATA_MODEL.md access pattern #9. Returns true the first time a given
 * Paystack event ID is seen, false on every replay — callers must skip
 * re-applying the event's effect (e.g. re-crediting an entitlement) on
 * `false`, per Prompt 7: "Concurrent/replayed events must not generate
 * extra paid entitlements."
 */
export async function recordWebhookEventOnce(
  eventId: string,
  receivedAt: string,
  employerId?: string,
): Promise<boolean> {
  try {
    await ddb.send(
      new PutCommand({
        TableName: tableName(),
        Item: {
          PK: `WEBHOOK#${eventId}`,
          SK: 'EVENT',
          receivedAt,
          ...(employerId ? { employerId } : {}),
        },
        ConditionExpression: 'attribute_not_exists(PK)',
      }),
    );
    return true;
  } catch (error) {
    if (isConditionalCheckFailed(error)) return false;
    throw error;
  }
}

/**
 * Atomic ledger example (Prompt 7: "Maintain atomic counters/ledgers ...
 * reconcile from immutable entitlement events"). Not called from the
 * webhook dedupe path itself — a generic primitive for any domain
 * (contact-unlock allowances, seat counts) that needs a monotonic counter
 * derived from append-only events rather than a client-supplied number.
 */
export async function incrementLedgerCounter(
  ledgerPk: string,
  ledgerSk: string,
  delta: number,
): Promise<number> {
  const result = await ddb.send(
    new UpdateCommand({
      TableName: tableName(),
      Key: { PK: ledgerPk, SK: ledgerSk },
      UpdateExpression: 'ADD #count :delta',
      ExpressionAttributeNames: { '#count': 'count' },
      ExpressionAttributeValues: { ':delta': delta },
      ReturnValues: 'UPDATED_NEW',
    }),
  );
  return Number(result.Attributes?.count ?? 0);
}

/**
 * Removes an idempotency marker so a Paystack retry can genuinely
 * re-attempt the event.
 *
 * Only ever called after the effect failed part-way. The marker exists to
 * stop two concurrent deliveries both applying the same event; once one of
 * them has failed and applied nothing durable, keeping the marker would
 * mean Paystack's retries — every three minutes, then hourly for
 * seventy-two hours — all short-circuit as duplicates, and a payment the
 * customer made is simply lost.
 */
export async function forgetWebhookEvent(eventId: string): Promise<void> {
  await ddb.send(
    new DeleteCommand({
      TableName: tableName(),
      Key: { PK: `WEBHOOK#${eventId}`, SK: 'EVENT' },
    }),
  );
}
