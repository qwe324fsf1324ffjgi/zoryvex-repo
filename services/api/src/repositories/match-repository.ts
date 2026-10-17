import { TransactionCanceledException } from '@aws-sdk/client-dynamodb';
import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { MatchSchema, type InterestState, type Match, type MatchStatus } from '@zoryvex/contracts';
import { ddb, tableName } from './dynamo-client';
import { isConditionalCheckFailed } from './dynamo-errors';

function key(roleId: string, candidateId: string) {
  return { PK: `ROLE#${roleId}`, SK: `MATCH#${candidateId}` };
}

/**
 * Every field the schema defines, not a hand-picked subset.
 *
 * This listed eleven of sixteen. `fit`, `fitReason` and `strongestEvidence`
 * were written by matching and then thrown away on the way back out, so an
 * employer's shortlist arrived with no tiering at all: `byStrongestMatch`
 * reads a missing `fit` as `meets`, which made every candidate look like an
 * exact answer and collapsed the ranking onto score alone. The location and
 * pay explanations were computed, stored, and never shown to anybody.
 *
 * Nothing failed, because a narrower object still parses: every dropped
 * field is optional, so the schema accepted the loss and the bug was
 * invisible from both ends.
 *
 * Spread rather than enumerated now. A field added to the schema is read
 * back automatically, and `withoutKeys` removes only the storage keys, so
 * there is no list here to forget to update. The parse still rejects
 * anything malformed.
 */
function itemToMatch(item: Record<string, unknown>): Match {
  const { PK, SK, GSI1PK, GSI1SK, ...rest } = item;
  void PK;
  void SK;
  void GSI1PK;
  void GSI1SK;
  return MatchSchema.parse(rest);
}

/** docs/DATA_MODEL.md access pattern #6 — also the "5 real matches" gate-count query. */
export async function listMatchesForRole(roleId: string): Promise<Match[]> {
  const result = await ddb.send(
    new QueryCommand({
      TableName: tableName(),
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: { ':pk': `ROLE#${roleId}`, ':prefix': 'MATCH#' },
    }),
  );
  return (result.Items ?? []).map(itemToMatch);
}

/** docs/DATA_MODEL.md access pattern #24 — GSI1 reused with a CANDIDATE# prefix. */
export async function listMatchesForCandidate(candidateId: string): Promise<Match[]> {
  const result = await ddb.send(
    new QueryCommand({
      TableName: tableName(),
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :pk AND begins_with(GSI1SK, :prefix)',
      ExpressionAttributeValues: { ':pk': `CANDIDATE#${candidateId}`, ':prefix': 'MATCH#' },
    }),
  );
  return (result.Items ?? []).map(itemToMatch);
}

export async function getMatch(roleId: string, candidateId: string): Promise<Match | null> {
  const result = await ddb.send(
    new GetCommand({ TableName: tableName(), Key: key(roleId, candidateId) }),
  );
  if (!result.Item) return null;
  return itemToMatch(result.Item);
}

/**
 * Deterministic matching (Phase 7 matching domain) recomputes and
 * overwrites a role's matches wholesale — an unconditional put is correct
 * here, not a bug: there is no concurrent-human-edit race on a
 * system-generated score the way there is on a role/evidence field.
 */
export async function putMatch(match: Match): Promise<Match> {
  const validated = MatchSchema.parse(match);
  await ddb.send(
    new PutCommand({
      TableName: tableName(),
      Item: {
        ...key(validated.roleId, validated.candidateId),
        GSI1PK: `CANDIDATE#${validated.candidateId}`,
        GSI1SK: `MATCH#${validated.roleId}`,
        ...validated,
      },
    }),
  );
  return validated;
}

export async function updateMatchStatus(
  roleId: string,
  candidateId: string,
  status: MatchStatus,
): Promise<Match> {
  const result = await ddb.send(
    new UpdateCommand({
      TableName: tableName(),
      Key: key(roleId, candidateId),
      UpdateExpression: 'SET #status = :status',
      ConditionExpression: 'attribute_exists(PK)',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: { ':status': status },
      ReturnValues: 'ALL_NEW',
    }),
  );
  return itemToMatch(result.Attributes ?? {});
}

/**
 * Records what one side has said about the other.
 *
 * Returns null rather than throwing when the row has gone: a recompute can
 * drop a match between a page rendering and a button being pressed, and
 * that is an ordinary race rather than an error the person caused.
 *
 * Only the one side's field is written. An employer's request can never
 * carry a candidate's answer and the reverse, which is enforced by the
 * caller passing exactly one key, and by this never accepting a whole
 * match object.
 */
