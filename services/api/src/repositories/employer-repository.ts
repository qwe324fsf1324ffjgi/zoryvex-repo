import { GetCommand, TransactWriteCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import {
  EmployerSchema,
  EntitlementSchema,
  type Employer,
  type Entitlement,
  type EntitlementPlan,
  type EntitlementStatus,
} from '@zoryvex/contracts';
import { ddb, tableName } from './dynamo-client';

function profileKey(employerId: string) {
  return { PK: `EMPLOYER#${employerId}`, SK: 'PROFILE' };
}

function entitlementKey(employerId: string) {
  return { PK: `EMPLOYER#${employerId}`, SK: 'ENTITLEMENT' };
}

export async function createEmployerProfile(input: {
  employerId: string;
  organizationName: string;
  contactEmail: string;
  createdAt: string;
}): Promise<Employer> {
  const employer: Employer = EmployerSchema.parse({
    id: input.employerId,
    organizationName: input.organizationName,
    contactEmail: input.contactEmail,
    createdAt: input.createdAt,
  });

  const entitlement = EntitlementSchema.parse({
    employerId: input.employerId,
    plan: 'none',
    status: 'none',
    kitPurchasedAt: null,
    subscriptionRenewsAt: null,
  });

  await ddb.send(
    new TransactWriteCommand({
      TransactItems: [
        {
          Put: {
            TableName: tableName(),
            Item: {
              ...profileKey(input.employerId),
              GSI3PK: 'ENTITY#EMPLOYER',
              GSI3SK: input.employerId,
              ...employer,
            },
            ConditionExpression: 'attribute_not_exists(PK)',
          },
        },
        {
          Put: {
            TableName: tableName(),
            Item: {
              ...entitlementKey(input.employerId),
              ...entitlement,
            },
            ConditionExpression: 'attribute_not_exists(PK)',
          },
        },
      ],
    }),
  );

  return employer;
}

export async function getEmployer(employerId: string): Promise<Employer | null> {
  const result = await ddb.send(
    new GetCommand({ TableName: tableName(), Key: profileKey(employerId) }),
  );
  if (!result.Item) return null;
  return EmployerSchema.parse({
    id: result.Item.id,
    organizationName: result.Item.organizationName,
    contactEmail: result.Item.contactEmail,
    createdAt: result.Item.createdAt,
  });
}

/**
 * Parses the whole stored item rather than a hand-listed subset.
 *
 * The hand-listed version named five fields. `priceNGN` and
 * `foundingMember` were added to `EntitlementSchema` on 2026-08-31 and
 * were not added here, and because both carry `.default()` the parse kept
 * succeeding — it just returned `null` and `false` for every employer, on
 * the real backend only. The strongest commercial promise on the pricing
 * page is that a founding member keeps their price, and the field holding
 * that price was being discarded on every read.
 *
 * `z.object` strips unknown keys, so passing the raw item (PK, SK and all)
 * is safe, and a field added to the schema from now on is read without
 * anyone having to remember this function exists.
 */
export async function getEntitlement(employerId: string): Promise<Entitlement | null> {
  const result = await ddb.send(
    new GetCommand({ TableName: tableName(), Key: entitlementKey(employerId) }),
  );
  if (!result.Item) return null;
  return EntitlementSchema.parse(result.Item);
}

/**
 * No optimistic-concurrency version field here (unlike candidate/role/
 * evidence) — entitlement transitions are driven exclusively by
 * server-resolved billing events (webhook dedupe already makes each
 * transition idempotent, docs/DATA_MODEL.md access pattern #9), never by a
 * client submitting a form against a previously-read value, so there is no
 * concurrent-human-edit race to guard against.
 */
export async function updateEntitlement(
  employerId: string,
  patch: {
    plan?: EntitlementPlan;
    status?: EntitlementStatus;
    kitPurchasedAt?: string | null;
    subscriptionRenewsAt?: string | null;
    priceNGN?: number | null;
    foundingMember?: boolean;
  },
): Promise<Entitlement> {
  const setClauses: string[] = [];
  const values: Record<string, unknown> = {};
  const names: Record<string, string> = {};

  for (const [field, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    setClauses.push(`#${field} = :${field}`);
    names[`#${field}`] = field;
    values[`:${field}`] = value;
  }

  const result = await ddb.send(
    new UpdateCommand({
      TableName: tableName(),
      Key: entitlementKey(employerId),
      UpdateExpression: `SET ${setClauses.join(', ')}`,
      ConditionExpression: 'attribute_exists(PK)',
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
      ReturnValues: 'ALL_NEW',
    }),
  );
  return EntitlementSchema.parse(result.Attributes ?? {});
}
