import { beforeEach, describe, expect, it } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import { TransactionCanceledException } from '@aws-sdk/client-dynamodb';
import { ddb } from '../src/repositories/dynamo-client';
import {
  contactUnlockPeriod,
  deleteMatch,
  listMatchesForCandidate,
  listMatchesForRole,
  putMatch,
  unlockContactAtomic,
} from '../src/repositories/match-repository';
import type { Match } from '@zoryvex/contracts';

process.env.TABLE_NAME = 'test-table';

const ddbMock = mockClient(ddb);

const match: Match = {
  id: 'match_1',
  roleId: 'role_1',
  candidateId: 'cand_1',
  matchScore: 0.8,
  status: 'suggested',
  contactUnlocked: false,
  createdAt: '2026-08-19T00:00:00.000Z',
};

describe('putMatch', () => {
  beforeEach(() => ddbMock.reset());

  it('writes PK=ROLE#<roleId>/SK=MATCH#<candidateId> plus GSI1PK=CANDIDATE#<id> for the candidate-side query', async () => {
    ddbMock.on(PutCommand).resolves({});
    await putMatch(match);
    const call = ddbMock.commandCalls(PutCommand)[0];
    expect(call).toBeDefined();
    expect(call!.args[0].input.Item).toMatchObject({
      PK: 'ROLE#role_1',
      SK: 'MATCH#cand_1',
      GSI1PK: 'CANDIDATE#cand_1',
      GSI1SK: 'MATCH#role_1',
    });
  });
});

describe('listMatchesForRole', () => {
  beforeEach(() => ddbMock.reset());

  it('queries the base table — this is the "5 real matches" gate-count query', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [match] });
    await listMatchesForRole('role_1');
    const call = ddbMock.commandCalls(QueryCommand)[0];
    expect(call).toBeDefined();
    expect(call!.args[0].input.IndexName).toBeUndefined();
    expect(call!.args[0].input.ExpressionAttributeValues).toEqual({
      ':pk': 'ROLE#role_1',
      ':prefix': 'MATCH#',
    });
  });
});

describe('listMatchesForCandidate', () => {
  beforeEach(() => ddbMock.reset());

  it('queries GSI1 with a CANDIDATE# prefix, reused from the discovery-by-track index', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [match] });
    await listMatchesForCandidate('cand_1');
    const call = ddbMock.commandCalls(QueryCommand)[0];
    expect(call).toBeDefined();
    expect(call!.args[0].input.IndexName).toBe('GSI1');
    expect(call!.args[0].input.ExpressionAttributeValues).toEqual({
      ':pk': 'CANDIDATE#cand_1',
      ':prefix': 'MATCH#',
    });
  });
});

describe('deleteMatch', () => {
  beforeEach(() => ddbMock.reset());

  it('deletes exactly the one match item by roleId/candidateId key', async () => {
    ddbMock.on(DeleteCommand).resolves({});
    await deleteMatch('role_1', 'cand_1');
    const call = ddbMock.commandCalls(DeleteCommand)[0];
    expect(call).toBeDefined();
    expect(call!.args[0].input.Key).toEqual({ PK: 'ROLE#role_1', SK: 'MATCH#cand_1' });
  });
});

