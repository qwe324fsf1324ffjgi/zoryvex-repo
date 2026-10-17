import { UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, tableName } from './dynamo-client';

/**
 * Fixed-window atomic counter (docs/DATA_MODEL.md access pattern #18) — a
 * bounded, not sliding, abuse control per ADR 0001. Simple and correct;
 * revisit only with real abuse evidence.
 */
export async function incrementAndCheck(input: {
  kind: string;
  key: string;
  windowSeconds: number;
  limit: number;
  now: Date;
}): Promise<{ allowed: boolean; count: number }> {
  const windowStart =
    Math.floor(input.now.getTime() / 1000 / input.windowSeconds) * input.windowSeconds;
  const ttl = windowStart + input.windowSeconds * 2;
  const result = await ddb.send(
    new UpdateCommand({
      TableName: tableName(),
      Key: { PK: `RATELIMIT#${input.kind}#${input.key}`, SK: `WINDOW#${windowStart}` },
      UpdateExpression: 'ADD #count :one SET #ttl = if_not_exists(#ttl, :ttl)',
      ExpressionAttributeNames: { '#count': 'count', '#ttl': 'ttl' },
      ExpressionAttributeValues: { ':one': 1, ':ttl': ttl },
      ReturnValues: 'UPDATED_NEW',
    }),
  );
  const count = Number(result.Attributes?.count ?? 0);
  return { allowed: count <= input.limit, count };
}
