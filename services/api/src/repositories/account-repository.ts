import { DeleteCommand, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { AccountSchema, type Account, type AccountRole } from '@zoryvex/contracts';
import { ddb, tableName } from './dynamo-client';
import { isConditionalCheckFailed } from './dynamo-errors';

function accountKey(email: string) {
  return { PK: `ACCOUNT#${email.toLowerCase()}`, SK: 'PROFILE' };
}

function itemToAccount(item: Record<string, unknown>): Account {
  return AccountSchema.parse({
    id: item.id,
    email: item.email,
    role: item.role,
    candidateId: item.candidateId,
    employerId: item.employerId,
    createdAt: item.createdAt,
  });
}

export async function getAccountByEmail(email: string): Promise<Account | null> {
  const result = await ddb.send(new GetCommand({ TableName: tableName(), Key: accountKey(email) }));
  if (!result.Item) return null;
  return itemToAccount(result.Item);
}

interface CreateAccountInput {
  id: string;
  email: string;
  role: Extract<AccountRole, 'candidate' | 'employer_admin'>;
  candidateId?: string;
  employerId?: string;
  createdAt: string;
}

/**
 * Self-serve account creation. Deliberately typed to only accept
 * candidate/employer_admin — founder_admin is pre-provisioned only (never
 * created here), and employer_member (team invites) is out of Phase 7
 * slice-1 scope, recorded as a known follow-up, not silently dropped.
 */
export async function createAccountIfNotExists(input: CreateAccountInput): Promise<Account> {
  const key = accountKey(input.email);
  const item = {
    ...key,
    id: input.id,
    email: input.email.toLowerCase(),
    role: input.role,
    candidateId: input.candidateId,
    employerId: input.employerId,
    createdAt: input.createdAt,
  };
  try {
    await ddb.send(
      new PutCommand({
        TableName: tableName(),
        Item: item,
        ConditionExpression: 'attribute_not_exists(PK)',
      }),
    );
    return itemToAccount(item);
  } catch (error) {
    if (isConditionalCheckFailed(error)) {
      const existing = await getAccountByEmail(input.email);
      if (existing) return existing;
    }
    throw error;
  }
}

/** Part of the async deletion workflow — never called from a direct request handler. */
export async function deleteAccount(email: string): Promise<void> {
  await ddb.send(new DeleteCommand({ TableName: tableName(), Key: accountKey(email) }));
}