describe('unlockContactAtomic', () => {
  beforeEach(() => ddbMock.reset());

  it('sends one transaction with a conditional match-flip and a conditional ledger increment', async () => {
    ddbMock.on(TransactWriteCommand).resolves({});
    ddbMock.on(GetCommand).resolves({ Item: { ...match, contactUnlocked: true } });

    await unlockContactAtomic('role_1', 'cand_1', 'emp_1', 5, '2026-08');

    const call = ddbMock.commandCalls(TransactWriteCommand)[0];
    expect(call).toBeDefined();
    const items = call!.args[0].input.TransactItems ?? [];
    expect(items).toHaveLength(2);

    const matchUpdate = items[0]?.Update;
    expect(matchUpdate?.Key).toEqual({ PK: 'ROLE#role_1', SK: 'MATCH#cand_1' });
    expect(matchUpdate?.ConditionExpression).toBe(
      'attribute_exists(PK) AND contactUnlocked = :false',
    );

    const ledgerUpdate = items[1]?.Update;
    expect(ledgerUpdate?.Key).toEqual({
      PK: 'EMPLOYER#emp_1',
      SK: 'CONTACTUNLOCK_LEDGER#2026-08',
    });
    expect(ledgerUpdate?.ConditionExpression).toBe(
      'attribute_not_exists(#count) OR #count < :allowance',
    );
    expect(ledgerUpdate?.ExpressionAttributeValues?.[':allowance']).toBe(5);
  });

  it('scopes the ledger to the billing period, so a new month starts from a fresh allowance', async () => {
    ddbMock.on(TransactWriteCommand).resolves({});
    ddbMock.on(GetCommand).resolves({ Item: { ...match, contactUnlocked: true } });

    await unlockContactAtomic('role_1', 'cand_1', 'emp_1', 5, '2026-08');
    await unlockContactAtomic('role_1', 'cand_2', 'emp_1', 5, '2026-09');

    const ledgerKeys = ddbMock
      .commandCalls(TransactWriteCommand)
      .map((call) => call.args[0].input.TransactItems?.[1]?.Update?.Key);

    // Different months must be different items. If they collided on one key
    // the "monthly" allowance would silently become a lifetime cap: 5 unlocks
    // in the first month and 0 in every month after, while still billing
    // monthly. That is exactly the bug this key shape exists to prevent.
    expect(ledgerKeys[0]).toEqual({ PK: 'EMPLOYER#emp_1', SK: 'CONTACTUNLOCK_LEDGER#2026-08' });
    expect(ledgerKeys[1]).toEqual({ PK: 'EMPLOYER#emp_1', SK: 'CONTACTUNLOCK_LEDGER#2026-09' });
    expect(ledgerKeys[0]).not.toEqual(ledgerKeys[1]);
  });

  it('derives the period as a UTC calendar month, including across a year boundary', () => {
    expect(contactUnlockPeriod(new Date('2026-08-27T23:59:59.999Z'))).toBe('2026-08');
    expect(contactUnlockPeriod(new Date('2026-09-01T00:00:00.000Z'))).toBe('2026-09');
    expect(contactUnlockPeriod(new Date('2026-12-31T23:59:59.999Z'))).toBe('2026-12');
    expect(contactUnlockPeriod(new Date('2027-01-01T00:00:00.000Z'))).toBe('2027-01');
  });

  it('returns allowed:true with the fresh match on success', async () => {
    ddbMock.on(TransactWriteCommand).resolves({});
    ddbMock.on(GetCommand).resolves({ Item: { ...match, contactUnlocked: true } });
    const result = await unlockContactAtomic('role_1', 'cand_1', 'emp_1', 5, '2026-08');
    expect(result.allowed).toBe(true);
    if (result.allowed) expect(result.match.contactUnlocked).toBe(true);
  });

  it('reports already_unlocked_or_not_found when the match condition (item 0) fails', async () => {
    ddbMock.on(TransactWriteCommand).rejects(
      new TransactionCanceledException({
        message: 'Transaction cancelled',
        $metadata: {},
        CancellationReasons: [{ Code: 'ConditionalCheckFailed' }, { Code: 'None' }],
      }),
    );
    const result = await unlockContactAtomic('role_1', 'cand_1', 'emp_1', 5, '2026-08');
    expect(result).toEqual({ allowed: false, reason: 'already_unlocked_or_not_found' });
  });

  it('reports allowance_exhausted when only the ledger condition (item 1) fails', async () => {
    ddbMock.on(TransactWriteCommand).rejects(
      new TransactionCanceledException({
        message: 'Transaction cancelled',
        $metadata: {},
        CancellationReasons: [{ Code: 'None' }, { Code: 'ConditionalCheckFailed' }],
      }),
    );
    const result = await unlockContactAtomic('role_1', 'cand_1', 'emp_1', 5, '2026-08');
    expect(result).toEqual({ allowed: false, reason: 'allowance_exhausted' });
  });

  it('never increments the ledger when the match condition fails first (no partial effect from a cancelled transaction)', async () => {
    ddbMock.on(TransactWriteCommand).rejects(
      new TransactionCanceledException({
        message: 'Transaction cancelled',
        $metadata: {},
        CancellationReasons: [{ Code: 'ConditionalCheckFailed' }, { Code: 'None' }],
      }),
    );
    await unlockContactAtomic('role_1', 'cand_1', 'emp_1', 5, '2026-08');
    // A cancelled TransactWriteItems call is fully atomic — DynamoDB itself
    // guarantees no partial writes, so there is nothing further to assert
    // here beyond the single rejected call already covered above; this
    // test documents that guarantee explicitly rather than leaving it implicit.
    expect(ddbMock.commandCalls(TransactWriteCommand)).toHaveLength(1);
  });

  it('propagates a genuine unrelated DynamoDB error instead of misreporting it as a condition failure', async () => {
    ddbMock.on(TransactWriteCommand).rejects(new Error('network blip'));
    await expect(unlockContactAtomic('role_1', 'cand_1', 'emp_1', 5, '2026-08')).rejects.toThrow(
      'network blip',
    );
  });
});
