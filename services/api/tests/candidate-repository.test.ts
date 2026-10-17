import { beforeEach, describe, expect, it } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { ddb } from '../src/repositories/dynamo-client';
import {
  createCandidateProfile,
  getCandidate,
  setDiscoveryOptIn,
  updateCandidateProfile,
} from '../src/repositories/candidate-repository';
import { ConflictError, NotFoundError } from '../src/errors/typed-errors';

process.env.TABLE_NAME = 'test-table';

const ddbMock = mockClient(ddb);

describe('createCandidateProfile', () => {
  beforeEach(() => ddbMock.reset());

  it('writes the profile item at PK=CANDIDATE#<id>/SK=PROFILE with version 1 and the GSI3 admin-enumeration attributes', async () => {
    ddbMock.on(PutCommand).resolves({});
    await createCandidateProfile({
      candidateId: 'cand_1',
      email: 'a@example.com',
      displayName: 'A',
      launchTrack: 'aws_cloud',
      createdAt: '2026-08-19T00:00:00.000Z',
    });
    const call = ddbMock.commandCalls(PutCommand)[0];
    expect(call).toBeDefined();
    expect(call!.args[0].input.Item).toMatchObject({
      PK: 'CANDIDATE#cand_1',
      SK: 'PROFILE',
      GSI3PK: 'ENTITY#CANDIDATE',
      GSI3SK: 'cand_1',
      version: 1,
    });
    expect(call!.args[0].input.ConditionExpression).toBe('attribute_not_exists(PK)');
  });
});

describe('updateCandidateProfile', () => {
  beforeEach(() => ddbMock.reset());

  it('conditions on the exact expected version and increments it', async () => {
    ddbMock.on(UpdateCommand).resolves({
      Attributes: {
        id: 'cand_1',
        email: 'a@example.com',
        displayName: 'New Name',
        launchTrack: 'aws_cloud',
        discoveryOptIn: false,
        onboardingComplete: true,
        summary: '',
        createdAt: '2026-08-19T00:00:00.000Z',
        updatedAt: '2026-08-19T01:00:00.000Z',
        version: 2,
      },
    });
    const result = await updateCandidateProfile(
      'cand_1',
      1,
      { displayName: 'New Name', onboardingComplete: true },
      '2026-08-19T01:00:00.000Z',
    );
    const call = ddbMock.commandCalls(UpdateCommand)[0];
    expect(call).toBeDefined();
    expect(call!.args[0].input.ConditionExpression).toBe(
      'attribute_exists(PK) AND version = :expectedVersion',
    );
    expect(call!.args[0].input.ExpressionAttributeValues?.[':expectedVersion']).toBe(1);
    expect(result.version).toBe(2);
    expect(result.candidate.displayName).toBe('New Name');
  });

  it('throws ConflictError (never a silent overwrite) when the version has moved on', async () => {
    const error = Object.assign(new Error('conditional check failed'), {
      name: 'ConditionalCheckFailedException',
    });
    ddbMock.on(UpdateCommand).rejects(error);
    ddbMock.on(GetCommand).resolves({
      Item: {
        id: 'cand_1',
        email: 'a@example.com',
        displayName: 'Someone Else Edited This',
        launchTrack: 'aws_cloud',
        discoveryOptIn: false,
        onboardingComplete: false,
        summary: '',
        createdAt: '2026-08-19T00:00:00.000Z',
        updatedAt: '2026-08-19T00:30:00.000Z',
        version: 3,
      },
    });
    await expect(
      updateCandidateProfile(
        'cand_1',
        1,
        { displayName: 'Stale Edit' },
        '2026-08-19T01:00:00.000Z',
      ),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('throws NotFoundError when the candidate does not exist at all', async () => {
    const error = Object.assign(new Error('conditional check failed'), {
      name: 'ConditionalCheckFailedException',
    });
    ddbMock.on(UpdateCommand).rejects(error);
    ddbMock.on(GetCommand).resolves({ Item: undefined });
    await expect(
      updateCandidateProfile('nonexistent', 1, { displayName: 'X' }, '2026-08-19T01:00:00.000Z'),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('setDiscoveryOptIn', () => {
  beforeEach(() => ddbMock.reset());

  it('opting in SETs GSI1PK/GSI1SK on the same profile item (structural consent, not a separate item)', async () => {
    ddbMock.on(UpdateCommand).resolves({});
    await setDiscoveryOptIn('cand_1', 'aws_cloud', true, '2026-08-19T00:00:00.000Z');
    const call = ddbMock.commandCalls(UpdateCommand)[0];
    expect(call).toBeDefined();
    expect(call!.args[0].input.UpdateExpression).toContain('GSI1PK = :gsi1pk');
    expect(call!.args[0].input.ExpressionAttributeValues?.[':gsi1pk']).toBe('TRACK#aws_cloud');
    expect(call!.args[0].input.ExpressionAttributeValues?.[':gsi1sk']).toBe('CANDIDATE#cand_1');
  });

  it('opting out REMOVEs GSI1PK/GSI1SK so the candidate cannot appear in a discovery query by construction', async () => {
    ddbMock.on(UpdateCommand).resolves({});
    await setDiscoveryOptIn('cand_1', 'aws_cloud', false, '2026-08-19T00:00:00.000Z');
    const call = ddbMock.commandCalls(UpdateCommand)[0];
    expect(call).toBeDefined();
    expect(call!.args[0].input.UpdateExpression).toContain('REMOVE GSI1PK, GSI1SK');
  });
});

describe('getCandidate', () => {
  beforeEach(() => ddbMock.reset());

  it('returns null for a nonexistent candidate rather than throwing', async () => {
    ddbMock.on(GetCommand).resolves({ Item: undefined });
    expect(await getCandidate('nonexistent')).toBeNull();
  });
});
