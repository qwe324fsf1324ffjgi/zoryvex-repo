import { beforeEach, describe, expect, it } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { ddb } from '../src/repositories/dynamo-client';
import { listAllCandidates, listAllEmployers } from '../src/repositories/admin-repository';
import { listDiscoveryOptedCandidates } from '../src/repositories/discovery-repository';
import {
  appendAuditEvent,
  listRecentAuditEvents,
} from '../src/repositories/audit-event-repository';
import type { AuditEvent, Candidate, Employer } from '@zoryvex/contracts';

process.env.TABLE_NAME = 'test-table';

const ddbMock = mockClient(ddb);

const candidate: Candidate = {
  id: 'cand_1',
  email: 'a@example.com',
  displayName: 'A',
  launchTrack: 'aws_cloud',
  discoveryOptIn: true,
  onboardingComplete: true,
  summary: '',
  createdAt: '2026-08-19T00:00:00.000Z',
  updatedAt: '2026-08-19T00:00:00.000Z',
};

const employer: Employer = {
  id: 'emp_1',
  organizationName: 'Acme',
  contactEmail: 'a@acme.example',
  createdAt: '2026-08-19T00:00:00.000Z',
};

describe('admin-repository (GSI3 enumeration, admin-only)', () => {
  beforeEach(() => ddbMock.reset());

  it('listAllCandidates queries GSI3 with ENTITY#CANDIDATE', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [candidate] });
    await listAllCandidates();
    const call = ddbMock.commandCalls(QueryCommand)[0];
    expect(call!.args[0].input.IndexName).toBe('GSI3');
    expect(call!.args[0].input.ExpressionAttributeValues).toEqual({ ':pk': 'ENTITY#CANDIDATE' });
  });

  it('listAllEmployers queries GSI3 with ENTITY#EMPLOYER', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [employer] });
    await listAllEmployers();
    const call = ddbMock.commandCalls(QueryCommand)[0];
    expect(call!.args[0].input.ExpressionAttributeValues).toEqual({ ':pk': 'ENTITY#EMPLOYER' });
  });
});

describe('discovery-repository (GSI1 by launch track)', () => {
  beforeEach(() => ddbMock.reset());

  it('queries GSI1 with a TRACK# prefix and no post-read filter', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [candidate] });
    const result = await listDiscoveryOptedCandidates('aws_cloud');
    const call = ddbMock.commandCalls(QueryCommand)[0];
    expect(call!.args[0].input.IndexName).toBe('GSI1');
    expect(call!.args[0].input.ExpressionAttributeValues).toEqual({ ':pk': 'TRACK#aws_cloud' });
    expect(result).toHaveLength(1);
  });

  it('follows LastEvaluatedKey across multiple pages instead of silently truncating — regression test for the 2026-08-26 pagination fix', async () => {
    const second: Candidate = { ...candidate, id: 'cand_2' };
    const third: Candidate = { ...candidate, id: 'cand_3' };
    ddbMock
      .on(QueryCommand)
      .resolvesOnce({ Items: [candidate], LastEvaluatedKey: { PK: 'a' } })
      .resolvesOnce({ Items: [second], LastEvaluatedKey: { PK: 'b' } })
      .resolvesOnce({ Items: [third] }); // no LastEvaluatedKey — final page

    const result = await listDiscoveryOptedCandidates('aws_cloud');

    expect(result.map((c) => c.id)).toEqual(['cand_1', 'cand_2', 'cand_3']);
    const calls = ddbMock.commandCalls(QueryCommand);
    expect(calls).toHaveLength(3);
    expect(calls[0]!.args[0].input.ExclusiveStartKey).toBeUndefined();
    expect(calls[1]!.args[0].input.ExclusiveStartKey).toEqual({ PK: 'a' });
    expect(calls[2]!.args[0].input.ExclusiveStartKey).toEqual({ PK: 'b' });
  });
});

describe('audit-event-repository', () => {
  beforeEach(() => ddbMock.reset());

  const event: AuditEvent = {
    id: 'audit_1',
    actorId: 'acct_1',
    actorRole: 'admin',
    action: 'quarantine_evidence',
    targetType: 'evidence',
    targetId: 'ev_1',
    createdAt: '2026-08-19T00:00:00.000Z',
  };

  it('appendAuditEvent writes PK=AUDIT#<id>/SK=AUDIT plus GSI3 attributes sorted by time', async () => {
    ddbMock.on(PutCommand).resolves({});
    await appendAuditEvent(event);
    const call = ddbMock.commandCalls(PutCommand)[0];
    expect(call!.args[0].input.Item).toMatchObject({
      PK: 'AUDIT#audit_1',
      SK: 'AUDIT',
      GSI3PK: 'AUDITEVENT',
      GSI3SK: '2026-08-19T00:00:00.000Z#audit_1',
    });
  });

  it('listRecentAuditEvents queries GSI3 newest-first', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [event] });
    await listRecentAuditEvents();
    const call = ddbMock.commandCalls(QueryCommand)[0];
    expect(call!.args[0].input.IndexName).toBe('GSI3');
    expect(call!.args[0].input.ExpressionAttributeValues).toEqual({ ':pk': 'AUDITEVENT' });
    expect(call!.args[0].input.ScanIndexForward).toBe(false);
  });
});
