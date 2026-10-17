import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { cacheControlFor, syncStaticSite } from '../sync-static-site.mjs';

/**
 * Guards a destructive-sync gap found in a 2026-08-27 audit.
 *
 * syncStaticSite deletes every remote object that has no local counterpart.
 * With an empty source directory that is not "no changes" — it is "delete the
 * entire live site". A missing directory already threw from readdir, but an
 * existing-but-empty one returned [] silently, which is precisely the shape a
 * build that exited 0 without writing output would produce.
 *
 * These run against real temp directories and never reach AWS: the empty case
 * must fail before any S3 call, and the non-empty case is only taken as far
 * as proving it got past the guard.
 */
describe('syncStaticSite empty-source guard', () => {
  const created = [];

  afterEach(() => {
    for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  function tempDir() {
    const dir = mkdtempSync(join(tmpdir(), 'zoryvex-sync-guard-'));
    created.push(dir);
    return dir;
  }

  it('refuses to sync an existing but empty directory, before touching S3', async () => {
    const emptyDir = tempDir();
    await expect(
      syncStaticSite({
        bucket: 'some-real-looking-bucket',
        sourceDir: emptyDir,
        region: 'eu-west-1',
        apply: true,
      }),
    ).rejects.toThrow(/Refusing to sync: no files found/);
  });

  it('names the bucket it protected, so the operator knows what was at risk', async () => {
    const emptyDir = tempDir();
    await expect(
      syncStaticSite({
        bucket: 'zoryvex-test-site-123456789012',
        sourceDir: emptyDir,
        region: 'eu-west-1',
        apply: true,
      }),
    ).rejects.toThrow(/zoryvex-test-site-123456789012/);
  });

  it('still rejects an empty directory even when only planning', async () => {
    // `apply: false` is a dry run, but returning a plan that says "delete
    // everything" would invite someone to approve exactly that.
    const emptyDir = tempDir();
    await expect(
      syncStaticSite({
        bucket: 'some-real-looking-bucket',
        sourceDir: emptyDir,
        region: 'eu-west-1',
        apply: false,
      }),
    ).rejects.toThrow(/Refusing to sync: no files found/);
  });

  it('rejects a blank bucket name before reading anything from disk', async () => {
    // The pre-existing bucket check, pinned here because it is the other
    // fail-closed input guard on this destructive function.
    const dir = tempDir();
    writeFileSync(join(dir, 'index.html'), '<!doctype html><title>t</title>');
    await expect(
      syncStaticSite({ bucket: '   ', sourceDir: dir, region: 'eu-west-1', apply: true }),
    ).rejects.toThrow(/bucket is required/);
  });
});

/**
 * The other half of the no-invalidation invariant.
 *
 * No deploy this project runs invalidates CloudFront, and none needs to, but
 * only because two separate rules hold at once. The distribution's own TTL is
 * kept short by infrastructure/modules/static-site and enforced by
 * terraform-policy-check.mjs. Nothing enforced this half until now, and this
 * half is the one that reaches the browser: CloudFront caps how long it holds
 * an object itself, but passes the origin's Cache-Control straight through to
 * the viewer. A long max-age written on HTML here would sit in people's
 * browsers for that long however short the distribution's TTL was, and no
 * invalidation can reach a cache inside somebody else's laptop.
 *
 * Documented in docs/RUNBOOKS.md, "Deploy (test)", step 4.
 */
describe('cacheControlFor, and why no deploy invalidates CloudFront', () => {
  it('lets content-hashed build assets cache forever', () => {
    // Safe precisely because the filename changes when the content does, so a
    // stale copy is never the copy a new page asks for.
    for (const key of [
      '_next/static/chunks/abc123.js',
      '_next/static/css/def456.css',
      '_next/static/media/font.woff2',
    ]) {
      expect(cacheControlFor(key)).toBe('public, max-age=31536000, immutable');
    }
  });

  it('makes everything else revalidate, because nothing else is content-hashed', () => {
    // Next's static export writes plain page names. Two deploys produce the
    // same URL with different contents, so a cached copy is a wrong copy.
    for (const key of [
      'index.html',
      'pricing.html',
      'employer/role.html',
      'sitemap.xml',
      'robots.txt',
      '404.html',
    ]) {
      expect(cacheControlFor(key)).toBe('public, max-age=0, must-revalidate');
    }
  });

  it('never gives a page a max-age a deploy cannot clear', () => {
    // The failure this exists to prevent, stated as the rule rather than as
    // a list of paths: anything outside _next/static must be revalidated, so
    // a future path that nobody thought of is caught too.
    const notHashed = ['index.html', 'about/index.html', 'feed.json', '_next/data/build/x.json'];
    for (const key of notHashed) {
      expect(cacheControlFor(key), key).not.toMatch(/max-age=[1-9]/);
    }
  });
});

// Deliberately not tested here: the happy path past the guard. Every route
// beyond it shells out to the AWS CLI, and a unit test that reaches the
// network is a test that hangs in CI — an earlier draft of this file did
// exactly that and timed out. The guard itself is the behaviour worth
// pinning; the sync mechanics are exercised by real deploys.
