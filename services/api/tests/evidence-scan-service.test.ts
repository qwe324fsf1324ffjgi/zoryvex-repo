import { beforeEach, describe, expect, it } from 'vitest';
import type { AuditEvent, EvidenceFile, EvidenceFileScanStatus } from '@zoryvex/contracts';
import {
  parseQuarantineKey,
  processScanResult,
  type EvidenceScanDependencies,
  type ScanResultEvent,
} from '../src/domain/evidence-scan-service';

const BUCKET = 'test-evidence-bucket';
const CANDIDATE_ID = 'cand_1';
const FILE_ID = 'file_1';
const QUARANTINE_KEY = `quarantine/${CANDIDATE_ID}/${FILE_ID}`;

function pngChunk(type: string, data: number[]): number[] {
  const length = data.length;
  const typeBytes = [...type].map((c) => c.charCodeAt(0));
  return [
    (length >>> 24) & 0xff,
    (length >>> 16) & 0xff,
    (length >>> 8) & 0xff,
    length & 0xff,
    ...typeBytes,
    ...data,
    0,
    0,
    0,
    0, // dummy CRC — the stripper never validates it
  ];
}

function pngBytes(): Uint8Array {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const ihdr = pngChunk('IHDR', new Array(13).fill(0));
  const idat = pngChunk('IDAT', [1, 2, 3, 4]);
  const iend = pngChunk('IEND', []);
  return new Uint8Array([...signature, ...ihdr, ...idat, ...iend]);
}

function baseEvent(overrides: Partial<ScanResultEvent> = {}): ScanResultEvent {
  return {
    bucket: BUCKET,
    objectKey: QUARANTINE_KEY,
    scanStatus: 'COMPLETED',
    scanResultStatus: 'NO_THREATS_FOUND',
    statusReasons: null,
    ...overrides,
  };
}

function pendingFile(overrides: Partial<EvidenceFile> = {}): EvidenceFile {
  return {
    id: FILE_ID,
    candidateId: CANDIDATE_ID,
    originalFilename: 'photo.png',
    mimeType: 'image/png',
    sizeBytes: 12,
    quarantineKey: QUARANTINE_KEY,
    acceptedKey: null,
    scanStatus: 'pending',
    createdAt: '2026-08-19T00:00:00.000Z',
    scannedAt: null,
    ...overrides,
  };
}

interface Fakes {
  deps: EvidenceScanDependencies;
  files: Map<string, EvidenceFile>;
  deletedKeys: string[];
  putKeys: string[];
  auditEvents: AuditEvent[];
}

function createFakes(initialFile: EvidenceFile | null): Fakes {
  const files = new Map<string, EvidenceFile>();
  if (initialFile) files.set(`${initialFile.candidateId}#${initialFile.id}`, initialFile);
  const deletedKeys: string[] = [];
  const putKeys: string[] = [];
  const auditEvents: AuditEvent[] = [];

  const deps: EvidenceScanDependencies = {
    clock: { now: () => new Date('2026-08-19T01:00:00.000Z') },
    async getFile(candidateId, fileId) {
      return files.get(`${candidateId}#${fileId}`) ?? null;
    },
    async markFileClean(candidateId, fileId, acceptedKey, scannedAt) {
      const key = `${candidateId}#${fileId}`;
      const existing = files.get(key);
      if (!existing || existing.scanStatus !== 'pending') return null;
      const updated: EvidenceFile = { ...existing, scanStatus: 'clean', acceptedKey, scannedAt };
      files.set(key, updated);
      return updated;
    },
    async markFileRejected(candidateId, fileId, scanStatus, reason, scannedAt) {
      const key = `${candidateId}#${fileId}`;
      const existing = files.get(key);
      if (!existing || existing.scanStatus !== 'pending') return null;
      const updated: EvidenceFile = {
        ...existing,
        scanStatus: scanStatus as EvidenceFileScanStatus,
        rejectionReason: reason,
        scannedAt,
      };
      files.set(key, updated);
      return updated;
    },
    async getObjectBytes() {
      return pngBytes();
    },
    async putAcceptedObject(input) {
      putKeys.push(input.key);
    },
    async deleteObject(_bucket, key) {
      deletedKeys.push(key);
    },
    async appendAuditEvent(event) {
      auditEvents.push(event);
      return event;
    },
    generateId: () => 'audit_1',
  };

  return { deps, files, deletedKeys, putKeys, auditEvents };
}

