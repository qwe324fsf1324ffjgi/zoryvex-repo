import { PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, tableName } from './dynamo-client';
import { isConditionalCheckFailed } from './dynamo-errors';
import { ConflictError } from '../errors/typed-errors';

export interface KitArtifact {
  roleId: string;
  version: number;
  templateVersion: number;
  html: string;
  generatedAt: string;
}

function versionSk(version: number): string {
  // Zero-padded so lexical SK ordering matches numeric ordering.
  return `KITARTIFACT#${String(version).padStart(5, '0')}`;
}

function key(roleId: string, version: number) {
  return { PK: `ROLE#${roleId}`, SK: versionSk(version) };
}

function itemToArtifact(item: Record<string, unknown>): KitArtifact {
  return {
    roleId: String(item.roleId),
    version: Number(item.version),
    templateVersion: Number(item.templateVersion),
    html: String(item.html),
    generatedAt: String(item.generatedAt),
  };
}

/**
 * Conditional create (attribute_not_exists) — this is what makes every
 * version immutable by construction: there is no update path for an
 * existing artifact item, only ever a new, higher-numbered one.
 */
export async function createArtifact(artifact: KitArtifact): Promise<void> {
  try {
    await ddb.send(
      new PutCommand({
        TableName: tableName(),
        Item: { ...key(artifact.roleId, artifact.version), ...artifact },
        ConditionExpression: 'attribute_not_exists(PK)',
      }),
    );
  } catch (error) {
    if (isConditionalCheckFailed(error)) {
      throw new ConflictError('Kit artifact version already exists — this should never happen');
    }
    throw error;
  }
}

export async function getLatestArtifact(roleId: string): Promise<KitArtifact | null> {
  const result = await ddb.send(
    new QueryCommand({
      TableName: tableName(),
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: { ':pk': `ROLE#${roleId}`, ':prefix': 'KITARTIFACT#' },
      ScanIndexForward: false,
      Limit: 1,
    }),
  );
  const item = result.Items?.[0];
  return item ? itemToArtifact(item) : null;
}
