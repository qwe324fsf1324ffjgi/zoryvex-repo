#!/usr/bin/env node
// Bundles each services/api handler into a single Lambda-deployable zip.
// esbuild output uses the .mjs extension deliberately — Node's Lambda
// runtime treats a .mjs file as ESM regardless of any package.json, so no
// package.json needs to ship inside the zip at all. Bundled (not just
// transpiled) so the zip is self-contained: no node_modules directory, no
// separate layer, matching this project's "immutable content hash" deploy
// model (infrastructure/modules/api-route's source_code_hash tracks
// exactly this file).
import { build } from 'esbuild';
import { ZipFile } from 'yazl';
import { createWriteStream, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = join(import.meta.dirname, '..');
const apiRoot = join(root, 'services', 'api');
const distDir = join(apiRoot, 'dist');

// Exported because it is the only authoritative map from a Lambda function
// name to the handler source it is built from, and other checks need that
// mapping — scripts/check-gsi-grants.mjs walks it to compare each function's
// real DynamoDB index usage against the IAM grant its Terraform block gives
// it. Keeping one list means a new handler cannot be added to the build and
// forgotten by the check.
export const HANDLERS = [
  { name: 'health', entry: join(apiRoot, 'handlers', 'health.ts') },
  { name: 'public-proof', entry: join(apiRoot, 'handlers', 'public', 'proof.ts') },
  { name: 'peer-request', entry: join(apiRoot, 'handlers', 'peer', 'request.ts') },
  { name: 'peer-preview', entry: join(apiRoot, 'handlers', 'peer', 'preview.ts') },
  { name: 'peer-confirm', entry: join(apiRoot, 'handlers', 'peer', 'confirm.ts') },
  { name: 'public-proof-badge', entry: join(apiRoot, 'handlers', 'public', 'badge.ts') },
  { name: 'authorizer', entry: join(apiRoot, 'handlers', 'authorizer.ts') },
  { name: 'auth-request-code', entry: join(apiRoot, 'handlers', 'auth', 'request-code.ts') },
  { name: 'auth-consume-code', entry: join(apiRoot, 'handlers', 'auth', 'consume-code.ts') },
  { name: 'auth-sign-out', entry: join(apiRoot, 'handlers', 'auth', 'sign-out.ts') },
  {
    name: 'webauthn-register-options',
    entry: join(apiRoot, 'handlers', 'auth', 'webauthn-register-options.ts'),
  },
  {
    name: 'webauthn-register-verify',
    entry: join(apiRoot, 'handlers', 'auth', 'webauthn-register-verify.ts'),
  },
  {
    name: 'webauthn-step-up-options',
    entry: join(apiRoot, 'handlers', 'auth', 'webauthn-step-up-options.ts'),
  },
  {
    name: 'webauthn-step-up-verify',
    entry: join(apiRoot, 'handlers', 'auth', 'webauthn-step-up-verify.ts'),
  },
  {
    name: 'evidence-request-upload',
    entry: join(apiRoot, 'handlers', 'evidence', 'request-upload.ts'),
  },
  { name: 'evidence-download', entry: join(apiRoot, 'handlers', 'evidence', 'download.ts') },
  {
    name: 'evidence-scan-result-worker',
    entry: join(apiRoot, 'handlers', 'evidence', 'scan-result-worker.ts'),
  },
  { name: 'kit-preview', entry: join(apiRoot, 'handlers', 'kit', 'preview.ts') },
  { name: 'kit-status', entry: join(apiRoot, 'handlers', 'kit', 'status.ts') },
  { name: 'kit-create-order', entry: join(apiRoot, 'handlers', 'kit', 'create-order.ts') },
  { name: 'kit-download', entry: join(apiRoot, 'handlers', 'kit', 'download.ts') },
  { name: 'kit-regenerate', entry: join(apiRoot, 'handlers', 'kit', 'regenerate.ts') },
  { name: 'webhooks-paystack', entry: join(apiRoot, 'handlers', 'webhooks', 'paystack.ts') },
  { name: 'privacy-consent', entry: join(apiRoot, 'handlers', 'privacy', 'consent.ts') },
  { name: 'privacy-export', entry: join(apiRoot, 'handlers', 'privacy', 'export.ts') },
  {
    name: 'privacy-request-deletion',
    entry: join(apiRoot, 'handlers', 'privacy', 'request-deletion.ts'),
  },
  {
    name: 'privacy-deletion-worker',
    entry: join(apiRoot, 'handlers', 'privacy', 'deletion-worker.ts'),
  },
  {
    name: 'matches-unlock-contact',
    entry: join(apiRoot, 'handlers', 'matches', 'unlock-contact.ts'),
  },
  {
    name: 'matches-set-employer-interest',
    entry: join(apiRoot, 'handlers', 'matches', 'set-employer-interest.ts'),
  },
  {
    name: 'candidates-list-matches',
    entry: join(apiRoot, 'handlers', 'candidates', 'list-matches.ts'),
  },
  {
    name: 'candidates-set-interest',
    entry: join(apiRoot, 'handlers', 'candidates', 'set-interest.ts'),
  },
  {
    name: 'matches-get-contact',
    entry: join(apiRoot, 'handlers', 'matches', 'get-contact.ts'),
  },
  { name: 'matches-recompute', entry: join(apiRoot, 'handlers', 'matches', 'recompute.ts') },
  { name: 'matches-list', entry: join(apiRoot, 'handlers', 'matches', 'list-for-role.ts') },
  { name: 'matches-explain', entry: join(apiRoot, 'handlers', 'matches', 'explain.ts') },
  { name: 'admin-exceptions', entry: join(apiRoot, 'handlers', 'admin', 'exceptions.ts') },
  { name: 'auth-session', entry: join(apiRoot, 'handlers', 'auth', 'session.ts') },
  { name: 'roles-create', entry: join(apiRoot, 'handlers', 'roles', 'create.ts') },
  { name: 'roles-get', entry: join(apiRoot, 'handlers', 'roles', 'get.ts') },
  { name: 'roles-list', entry: join(apiRoot, 'handlers', 'roles', 'list.ts') },
  { name: 'roles-update', entry: join(apiRoot, 'handlers', 'roles', 'update.ts') },
  {
    name: 'candidates-profile-get',
    entry: join(apiRoot, 'handlers', 'candidates', 'profile-get.ts'),
  },
  {
    name: 'candidates-profile-update',
    entry: join(apiRoot, 'handlers', 'candidates', 'profile-update.ts'),
  },
  {
    name: 'candidates-evidence-create',
    entry: join(apiRoot, 'handlers', 'candidates', 'evidence-create.ts'),
  },
  {
    name: 'candidates-evidence-list',
    entry: join(apiRoot, 'handlers', 'candidates', 'evidence-list.ts'),
  },
  {
    name: 'candidates-evidence-get',
    entry: join(apiRoot, 'handlers', 'candidates', 'evidence-get.ts'),
  },
  {
    name: 'candidates-evidence-update',
    entry: join(apiRoot, 'handlers', 'candidates', 'evidence-update.ts'),
  },
  {
    name: 'candidates-evidence-delete',
    entry: join(apiRoot, 'handlers', 'candidates', 'evidence-delete.ts'),
  },
  {
    name: 'candidates-evidence-verify-begin',
    entry: join(apiRoot, 'handlers', 'candidates', 'evidence-verify-begin.ts'),
  },
  {
    name: 'candidates-evidence-verify',
    entry: join(apiRoot, 'handlers', 'candidates', 'evidence-verify.ts'),
  },
  {
    name: 'matches-evidence',
    entry: join(apiRoot, 'handlers', 'matches', 'evidence.ts'),
  },
  {
    name: 'candidates-graded-task',
    entry: join(apiRoot, 'handlers', 'candidates', 'graded-task.ts'),
  },
  {
    name: 'jobs-verification-reminder',
    entry: join(apiRoot, 'handlers', 'jobs', 'verification-reminder-worker.ts'),
  },
  {
    name: 'billing-create-subscription',
    entry: join(apiRoot, 'handlers', 'billing', 'create-subscription.ts'),
  },
  { name: 'billing-overview', entry: join(apiRoot, 'handlers', 'billing', 'overview.ts') },
  { name: 'billing-cancel', entry: join(apiRoot, 'handlers', 'billing', 'cancel.ts') },
  {
    name: 'billing-card-update-link',
    entry: join(apiRoot, 'handlers', 'billing', 'card-update-link.ts'),
  },
  {
    name: 'admin-billing-diagnostic',
    entry: join(apiRoot, 'handlers', 'admin', 'billing-diagnostic.ts'),
  },
  {
    name: 'jobs-billing-reconciliation',
    entry: join(apiRoot, 'handlers', 'jobs', 'billing-reconciliation-worker.ts'),
  },
];

// Fixed, not the real build time: yazl's addFile() otherwise stamps each
// zip entry with the bundle file's own mtime (a fresh write every build),
// so infrastructure/modules/api-route's filebase64sha256(deployment_package_path)
// changes on every single deploy even when esbuild's actual output is
// byte-identical — confirmed by hashing services/api/dist/health.mjs across
// two back-to-back builds (identical) versus the resulting .zip (different).
// That noise is exactly what showed up as "Plan summary: +0 ~37/~39 -0" on
// deploys that touched no Lambda source at all. yazl's DOS-date range starts
// at 1980-01-01, so that is used here rather than the Unix epoch.
const FIXED_ZIP_ENTRY_DATE = new Date('1980-01-01T00:00:00Z');

async function zipFile(sourcePath, destZipPath, entryName) {
  await new Promise((resolve, reject) => {
    const zipFile = new ZipFile();
    const output = createWriteStream(destZipPath);
    output.on('close', resolve);
    output.on('error', reject);
    zipFile.outputStream.pipe(output);
    zipFile.addFile(sourcePath, entryName, { mtime: FIXED_ZIP_ENTRY_DATE });
    zipFile.end();
  });
}

/**
 * The commit these bundles are built from, substituted into the code below
 * so a running Lambda can report which build it is.
 *
 * This is what lets a deploy prove it actually deployed: the smoke test
 * compares the sha /health reports against the sha being deployed. Asserting
 * a 2xx alone could never catch a deploy that silently changed nothing,
 * because the previous build answers 2xx just as happily.
 *
 * Falls back to 'unknown' rather than throwing, so a build still works
 * outside a git checkout. A deploy is what insists on a real value.
 */
export function resolveBuildSha() {
  if (process.env.ZORYVEX_BUILD_SHA) return process.env.ZORYVEX_BUILD_SHA;
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

async function main() {
  const buildSha = resolveBuildSha();
  console.log(`Build sha: ${buildSha}`);

  if (!existsSync(distDir)) mkdirSync(distDir, { recursive: true });

  for (const { name, entry } of HANDLERS) {
    const bundlePath = join(distDir, `${name}.mjs`);
    const zipPath = join(distDir, `${name}.zip`);

    console.log(`Building ${name}...`);
    await build({
      entryPoints: [entry],
      outfile: bundlePath,
      bundle: true,
      platform: 'node',
      target: 'node24',
      format: 'esm',
      // AWS's own current guidance (docs.aws.amazon.com/lambda/latest/dg/
      // lambda-runtimes.html, "Runtime-included SDK versions"): always
      // bundle the exact SDK modules your code uses rather than relying on
      // the runtime-provided copy, which is a curated subset intended for
      // console/inline-code use, not guaranteed to include every
      // @aws-sdk/* package this app depends on, and can drift version
      // during an automatic runtime update. No `external` list for
      // @aws-sdk/* — every handler's zip is fully self-contained.
      minify: true,
      sourcemap: false,
      logLevel: 'warning',
      // A bundled dependency can contain a require() call esbuild can't
      // statically resolve to a static import (e.g. a non-literal-string
      // argument) — esbuild then leaves a runtime require() call in the
      // output, which throws "Dynamic require of ... is not supported"
      // under Node's real ESM loader, since `require` isn't a global there.
      // This banner gives every bundle a real require, built the same way
      // Node's own docs recommend for ESM (nodejs.org/api/module.html
      // #modulecreaterequirefilename): createRequire(import.meta.url).
      // Confirmed as the failing path via a real Phase 7 slice 11
      // acceptance attempt (CloudWatch Init Error: "Dynamic require of
      // \"node:https\" is not supported", zoryvex-test-auth-request-code) —
      // not a guess.
      banner: {
        js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
      },
      // Literal-substituted at bundle time, so the value describes this
      // exact bundle rather than configuration that could drift from it.
      // Under vitest the source is never bundled, so the same expression
      // reads a genuinely absent env var and falls back to 'unknown'.
      define: {
        'process.env.ZORYVEX_BUILD_SHA': JSON.stringify(buildSha),
      },
    });

    // handlers/<name>.handler must resolve to <name>.mjs inside the zip —
    // matching infrastructure/modules/api-route's/auth's `handler` variable.
    await zipFile(bundlePath, zipPath, `handlers/${name}.mjs`);
    console.log(`  -> ${zipPath}`);
  }
}

// Guarded so importing HANDLERS does not run a build.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
