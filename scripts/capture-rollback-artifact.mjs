#!/usr/bin/env node
// Captures everything a Terraform apply is about to overwrite, so the apply
// has a rollback rather than a hope.
//
// CLAUDE.md requires a tested rollback before any apply. For most resource
// types the rollback is a reviewed reverse plan, because Terraform can
// recreate them from configuration. Lambda code is the exception, and it is
// the exception that matters here: infrastructure/modules/api-route creates
// functions with `publish` unset, so AWS keeps only $LATEST and retains no
// previous version. The moment an apply updates a function's code, the bytes
// that were running are gone. They are not in AWS, and they are not
// reconstructible from the repository either, because nothing records which
// commit built the code that is currently deployed.
//
// So this script downloads the live deployment package of every function
// named on the command line, verifies each download against the CodeSha256
// AWS reports for it, and writes a manifest. A copy that has not been
// verified against the live hash is not a rollback artifact, it is a file.
//
// Deliberately read-only: get-function and a presigned GET. It changes
// nothing in AWS and can be run at any time, including while deciding
// whether to apply at all.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const REGION = process.env.AWS_REGION ?? 'eu-west-1';

function aws(args) {
  return execFileSync('aws', [...args, '--region', REGION], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
}

/** AWS reports CodeSha256 as base64 of the zip's SHA-256 digest. */
function sha256Base64(bytes) {
  return createHash('sha256').update(bytes).digest('base64');
}

export async function captureFunction(functionName, outDir) {
  const described = JSON.parse(
    aws(['lambda', 'get-function', '--function-name', functionName, '--output', 'json']),
  );
  const expected = described.Configuration.CodeSha256;

  // The local resolver on this machine fails intermittently for arbitrary
  // hostnames (docs/RISK_REGISTER.md). One transient lookup failure part-way
  // through forty-five downloads would otherwise leave a rollback artifact
  // with a hole in it, discovered at the worst possible moment.
  let bytes;
  let lastError;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const response = await fetch(described.Code.Location);
      if (!response.ok) {
        throw new Error(`download failed with HTTP ${response.status}`);
      }
      bytes = Buffer.from(await response.arrayBuffer());
      break;
    } catch (error) {
      lastError = error;
      if (attempt < 4) await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
    }
  }
  if (!bytes) {
    throw new Error(`${functionName}: ${lastError?.message ?? 'download failed'} after 4 attempts`);
  }
  const actual = sha256Base64(bytes);

  // The whole point of the artifact. An unverified copy would look identical
  // on disk and be useless at the only moment it is ever needed.
  if (actual !== expected) {
    throw new Error(
      `${functionName}: downloaded package does not match the live CodeSha256. ` +
        `AWS reports ${expected}, the download hashes to ${actual}.`,
    );
  }

  const file = join(outDir, `${functionName}.zip`);
  writeFileSync(file, bytes);

  return {
    functionName,
    codeSha256: expected,
    bytes: bytes.length,
    runtime: described.Configuration.Runtime,
    handler: described.Configuration.Handler,
    lastModified: described.Configuration.LastModified,
    // Kept because an apply can change these alongside the code, and a
    // rollback that restores the bytes but not the variables is not one.
    environment: described.Configuration.Environment?.Variables ?? {},
    file,
  };
}

async function main() {
  const argv = process.argv.slice(2);
  const outFlag = argv.indexOf('--out');
  // Skip the flag and the directory that follows it. Without this the output
  // directory is read as a function name, which fails in a way that looks
  // like a missing Lambda rather than a mistake in this file.
  const names = argv.filter(
    (arg, index) => !arg.startsWith('--') && index !== outFlag + 1 && !arg.startsWith('-'),
  );
  if (names.length === 0 || outFlag === -1) {
    console.error(
      'Usage: node scripts/capture-rollback-artifact.mjs --out <dir> <functionName>...\n' +
        '  Reads function names from stdin as well, one per line.',
    );
    process.exit(1);
  }
  const outDir = argv[outFlag + 1];
  mkdirSync(outDir, { recursive: true });

  const captured = [];
  const failures = [];
  for (const name of names) {
    try {
      const record = await captureFunction(name, outDir);
      captured.push(record);
      console.log(`ok       ${name.padEnd(48)} ${String(record.bytes).padStart(9)} bytes`);
    } catch (error) {
      failures.push(`${name}: ${error.message}`);
      console.error(`FAILED   ${name}: ${error.message}`);
    }
  }

  const manifest = {
    capturedAt: new Date().toISOString(),
    region: REGION,
    functionCount: captured.length,
    functions: captured,
  };
  writeFileSync(join(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  console.log(`\n${captured.length} package(s) captured and hash-verified into ${outDir}`);
  if (failures.length > 0) {
    console.error(`\n${failures.length} failed. This is not a usable rollback artifact yet:`);
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exit(1);
  }
}

if (process.argv[1]?.endsWith('capture-rollback-artifact.mjs')) {
  await main();
}
