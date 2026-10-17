// Pure, AWS-free logic for scripts/verify-evidence-eicar-fail-closed.mjs.
// Kept separate (same pattern as scripts/lib/deploy-lib.mjs) so the safety
// rules — correct bucket, correct prefix, bounded polling, fail-closed
// classification — are unit-testable without ever touching real AWS or
// materializing the EICAR string on disk.

export const EICAR_STRING = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';

// infrastructure/envs/*/main.tf names this bucket zoryvex-<env>-evidence-scan-eicar-<account-id>.
const EICAR_BUCKET_NAME_PATTERN = /^zoryvex-[a-z0-9]+-evidence-scan-eicar-\d+$/;

/**
 * The isolated bucket's GuardDuty Malware Protection plan is scoped to
 * ObjectPrefixes: ["quarantine/"] only (confirmed live). Any key outside
 * this prefix is never scanned, so a verifier using one would poll for a
 * tag that will never appear and report a misleading generic failure.
 */
export const REQUIRED_KEY_PREFIX = 'quarantine/';

export function isIsolatedEicarBucketName(bucketName) {
  return typeof bucketName === 'string' && EICAR_BUCKET_NAME_PATTERN.test(bucketName);
}

export function generateEicarTestKey(
  now = Date.now(),
  randomSuffix = Math.random().toString(36).slice(2, 8),
) {
  return `${REQUIRED_KEY_PREFIX}eicar-test-${now}-${randomSuffix}`;
}

/**
 * `s3 cp - s3://bucket/key` streams from stdin — the caller passes
 * EICAR_STRING via execFileSync's `input` option, so the payload is never
 * written to a local file (which local antivirus correctly quarantines on
 * sight, breaking any file-based upload path on a machine with real-time
 * protection enabled).
 */
export function buildUploadArgs(bucket, key, region) {
  return ['s3', 'cp', '-', `s3://${bucket}/${key}`, '--region', region];
}

export function buildTaggingArgs(bucket, key, region) {
  return [
    's3api',
    'get-object-tagging',
    '--bucket',
    bucket,
    '--key',
    key,
    '--region',
    region,
    '--output',
    'json',
  ];
}

export function buildDeleteArgs(bucket, key, region) {
  return ['s3api', 'delete-object', '--bucket', bucket, '--key', key, '--region', region];
}

export function buildHeadObjectArgs(bucket, key, region) {
  return ['s3api', 'head-object', '--bucket', bucket, '--key', key, '--region', region];
}

export function extractScanStatus(taggingResult) {
  const tag = (taggingResult?.TagSet ?? []).find((t) => t.Key === 'GuardDutyMalwareScanStatus');
  return tag ? tag.Value : null;
}

/** Fail closed: only an exact THREATS_FOUND is a pass; everything else — including timeout (null) — fails. */
export function classifyResult(status) {
  if (status === null) {
    return { pass: false, reason: 'No GuardDuty scan tag appeared within the timeout.' };
  }
  if (status !== 'THREATS_FOUND') {
    return {
      pass: false,
      reason: `Expected GuardDutyMalwareScanStatus=THREATS_FOUND, got "${status}".`,
    };
  }
  return {
    pass: true,
    reason: 'GuardDuty correctly flagged the EICAR test file as THREATS_FOUND.',
  };
}

/**
 * Bounded polling with injected fetch/sleep so this is unit-testable
 * without real timers or real AWS. Returns the first non-null status, or
 * null if maxAttempts is exhausted (never loops indefinitely).
 */
export async function pollForScanStatus({ fetchTagging, sleep, maxAttempts, intervalMs }) {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const status = await fetchTagging();
    if (status !== null) return status;
    if (attempt < maxAttempts) await sleep(intervalMs);
  }
  return null;
}
