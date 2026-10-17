import { describe, expect, it, vi } from 'vitest';
import {
  EICAR_STRING,
  REQUIRED_KEY_PREFIX,
  buildDeleteArgs,
  buildHeadObjectArgs,
  buildTaggingArgs,
  buildUploadArgs,
  classifyResult,
  extractScanStatus,
  generateEicarTestKey,
  isIsolatedEicarBucketName,
  pollForScanStatus,
} from './eicar-verifier-lib.mjs';

describe('generateEicarTestKey', () => {
  it('always generates a key under the required quarantine/ prefix', () => {
    const key = generateEicarTestKey();
    expect(key.startsWith(REQUIRED_KEY_PREFIX)).toBe(true);
    expect(key.startsWith('quarantine/')).toBe(true);
  });

  it('never generates a root-level key, even for edge-case inputs', () => {
    for (const now of [0, 1, Date.now()]) {
      const key = generateEicarTestKey(now, 'abc123');
      expect(key).toMatch(/^quarantine\/eicar-test-\d+-[a-z0-9]+$/);
    }
  });

  it('varies with the random suffix so concurrent runs cannot collide', () => {
    const a = generateEicarTestKey(1000, 'aaaaaa');
    const b = generateEicarTestKey(1000, 'bbbbbb');
    expect(a).not.toBe(b);
  });
});

describe('isIsolatedEicarBucketName', () => {
  it('accepts the real, live isolated-bucket naming pattern', () => {
    expect(isIsolatedEicarBucketName('zoryvex-test-evidence-scan-eicar-071770169654')).toBe(true);
    expect(isIsolatedEicarBucketName('zoryvex-production-evidence-scan-eicar-071770169654')).toBe(
      true,
    );
  });

  it('rejects the real evidence bucket — this must never be an accidental target', () => {
    expect(isIsolatedEicarBucketName('zoryvex-test-evidence-071770169654')).toBe(false);
  });

  it('rejects arbitrary or malformed bucket names', () => {
    for (const bad of [
      '',
      'not-a-bucket',
      'zoryvex-test-evidence-scan-eicar-', // missing account id
      'evidence-scan-eicar-071770169654', // missing zoryvex-<env>- prefix
      undefined,
      null,
      42,
    ]) {
      expect(isIsolatedEicarBucketName(bad)).toBe(false);
    }
  });
});

describe('upload/tagging/delete arg builders', () => {
  it('the upload mechanism streams via stdin and never references a local file path', () => {
    const args = buildUploadArgs(
      'zoryvex-test-evidence-scan-eicar-071770169654',
      'quarantine/x',
      'eu-west-1',
    );
    expect(args).toEqual([
      's3',
      'cp',
      '-',
      's3://zoryvex-test-evidence-scan-eicar-071770169654/quarantine/x',
      '--region',
      'eu-west-1',
    ]);
    // '-' is the stdin marker; no arg looks like a filesystem path.
    expect(args.some((a) => /[\\/].*\.(txt|tmp)$/i.test(a))).toBe(false);
  });

  it('EICAR_STRING is the payload the caller pipes via stdin, never written to a file by this module', () => {
    expect(EICAR_STRING).toContain('EICAR-STANDARD-ANTIVIRUS-TEST-FILE');
  });

  it('tagging/delete/head-object args are scoped to exactly the given bucket and key', () => {
    const bucket = 'zoryvex-test-evidence-scan-eicar-071770169654';
    const key = 'quarantine/eicar-test-123-abc';
    for (const builder of [buildTaggingArgs, buildDeleteArgs, buildHeadObjectArgs]) {
      const args = builder(bucket, key, 'eu-west-1');
      expect(args).toContain('--bucket');
      expect(args[args.indexOf('--bucket') + 1]).toBe(bucket);
      expect(args).toContain('--key');
      expect(args[args.indexOf('--key') + 1]).toBe(key);
    }
  });
});

describe('extractScanStatus', () => {
  it('reads the GuardDutyMalwareScanStatus tag value when present', () => {
    expect(
      extractScanStatus({
        TagSet: [{ Key: 'GuardDutyMalwareScanStatus', Value: 'THREATS_FOUND' }],
      }),
    ).toBe('THREATS_FOUND');
  });

  it('returns null when the tag is absent or the response is malformed', () => {
    expect(extractScanStatus({ TagSet: [] })).toBeNull();
    expect(extractScanStatus({ TagSet: [{ Key: 'Unrelated', Value: 'x' }] })).toBeNull();
    expect(extractScanStatus({})).toBeNull();
    expect(extractScanStatus(null)).toBeNull();
  });
});

describe('classifyResult (fail-closed)', () => {
  it('THREATS_FOUND is the only passing result', () => {
    expect(classifyResult('THREATS_FOUND')).toEqual({ pass: true, reason: expect.any(String) });
  });

  it('a timeout (null status) fails', () => {
    expect(classifyResult(null).pass).toBe(false);
  });

  it('any non-threat or unexpected status fails, never silently passes', () => {
    for (const status of ['NO_THREATS_FOUND', 'UNSUPPORTED', 'ACCESS_DENIED', 'unexpected-value']) {
      expect(classifyResult(status).pass).toBe(false);
    }
  });
});

describe('pollForScanStatus (bounded)', () => {
  it('returns the first non-null status without exhausting the attempt budget', async () => {
    const fetchTagging = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce('THREATS_FOUND');
    const sleep = vi.fn().mockResolvedValue(undefined);

    const status = await pollForScanStatus({ fetchTagging, sleep, maxAttempts: 5, intervalMs: 10 });

    expect(status).toBe('THREATS_FOUND');
    expect(fetchTagging).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it('never loops indefinitely — stops at exactly maxAttempts and returns null', async () => {
    const fetchTagging = vi.fn().mockResolvedValue(null);
    const sleep = vi.fn().mockResolvedValue(undefined);

    const status = await pollForScanStatus({ fetchTagging, sleep, maxAttempts: 4, intervalMs: 10 });

    expect(status).toBeNull();
    expect(fetchTagging).toHaveBeenCalledTimes(4);
    // no sleep after the final attempt
    expect(sleep).toHaveBeenCalledTimes(3);
  });

  it('cleanup callers scope delete to exactly the generated key, never a different one', () => {
    const key = generateEicarTestKey(1234, 'zzzzzz');
    const args = buildDeleteArgs('zoryvex-test-evidence-scan-eicar-071770169654', key, 'eu-west-1');
    expect(args[args.indexOf('--key') + 1]).toBe(key);
    expect(args).not.toContain('malware-protection-resource-validation-object');
  });
});
