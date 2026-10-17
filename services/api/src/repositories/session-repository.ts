import {
  GetCommand,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import type { AccountRole } from '@zoryvex/contracts';
import { ddb, tableName } from './dynamo-client';

export interface SessionRecord {
  sessionIdHash: string;
  accountId: string;
  accountEmail: string;
  role: AccountRole;
  candidateId?: string | undefined;
  employerId?: string | undefined;
  csrfTokenHash: string;
  issuedAt: string;
  idleExpiresAt: string;
  absoluteExpiresAt: string;
  /** Set by markSessionSteppedUp once this session completes WebAuthn step-up. */
  stepUpVerifiedAt?: string | undefined;
}

function sessionKey(sessionIdHash: string) {
  return { PK: `SESSION#${sessionIdHash}`, SK: 'SESSION' };
}

function sessionIndexKey(email: string, sessionIdHash: string) {
  return { PK: `ACCOUNT#${email.toLowerCase()}`, SK: `SESSION#${sessionIdHash}` };
}

/**
 * Two-item write (the session itself + a per-account adjacency index entry
 * that makes "list/revoke all sessions for this account" a Query, never a
 * scan — docs/DATA_MODEL.md access patterns #15/#17) done as one
 * transaction so the index can never drift out of sync with the session.
 */
export async function createSession(record: SessionRecord, ttlEpochSeconds: number): Promise<void> {
  const sessionItem = { ...sessionKey(record.sessionIdHash), ...record, ttl: ttlEpochSeconds };
  const indexItem = {
    ...sessionIndexKey(record.accountEmail, record.sessionIdHash),
    sessionIdHash: record.sessionIdHash,
    ttl: ttlEpochSeconds,
  };
  await ddb.send(
    new TransactWriteCommand({
      TransactItems: [
        { Put: { TableName: tableName(), Item: sessionItem } },
        { Put: { TableName: tableName(), Item: indexItem } },
      ],
    }),
  );
}

/**
 * TTL is cleanup-only (ADR 0001) — idle/absolute expiry are re-checked here
 * against the caller-supplied "now" even if the TTL sweep hasn't run yet.
 */
export async function getSession(sessionIdHash: string, now: Date): Promise<SessionRecord | null> {
  const result = await ddb.send(
    new GetCommand({ TableName: tableName(), Key: sessionKey(sessionIdHash) }),
  );
  const item = result.Item;
  if (!item) return null;
  if (new Date(item.idleExpiresAt) < now || new Date(item.absoluteExpiresAt) < now) return null;
  return item as SessionRecord;
}

/**
 * Records that this specific session completed a WebAuthn step-up ceremony
 * (handlers/auth/webauthn-step-up-verify.ts) — a founder_admin session that
 * never steps up, or whose step-up has aged out, cannot reach a sensitive
 * admin action (see requireFounderStepUp). `attribute_exists(PK)` only —
 * this is a best-effort timestamp update, not a security-critical
 * conditional write, so a session that expired between authorizer-check and
 * this call simply fails loudly rather than silently creating a new item.
 */
export async function markSessionSteppedUp(
  sessionIdHash: string,
  verifiedAt: string,
): Promise<void> {
  await ddb.send(
    new UpdateCommand({
      TableName: tableName(),
      Key: sessionKey(sessionIdHash),
      UpdateExpression: 'SET stepUpVerifiedAt = :verifiedAt',
      ConditionExpression: 'attribute_exists(PK)',
      ExpressionAttributeValues: { ':verifiedAt': verifiedAt },
    }),
  );
}

/**
 * Re-establishes a fresh, client-usable CSRF token for an existing session
 * (services/api/handlers/auth/session.ts) — the plaintext value is only
 * ever handed to the client once per issuance (ADR 0001: keyed-hash-at-rest
 * only), and a full page navigation/reload discards whatever the client
 * held in memory, so every real page load needs a way to get a working one
 * again without a second sign-in. Same best-effort-write pattern as
 * markSessionSteppedUp.
 */
export async function rotateSessionCsrfToken(
  sessionIdHash: string,
  csrfTokenHash: string,
  idleExpiresAt?: string,
): Promise<void> {
  // Extending the idle window rides along on this already-happening write
  // rather than adding one: see refreshedIdleExpiry in auth-service.ts for
  // why this is the place it happens. `if_not_exists` is deliberately NOT
  // used — the whole point is to move this value forward.
  const extendIdle = idleExpiresAt !== undefined;
  await ddb.send(
    new UpdateCommand({
      TableName: tableName(),
      Key: sessionKey(sessionIdHash),
      UpdateExpression: extendIdle
        ? 'SET csrfTokenHash = :csrfTokenHash, idleExpiresAt = :idleExpiresAt'
        : 'SET csrfTokenHash = :csrfTokenHash',
      ConditionExpression: 'attribute_exists(PK)',
      ExpressionAttributeValues: {
        ':csrfTokenHash': csrfTokenHash,
        ...(extendIdle ? { ':idleExpiresAt': idleExpiresAt } : {}),
      },
    }),
  );
}

export async function deleteSession(sessionIdHash: string, accountEmail: string): Promise<void> {
  await ddb.send(
    new TransactWriteCommand({
      TransactItems: [
        { Delete: { TableName: tableName(), Key: sessionKey(sessionIdHash) } },
        { Delete: { TableName: tableName(), Key: sessionIndexKey(accountEmail, sessionIdHash) } },
      ],
    }),
  );
}

export async function revokeAllSessions(accountEmail: string): Promise<number> {
  const result = await ddb.send(
    new QueryCommand({
      TableName: tableName(),
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: {
        ':pk': `ACCOUNT#${accountEmail.toLowerCase()}`,
        ':prefix': 'SESSION#',
      },
    }),
  );
  const items = result.Items ?? [];
  for (const item of items) {
    const sessionIdHash = String(item.sessionIdHash);
    await ddb.send(
      new TransactWriteCommand({
        TransactItems: [
          { Delete: { TableName: tableName(), Key: sessionKey(sessionIdHash) } },
          { Delete: { TableName: tableName(), Key: sessionIndexKey(accountEmail, sessionIdHash) } },
        ],
      }),
    );
  }
  return items.length;
}
