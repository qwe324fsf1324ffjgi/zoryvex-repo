import { beforeEach, describe, expect, it } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { GetCommand, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { ddb } from '../src/repositories/dynamo-client';
import { createRole, listRolesByEmployer, updateRole } from '../src/repositories/role-repository';
import { ConflictError } from '../src/errors/typed-errors';
import type { Role } from '@zoryvex/contracts';

process.env.TABLE_NAME = 'test-table';

const ddbMock = mockClient(ddb);

const role: Role = {
  id: 'role_1',
  employerId: 'emp_1',
  launchTrack: 'aws_cloud',
  title: 'Cloud Engineer',
  seniority: 'mid',
  outcomes: 'Ship things',
  mustHaveWork: ['Terraform'],
  constraints: '',
  status: 'draft',
  createdAt: '2026-08-19T00:00:00.000Z',
};

describe('createRole', () => {
  beforeEach(() => ddbMock.reset());

  it('writes PK=ROLE#<id>/SK=PROFILE plus GSI2PK=EMPLOYER#<employerId> for the by-employer listing', async () => {
    ddbMock.on(PutCommand).resolves({});
    await createRole(role);
    const call = ddbMock.commandCalls(PutCommand)[0];
    expect(call).toBeDefined();
    expect(call!.args[0].input.Item).toMatchObject({
      PK: 'ROLE#role_1',
      SK: 'PROFILE',
      GSI2PK: 'EMPLOYER#emp_1',
      GSI2SK: 'ROLE#role_1',
      version: 1,
    });
  });
});

describe('listRolesByEmployer', () => {
  beforeEach(() => ddbMock.reset());

  it('queries GSI2 with an EMPLOYER# prefix', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [role] });
    await listRolesByEmployer('emp_1');
    const call = ddbMock.commandCalls(QueryCommand)[0];
    expect(call).toBeDefined();
    expect(call!.args[0].input.IndexName).toBe('GSI2');
    expect(call!.args[0].input.ExpressionAttributeValues).toEqual({
      ':pk': 'EMPLOYER#emp_1',
      ':prefix': 'ROLE#',
    });
  });
});

describe('updateRole', () => {
  beforeEach(() => ddbMock.reset());

  it('conditions on the exact expected version', async () => {
    ddbMock.on(UpdateCommand).resolves({ Attributes: { ...role, status: 'active', version: 2 } });
    const result = await updateRole('role_1', 1, { status: 'active' });
    const call = ddbMock.commandCalls(UpdateCommand)[0];
    expect(call).toBeDefined();
    expect(call!.args[0].input.ConditionExpression).toBe(
      'attribute_exists(PK) AND version = :expectedVersion',
    );
    expect(result.version).toBe(2);
  });

  it('throws ConflictError on a stale version', async () => {
    const error = Object.assign(new Error('conditional check failed'), {
      name: 'ConditionalCheckFailedException',
    });
    ddbMock.on(UpdateCommand).rejects(error);
    ddbMock.on(GetCommand).resolves({ Item: { ...role, version: 5 } });
    await expect(updateRole('role_1', 1, { status: 'active' })).rejects.toBeInstanceOf(
      ConflictError,
    );
  });
});