describe('parseQuarantineKey', () => {
  it('extracts candidateId/fileId from a well-formed key', () => {
    expect(parseQuarantineKey('quarantine/cand_1/file_1')).toEqual({
      candidateId: 'cand_1',
      fileId: 'file_1',
    });
  });

  it('returns null for a key outside quarantine/', () => {
    expect(parseQuarantineKey('accepted/cand_1/file_1')).toBeNull();
    expect(parseQuarantineKey('not-a-real-key')).toBeNull();
  });
});

describe('processScanResult — clean path', () => {
  it('promotes to accepted/, strips PNG metadata, marks clean, and deletes the quarantine object', async () => {
    const { deps, files, deletedKeys, putKeys } = createFakes(pendingFile());
    await processScanResult(baseEvent(), deps);

    const updated = files.get(`${CANDIDATE_ID}#${FILE_ID}`)!;
    expect(updated.scanStatus).toBe('clean');
    expect(updated.acceptedKey).toBe(`accepted/${CANDIDATE_ID}/${FILE_ID}`);
    expect(putKeys).toContain(`accepted/${CANDIDATE_ID}/${FILE_ID}`);
    expect(deletedKeys).toContain(QUARANTINE_KEY);
  });
});

describe('processScanResult — fail-closed rejection paths', () => {
  it.each<[string, Partial<ScanResultEvent>, EvidenceFileScanStatus]>([
    ['THREATS_FOUND', { scanStatus: 'COMPLETED', scanResultStatus: 'THREATS_FOUND' }, 'infected'],
    ['UNSUPPORTED', { scanStatus: 'SKIPPED', scanResultStatus: 'UNSUPPORTED' }, 'unsupported'],
    ['ACCESS_DENIED', { scanStatus: 'SKIPPED', scanResultStatus: 'ACCESS_DENIED' }, 'failed'],
    ['scan FAILED status', { scanStatus: 'FAILED', scanResultStatus: null }, 'failed'],
    ['unrecognized combination', { scanStatus: 'COMPLETED', scanResultStatus: null }, 'failed'],
  ])('rejects on %s, never promoting to accepted/', async (_label, overrides, expectedStatus) => {
    const { deps, files, putKeys } = createFakes(pendingFile());
    await processScanResult(baseEvent(overrides), deps);

    const updated = files.get(`${CANDIDATE_ID}#${FILE_ID}`)!;
    expect(updated.scanStatus).toBe(expectedStatus);
    expect(updated.acceptedKey).toBeNull();
    expect(putKeys).toHaveLength(0);
  });

  it('deletes the object immediately only for a confirmed threat, not for unsupported/failed', async () => {
    const threatFakes = createFakes(pendingFile());
    await processScanResult(baseEvent({ scanResultStatus: 'THREATS_FOUND' }), threatFakes.deps);
    expect(threatFakes.deletedKeys).toContain(QUARANTINE_KEY);

    const unsupportedFakes = createFakes(pendingFile());
    await processScanResult(
      baseEvent({ scanStatus: 'SKIPPED', scanResultStatus: 'UNSUPPORTED' }),
      unsupportedFakes.deps,
    );
    expect(unsupportedFakes.deletedKeys).not.toContain(QUARANTINE_KEY);
  });

  it('records an audit event for every rejection', async () => {
    const { deps, auditEvents } = createFakes(pendingFile());
    await processScanResult(baseEvent({ scanResultStatus: 'THREATS_FOUND' }), deps);
    expect(auditEvents).toHaveLength(1);
    expect(auditEvents[0]?.action).toBe('evidence_file_rejected');
  });

  it('rejects when the scanned bytes do not match the claimed MIME type, even after NO_THREATS_FOUND', async () => {
    const { deps, files, putKeys, deletedKeys } = createFakes(
      pendingFile({ mimeType: 'application/pdf' }), // bytes fixture returns PNG signature, not PDF
    );
    await processScanResult(baseEvent(), deps);

    const updated = files.get(`${CANDIDATE_ID}#${FILE_ID}`)!;
    expect(updated.scanStatus).toBe('rejected');
    expect(putKeys).toHaveLength(0);
    expect(deletedKeys).toContain(QUARANTINE_KEY);
  });
});

