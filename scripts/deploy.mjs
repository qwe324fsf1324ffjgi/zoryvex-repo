#!/usr/bin/env node
// Real implementation, authorized by Prompt 5 ("Create ... deployment and
// rollback scripts that show a plan, save the exact plan artifact, require
// environment confirmation, apply only the saved plan, run smoke tests, and
// automatically roll back app code on failure"). Still guarded: the CLI
// entry point at the bottom of this file refuses production outright — the
// only way into runDeploy() for production is scripts/release.mjs calling
// it directly (in-process, not a shelled-out flag), after its own stronger
// two-part confirmation. There is deliberately no environment variable or
// flag that reopens that door on this file's own CLI, so a stray direct
// invocation of `node scripts/deploy.mjs --env production` cannot be
// talked into proceeding no matter what else is passed.
//
// This has been run end-to-end against real AWS — the 2026-08-26 CORS and
// Paystack-reference fixes were deployed through it. What has not run is the
// failure path: no smoke test has ever failed, so the auto-rollback below is
// still reviewed rather than proven, which is why the pure decision logic
// (scripts/lib/deploy-lib.mjs) is unit tested separately from the parts of
// this file that shell out.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  DeployInputError,
  assertExpectedAwsAccount,
  backendConfigArgs,
  confirmationMatchesEnvironment,
  describeBlankingRegressions,
  detectBlankingRegressions,
  hasDangerousDestroy,
  planArtifactPath,
  spawnPlanFor,
  summarizePlan,
  validateEnvironment,
} from './lib/deploy-lib.mjs';
import { reportFeatureFlagDrift } from './check-feature-flags.mjs';
import { recordLastGoodCommit } from './rollback.mjs';
import { syncStaticSite } from './sync-static-site.mjs';

const root = join(import.meta.dirname, '..');

function run(cmd, args, options = {}) {
  console.log(`\n$ ${cmd} ${args.join(' ')}`);
  const spawn = spawnPlanFor(cmd, args);
  return execFileSync(spawn.command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
    shell: spawn.shell,
    // Default Node maxBuffer (1MB) is too small for `terraform show -json`
    // on a plan touching hundreds of resources — found for real running
    // this script against the Phase 7 backlog (263 resources), which
    // produced >1MB of JSON and failed with ENOBUFS.
    maxBuffer: 100 * 1024 * 1024,
    ...options,
  });
}

/**
 * Plan → (optionally) apply → smoke-test → (on failure) auto app-code
 * rollback, for one environment. Callable directly (scripts/release.mjs
 * does this for production) or via this file's CLI (test only — see
 * main() below).
 */
