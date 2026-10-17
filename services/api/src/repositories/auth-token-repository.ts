import { GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, tableName } from './dynamo-client';
import { isConditionalCheckFailed } from './dynamo-errors';

export interface AuthTokenRecord {
  tokenHash: string;
  email: string;
  intendedRole: 'candidate' | 'employer_admin';
  existingAccountId: string | null;
  createdAt: string;
  expiresAt: string;
  consumed: boolean;
}

function tokenKey(tokenHash: string) {
  return { PK: `AUTHTOKEN#${tokenHash}`, SK: 'AUTHTOKEN' };
}

/**
 * Unconditional create: a hash collision across 256 bits of randomness is
 * not a realistic race to defend against (see docs/DATA_MODEL.md access
 * pattern #13).
 */
export async function createAuthToken(input: {
  tokenHash: string;
  email: string;
  intendedRole: 'candidate' | 'employer_admin';
  existingAccountId: string | null;
  createdAt: string;
  expiresAt: string;
  ttlEpochSeconds: number;
}): Promise<void> {
  await ddb.send(
    new PutCommand({
      TableName: tableName(),
      Item: {
        ...tokenKey(input.tokenHash),
        email: input.email.toLowerCase(),
        intendedRole: input.intendedRole,
        existingAccountId: input.existingAccountId,
        createdAt: input.createdAt,
        expiresAt: input.expiresAt,
        consumed: false,
        ttl: input.ttlEpochSeconds,
      },
    }),
  );
}

/**
 * Atomic conditional consume-once (docs/DATA_MODEL.md access pattern #14 /
 * ADR 0001's "consumption is an atomic conditional write" requirement).
 * Returns null on any failure (not found, already consumed) — callers must
 * treat every failure mode identically (generic "invalid or expired code"),
 * never distinguishing which case occurred, per the enumeration-resistance
 * principle applied to token consumption too.
 */
export async function consumeAuthToken(tokenHash: string): Promise<AuthTokenRecord | null> {
  try {
    const result = await ddb.send(
      new UpdateCommand({
        TableName: tableName(),
        Key: tokenKey(tokenHash),
        // "consumed" is a DynamoDB reserved word — used unaliased here, every
        // real invocation failed with ValidationException: Invalid
        // UpdateExpression: Attribute name is a reserved keyword; reserved
        // keyword: consumed (confirmed live, Phase 7 slice 11 auth
        // acceptance). aws-sdk-client-mock's unit test never caught this
        // because it mocks the client entirely, not DynamoDB's real
        // expression-syntax validation.
        UpdateExpression: 'SET #consumed = :true',
        ConditionExpression: 'attribute_exists(PK) AND #consumed = :false',
        ExpressionAttributeNames: { '#consumed': 'consumed' },
        ExpressionAttributeValues: { ':true': true, ':false': false },
        ReturnValues: 'ALL_NEW',
      }),
    );
    const item = result.Attributes;
    if (!item) return null;
    return {
      tokenHash,
      email: item.email,
      intendedRole: item.intendedRole,
      existingAccountId: item.existingAccountId ?? null,
      createdAt: item.createdAt,
      expiresAt: item.expiresAt,
      consumed: true,
    };
  } catch (error) {
    if (isConditionalCheckFailed(error)) return null;
    throw error;
  }
}

/** Read-only lookup for tests/diagnostics — never used to gate consumption itself. */
export async function getAuthTokenByHash(tokenHash: string): Promise<AuthTokenRecord | null> {
  const result = await ddb.send(
    new GetCommand({ TableName: tableName(), Key: tokenKey(tokenHash) }),
  );
  if (!result.Item) return null;
  const item = result.Item;
  return {
    tokenHash,
    email: item.email,
    intendedRole: item.intendedRole,
    existingAccountId: item.existingAccountId ?? null,
    createdAt: item.createdAt,
    expiresAt: item.expiresAt,
    consumed: Boolean(item.consumed),
  };
}