describe('processScanResult — idempotency and defensiveness', () => {
  let originalFile: EvidenceFile;

  beforeEach(() => {
    originalFile = pendingFile({ scanStatus: 'clean', acceptedKey: 'accepted/cand_1/file_1' });
  });

  it('is a no-op when the file was already processed (SQS at-least-once redelivery)', async () => {
    const { deps, putKeys, deletedKeys } = createFakes(originalFile);
    await processScanResult(baseEvent(), deps);
    expect(putKeys).toHaveLength(0);
    expect(deletedKeys).toHaveLength(0);
  });

  it('is a no-op for an unknown fileId (defensive, never throws)', async () => {
    const { deps } = createFakes(null);
    await expect(processScanResult(baseEvent(), deps)).resolves.toBeUndefined();
  });

  it('is a no-op for an object key outside the expected quarantine/<candidateId>/<fileId> shape', async () => {
    const { deps, putKeys } = createFakes(pendingFile());
    await processScanResult(baseEvent({ objectKey: 'accepted/already/promoted' }), deps);
    expect(putKeys).toHaveLength(0);
  });
});

/**
 * Guards a real data-loss bug found in a 2026-08-27 audit.
 *
 * Two concurrent deliveries of the same scan result (SQS is at-least-once)
 * both read the file as `pending` and both write the promoted object. The
 * accepted key is deterministic — `accepted/<candidateId>/<fileId>` — so
 * both writes land on the SAME key. The winner marks the record clean and
 * deletes the quarantine original. The loser's `markFileClean` returns null,
 * and the old cleanup then deleted acceptedKey "rather than leave an orphan"
 * — destroying the winner's object, which was the only surviving copy.
 *
 * The record was left saying `clean` with an acceptedKey pointing at nothing.
 * The race handler made the race strictly worse than doing nothing.
 */
describe("losing the promotion race does not destroy the winner's object", () => {
  /** An object store that actually holds objects, so deletion is observable. */
  function createRacingFakes(winnerOutcome: 'clean' | 'rejected') {
    const objects = new Set<string>([QUARANTINE_KEY]);
    const acceptedKey = `accepted/${CANDIDATE_ID}/${FILE_ID}`;
    let record: EvidenceFile = pendingFile();

    const deps: EvidenceScanDependencies = {
      clock: { now: () => new Date('2026-08-19T01:00:00.000Z') },
      async getFile() {
        return record;
      },
      async markFileClean() {
        // The other delivery wins in the window between our putAcceptedObject
        // and our conditional update. This is the exact interleaving.
        if (winnerOutcome === 'clean') {
          record = {
            ...record,
            scanStatus: 'clean',
            acceptedKey,
            scannedAt: '2026-08-19T01:00:00.000Z',
          };
          objects.delete(QUARANTINE_KEY); // the winner cleans up the original
        } else {
          record = { ...record, scanStatus: 'rejected', scannedAt: '2026-08-19T01:00:00.000Z' };
          objects.delete(QUARANTINE_KEY);
        }
        return null; // our conditional update lost
      },
      async markFileRejected() {
        return null;
      },
      async getObjectBytes() {
        return pngBytes();
      },
      async putAcceptedObject(input) {
        objects.add(input.key);
      },
      async deleteObject(_bucket, key) {
        objects.delete(key);
      },
      async appendAuditEvent(event) {
        return event;
      },
      generateId: () => 'audit_1',
    };

    return { deps, objects, acceptedKey };
  }

  it('leaves the promoted object alone when the winner promoted the same key', async () => {
    const { deps, objects, acceptedKey } = createRacingFakes('clean');
    await processScanResult(baseEvent(), deps);

    // The bug in one assertion: without the fix this set is empty and the
    // candidate's evidence is gone for good.
    expect(objects.has(acceptedKey)).toBe(true);
  });

  it('still deletes our object when the winner rejected the file', async () => {
    // Here the object we wrote really is an orphan for a file that never
    // passed, and nothing must be readable from accepted/ for it.
    const { deps, objects, acceptedKey } = createRacingFakes('rejected');
    await processScanResult(baseEvent(), deps);

    expect(objects.has(acceptedKey)).toBe(false);
  });
});
