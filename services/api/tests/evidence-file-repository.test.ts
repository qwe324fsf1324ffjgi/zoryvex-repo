import { beforeEach, describe, expect, it } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { ddb } from '../src/repositories/dynamo-client';
import {
  createPendingFile,
  getFile,
  markFileClean,
  markFileRejected,
} from '../src/repositories/evidence-file-repository';

process.env.TABLE_NAME = 'test-table';

const ddbMock = mockClient(ddb);

describe('createPendingFile', () => {
  beforeEach(() => ddbMock.reset());

  it('writes PK=CANDIDATE#<id>/SK=EVIDENCEFILE#<fileId> with scanStatus pending', async () => {
    ddbMock.on(PutCommand).resolves({});
    await createPendingFile({
      fileId: 'file_1',
      candidateId: 'cand_1',
      originalFilename: 'resume.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 100,
      quarantineKey: 'quarantine/cand_1/file_1',
      createdAt: '2026-08-19T00:00:00.000Z',
    });
    const call = ddbMock.commandCalls(PutCommand)[0];
    expect(call!.args[0].input.Item).toMatchObject({
      PK: 'CANDIDATE#cand_1',
      SK: 'EVIDENCEFILE#file_1',
      scanStatus: 'pending',
      acceptedKey: null,
    });
  });
});

describe('getFile', () => {
  beforeEach(() => ddbMock.reset());

  it('returns null when no file record exists', async () => {
    ddbMock.on(GetCommand).resolves({ Item: undefined });
    expect(await getFile('cand_1', 'nonexistent')).toBeNull();
  });
});

describe('markFileClean / markFileRejected', () => {
  beforeEach(() => ddbMock.reset());

  it('markFileClean conditions on the file still being pending', async () => {
    ddbMock.on(UpdateCommand).resolves({
      Attributes: {
        id: 'file_1',
        candidateId: 'cand_1',
        originalFilename: 'x.png',
        mimeType: 'image/png',
        sizeBytes: 10,
        quarantineKey: 'quarantine/cand_1/file_1',
        acceptedKey: 'accepted/cand_1/file_1',
        scanStatus: 'clean',
        createdAt: '2026-08-19T00:00:00.000Z',
        scannedAt: '2026-08-19T00:01:00.000Z',
      },
    });
    const result = await markFileClean(
      'cand_1',
      'file_1',
      'accepted/cand_1/file_1',
      '2026-08-19T00:01:00.000Z',
    );
    const call = ddbMock.commandCalls(UpdateCommand)[0];
    expect(call!.args[0].input.ConditionExpression).toBe(
      'attribute_exists(PK) AND scanStatus = :pending',
    );
    expect(result?.scanStatus).toBe('clean');
  });

  it('markFileClean returns null (idempotent no-op) when already processed', async () => {
    const error = Object.assign(new Error('conditional check failed'), {
      name: 'ConditionalCheckFailedException',
    });
    ddbMock.on(UpdateCommand).rejects(error);
    const result = await markFileClean(
      'cand_1',
      'file_1',
      'accepted/cand_1/file_1',
      '2026-08-19T00:01:00.000Z',
    );
    expect(result).toBeNull();
  });

  it('markFileRejected sets the rejection reason and scan status', async () => {
    ddbMock.on(UpdateCommand).resolves({
      Attributes: {
        id: 'file_1',
        candidateId: 'cand_1',
        originalFilename: 'x.png',
        mimeType: 'image/png',
        sizeBytes: 10,
        quarantineKey: 'quarantine/cand_1/file_1',
        acceptedKey: null,
        scanStatus: 'infected',
        rejectionReason: 'Malware detected',
        createdAt: '2026-08-19T00:00:00.000Z',
        scannedAt: '2026-08-19T00:01:00.000Z',
      },
    });
    const result = await markFileRejected(
      'cand_1',
      'file_1',
      'infected',
      'Malware detected',
      '2026-08-19T00:01:00.000Z',
    );
    expect(result?.scanStatus).toBe('infected');
    expect(result?.rejectionReason).toBe('Malware detected');
  });
});
