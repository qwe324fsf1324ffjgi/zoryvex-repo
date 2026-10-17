import { GetCommand, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { RoleSchema, type Role } from '@zoryvex/contracts';
import { ddb, tableName } from './dynamo-client';
import { isConditionalCheckFailed } from './dynamo-errors';
import { ConflictError, NotFoundError } from '../errors/typed-errors';

function key(roleId: string) {
  return { PK: `ROLE#${roleId}`, SK: 'PROFILE' };
}

function itemToRole(item: Record<string, unknown>): Role {
  return RoleSchema.parse({
    id: item.id,
    employerId: item.employerId,
    launchTrack: item.launchTrack,
    title: item.title,
    seniority: item.seniority,
    outcomes: item.outcomes,
    mustHaveWork: item.mustHaveWork,
    constraints: item.constraints,
    locationRequirement: item.locationRequirement,
    intent: item.intent,
    status: item.status,
    createdAt: item.createdAt,
  });
}

export async function createRole(role: Role): Promise<{ role: Role; version: number }> {
  const validated = RoleSchema.parse(role);
  await ddb.send(
    new PutCommand({
      TableName: tableName(),
      Item: {
        ...key(validated.id),
        GSI2PK: `EMPLOYER#${validated.employerId}`,
        GSI2SK: `ROLE#${validated.id}`,
        version: 1,
        ...validated,
      },
      ConditionExpression: 'attribute_not_exists(PK)',
    }),
  );
  return { role: validated, version: 1 };
}

export async function getRole(roleId: string): Promise<{ role: Role; version: number } | null> {
  const result = await ddb.send(new GetCommand({ TableName: tableName(), Key: key(roleId) }));
  if (!result.Item) return null;
  return { role: itemToRole(result.Item), version: Number(result.Item.version) };
}

/** docs/DATA_MODEL.md access pattern #21 — GSI2 reused with an EMPLOYER# prefix. */
export async function listRolesByEmployer(employerId: string): Promise<Role[]> {
  const result = await ddb.send(
    new QueryCommand({
      TableName: tableName(),
      IndexName: 'GSI2',
      KeyConditionExpression: 'GSI2PK = :pk AND begins_with(GSI2SK, :prefix)',
      ExpressionAttributeValues: { ':pk': `EMPLOYER#${employerId}`, ':prefix': 'ROLE#' },
    }),
  );
  return (result.Items ?? []).map(itemToRole);
}

export async function updateRole(
  roleId: string,
  expectedVersion: number,
  patch: Partial<
    Pick<Role, 'title' | 'seniority' | 'outcomes' | 'mustHaveWork' | 'constraints' | 'status'>
  > & {
    locationRequirement?: Role['locationRequirement'] | null;
    // Null removes the attribute entirely, which is how an employer
    // withdraws a published pay range. The loop below already turns null
    // into a REMOVE rather than storing a DynamoDB NULL that RoleSchema
    // would reject on the way back out.
    intent?: Role['intent'] | null;
  },
): Promise<{ role: Role; version: number }> {
  const setClauses = ['version = version + :one'];
  const values: Record<string, unknown> = { ':expectedVersion': expectedVersion, ':one': 1 };
  const names: Record<string, string> = {};

  // Same null-versus-undefined rule as the candidate repository: undefined
  // means the request did not mention the field, null means remove it.
  // Writing `SET field = null` stores a DynamoDB NULL, which comes back and
  // fails RoleSchema, since the field is absent or an object and never null.
  const removeClauses: string[] = [];

  for (const [field, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    names[`#${field}`] = field;
    if (value === null) {
      removeClauses.push(`#${field}`);
      continue;
    }
    setClauses.push(`#${field} = :${field}`);
    values[`:${field}`] = value;
  }

  const updateExpression =
    `SET ${setClauses.join(', ')}` +
    (removeClauses.length > 0 ? ` REMOVE ${removeClauses.join(', ')}` : '');

  try {
    const result = await ddb.send(
      new UpdateCommand({
        TableName: tableName(),
        Key: key(roleId),
        UpdateExpression: updateExpression,
        ConditionExpression: 'attribute_exists(PK) AND version = :expectedVersion',
        ExpressionAttributeNames: Object.keys(names).length > 0 ? names : undefined,
        ExpressionAttributeValues: values,
        ReturnValues: 'ALL_NEW',
      }),
    );
    const item = result.Attributes;
    if (!item) throw new NotFoundError('Role not found');
    return { role: itemToRole(item), version: Number(item.version) };
  } catch (error) {
    if (isConditionalCheckFailed(error)) {
      const existing = await getRole(roleId);
      if (!existing) throw new NotFoundError('Role not found');
      throw new ConflictError('Role was modified by another request');
    }
    throw error;
  }
}
