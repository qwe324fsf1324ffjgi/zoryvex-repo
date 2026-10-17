#!/usr/bin/env node
// Real AWS verification (not a CI unit test) that GuardDuty Malware
// Protection for S3 correctly flags the EICAR standard antivirus test
// string as a threat, proving the fail-closed evidence pipeline's negative
// case — not just its happy path. Uses ONLY the isolated
// evidence_scan_test_bucket (infrastructure/envs/test's
// evidence_scan_test_bucket_name), never the real evidence bucket, and
// deletes the object immediately after the assertion regardless of
// outcome — per Prompt 7: prove this "without storing the test artifact
// outside the isolated test bucket."
//
// The isolated bucket's GuardDuty Malware Protection plan is scoped to
// ObjectPrefixes: ["quarantine/"] only (confirmed live) — every object this
// script creates MUST be keyed under quarantine/, or GuardDuty will never
// scan it and this script will time out with a misleading generic failure
// instead of a real result. Do not choose a root-level key.
//
// The EICAR payload is streamed directly to S3 via stdin — never written to
// a local file. A materialized EICAR file is correctly quarantined by any
// real-time antivirus product the instant it touches disk, which breaks a
// file-based upload path entirely on a developer machine with real-time
// protection enabled.
//
// Run manually, post-deploy, from the founder's own authenticated AWS CLI
// session (same pattern as every other real acceptance check in this
// project) — never part of CI, never automated against production.
import { execFileSync } from 'node:child_process';
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
} from './lib/eicar-verifier-lib.mjs';

const POLL_INTERVAL_MS = 10_000;

function parseArgs(argv) {
  const args = { bucket: null, region: 'eu-west-1', timeoutSeconds: 180 };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--bucket') args.bucket = argv[++i];
    if (argv[i] === '--region') args.region = argv[++i];
    if (argv[i] === '--timeout-seconds') args.timeoutSeconds = Number(argv[++i]);
  }
  return args;
}

function printUsage() {
  console.error(
    [
      'Usage: node scripts/verify-evidence-eicar-fail-closed.mjs --bucket <isolated-eicar-test-bucket> [--region <region>] [--timeout-seconds <n>]',
      '',
      'The target bucket must be the dedicated isolated EICAR test bucket',
      '(infrastructure/envs/*/main.tf: evidence_scan_test_bucket_name, e.g.',
      '"zoryvex-test-evidence-scan-eicar-<account-id>") — never the real evidence bucket.',
      'Its GuardDuty Malware Protection plan only scans objects under the',
      `"${REQUIRED_KEY_PREFIX}" prefix; this script always keys its test object there.`,
    ].join('\n'),
  );
}

function awsJson(cliArgs) {
  const out = execFileSync('aws', cliArgs, { encoding: 'utf8' });
  return JSON.parse(out);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const { bucket, region, timeoutSeconds } = parseArgs(process.argv.slice(2));
  if (!bucket) {
    printUsage();
    process.exit(1);
  }

  if (!isIsolatedEicarBucketName(bucket)) {
    console.error(
      `Refusing to run: "${bucket}" does not match the expected isolated EICAR test-bucket name ` +
        'pattern (zoryvex-<env>-evidence-scan-eicar-<account-id>). This tool must never target the ' +
        'real evidence bucket or any other bucket.',
    );
    process.exit(1);
  }

  const key = generateEicarTestKey();
  if (!key.startsWith(REQUIRED_KEY_PREFIX)) {
    // Should be structurally impossible — fail closed if it ever isn't.
    console.error(`Refusing to run: generated key "${key}" is missing the required prefix.`);
    process.exit(1);
  }

  let uploaded = false;
  try {
    console.log(
      `Streaming the EICAR test string directly to s3://${bucket}/${key} via stdin ` +
        '(never written to local disk) ...',
    );
    try {
      execFileSync('aws', buildUploadArgs(bucket, key, region), {
        input: EICAR_STRING,
        encoding: 'utf8',
      });
      uploaded = true;
    } catch (uploadError) {
      console.error('FAIL: upload to the isolated bucket failed.', uploadError.message);
      process.exitCode = 1;
      return;
    }

    const maxAttempts = Math.max(1, Math.floor((timeoutSeconds * 1000) / POLL_INTERVAL_MS));
    console.log(
      `Polling for the GuardDuty scan tag (up to ${maxAttempts} checks, ` +
        `${POLL_INTERVAL_MS / 1000}s apart) ...`,
    );
    const status = await pollForScanStatus({
      fetchTagging: () => extractScanStatus(awsJson(buildTaggingArgs(bucket, key, region))),
      sleep,
      maxAttempts,
      intervalMs: POLL_INTERVAL_MS,
    });

    const result = classifyResult(status);
    if (!result.pass) {
      console.error(`FAIL: ${result.reason}`);
      process.exitCode = 1;
      return;
    }
    console.log(`PASS: ${result.reason}`);
  } finally {
    if (uploaded) {
      console.log(`Cleaning up: deleting s3://${bucket}/${key} ...`);
      try {
        execFileSync('aws', buildDeleteArgs(bucket, key, region), { stdio: 'inherit' });
        try {
          execFileSync('aws', buildHeadObjectArgs(bucket, key, region), { stdio: 'ignore' });
          console.error(
            `WARNING: s3://${bucket}/${key} still appears to exist after delete — verify and delete manually.`,
          );
        } catch {
          console.log('Cleanup verified: the test object no longer exists.');
        }
      } catch (cleanupError) {
        console.error(
          'WARNING: failed to delete the EICAR test object — delete it manually.',
          cleanupError.message,
        );
      }
    }
  }
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
