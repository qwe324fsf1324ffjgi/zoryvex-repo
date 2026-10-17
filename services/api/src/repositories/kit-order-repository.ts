import {
  GetCommand,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { KitOrderSchema, type KitOrder, type KitOrderStatus } from '@zoryvex/contracts';
import { ddb, tableName } from './dynamo-client';
import { isConditionalCheckFailed, isTransactionCanceledByCondition } from './dynamo-errors';

function key(roleId: string, kitOrderId: string) {
  return { PK: `ROLE#${roleId}`, SK: `KITORDER#${kitOrderId}` };
}

function idempotencyKey(roleId: string, idempotencyKey: string) {
  return { PK: `ROLE#${roleId}`, SK: `KITORDER_IDEMPOTENCY#${idempotencyKey}` };
}

function itemToKitOrder(item: Record<string, unknown>): KitOrder {
  return KitOrderSchema.parse({
    id: item.id,
    employerId: item.employerId,
    roleId: item.roleId,
    amountNGN: item.amountNGN,
    checkoutUrl: item.checkoutUrl,
    status: item.status,
    paystackReference: item.paystackReference,
    createdAt: item.createdAt,
  });
}

/**
 * Idempotency-key-protected create (Prompt 7: "Use idempotency keys for ...
 * billing event application"). A retried request with the same key returns
 * the order created by the first request rather than creating a duplicate
 * pending order — enforced by an atomic transaction, not a check-then-act
 * race.
 */
export async function createKitOrderIfNotExists(
  order: KitOrder,
  clientIdempotencyKey: string,
): Promise<{ order: KitOrder; created: boolean }> {
  const validated = KitOrderSchema.parse(order);
  try {
    await ddb.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Put: {
              TableName: tableName(),
              Item: {
                ...idempotencyKey(validated.roleId, clientIdempotencyKey),
                kitOrderId: validated.id,
              },
              ConditionExpression: 'attribute_not_exists(PK)',
            },
          },
          {
            Put: {
              TableName: tableName(),
              Item: {
                ...key(validated.roleId, validated.id),
                GSI2PK: `EMPLOYER#${validated.employerId}`,
                GSI2SK: `KITORDER#${validated.id}`,
                ...validated,
              },
              ConditionExpression: 'attribute_not_exists(PK)',
            },
          },
        ],
      }),
    );
    return { order: validated, created: true };
  } catch (error) {
    if (isTransactionCanceledByCondition(error)) {
      const existingKeyItem = await ddb.send(
        new GetCommand({
          TableName: tableName(),
          Key: idempotencyKey(validated.roleId, clientIdempotencyKey),
        }),
      );
      const existingKitOrderId = existingKeyItem.Item?.kitOrderId;
      if (existingKitOrderId) {
        const existing = await ddb.send(
          new GetCommand({
            TableName: tableName(),
            Key: key(validated.roleId, existingKitOrderId),
          }),
        );
        if (existing.Item) return { order: itemToKitOrder(existing.Item), created: false };
      }
    }
    throw error;
  }
}

/** Direct GetItem by key, any status — for the webhook handler's pre-grant verification read. */
export async function getKitOrder(roleId: string, kitOrderId: string): Promise<KitOrder | null> {
  const result = await ddb.send(
    new GetCommand({ TableName: tableName(), Key: key(roleId, kitOrderId) }),
  );
  if (!result.Item) return null;
  return itemToKitOrder(result.Item);
}

/** docs/DATA_MODEL.md access pattern #23. */
export async function getKitOrderForRole(roleId: string): Promise<KitOrder | null> {
  const result = await ddb.send(
    new QueryCommand({
      TableName: tableName(),
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: { ':pk': `ROLE#${roleId}`, ':prefix': 'KITORDER#' },
    }),
  );
  const items = (result.Items ?? []).map(itemToKitOrder);
  return items.find((o) => o.status === 'succeeded') ?? null;
}

/** docs/DATA_MODEL.md access pattern #22 — GSI2 reused with an EMPLOYER# prefix. */
export async function listKitOrdersForEmployer(employerId: string): Promise<KitOrder[]> {
  const result = await ddb.send(
    new QueryCommand({
      TableName: tableName(),
      IndexName: 'GSI2',
      KeyConditionExpression: 'GSI2PK = :pk AND begins_with(GSI2SK, :prefix)',
      ExpressionAttributeValues: { ':pk': `EMPLOYER#${employerId}`, ':prefix': 'KITORDER#' },
    }),
  );
  return (result.Items ?? []).map(itemToKitOrder);
}

export async function updateKitOrderStatus(
  roleId: string,
  kitOrderId: string,
  status: KitOrderStatus,
): Promise<KitOrder> {
  const result = await ddb.send(
    new UpdateCommand({
      TableName: tableName(),
      Key: key(roleId, kitOrderId),
      UpdateExpression: 'SET #status = :status',
      ConditionExpression: 'attribute_exists(PK)',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: { ':status': status },
      ReturnValues: 'ALL_NEW',
    }),
  );
  return itemToKitOrder(result.Attributes ?? {});
}

/**
 * A status change that only applies while the order is still in the status
 * the caller read.
 *
 * This is what makes the webhook's success path safe to run twice. The
 * unconditional `updateKitOrderStatus` above would happily move an
 * already-succeeded order to succeeded again, and the caller would then go
 * on to generate a second Kit artifact for a single payment. Returning
 * null when the condition fails lets the second caller know it lost and
 * stop, rather than repeating work that was already done.
 */
/**
 * Records where the buyer was sent to pay.
 *
 * Separate from the status transition because it is not one: the order
 * stays pending. Conditional on the row existing so a write cannot create
 * an order, and it never overwrites a URL already stored — the first
 * checkout opened is the one a retry should return to.
 */
export async function setKitOrderCheckoutUrl(
  roleId: string,
  kitOrderId: string,
  checkoutUrl: string,
): Promise<KitOrder | null> {
  try {
    const result = await ddb.send(
      new UpdateCommand({
        TableName: tableName(),
        Key: key(roleId, kitOrderId),
        UpdateExpression: 'SET checkoutUrl = :url',
        ConditionExpression:
          'attribute_exists(PK) AND (attribute_not_exists(checkoutUrl) OR checkoutUrl = :null)',
        ExpressionAttributeValues: { ':url': checkoutUrl, ':null': null },
        ReturnValues: 'ALL_NEW',
      }),
    );
    return itemToKitOrder(result.Attributes ?? {});
  } catch (error) {
    if (isConditionalCheckFailed(error)) return null;
    throw error;
  }
}

export async function transitionKitOrderStatus(
  roleId: string,
  kitOrderId: string,
  expected: KitOrderStatus,
  next: KitOrderStatus,
): Promise<KitOrder | null> {
  try {
    const result = await ddb.send(
      new UpdateCommand({
        TableName: tableName(),
        Key: key(roleId, kitOrderId),
        UpdateExpression: 'SET #status = :next',
        ConditionExpression: 'attribute_exists(PK) AND #status = :expected',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: { ':next': next, ':expected': expected },
        ReturnValues: 'ALL_NEW',
      }),
    );
    return itemToKitOrder(result.Attributes ?? {});
  } catch (error) {
    if (isConditionalCheckFailed(error)) return null;
    throw error;
  }
}
