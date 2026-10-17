import { GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, tableName } from './dynamo-client';
import { isConditionalCheckFailed } from './dynamo-errors';

/**
 * The founding-places ledger: one item, `PLATFORM` / `FOUNDING_PLACES`
 * (docs/DATA_MODEL.md access pattern 4b).
 *
 * "The first 25 organizations" is a promise about a global count, which
 * makes it the one number in this system that cannot be derived per
 * employer and cannot be computed by reading everybody's records. It is a
 * counter, and a counter read-then-written by two concurrent checkouts is
 * how twenty-five places become twenty-seven.
 *
 * So the count and the holders move together in a single atomic `ADD`.
 * The holder set is what makes the operation idempotent: a webhook
 * redelivery for the same employer changes nothing, because the condition
 * refuses to apply twice for one holder.
 */

const LEDGER_KEY = { PK: 'PLATFORM', SK: 'FOUNDING_PLACES' };

interface LedgerItem {
  count?: number;
  holders?: Set<string> | string[];
}

async function readLedger(): Promise<LedgerItem | null> {
  const result = await ddb.send(new GetCommand({ TableName: tableName(), Key: LEDGER_KEY }));
  return (result.Item as LedgerItem | undefined) ?? null;
}

function holderList(item: LedgerItem | null): string[] {
  const holders = item?.holders;
  if (!holders) return [];
  return holders instanceof Set ? [...holders] : holders;
}

export async function countFoundingPlacesTaken(): Promise<number> {
  const item = await readLedger();
  // The count attribute is authoritative; the holder set is the
  // idempotency guard beside it. They are written in one expression, so
  // they cannot drift, but reading the count is cheaper than sizing a set.
  return Number(item?.count ?? 0);
}

export async function holdsFoundingPlace(employerId: string): Promise<boolean> {
  const item = await readLedger();
  return holderList(item).includes(employerId);
}

/**
 * Claims a founding place for an employer, exactly once.
 *
 * Deliberately not capped by the condition. This runs from the webhook,
 * which means the money has already moved: the employer was quoted a
 * founding price, paid it, and Paystack has confirmed. Refusing the place
 * here because the twenty-fifth went while they were on the checkout page
 * would leave somebody charged the founding price and denied the founding
 * status, which is the one outcome worse than briefly having twenty-six
 * founding members.
 *
 * The over-issue is bounded by the number of checkouts in flight at the
 * moment the last place goes, and it is reported rather than hidden —
 * `overCap` tells the caller to alert.
 */
export async function recordFoundingPlaceTaken(
  employerId: string,
  cap: number,
): Promise<{ recorded: boolean; count: number; overCap: boolean }> {
  try {
    const result = await ddb.send(
      new UpdateCommand({
        TableName: tableName(),
        Key: LEDGER_KEY,
        UpdateExpression: 'ADD #count :one, #holders :employer',
        // Applies only when this employer is not already a holder, which
        // is what makes a redelivered `subscription.create` a no-op rather
        // than a second place spent on one organization.
        ConditionExpression: 'attribute_not_exists(#holders) OR NOT contains(#holders, :id)',
        ExpressionAttributeNames: { '#count': 'count', '#holders': 'holders' },
        ExpressionAttributeValues: {
          ':one': 1,
          ':employer': new Set([employerId]),
          ':id': employerId,
        },
        ReturnValues: 'ALL_NEW',
      }),
    );
    const count = Number((result.Attributes as LedgerItem | undefined)?.count ?? 0);
    return { recorded: true, count, overCap: count > cap };
  } catch (error) {
    if (isConditionalCheckFailed(error)) {
      // Already a holder. Not an error, and not a second place.
      return { recorded: false, count: await countFoundingPlacesTaken(), overCap: false };
    }
    throw error;
  }
}
