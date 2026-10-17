import { beforeEach, describe, expect, it } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { GetCommand } from '@aws-sdk/lib-dynamodb';
import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';
import type { APIGatewayRequestAuthorizerEventV2 } from 'aws-lambda';
import { ddb } from '../src/repositories/dynamo-client';
import { hmacHash } from '../src/crypto/tokens';

process.env.TABLE_NAME = 'test-table';
process.env.AUTH_TOKEN_PEPPER_PARAM = '/zoryvex/test/auth-token-pepper';
process.env.APP_ORIGIN = 'https://test.zoryvex.space';

const ddbMock = mockClient(ddb);
const ssmMock = mockClient(SSMClient);
const { handler } = await import('../handlers/authorizer');
const PEPPER = 'unit-test-pepper';
const SESSION_ID = 'plaintext-session-id';
const CSRF_TOKEN = 'plaintext-csrf-token';

function baseEvent(
  overrides: Partial<APIGatewayRequestAuthorizerEventV2> = {},
): APIGatewayRequestAuthorizerEventV2 {
  return {
    version: '2.0',
    type: 'REQUEST',
    routeArn: 'arn:aws:execute-api:eu-west-1:111111111111:abc/$default/GET/health',
    identitySource: [],
    routeKey: 'GET /health',
    rawPath: '/health',
    rawQueryString: '',
    headers: {},
    requestContext: {} as APIGatewayRequestAuthorizerEventV2['requestContext'],
    cookies: [],
    ...overrides,
  };
}

const futureIso = new Date(Date.now() + 60 * 60_000).toISOString();

