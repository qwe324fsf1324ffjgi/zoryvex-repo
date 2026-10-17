#!/usr/bin/env node
// Real implementation (see scripts/deploy.mjs's header for the same
// caveat: reviewed, never yet exercised against a real deployment).
//
// docs/RUNBOOKS.md "Rollback": application code rollback is automatic and
// conservative (redeploy the last known-good commit); infrastructure/data
// rollback is deliberately NOT automatic here — it always goes through a
// new, reviewed `terraform plan`/diff via scripts/deploy.mjs or
// scripts/release.mjs, never a blind revert of live state.
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  DeployInputError,
  confirmationMatchesEnvironment,
  validateEnvironment,
} from './lib/deploy-lib.mjs';

const root = join(import.meta.dirname, '..');

/** Same region every other part of the deploy path targets (deploy-lib's backendConfigArgs). */
const DEPLOY_REGION = 'eu-west-1';

function parseArgs(argv) {
  const args = { env: null, confirm: null, appCodeOnly: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--env') args.env = argv[++i];
    else if (arg === '--confirm') args.confirm = argv[++i];
    else if (arg === '--app-code-only') args.appCodeOnly = true;
  }
  return args;
}

function usageAndExit(message) {
  console.error(message);
  console.error(
    '\nUsage: node scripts/rollback.mjs --env <test|production> --confirm <env-name> [--app-code-only]\n' +
      '  --app-code-only redeploys the last known-good commit (the only automatic path).\n' +
      '  Infrastructure/data rollback is never automatic — see docs/RUNBOOKS.md "Rollback" and\n' +
      '  "Data restore": it is a new, reviewed terraform plan/diff via scripts/deploy.mjs or\n' +
      '  scripts/release.mjs, applied deliberately, never a blind revert.',
  );
  process.exit(1);
}

export function lastGoodCommitParameterName(env) {
  validateEnvironment(env);
  return `/zoryvex/${env}/last-good-commit`;
}

/**
 * Called by scripts/deploy.mjs after a successful smoke test. Returns
 * whether it recorded, and deliberately never throws.
 *
 * Recording is bookkeeping for a FUTURE deploy. A deploy that has already
 * passed its smoke test has succeeded, and letting an SSM hiccup here throw
 * would fall into runDeploy's catch and roll back a deploy that actually
 * worked — turning a monitoring gap into an outage. The cost of a miss is
 * only that a later rollback targets an older commit, which is precisely the
 * situation this path exists to survive.
 */
