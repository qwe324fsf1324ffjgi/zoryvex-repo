import { beforeEach, describe, expect, it } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { ddb } from '../src/repositories/dynamo-client';
import { createArtifact, getLatestArtifact } from '../src/repositories/kit-artifact-repository';
import { ConflictError } from '../src/errors/typed-errors';

process.env.TABLE_NAME = 'test-table';

const ddbMock = mockClient(ddb);

describe('createArtifact', () => {
  beforeEach(() => ddbMock.reset());

  it('writes a zero-padded, sortable version SK and conditions on it not already existing', async () => {
    ddbMock.on(PutCommand).resolves({});
    await createArtifact({
      roleId: 'role_1',
      version: 3,
      templateVersion: 1,
      html: '<html></html>',
      generatedAt: '2026-08-19T00:00:00.000Z',
    });
    const call = ddbMock.commandCalls(PutCommand)[0];
    expect(call!.args[0].input.Item).toMatchObject({ PK: 'ROLE#role_1', SK: 'KITARTIFACT#00003' });
    expect(call!.args[0].input.ConditionExpression).toBe('attribute_not_exists(PK)');
  });

  it('throws ConflictError rather than silently overwriting an existing version', async () => {
    const error = Object.assign(new Error('conditional check failed'), {
      name: 'ConditionalCheckFailedException',
    });
    ddbMock.on(PutCommand).rejects(error);
    await expect(
      createArtifact({
        roleId: 'role_1',
        version: 1,
        templateVersion: 1,
        html: '<html></html>',
        generatedAt: '2026-08-19T00:00:00.000Z',
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});

describe('getLatestArtifact', () => {
  beforeEach(() => ddbMock.reset());

  it('queries newest-first with a limit of 1', async () => {
    ddbMock.on(QueryCommand).resolves({
      Items: [
        {
          roleId: 'role_1',
          version: 3,
          templateVersion: 1,
          html: '<html>v3</html>',
          generatedAt: 'x',
        },
      ],
    });
    const result = await getLatestArtifact('role_1');
    const call = ddbMock.commandCalls(QueryCommand)[0];
    expect(call!.args[0].input.ScanIndexForward).toBe(false);
    expect(call!.args[0].input.Limit).toBe(1);
    expect(result?.version).toBe(3);
  });

  it('returns null when no artifact has ever been generated', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [] });
    expect(await getLatestArtifact('role_1')).toBeNull();
  });
});