export async function runDeploy({
  env,
  confirm,
  apply = false,
  allowDestroy = false,
  allowBlanking = false,
  autoRollback = true,
}) {
  env = validateEnvironment(env);

  if (!confirmationMatchesEnvironment(confirm, env)) {
    throw new DeployInputError(`--confirm must exactly equal the environment name ("${env}").`);
  }

  const envDir = join(root, 'infrastructure', 'envs', env);
  const planPath = join(root, planArtifactPath(env));
  mkdirSync(dirname(planPath), { recursive: true });

  // Fresh-runner-safe backend init (Phase 7 slice 9): a clean checkout has
  // no infrastructure/envs/<env>/.terraform cache to fall back on, so the
  // backend bucket/key must be resolved explicitly every run, from the AWS
  // account the caller is currently authenticated as — never a GitHub
  // variable, never a hardcoded bucket, never a different account. Fails
  // closed before any backend/state resolution if the identity is wrong.
  const accountId = assertExpectedAwsAccount(
    run('aws', ['sts', 'get-caller-identity', '--query', 'Account', '--output', 'text'], {
      cwd: envDir,
    }).trim(),
  );

  // Rebuild the API bundles before planning, so what Terraform uploads is
  // this commit's code.
  //
  // The commit is baked into each bundle by esbuild at build time and is
  // what /health reports. This step did not exist, so a release ran
  // Terraform against whatever zips happened to be on disk: usually stale,
  // occasionally from a different branch, and on a frontend-only commit
  // Terraform correctly saw no change and deployed no API at all. The
  // smoke test then failed on a version mismatch, which looked like a
  // broken deploy and was really the deploy telling the truth — the API
  // running in production was not the commit being released.
  //
  // Deterministic: identical source produces identical bundles, so on a
  // commit that changes no API code Terraform still sees no change and
  // nothing is redeployed unnecessarily.
  console.log('\nBuilding API deployment packages ...');
  run('npm', ['run', 'build:lambda'], { cwd: root });

  console.log(`Planning ${env} — saving the exact plan artifact to ${planPath}`);
  run('terraform', ['init', '-input=false', ...backendConfigArgs(env, accountId)], {
    cwd: envDir,
  });
  run('terraform', ['plan', '-input=false', `-out=${planPath}`], { cwd: envDir });

  const planJsonRaw = run('terraform', ['show', '-json', planPath], { cwd: envDir });
  const planJson = JSON.parse(planJsonRaw);
  const summary = summarizePlan(planJson);

  console.log(`\nPlan summary: +${summary.add} ~${summary.change} -${summary.destroy}`);
  if (summary.destroy > 0) {
    console.log('Resources this plan would destroy:');
    for (const d of summary.destroyed) console.log(`  - ${d.address} (${d.type})`);
  }

  if (hasDangerousDestroy(summary) && !allowDestroy) {
    throw new DeployInputError(
      'BLOCKED: this plan would destroy a stateful resource (data table, S3 bucket, GuardDuty ' +
        'detector, SES identity, or ACM cert). CLAUDE.md requires a plan, a diff, a tested rollback, and ' +
        'explicit founder approval before any data destruction — re-run with allowDestroy only after ' +
        'that approval is in hand, and only if this really is the intended change.',
    );
  }

  // See detectBlankingRegressions in scripts/lib/deploy-lib.mjs for why an
  // emptied value is treated as more dangerous than a destroyed resource.
  const blanking = detectBlankingRegressions(planJson);
  if (blanking.length > 0 && !allowBlanking) {
    throw new DeployInputError(
      'BLOCKED: this plan would replace live, non-empty configuration with empty values:\n' +
        `${describeBlankingRegressions(blanking)}\n\n` +
        'Almost always this means a deploy input never reached Terraform. A GitHub repository ' +
        "variable that is missing or renamed arrives as an empty string, and the variable's own " +
        'empty default then makes it look like a deliberate choice. Supply the missing value, or ' +
        're-run with --allow-blanking if removing these settings really is the intent.',
    );
  }

  if (!apply) {
    console.log(
      `\nPlan saved to ${planPath}. Re-run with --apply to apply exactly this saved plan.`,
    );
    return { applied: false, planPath, summary };
  }

  console.log(`\nApplying the saved plan (${planPath}) — never a fresh plan.`);
  run('terraform', ['apply', '-input=false', planPath], { cwd: envDir });

  const apiEndpoint = run('terraform', ['output', '-raw', 'api_endpoint'], { cwd: envDir }).trim();

  try {
    // Terraform manages the site bucket/CloudFront infrastructure but never
    // the built app's *content* (no aws_s3_object resources reference
    // apps/web/out — deliberately: content-hash-based sync, not a Terraform
    // resource per file). Without this step, terraform apply succeeding
    // says nothing about whether the deployed frontend actually changed.
    //
    // This ran for test alone until 2026-09-10, on the reasoning that this
    // script never targets production. It does: scripts/release.mjs is a
    // thin wrapper that calls runDeploy({ env: 'production' }) precisely so
    // production cannot drift into a second code path. So a production
    // release applied the infrastructure and uploaded no website, leaving a
    // new distribution serving an empty bucket, and reported success. The
    // founder has one production deployment, and this repository has
    // already shipped a release whose site never synced (2026-08-22).
    //
    // The bucket name now comes from the environment's own Terraform
    // output rather than a pattern, because production's is a variable
    // with no pattern to derive.
    {
      // apps/web decides at BUILD time whether it is the real
      // application or a self-contained demo: isRealApiConfigured() is
      // just Boolean(process.env.NEXT_PUBLIC_API_BASE_URL). Built without
      // it, every page runs on browser-local fakes and the sign-in screen
      // reads "This demo build never sends real email".
      //
      // Only .github/workflows/ci.yml ever set it. This path — the one
      // scripts/release.mjs uses for production — never did, so the
      // production launch on 2026-09-11 uploaded the demo to
      // zoryvex.space. The infrastructure was right, the API was live and
      // healthy, every page returned 200, and nobody could sign in
      // because the site never called the API at all.
      //
      // Read from the environment's own Terraform output rather than
      // assembled here, so it is the same value Terraform used for the
      // API's CORS and the Lambdas' APP_ORIGIN, and so a new environment
      // cannot be deployed against another one's API.
      const apiBaseUrl = run('terraform', ['output', '-raw', 'api_public_base_url'], {
        cwd: envDir,
      }).trim();
      if (!apiBaseUrl || !apiBaseUrl.startsWith('https://')) {
        throw new Error(
          'terraform output api_public_base_url is empty or not https. Refusing to build: ' +
            'without it the bundle is the local-fake demo, and uploading that to a real ' +
            'environment produces a site that looks fine and cannot sign anybody in.',
        );
      }

      console.log(`\nBuilding apps/web (static export) against ${apiBaseUrl} ...`);
      run('npm', ['run', 'build', '-w', 'apps/web'], {
        cwd: root,
        env: {
          ...process.env,
          NEXT_PUBLIC_API_BASE_URL: apiBaseUrl,
          // Which environment this bundle is, not merely that it has a
          // real API. The banner used the latter and so told production's
          // own customers they were on a non-production test.
          NEXT_PUBLIC_ENVIRONMENT: env,
        },
      });

      // Proof, not intent. The environment variable being set is not
      // evidence that the bundle honoured it, and the failure mode is
      // silent by construction: a demo build serves 200s on every page.
      // This asserts against the artifact that is about to be uploaded.
      const demoMarker = 'This demo build never sends real email';
      const builtPages = readdirSync(join(root, 'apps', 'web', 'out'), { recursive: true })
        .filter((f) => typeof f === 'string' && f.endsWith('.html'))
        .map((f) => join(root, 'apps', 'web', 'out', f));
      // admin/sign-in is the one page that stays in demo mode by design:
      // SignInForm hardcodes `intendedRole !== 'admin'`, because founder
      // accounts are pre-provisioned rather than self-serve and no
      // provisioning path exists yet. It is founder-only, reachable by
      // nobody else, and blocking every deploy on it would keep a broken
      // site live for real users. Named explicitly so it cannot quietly
      // grow to cover a page that matters.
      const demoByDesign = new Set(['admin/sign-in.html', join('admin', 'sign-in.html')]);
      const demoPages = builtPages.filter(
        (f) =>
          !demoByDesign.has(f.slice(join(root, 'apps', 'web', 'out').length + 1)) &&
          readFileSync(f, 'utf8').includes(demoMarker),
      );
      if (demoPages.length > 0) {
        throw new Error(
          `Refusing to upload: ${demoPages.length} built page(s) still carry the demo-mode ` +
            'notice, so this bundle runs on browser-local fakes rather than the real API. ' +
            'Nothing was uploaded.',
        );
      }
      console.log(`  ${builtPages.length} pages built, none in demo mode.`);

      const bucket = run('terraform', ['output', '-raw', 'site_bucket_name'], {
        cwd: envDir,
      }).trim();
      if (!bucket) {
        throw new Error(
          'terraform output site_bucket_name was empty, so there is nowhere to upload the ' +
            'built site. The infrastructure applied; the website did not. Sync it before ' +
            'treating this release as done.',
        );
      }
      console.log(`\nSyncing apps/web/out to s3://${bucket} ...`);
      const { plan } = await syncStaticSite({
        bucket,
        sourceDir: join(root, 'apps', 'web', 'out'),
        region: 'eu-west-1',
        apply: true,
      });
      console.log(
        `Site sync: ${plan.toUploadCount} uploaded, ${plan.toDeleteCount} deleted, ` +
          `${plan.localFileCount} files total.`,
      );
    }

    console.log(`\nSmoke-testing ${apiEndpoint}/health ...`);
    // Read before the smoke test, because the smoke test now asserts the
    // deployed bundle reports exactly this commit.
    const commitSha = run('git', ['rev-parse', 'HEAD'], { cwd: root }).trim();
    // A wider budget than the default, because of what failing here costs.
    //
    // A smoke-test failure triggers the automatic app-code rollback below,
    // which redeploys the previous commit. On a deploy that actually worked
    // that is the worst possible outcome: it reverts good code and spends a
    // deployment doing it. Terraform waits for each function update to reach
    // Successful before returning, so the first probe should already report
    // the new commit - but the budget only costs anything when something is
    // slow, since a match returns immediately, and thirty seconds of patience
    // is cheap against an unnecessary rollback.
    await smokeTest(`${apiEndpoint}/health`, {
      expectedVersion: commitSha,
      attempts: 12,
      delayMs: 3000,
    });
    console.log('Smoke test passed: the deployed build reports the commit just deployed.');

    // Reported, never enforced. The feature-flag document is deliberately
    // outside Terraform (`ignore_changes = [value]`), so a deploy is not
    // what changed it and blocking the deploy would not fix it — worse, an
    // emergency lockdown deliberately sets flags off, and that is exactly
    // when a deploy must still be able to go out. This just means the
    // difference stops being invisible.
    reportFeatureFlagDrift(env);

    recordLastGoodCommit(env, commitSha);
    return { applied: true, smokeTestPassed: true, planPath, summary };
  } catch (err) {
    console.error(`Deploy step failed: ${err.message}`);

    // Rollback re-invokes THIS script to redeploy the last known-good
    // commit. Without this guard that is an unbounded loop: a smoke-test
    // failure caused by infrastructure rather than app code (an expired
    // cert, a bad state, an AWS incident) is not fixed by rolling code
    // back, so the rollback's own smoke test fails too, which triggers
    // another rollback, which triggers another deploy. Every cycle runs a
    // real `terraform apply` and burns CI minutes, indefinitely.
    if (!autoRollback) {
      console.error(
        'Auto-rollback is disabled for this run (already inside a rollback) — not recursing.',
      );
      throw err;
    }

    // Production is deliberately never auto-rolled-back, and saying so here
    // is the honest version of what already happened silently. rollback.mjs
    // redeploys by shelling out to this file's CLI, which refuses
    // `--env production` under any flag, so the production rollback chain
    // could only ever fail — and before the error-masking fix above, it
    // failed with "BLOCKED: deploy.mjs never targets production", hiding the
    // actual deploy failure behind a confusing one.
    //
    // Routing production through rollback.mjs would also create a second,
    // unreviewed path to a production apply, which release.mjs exists to
    // prevent, and CLAUDE.md requires explicit founder approval for any
    // production apply — an automatic one cannot have that by definition.
    if (env === 'production') {
      console.error(
        'Production is never auto-rolled-back. The environment is left exactly as this deploy ' +
          'left it. Roll forward or back deliberately via scripts/release.mjs with a reviewed ' +
          'plan, per docs/RUNBOOKS.md "Rollback".',
      );
      throw err;
    }

    console.error(
      'Rolling back application code automatically (infrastructure/data are never auto-rolled-back).',
    );
    try {
      run('node', [
        join(root, 'scripts', 'rollback.mjs'),
        '--env',
        env,
        '--confirm',
        env,
        '--app-code-only',
      ]);
    } catch (rollbackErr) {
      // Never let the rollback's own failure replace the original one: the
      // first error is what actually explains the bad deploy, and it is the
      // one an operator needs. Surface both, rethrow the original.
      console.error(`Rollback ALSO failed: ${rollbackErr.message}`);
      console.error('Environment may be in a partially-deployed state — inspect it manually.');
    }
    throw err;
  }
}

