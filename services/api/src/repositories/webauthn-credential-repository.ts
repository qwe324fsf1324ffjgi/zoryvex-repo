import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { ddb, tableName } from './dynamo-client';

export interface WebAuthnCredentialRecord {
  credentialId: string;
  publicKey: string; // base64url
  counter: number;
  transports?: string[];
  createdAt: string;
}

function accountPk(email: string) {
  return `ACCOUNT#${email.toLowerCase()}`;
}

export async function listCredentialsForAccount(
  email: string,
): Promise<WebAuthnCredentialRecord[]> {
  const result = await ddb.send(
    new QueryCommand({
      TableName: tableName(),
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: { ':pk': accountPk(email), ':prefix': 'WEBAUTHNCRED#' },
    }),
  );
  return (result.Items ?? []).map((item) => ({
    credentialId: item.credentialId,
    publicKey: item.publicKey,
    counter: Number(item.counter),
    transports: item.transports,
    createdAt: item.createdAt,
  }));
}

export async function saveCredential(
  email: string,
  record: WebAuthnCredentialRecord,
): Promise<void> {
  await ddb.send(
    new PutCommand({
      TableName: tableName(),
      Item: { PK: accountPk(email), SK: `WEBAUTHNCRED#${record.credentialId}`, ...record },
    }),
  );
}

export async function updateCredentialCounter(
  email: string,
  credentialId: string,
  counter: number,
): Promise<void> {
  await ddb.send(
    new UpdateCommand({
      TableName: tableName(),
      Key: { PK: accountPk(email), SK: `WEBAUTHNCRED#${credentialId}` },
      UpdateExpression: 'SET #counter = :counter',
      ExpressionAttributeNames: { '#counter': 'counter' },
      ExpressionAttributeValues: { ':counter': counter },
    }),
  );
}

/** 5-minute-TTL single-use ceremony challenge (docs/DATA_MODEL.md access pattern #20). */
export async function putChallenge(
  email: string,
  challenge: string,
  ttlEpochSeconds: number,
): Promise<void> {
  await ddb.send(
    new PutCommand({
      TableName: tableName(),
      Item: { PK: accountPk(email), SK: 'WEBAUTHNCHALLENGE', challenge, ttl: ttlEpochSeconds },
    }),
  );
}

export async function consumeChallenge(email: string): Promise<string | null> {
  const key = { PK: accountPk(email), SK: 'WEBAUTHNCHALLENGE' };
  const result = await ddb.send(new GetCommand({ TableName: tableName(), Key: key }));
  const item = result.Item;
  if (!item) return null;
  await ddb.send(new DeleteCommand({ TableName: tableName(), Key: key }));
  if (Number(item.ttl) < Math.floor(Date.now() / 1000)) return null;
  return String(item.challenge);
}