export function recordLastGoodCommit(env, commitSha, { exec = execFileSync } = {}) {
  const name = lastGoodCommitParameterName(env);
  try {
    exec(
      'aws',
      [
        'ssm',
        'put-parameter',
        '--name',
        name,
        '--type',
        'String',
        '--overwrite',
        '--region',
        DEPLOY_REGION,
        '--value',
        String(commitSha).trim(),
      ],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
    return true;
  } catch (err) {
    console.warn(
      `Could not record the last-known-good commit at ${name} (${err.message}). This deploy ` +
        'succeeded and is unaffected; a later rollback would target the previously recorded commit.',
    );
    return false;
  }
}

/**
 * The value crosses a trust boundary on its way to `git checkout`, so its
 * shape is checked rather than assumed. Only the deploy role can write this
 * parameter, but a truncated or hand-edited value would otherwise reach git
 * as an opaque revision string and fail confusingly mid-rollback.
 */
function isCommitSha(value) {
  return /^[0-9a-f]{40}$/.test(value);
}

/** `null` when nothing has ever completed a smoke-tested deploy in this environment. */
export function readLastGoodCommit(env, { exec = execFileSync } = {}) {
  const name = lastGoodCommitParameterName(env);
  try {
    const value = exec(
      'aws',
      [
        'ssm',
        'get-parameter',
        '--name',
        name,
        '--query',
        'Parameter.Value',
        '--output',
        'text',
        '--region',
        DEPLOY_REGION,
      ],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    ).trim();
    // An absent parameter throws; a null value prints the literal "None".
    // Both fall through isCommitSha to `null`, the one "nothing to roll back
    // to" answer main() below already handles.
    return isCommitSha(value) ? value : null;
  } catch {
    return null;
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  let env;
  try {
    env = validateEnvironment(args.env);
  } catch (err) {
    if (err instanceof DeployInputError) usageAndExit(err.message);
    throw err;
  }

  if (!confirmationMatchesEnvironment(args.confirm, env)) {
    usageAndExit(`BLOCKED: --confirm must exactly equal the environment name ("${env}").`);
  }

  if (!args.appCodeOnly) {
    usageAndExit(
      'This script only ever performs the automatic app-code rollback (--app-code-only). ' +
        'An infrastructure/data rollback is a new, reviewed terraform plan — run scripts/deploy.mjs ' +
        '(or scripts/release.mjs for production) with a plan that reverts the change, per docs/RUNBOOKS.md.',
    );
  }

  // Refused here, at the top, rather than failing several steps later. This
  // script redeploys by shelling out to deploy.mjs, whose CLI refuses
  // `--env production` under any flag — so a production rollback could never
  // have worked. It previously got as far as checking out old code and
  // rebuilding before dying on that guard, leaving a modified working tree
  // behind. Production rollback is deliberately a reviewed, manual
  // release.mjs run (CLAUDE.md: no production apply without explicit
  // founder approval, which an automatic rollback cannot have).
  if (env === 'production') {
    usageAndExit(
      'BLOCKED: production is never rolled back automatically. Roll forward or back deliberately ' +
        'via scripts/release.mjs with a reviewed plan, per docs/RUNBOOKS.md "Rollback".',
    );
  }

  const commitSha = readLastGoodCommit(env);
  if (!commitSha) {
    console.error(
      `No recorded last-known-good commit for ${env} (${lastGoodCommitParameterName(env)} is unset — nothing has` +
        ' completed a smoke-tested deploy in this environment). Nothing to roll back to.',
    );
    process.exit(1);
  }

  console.log(`Rolling back ${env} app code to last known-good commit ${commitSha}.`);

  execFileSync('git', ['checkout', commitSha, '--', 'apps/web', 'services/api'], {
    cwd: root,
    stdio: 'inherit',
  });

  // From here the working tree holds OLD code, so the restore below must run
  // whatever happens. It used to sit after the redeploy with no `finally`,
  // so any failure in the build or the redeploy left the checkout in place —
  // a developer's tree silently reverted to an old commit, or a CI job
  // continuing against code nobody intended to be there.
  try {
    execFileSync('npm', ['run', 'build', '-w', 'apps/web'], { cwd: root, stdio: 'inherit' });
    // The actual redeploy (S3 sync + Lambda code update, using the same
    // saved-plan discipline) reuses scripts/deploy.mjs against this restored
    // working tree rather than duplicating the terraform invocation here.
    // `--no-auto-rollback` is essential, not optional: deploy.mjs rolls back
    // automatically when its smoke test fails, and this IS that rollback.
    // Without the flag a rollback whose own smoke test fails would trigger
    // another rollback, and so on without bound — each cycle running a real
    // `terraform apply`. That is the likely case, not the unlikely one: a
    // smoke test failing for an infrastructure reason is not fixed by
    // redeploying older application code.
    execFileSync(
      'node',
      [
        join(root, 'scripts', 'deploy.mjs'),
        '--env',
        env,
        '--confirm',
        env,
        '--apply',
        '--no-auto-rollback',
      ],
      {
        cwd: root,
        stdio: 'inherit',
      },
    );
  } finally {
    execFileSync('git', ['checkout', 'HEAD', '--', 'apps/web', 'services/api'], {
      cwd: root,
      stdio: 'inherit',
    });
  }

  console.log(`Rollback of ${env} to ${commitSha} complete.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
