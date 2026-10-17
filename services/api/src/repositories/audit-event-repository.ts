import { PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { AuditEventSchema, type AuditEvent } from '@zoryvex/contracts';
import { ddb, tableName } from './dynamo-client';

function itemToAuditEvent(item: Record<string, unknown>): AuditEvent {
  return AuditEventSchema.parse({
    id: item.id,
    actorId: item.actorId,
    actorRole: item.actorRole,
    action: item.action,
    targetType: item.targetType,
    targetId: item.targetId,
    reason: item.reason,
    createdAt: item.createdAt,
  });
}

/** docs/DATA_MODEL.md access pattern #26 — append-only, server-generated ID. */
export async function appendAuditEvent(event: AuditEvent): Promise<AuditEvent> {
  const validated = AuditEventSchema.parse(event);
  await ddb.send(
    new PutCommand({
      TableName: tableName(),
      Item: {
        PK: `AUDIT#${validated.id}`,
        SK: 'AUDIT',
        GSI3PK: 'AUDITEVENT',
        GSI3SK: `${validated.createdAt}#${validated.id}`,
        ...validated,
      },
    }),
  );
  return validated;
}

/** docs/DATA_MODEL.md access pattern #27 — founder exception-queue view. */
export async function listRecentAuditEvents(limit = 50): Promise<AuditEvent[]> {
  const result = await ddb.send(
    new QueryCommand({
      TableName: tableName(),
      IndexName: 'GSI3',
      KeyConditionExpression: 'GSI3PK = :pk',
      ExpressionAttributeValues: { ':pk': 'AUDITEVENT' },
      ScanIndexForward: false,
      Limit: limit,
    }),
  );
  return (result.Items ?? []).map(itemToAuditEvent);
}
