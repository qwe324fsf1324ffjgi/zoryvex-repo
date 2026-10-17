import { beforeEach, describe, expect, it } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import {
  GetCommand,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { ddb } from '../src/repositories/dynamo-client';
import {
  createSession,
  deleteSession,
  getSession,
  markSessionSteppedUp,
  revokeAllSessions,
  rotateSessionCsrfToken,
  type SessionRecord,
} from '../src/repositories/session-repository';

process.env.TABLE_NAME = 'test-table';

const ddbMock = mockClient(ddb);

const record: SessionRecord = {
  sessionIdHash: 'hash-abc',
  accountId: 'acct_1',
  accountEmail: 'a@example.com',
  role: 'candidate',
  candidateId: 'cand_1',
  csrfTokenHash: 'csrf-hash',
  issuedAt: '2026-08-19T00:00:00.000Z',
  idleExpiresAt: '2026-08-19T00:30:00.000Z',
  absoluteExpiresAt: '2026-08-19T12:00:00.000Z',
};

describe('createSession', () => {
  beforeEach(() => ddbMock.reset());

  it('writes the session item and its per-account index item atomically', async () => {
    ddbMock.on(TransactWriteCommand).resolves({});
    await createSession(record, 1_000_000);
    const call = ddbMock.commandCalls(TransactWriteCommand)[0];
    expect(call).toBeDefined();
    const items = call!.args[0].input.TransactItems ?? [];
    expect(items).toHaveLength(2);
    expect(items[0]?.Put?.Item).toMatchObject({ PK: 'SESSION#hash-abc', SK: 'SESSION' });
    expect(items[1]?.Put?.Item).toMatchObject({
      PK: 'ACCOUNT#a@example.com',
      SK: 'SESSION#hash-abc',
    });
  });
});

describe('getSession', () => {
  beforeEach(() => ddbMock.reset());

  it('returns the record when neither expiry has passed', async () => {
    ddbMock.on(GetCommand).resolves({ Item: record });
    const result = await getSession('hash-abc', new Date('2026-08-19T00:15:00.000Z'));
    expect(result).not.toBeNull();
  });

  it('rejects a record whose idle expiry has passed, independent of the ttl attribute', async () => {
    ddbMock.on(GetCommand).resolves({ Item: record });
    const result = await getSession('hash-abc', new Date('2026-08-19T00:31:00.000Z'));
    expect(result).toBeNull();
  });

  it('rejects a record whose absolute expiry has passed', async () => {
    ddbMock.on(GetCommand).resolves({ Item: record });
    const result = await getSession('hash-abc', new Date('2026-08-19T13:00:00.000Z'));
    expect(result).toBeNull();
  });

  it('returns null when no item exists', async () => {
    ddbMock.on(GetCommand).resolves({ Item: undefined });
    const result = await getSession('hash-abc', new Date());
    expect(result).toBeNull();
  });
});

describe('deleteSession', () => {
  beforeEach(() => ddbMock.reset());

  it('deletes both the session item and its index item atomically', async () => {
    ddbMock.on(TransactWriteCommand).resolves({});
    await deleteSession('hash-abc', 'a@example.com');
    const call = ddbMock.commandCalls(TransactWriteCommand)[0];
    expect(call).toBeDefined();
    const items = call!.args[0].input.TransactItems ?? [];
    expect(items).toHaveLength(2);
    expect(items[0]?.Delete?.Key).toEqual({ PK: 'SESSION#hash-abc', SK: 'SESSION' });
    expect(items[1]?.Delete?.Key).toEqual({ PK: 'ACCOUNT#a@example.com', SK: 'SESSION#hash-abc' });
  });
});

describe('markSessionSteppedUp', () => {
  beforeEach(() => ddbMock.reset());

  it('conditionally sets stepUpVerifiedAt on exactly this session item', async () => {
    ddbMock.on(UpdateCommand).resolves({});
    await markSessionSteppedUp('hash-abc', '2026-08-19T00:05:00.000Z');
    const call = ddbMock.commandCalls(UpdateCommand)[0];
    expect(call).toBeDefined();
    expect(call!.args[0].input.Key).toEqual({ PK: 'SESSION#hash-abc', SK: 'SESSION' });
    expect(call!.args[0].input.ConditionExpression).toBe('attribute_exists(PK)');
    expect(call!.args[0].input.ExpressionAttributeValues).toEqual({
      ':verifiedAt': '2026-08-19T00:05:00.000Z',
    });
  });

  it('propagates a conditional-check failure for a session that no longer exists', async () => {
    const error = Object.assign(new Error('conditional check failed'), {
      name: 'ConditionalCheckFailedException',
    });
    ddbMock.on(UpdateCommand).rejects(error);
    await expect(markSessionSteppedUp('gone', '2026-08-19T00:05:00.000Z')).rejects.toThrow();
  });
});

describe('rotateSessionCsrfToken', () => {
  beforeEach(() => ddbMock.reset());

  it('conditionally sets csrfTokenHash on exactly this session item', async () => {
    ddbMock.on(UpdateCommand).resolves({});
    await rotateSessionCsrfToken('hash-abc', 'new-csrf-hash');
    const call = ddbMock.commandCalls(UpdateCommand)[0];
    expect(call).toBeDefined();
    expect(call!.args[0].input.Key).toEqual({ PK: 'SESSION#hash-abc', SK: 'SESSION' });
    expect(call!.args[0].input.ConditionExpression).toBe('attribute_exists(PK)');
    expect(call!.args[0].input.ExpressionAttributeValues).toEqual({
      ':csrfTokenHash': 'new-csrf-hash',
    });
  });

  it('slides idleExpiresAt forward in the same write when one is supplied', async () => {
    ddbMock.on(UpdateCommand).resolves({});
    await rotateSessionCsrfToken('hash-abc', 'new-csrf-hash', '2026-08-27T12:30:00.000Z');
    const call = ddbMock.commandCalls(UpdateCommand)[0];
    expect(call!.args[0].input.UpdateExpression).toBe(
      'SET csrfTokenHash = :csrfTokenHash, idleExpiresAt = :idleExpiresAt',
    );
    expect(call!.args[0].input.ExpressionAttributeValues).toEqual({
      ':csrfTokenHash': 'new-csrf-hash',
      ':idleExpiresAt': '2026-08-27T12:30:00.000Z',
    });
    // One write, not two: the idle refresh deliberately rides along on the
    // CSRF rotation that already happens on every page load.
    expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(1);
  });

  it('propagates a conditional-check failure for a session that no longer exists', async () => {
    const error = Object.assign(new Error('conditional check failed'), {
      name: 'ConditionalCheckFailedException',
    });
    ddbMock.on(UpdateCommand).rejects(error);
    await expect(rotateSessionCsrfToken('gone', 'new-csrf-hash')).rejects.toThrow();
  });
});

describe('revokeAllSessions', () => {
  beforeEach(() => ddbMock.reset());

  it('queries the per-account index (never a scan) and deletes every session found', async () => {
    ddbMock
      .on(QueryCommand)
      .resolves({ Items: [{ sessionIdHash: 'hash-1' }, { sessionIdHash: 'hash-2' }] });
    ddbMock.on(TransactWriteCommand).resolves({});
    const count = await revokeAllSessions('a@example.com');
    const queryCall = ddbMock.commandCalls(QueryCommand)[0];
    expect(queryCall).toBeDefined();
    expect(queryCall!.args[0].input.KeyConditionExpression).toBe(
      'PK = :pk AND begins_with(SK, :prefix)',
    );
    expect(queryCall!.args[0].input.ExpressionAttributeValues).toEqual({
      ':pk': 'ACCOUNT#a@example.com',
      ':prefix': 'SESSION#',
    });
    expect(count).toBe(2);
    expect(ddbMock.commandCalls(TransactWriteCommand)).toHaveLength(2);
  });

  it('returns 0 with no writes when the account has no active sessions', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [] });
    const count = await revokeAllSessions('nobody@example.com');
    expect(count).toBe(0);
    expect(ddbMock.commandCalls(TransactWriteCommand)).toHaveLength(0);
  });
});