export async function updateMatchInterest(
  roleId: string,
  candidateId: string,
  patch: { candidateInterest?: InterestState; employerInterest?: InterestState },
): Promise<Match | null> {
  const names: Record<string, string> = {};
  const values: Record<string, unknown> = {};
  const sets: string[] = [];
  for (const [field, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    names[`#${field}`] = field;
    values[`:${field}`] = value;
    sets.push(`#${field} = :${field}`);
  }
  if (sets.length === 0) return getMatch(roleId, candidateId);

  try {
    const result = await ddb.send(
      new UpdateCommand({
        TableName: tableName(),
        Key: key(roleId, candidateId),
        UpdateExpression: `SET ${sets.join(', ')}`,
        ConditionExpression: 'attribute_exists(PK)',
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
        ReturnValues: 'ALL_NEW',
      }),
    );
    return itemToMatch(result.Attributes ?? {});
  } catch (error) {
    if (isConditionalCheckFailed(error)) return null;
    throw error;
  }
}

/** Part of the async deletion workflow — never called from a direct request handler. */
export async function deleteMatch(roleId: string, candidateId: string): Promise<void> {
  await ddb.send(new DeleteCommand({ TableName: tableName(), Key: key(roleId, candidateId) }));
}

export type ContactUnlockOutcome =
  | { allowed: true; match: Match }
  | { allowed: false; reason: 'already_unlocked_or_not_found' | 'allowance_exhausted' | 'unknown' };

/**
 * Billing-period-scoped, deliberately. The allowance this counter enforces
 * is a MONTHLY one — `CONTACT_UNLOCK_ALLOWANCE` calls it "monthly", the
 * employer UI says "used this period", and the domain error says "exhausted
 * for this billing period". An earlier version keyed this ledger on the
 * employer alone, with no period component and no reset anywhere in the
 * codebase, which silently made the allowance a LIFETIME cap: an employer
 * on Scout got 5 unlocks in their first month and 0 in every month after,
 * while still being charged monthly (found in a 2026-08-27 audit).
 *
 * Including the period in the sort key makes each month's counter a
 * naturally separate item, so a new month starts at zero with no reset job,
 * no scheduled task, and nothing to go wrong on a boundary. Calendar-month
 * (UTC) rather than a per-employer billing anniversary: simpler, and every
 * employer-visible string already says "this period"/"per month" rather
 * than promising an anniversary-relative window.
 */
export function contactUnlockPeriod(now: Date): string {
  return now.toISOString().slice(0, 7); // YYYY-MM
}

function ledgerKey(employerId: string, period: string) {
  return { PK: `EMPLOYER#${employerId}`, SK: `CONTACTUNLOCK_LEDGER#${period}` };
}

/**
 * How many contact unlocks this employer has spent in `period`.
 *
 * A missing item means none spent, which is the ordinary state at the
 * start of every month: the ledger row is created by the first unlock, not
 * by the month beginning.
 */
export async function countContactUnlocksInPeriod(
  employerId: string,
  period: string,
): Promise<number> {
  const result = await ddb.send(
    new GetCommand({ TableName: tableName(), Key: ledgerKey(employerId, period) }),
  );
  const count = Number(result.Item?.count ?? 0);
  return Number.isFinite(count) && count > 0 ? count : 0;
}

/**
 * Atomic (docs/DATA_MODEL.md rules / Prompt 7: "Maintain atomic counters/
 * ledgers for ... contact unlocks"): a single transaction that (a)
 * conditionally flips this one match's contactUnlocked flag exactly once,
 * and (b) conditionally increments the employer's usage ledger only if it
 * is still under the allowance — DynamoDB evaluates both conditions
 * against each item's pre-transaction value, so two concurrent unlock
 * requests can never both succeed past the allowance limit the way a
 * naive "read the count, then write" approach could.
 */
export async function unlockContactAtomic(
  roleId: string,
  candidateId: string,
  employerId: string,
  allowance: number,
  period: string,
): Promise<ContactUnlockOutcome> {
  try {
    await ddb.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Update: {
              TableName: tableName(),
              Key: key(roleId, candidateId),
              UpdateExpression: 'SET contactUnlocked = :true',
              ConditionExpression: 'attribute_exists(PK) AND contactUnlocked = :false',
              ExpressionAttributeValues: { ':true': true, ':false': false },
            },
          },
          {
            Update: {
              TableName: tableName(),
              Key: ledgerKey(employerId, period),
              UpdateExpression: 'ADD #count :one',
              ConditionExpression: 'attribute_not_exists(#count) OR #count < :allowance',
              ExpressionAttributeNames: { '#count': 'count' },
              ExpressionAttributeValues: { ':one': 1, ':allowance': allowance },
            },
          },
        ],
      }),
    );
    const match = await getMatch(roleId, candidateId);
    if (!match) return { allowed: false, reason: 'unknown' };
    return { allowed: true, match };
  } catch (error) {
    if (error instanceof TransactionCanceledException) {
      const reasons = error.CancellationReasons ?? [];
      if (reasons[0]?.Code === 'ConditionalCheckFailed') {
        return { allowed: false, reason: 'already_unlocked_or_not_found' };
      }
      if (reasons[1]?.Code === 'ConditionalCheckFailed') {
        return { allowed: false, reason: 'allowance_exhausted' };
      }
      return { allowed: false, reason: 'unknown' };
    }
    throw error;
  }
}
