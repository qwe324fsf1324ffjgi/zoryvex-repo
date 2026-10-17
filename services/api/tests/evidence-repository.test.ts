import { beforeEach, describe, expect, it } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { GetCommand, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { ddb } from '../src/repositories/dynamo-client';
import {
  createEvidence,
  listCandidateEvidence,
  updateEvidence,
} from '../src/repositories/evidence-repository';
import { ConflictError } from '../src/errors/typed-errors';
import type { Evidence } from '@zoryvex/contracts';

process.env.TABLE_NAME = 'test-table';

const ddbMock = mockClient(ddb);

const evidence: Evidence = {
  id: 'ev_1',
  candidateId: 'cand_1',
  source: 'github',
  claim: 'Built X',
  context: 'At company Y',
  actions: 'Did Z',
  outcome: 'Result W',
  verificationState: 'unverified',
  visibility: 'private',
  consentGiven: true,
  createdAt: '2026-08-19T00:00:00.000Z',
  updatedAt: '2026-08-19T00:00:00.000Z',
};

describe('createEvidence', () => {
  beforeEach(() => ddbMock.reset());

  it('writes at PK=CANDIDATE#<id>/SK=EVIDENCE#<id> with version 1, conditioned on not already existing', async () => {
    ddbMock.on(PutCommand).resolves({});
    const result = await createEvidence(evidence);
    const call = ddbMock.commandCalls(PutCommand)[0];
    expect(call).toBeDefined();
    expect(call!.args[0].input.Item).toMatchObject({
      PK: 'CANDIDATE#cand_1',
      SK: 'EVIDENCE#ev_1',
      version: 1,
    });
    expect(call!.args[0].input.ConditionExpression).toBe('attribute_not_exists(PK)');
    expect(result.version).toBe(1);
  });
});

describe('listCandidateEvidence', () => {
  beforeEach(() => ddbMock.reset());

  it('queries PK=CANDIDATE#<id>, SK begins_with EVIDENCE# — never a scan', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [evidence] });
    await listCandidateEvidence('cand_1');
    const call = ddbMock.commandCalls(QueryCommand)[0];
    expect(call).toBeDefined();
    expect(call!.args[0].input.KeyConditionExpression).toBe(
      'PK = :pk AND begins_with(SK, :prefix)',
    );
    expect(call!.args[0].input.ExpressionAttributeValues).toEqual({
      ':pk': 'CANDIDATE#cand_1',
      ':prefix': 'EVIDENCE#',
    });
  });
});

describe('updateEvidence', () => {
  beforeEach(() => ddbMock.reset());

  it('conditions on the exact expected version', async () => {
    ddbMock.on(UpdateCommand).resolves({ Attributes: { ...evidence, version: 2 } });
    const result = await updateEvidence(
      'cand_1',
      'ev_1',
      1,
      { verificationState: 'self_attested' },
      '2026-08-19T01:00:00.000Z',
    );
    const call = ddbMock.commandCalls(UpdateCommand)[0];
    expect(call).toBeDefined();
    expect(call!.args[0].input.ConditionExpression).toBe(
      'attribute_exists(PK) AND version = :expectedVersion',
    );
    expect(result.version).toBe(2);
  });

  it('throws ConflictError on a stale version rather than silently overwriting', async () => {
    const error = Object.assign(new Error('conditional check failed'), {
      name: 'ConditionalCheckFailedException',
    });
    ddbMock.on(UpdateCommand).rejects(error);
    ddbMock.on(GetCommand).resolves({ Item: evidence });
    await expect(
      updateEvidence('cand_1', 'ev_1', 1, { claim: 'stale' }, '2026-08-19T01:00:00.000Z'),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});
