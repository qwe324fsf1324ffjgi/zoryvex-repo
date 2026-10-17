#!/usr/bin/env node
// Uploads an already-built Next.js static export to exactly one S3 bucket,
// using content-hash comparison (not mtime) to decide what to upload, and
// deletes only S3 keys that are (a) inside the one --bucket named on the
// command line and (b) absent from the local build directory. There is no
// wildcard/multi-bucket capability anywhere in this file — the bucket name
// is a required, single string argument, so this script structurally cannot
// reach any bucket other than the one explicitly passed to it.
import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { extname, join, relative, sep } from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.json': 'application/json',
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.xml': 'application/xml',
  '.map': 'application/json',
};

function contentTypeFor(path) {
  return CONTENT_TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream';
}

// Next's hashed build assets (/_next/static/**) are content-addressed and
// safe to cache forever; everything else (HTML, top-level JSON/txt route
// exports) must revalidate so deploys are visible immediately.
//
// This is half of a two-part invariant, and the halves protect different
// caches. The CloudFront side (infrastructure/modules/static-site, guarded by
// terraform-policy-check) keeps the distribution's own TTL short. This side
// is what reaches the *browser*: CloudFront caps how long it holds an object
// itself, but passes the origin's Cache-Control through to the viewer, so a
// long max-age written here would sit in people's browsers for that long
// whatever the distribution does. No deploy invalidates anything, and none
// needs to, precisely because both halves hold. See docs/RUNBOOKS.md, "Deploy
// (test)", step 4, and the guard in sync-static-site-guard.test.mjs.
export function cacheControlFor(relKey) {
  return relKey.startsWith('_next/static/')
    ? 'public, max-age=31536000, immutable'
    : 'public, max-age=0, must-revalidate';
}

function md5Hex(buffer) {
  return createHash('md5').update(buffer).digest('hex');
}

async function walk(dir, base = dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walk(full, base)));
    } else if (entry.isFile()) {
      const relKey = relative(base, full).split(sep).join('/');
      files.push(relKey);
    }
  }
  return files;
}

function awsJson(args) {
  const out = execFileSync('aws', args, { encoding: 'utf8' });
  return JSON.parse(out);
}

/**
 * @param {{ bucket: string, sourceDir: string, region: string, apply?: boolean }} opts
 */
export async function syncStaticSite({ bucket, sourceDir, region, apply = false }) {
  if (!bucket || typeof bucket !== 'string' || bucket.trim() === '') {
    throw new Error('bucket is required and must be a non-empty string');
  }

  const localKeys = await walk(sourceDir);

  // Refuse to sync nothing. This function deletes every remote key that has
  // no local counterpart, so an empty source directory does not mean "no
  // changes" — it means "delete the entire live site". A missing directory
  // already throws from readdir, but an existing-but-empty one returns []
  // silently, which is exactly the shape a build that exited 0 without
  // writing output would produce. Syncing zero files is never intentional
  // here, so it fails closed rather than proceeding.
  if (localKeys.length === 0) {
    throw new Error(
      `Refusing to sync: no files found in ${sourceDir}. Every object in ${bucket} would be ` +
        'deleted. This almost certainly means the site build did not produce output — check the ' +
        'build step before re-running.',
    );
  }

  const localByKey = new Map();
  for (const key of localKeys) {
    const buf = readFileSync(join(sourceDir, ...key.split('/')));
    localByKey.set(key, {
      md5: md5Hex(buf),
      size: buf.length,
      path: join(sourceDir, ...key.split('/')),
    });
  }

  let remote;
  try {
    remote = awsJson([
      's3api',
      'list-objects-v2',
      '--bucket',
      bucket,
      '--region',
      region,
      '--query',
      'Contents[].{Key:Key,ETag:ETag}',
      '--output',
      'json',
    ]);
  } catch (err) {
    if (String(err.message ?? err).includes('NoSuchBucket')) {
      throw new Error(`Bucket does not exist: ${bucket}`);
    }
    throw err;
  }
  const remoteByKey = new Map((remote ?? []).map((o) => [o.Key, o.ETag.replaceAll('"', '')]));

  const toUpload = [];
  for (const [key, info] of localByKey) {
    const remoteEtag = remoteByKey.get(key);
    if (remoteEtag !== info.md5) toUpload.push(key);
  }
  const toDelete = [...remoteByKey.keys()].filter((key) => !localByKey.has(key));

  const plan = {
    bucket,
    localFileCount: localByKey.size,
    remoteFileCount: remoteByKey.size,
    toUploadCount: toUpload.length,
    toDeleteCount: toDelete.length,
    toUpload,
    toDelete,
  };

  if (!apply) return { applied: false, plan };

  for (const key of toUpload) {
    const info = localByKey.get(key);
    execFileSync(
      'aws',
      [
        's3api',
        'put-object',
        '--bucket',
        bucket,
        '--region',
        region,
        '--key',
        key,
        '--body',
        info.path,
        '--content-type',
        contentTypeFor(key),
        '--cache-control',
        cacheControlFor(key),
      ],
      { stdio: ['ignore', 'ignore', 'inherit'] },
    );
  }

  for (const key of toDelete) {
    execFileSync(
      'aws',
      ['s3api', 'delete-object', '--bucket', bucket, '--region', region, '--key', key],
      {
        stdio: ['ignore', 'ignore', 'inherit'],
      },
    );
  }

  return { applied: true, plan };
}

function parseArgs(argv) {
  const args = { bucket: null, sourceDir: null, region: 'eu-west-1', apply: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--bucket') args.bucket = argv[++i];
    else if (arg === '--source') args.sourceDir = argv[++i];
    else if (arg === '--region') args.region = argv[++i];
    else if (arg === '--apply') args.apply = true;
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.bucket || !args.sourceDir) {
    console.error(
      'Usage: node scripts/sync-static-site.mjs --bucket <name> --source <dir> [--region <region>] [--apply]\n' +
        '  Without --apply, only prints the plan (files to upload/delete) and makes no AWS calls that write.',
    );
    process.exit(1);
  }
  if (!statSync(args.sourceDir).isDirectory()) {
    console.error(`Not a directory: ${args.sourceDir}`);
    process.exit(1);
  }

  const { applied, plan } = await syncStaticSite(args);
  console.log(
    `Bucket: ${plan.bucket}\nLocal files: ${plan.localFileCount}\nRemote files (before): ${plan.remoteFileCount}\nTo upload (new/changed by content hash): ${plan.toUploadCount}\nTo delete (remote-only, this bucket only): ${plan.toDeleteCount}`,
  );
  if (plan.toDelete.length > 0) {
    console.log('Deletions:');
    for (const key of plan.toDelete) console.log(`  - ${key}`);
  }
  console.log(applied ? '\nApplied.' : '\nDry run only — pass --apply to upload.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
