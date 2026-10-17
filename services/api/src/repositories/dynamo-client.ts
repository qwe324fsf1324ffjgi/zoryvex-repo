import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  QueryCommand,
  type QueryCommandInput,
} from '@aws-sdk/lib-dynamodb';

const client = new DynamoDBClient({});

export const ddb = DynamoDBDocumentClient.from(client, {
  marshallOptions: { removeUndefinedValues: true },
});

export function tableName(): string {
  const name = process.env.TABLE_NAME;
  if (!name) throw new Error('TABLE_NAME environment variable is not set');
  return name;
}

/**
 * A single DynamoDB Query response caps out around 1MB — silently truncated
 * beyond that, with no error, unless the caller follows LastEvaluatedKey.
 * Found 2026-08-26: every Query call in this codebase issued exactly one
 * page and returned whatever came back, correct only while each queried
 * partition stays under that cap. Fine for access patterns bounded by one
 * owner's own items (a candidate's evidence, an employer's roles), but a
 * real, serious correctness bug for any UNBOUNDED-by-platform-scale
 * partition — the clearest case being a launch track's discovery-opted
 * candidates: once a track's opted-in population grows past the 1MB cap,
 * recomputeMatchesForRole would silently and permanently stop scoring some
 * real, eligible candidates against real roles, with no error surfaced
 * anywhere. This is the one paginating helper every such query should use.
 */
export async function queryAllPages(
  input: Omit<QueryCommandInput, 'TableName' | 'ExclusiveStartKey'>,
): Promise<Record<string, unknown>[]> {
  const items: Record<string, unknown>[] = [];
  let exclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const result = await ddb.send(
      new QueryCommand({
        ...input,
        TableName: tableName(),
        ...(exclusiveStartKey ? { ExclusiveStartKey: exclusiveStartKey } : {}),
      }),
    );
    items.push(...(result.Items ?? []));
    exclusiveStartKey = result.LastEvaluatedKey;
  } while (exclusiveStartKey);
  return items;
}