describe('authorizer handler', () => {
  beforeEach(() => {
    ddbMock.reset();
    ssmMock.reset();
    ssmMock.on(GetParameterCommand).resolves({ Parameter: { Value: PEPPER } });
    // Cold-start module cache in ssm-secure-repository persists the pepper
    // across tests in this file (module-level cache) — fine, since the
    // pepper value is always the same constant here.
  });

  async function invoke(event: APIGatewayRequestAuthorizerEventV2) {
    return handler(event);
  }

  it('denies a request with no session cookie', async () => {
    const result = await invoke(baseEvent({ cookies: [] }));
    expect(result).toEqual({ isAuthorized: false, context: {} });
  });

  it('denies a request whose session cookie matches nothing in DynamoDB (forged/expired)', async () => {
    ddbMock.on(GetCommand).resolves({ Item: undefined });
    const result = await invoke(baseEvent({ cookies: [`__Host-zoryvex_session=${SESSION_ID}`] }));
    expect(result).toEqual({ isAuthorized: false, context: {} });
  });

  it('allows a GET request with a valid, unexpired session and returns role/tenant context', async () => {
    ddbMock.on(GetCommand).resolves({
      Item: {
        accountId: 'acct_1',
        accountEmail: 'candidate@example.com',
        role: 'candidate',
        candidateId: 'cand_1',
        csrfTokenHash: hmacHash(PEPPER, CSRF_TOKEN),
        idleExpiresAt: futureIso,
        absoluteExpiresAt: futureIso,
      },
    });
    const result = await invoke(
      baseEvent({
        routeKey: 'GET /candidates/me',
        cookies: [`__Host-zoryvex_session=${SESSION_ID}`],
      }),
    );
    expect(result).toEqual({
      isAuthorized: true,
      context: {
        accountId: 'acct_1',
        email: 'candidate@example.com',
        role: 'candidate',
        candidateId: 'cand_1',
        employerId: '',
      },
    });
  });

  it('denies an expired session even though the item still exists (TTL is cleanup-only)', async () => {
    const pastIso = new Date(Date.now() - 60_000).toISOString();
    ddbMock.on(GetCommand).resolves({
      Item: {
        accountId: 'acct_1',
        accountEmail: 'candidate@example.com',
        role: 'candidate',
        candidateId: 'cand_1',
        csrfTokenHash: hmacHash(PEPPER, CSRF_TOKEN),
        idleExpiresAt: pastIso,
        absoluteExpiresAt: futureIso,
      },
    });
    const result = await invoke(baseEvent({ cookies: [`__Host-zoryvex_session=${SESSION_ID}`] }));
    expect(result).toEqual({ isAuthorized: false, context: {} });
  });

  it('denies a mutating (POST) request missing the CSRF header', async () => {
    ddbMock.on(GetCommand).resolves({
      Item: {
        accountId: 'acct_1',
        accountEmail: 'candidate@example.com',
        role: 'candidate',
        csrfTokenHash: hmacHash(PEPPER, CSRF_TOKEN),
        idleExpiresAt: futureIso,
        absoluteExpiresAt: futureIso,
      },
    });
    const result = await invoke(
      baseEvent({
        routeKey: 'POST /roles',
        headers: { origin: 'https://test.zoryvex.space' },
        cookies: [`__Host-zoryvex_session=${SESSION_ID}`],
      }),
    );
    expect(result).toEqual({ isAuthorized: false, context: {} });
  });

  it('denies a mutating request with a mismatched Origin, even with a correct CSRF token', async () => {
    ddbMock.on(GetCommand).resolves({
      Item: {
        accountId: 'acct_1',
        accountEmail: 'candidate@example.com',
        role: 'candidate',
        csrfTokenHash: hmacHash(PEPPER, CSRF_TOKEN),
        idleExpiresAt: futureIso,
        absoluteExpiresAt: futureIso,
      },
    });
    const result = await invoke(
      baseEvent({
        routeKey: 'POST /roles',
        headers: { origin: 'https://evil.example', 'x-zoryvex-csrf': CSRF_TOKEN },
        cookies: [`__Host-zoryvex_session=${SESSION_ID}`],
      }),
    );
    expect(result).toEqual({ isAuthorized: false, context: {} });
  });

  it('allows a mutating request with a correct Origin and CSRF token', async () => {
    ddbMock.on(GetCommand).resolves({
      Item: {
        accountId: 'acct_1',
        accountEmail: 'employer@example.com',
        role: 'employer_admin',
        employerId: 'emp_1',
        csrfTokenHash: hmacHash(PEPPER, CSRF_TOKEN),
        idleExpiresAt: futureIso,
        absoluteExpiresAt: futureIso,
      },
    });
    const result = await invoke(
      baseEvent({
        routeKey: 'POST /roles',
        headers: { origin: 'https://test.zoryvex.space', 'x-zoryvex-csrf': CSRF_TOKEN },
        cookies: [`__Host-zoryvex_session=${SESSION_ID}`],
      }),
    );
    expect(result).toEqual({
      isAuthorized: true,
      context: {
        accountId: 'acct_1',
        email: 'employer@example.com',
        role: 'employer_admin',
        candidateId: '',
        employerId: 'emp_1',
      },
    });
  });

  it('includes stepUpVerifiedAt in context only when the session has one', async () => {
    ddbMock.on(GetCommand).resolves({
      Item: {
        accountId: 'acct_1',
        accountEmail: 'founder@example.com',
        role: 'founder_admin',
        csrfTokenHash: hmacHash(PEPPER, CSRF_TOKEN),
        idleExpiresAt: futureIso,
        absoluteExpiresAt: futureIso,
        stepUpVerifiedAt: '2026-08-19T00:00:00.000Z',
      },
    });
    const result = await invoke(
      baseEvent({
        routeKey: 'GET /admin/exceptions',
        cookies: [`__Host-zoryvex_session=${SESSION_ID}`],
      }),
    );
    expect(result).toEqual({
      isAuthorized: true,
      context: {
        accountId: 'acct_1',
        email: 'founder@example.com',
        role: 'founder_admin',
        candidateId: '',
        employerId: '',
        stepUpVerifiedAt: '2026-08-19T00:00:00.000Z',
      },
    });
  });
});
