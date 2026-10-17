#!/usr/bin/env node
// The one reviewed entry point .claude/hooks/pre-tool-use.ps1 allows a
// production `terraform apply` through. Real implementation (see
// scripts/deploy.mjs's header for the same caveat: reviewed, never yet
// exercised — nothing is deployed anywhere yet, docs/DEPLOYMENT_STATUS.md).
//
// Calls scripts/deploy.mjs's runDeploy() directly, in-process — production
// does not get a second, divergent code path to accidentally fall out of
// sync with test's, and there is no flag or environment variable that lets
// deploy.mjs's own CLI reopen the door to production (see that file). This
// script is the only caller allowed to pass env: "production" to
// runDeploy(), and only after both confirmations below.
import { pathToFileURL } from 'node:url';
import { runDeploy } from './deploy.mjs';
import { DeployInputError, confirmationAuthorizesProductionRelease } from './lib/deploy-lib.mjs';

function parseArgs(argv) {
  const args = { confirmEnv: null, confirmRelease: null, apply: false, allowDestroy: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--confirm-env') args.confirmEnv = argv[++i];
    else if (arg === '--confirm-release') args.confirmRelease = argv[++i];
    else if (arg === '--apply') args.apply = true;
    else if (arg === '--allow-destroy') args.allowDestroy = true;
  }
  return args;
}

function usageAndExit(message) {
  console.error(message);
  console.error(
    '\nUsage: node scripts/release.mjs --confirm-env production --confirm-release PRODUCTION [--apply]\n' +
      '  Two separate, deliberately different confirmations are required — a single flag typo must\n' +
      '  never be enough to release to production. Without --apply, this only plans and shows you\n' +
      '  what would change.',
  );
  process.exit(1);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (
    !confirmationAuthorizesProductionRelease('production', args.confirmEnv, args.confirmRelease)
  ) {
    usageAndExit(
      'BLOCKED: production release requires both --confirm-env production and --confirm-release PRODUCTION.',
    );
  }

  try {
    await runDeploy({
      env: 'production',
      confirm: 'production',
      apply: args.apply,
      allowDestroy: args.allowDestroy,
    });
  } catch (err) {
    console.error(err instanceof DeployInputError ? err.message : err);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