/**
 * Bounded retry — a fresh deploy can take a few seconds to warm up.
 *
 * `expectedVersion` is what makes this a real check rather than a liveness
 * ping. A 2xx from /health proves something is answering, which the PREVIOUS
 * build also does — so on its own it cannot tell a successful deploy apart
 * from one that silently changed nothing, a failure this repo has shipped
 * before. /health now reports the commit its bundle was built from
 * (scripts/build-lambda.mjs bakes it in), so comparing it against the commit
 * being deployed closes that gap.
 *
 * A mismatch is retried rather than failed at once: Lambda can serve a warm
 * container running the old code for a moment after an update. It is only a
 * failure once the retries are exhausted.
 */
export async function smokeTest(
  url,
  { attempts = 5, delayMs = 2000, fetchImpl = fetch, expectedVersion } = {},
) {
  let lastError;
  for (let i = 0; i < attempts; i += 1) {
    try {
      const res = await fetchImpl(url);
      if (res.ok) {
        if (!expectedVersion) return true;
        const body = await res.json();
        if (body?.version === expectedVersion) return true;
        lastError = new Error(
          `Deployed version mismatch: /health reports ${body?.version ?? 'no version'}, ` +
            `expected ${expectedVersion}. The deploy did not take effect.`,
        );
      } else {
        lastError = new Error(`Non-2xx response: ${res.status}`);
      }
    } catch (err) {
      lastError = err;
    }
    if (i < attempts - 1) await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  throw lastError ?? new Error('Smoke test failed for an unknown reason');
}

function parseArgs(argv) {
  const args = {
    env: null,
    confirm: null,
    apply: false,
    allowDestroy: false,
    allowBlanking: false,
    autoRollback: true,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--env') args.env = argv[++i];
    else if (arg === '--confirm') args.confirm = argv[++i];
    else if (arg === '--apply') args.apply = true;
    else if (arg === '--allow-destroy') args.allowDestroy = true;
    else if (arg === '--allow-blanking') args.allowBlanking = true;
    // Passed by scripts/rollback.mjs when it redeploys the last known-good
    // commit, so a failing rollback cannot trigger another rollback.
    else if (arg === '--no-auto-rollback') args.autoRollback = false;
  }
  return args;
}

function usageAndExit(message) {
  console.error(message);
  console.error(
    '\nUsage: node scripts/deploy.mjs --env <test> --confirm <env-name> [--apply]\n' +
      '                                 [--allow-destroy] [--allow-blanking]\n' +
      '  Production is never deployed through this script directly — see scripts/release.mjs.\n' +
      '  Without --apply, this only plans and shows you what would change.',
  );
  process.exit(1);
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.env === 'production') {
    usageAndExit(
      'BLOCKED: scripts/deploy.mjs never targets production directly, under any flag. ' +
        'Use scripts/release.mjs, the one reviewed production entry point.',
    );
  }

  // Without this, running the script with no arguments fell through to
  // runDeploy and reported `Unknown environment "null"` — accurate, and no
  // help at all to somebody who has just typed the command wrong.
  if (!args.env || !args.confirm) {
    usageAndExit('Both --env and --confirm are required.');
  }

  runDeploy(args).catch((err) => {
    console.error(err instanceof DeployInputError ? err.message : err);
    process.exit(1);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
