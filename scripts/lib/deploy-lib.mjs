// Pure, dependency-free logic shared by scripts/deploy.mjs,
// scripts/release.mjs, and scripts/rollback.mjs. Kept separate from the
// shell-out/AWS-calling code in those scripts specifically so it can be
// unit tested (see scripts/lib/deploy-lib.test.mjs) without a real AWS
// account, Terraform state, or deployed environment — none of which exist
// yet this phase.

export const ENVIRONMENTS = ['test', 'production'];

// A destroy of any of these resource types is never auto-approved, even in
// test — it either holds real (if synthetic) data, or is expensive/slow to
// recreate. CLAUDE.md: "no data destruction without a plan, a diff, a
// tested rollback, and explicit founder approval."
export const STATEFUL_RESOURCE_TYPES = [
  'aws_dynamodb_table',
  'aws_s3_bucket',
  'aws_guardduty_detector',
  'aws_guardduty_malware_protection_plan',
  'aws_ses_domain_identity',
  'aws_acm_certificate',
];

export class DeployInputError extends Error {}

export function validateEnvironment(env) {
  if (!ENVIRONMENTS.includes(env)) {
    throw new DeployInputError(
      `Unknown environment "${env}". Must be one of: ${ENVIRONMENTS.join(', ')}.`,
    );
  }
  return env;
}

/**
 * The environment-name confirmation gate: the operator must type the exact
 * environment name back, so a copy-pasted command against the wrong
 * environment fails closed rather than silently running.
 */
export function confirmationMatchesEnvironment(confirmValue, env) {
  return typeof confirmValue === 'string' && confirmValue === env;
}

/**
 * scripts/release.mjs's stronger gate for production specifically — typing
 * the environment name alone (which release.mjs also requires) is not
 * enough; the literal word "PRODUCTION" is a second, deliberately
 * different, harder-to-fat-finger confirmation.
 */
export function confirmationAuthorizesProductionRelease(env, envConfirmValue, releaseConfirmValue) {
  return (
    env === 'production' &&
    confirmationMatchesEnvironment(envConfirmValue, env) &&
    releaseConfirmValue === 'PRODUCTION'
  );
}

function pad(n) {
  return String(n).padStart(2, '0');
}

/** Sortable, collision-resistant timestamp for a saved plan file's name. */
export function timestampForPlanFile(date = new Date()) {
  return (
    `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}-` +
    `${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}`
  );
}

export function planArtifactPath(env, timestamp = timestampForPlanFile()) {
  validateEnvironment(env);
  return `.terraform-plans/${env}/${timestamp}.tfplan`;
}

/**
 * Reduces `terraform show -json <planfile>` output down to counts and the
 * list of resources that would be destroyed. Never trusts a human to read
 * the full plan output correctly under pressure — this is the machine-
 * checked summary a deploy actually gates on.
 */
export function summarizePlan(planJson) {
  const changes = planJson?.resource_changes ?? [];
  const summary = { add: 0, change: 0, destroy: 0, destroyed: [] };

  for (const rc of changes) {
    const actions = rc.change?.actions ?? [];
    if (actions.includes('create') && !actions.includes('delete')) summary.add += 1;
    if (actions.includes('update')) summary.change += 1;
    if (actions.includes('delete')) {
      summary.destroy += 1;
      summary.destroyed.push({ address: rc.address, type: rc.type });
    }
  }

  return summary;
}

/** True when the plan would destroy anything in STATEFUL_RESOURCE_TYPES. */
export function hasDangerousDestroy(summary) {
  return summary.destroyed.some((d) => STATEFUL_RESOURCE_TYPES.includes(d.type));
}

// A deploy that *blanks* live configuration is more dangerous than one that
// destroys a resource, because nothing about it looks alarming. Terraform
// reports "1 to change", the apply succeeds, the smoke test on /health still
// passes, and the environment is quietly broken somewhere the smoke test
// does not reach.
//
// This is not hypothetical. terraform.tfvars is gitignored, so a CI-driven
// apply supplies its inputs as TF_VAR_* instead — and a repository variable
// that is missing, renamed, or simply never wired up arrives as an empty
// string, not as an error. Terraform then accepts it, because every one of
// these variables has an empty default from the pre-Stage-B era when empty
// really was the right answer. webauthn_rp_id was exactly this: set locally,
// unset in CI, and the first pipeline deploy would have written
// WEBAUTHN_RP_ID="" to four Lambdas that throw on an empty value at cold
// start. It was found by reading the workflow against the variables file,
// which is not a method that scales.
//
// So the check is on the plan itself rather than on the inputs: whatever
// supplies a value, a live non-empty setting turning empty is refused.

/** Plan attributes where an existing value turning empty is a regression, not a change. */
const BLANKING_SENSITIVE_ATTRIBUTES = [
  { type: 'aws_apigatewayv2_api', path: ['cors_configuration', 0, 'allow_origins'] },
  { type: 'aws_apigatewayv2_api', path: ['cors_configuration', 0, 'allow_headers'] },
  { type: 'aws_cloudfront_distribution', path: ['aliases'] },
];

function valueAt(root, path) {
  let node = root;
  for (const key of path) {
    if (node === null || node === undefined) return undefined;
    node = node[key];
  }
  return node;
}

/** Non-empty for this purpose means "a value an operator would notice losing". */
function isPresent(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  return true;
}

function isBlank(value) {
  return !isPresent(value);
}

/**
 * Finds every place a plan would replace a live, non-empty value with an
 * empty one. Lambda environment variables are checked key by key, because
 * that is where a missing deploy input actually lands.
 *
 * Values Terraform cannot resolve until apply time are skipped rather than
 * guessed at: `after` is null for them, and treating "unknown" as "empty"
 * would make this fire on ordinary deploys and train an operator to pass
 * --allow-blanking by reflex, which would cost more than it saves.
 */
export function detectBlankingRegressions(planJson) {
  const findings = [];

  for (const rc of planJson?.resource_changes ?? []) {
    const actions = rc.change?.actions ?? [];
    if (!actions.includes('update')) continue;

    const before = rc.change?.before;
    const after = rc.change?.after;
    const afterUnknown = rc.change?.after_unknown;
    if (!before || !after) continue;

    if (rc.type === 'aws_lambda_function') {
      const beforeVars = valueAt(before, ['environment', 0, 'variables']) ?? {};
      const afterVars = valueAt(after, ['environment', 0, 'variables']) ?? {};
      const unknownVars = valueAt(afterUnknown, ['environment', 0, 'variables']) ?? {};

      for (const [key, beforeValue] of Object.entries(beforeVars)) {
        if (unknownVars[key] === true) continue;
        if (isPresent(beforeValue) && isBlank(afterVars[key])) {
          findings.push({
            address: rc.address,
            attribute: `environment.variables.${key}`,
            before: beforeValue,
            after: afterVars[key] ?? null,
          });
        }
      }
      continue;
    }

    for (const sensitive of BLANKING_SENSITIVE_ATTRIBUTES) {
      if (sensitive.type !== rc.type) continue;
      if (valueAt(afterUnknown, sensitive.path) === true) continue;

      const beforeValue = valueAt(before, sensitive.path);
      const afterValue = valueAt(after, sensitive.path);
      if (isPresent(beforeValue) && isBlank(afterValue)) {
        findings.push({
          address: rc.address,
          attribute: sensitive.path.join('.'),
          before: beforeValue,
          after: afterValue ?? null,
        });
      }
    }
  }

  return findings;
}

/** Operator-facing rendering of detectBlankingRegressions' findings. */
export function describeBlankingRegressions(findings) {
  return findings
    .map(
      (f) =>
        `  - ${f.address}: ${f.attribute} ${JSON.stringify(f.before)} -> ${JSON.stringify(f.after)}`,
    )
    .join('\n');
}

// Fresh-runner-safe Terraform backend resolution (Phase 7 slice 9). A clean
// GitHub Actions checkout has no infrastructure/envs/<env>/.terraform cache
// to fall back on (unlike a founder's local machine, where a prior manual
// `terraform init -reconfigure -backend-config=...` already cached it) — so
// the backend bucket/key must be resolved explicitly on every run, from the
// AWS account the caller is *currently* authenticated as, never from a
// GitHub repository variable, a hardcoded bucket, or another account.

export const EXPECTED_AWS_ACCOUNT_ID = '071770169654';

/** The one Terraform state bucket this project uses, for any environment. */
export function stateBucketName(accountId) {
  return `zoryvex-terraform-state-${accountId}`;
}

/**
 * The test static-site S3 bucket (infrastructure/envs/test/main.tf's
 * local.site_bucket_name — deterministic there). Test-only: production's
 * equivalent (infrastructure/envs/production/main.tf) is an explicit
 * required Terraform variable with no fixed pattern to derive, matching
 * scripts/deploy.mjs itself only ever running the test environment.
 */
export function testSiteBucketName(accountId) {
  return `zoryvex-test-site-${accountId}`;
}

/**
 * `-backend-config=...` arguments for `terraform init`, scoped to exactly
 * one already-validated environment's own state and lock-object keys —
 * never a bucket/key an arbitrary caller supplies directly. env is passed
 * through validateEnvironment(), so this can only ever produce a
 * `test/terraform.tfstate` or `production/terraform.tfstate` key; there is
 * no code path here that can construct a `foundation/`, `bootstrap/`, or
 * `test-secrets/` key.
 */
export function backendConfigArgs(env, accountId, { region = 'eu-west-1' } = {}) {
  validateEnvironment(env);
  const bucket = stateBucketName(accountId);
  const key = `${env}/terraform.tfstate`;
  return [
    `-backend-config=bucket=${bucket}`,
    `-backend-config=key=${key}`,
    `-backend-config=region=${region}`,
    '-backend-config=use_lockfile=true',
    '-backend-config=encrypt=true',
  ];
}

/**
 * Fail-closed identity check: converts a hypothetical wrong-account
 * situation (e.g. a misconfigured session) into an immediate, clear error
 * before any backend/state resolution happens, rather than a confusing
 * AccessDenied several steps later against a wrong-but-plausible bucket
 * name. This project uses exactly one AWS account for every environment.
 */
export function assertExpectedAwsAccount(accountId) {
  if (accountId !== EXPECTED_AWS_ACCOUNT_ID) {
    throw new DeployInputError(
      `BLOCKED: authenticated AWS account (${accountId}) is not the expected account ` +
        `(${EXPECTED_AWS_ACCOUNT_ID}). Refusing to resolve a Terraform backend or deploy anything.`,
    );
  }
  return accountId;
}

/**
 * How to spawn one command on this platform.
 *
 * Windows makes this genuinely awkward, and the 2026-09-01 billing apply hit
 * both halves of it in sequence, each time after Terraform had already
 * changed AWS and before the site sync, the smoke test, or the last-good-
 * commit record. A terraform apply that succeeds and a deploy that succeeds
 * are not the same thing, and this is the gap between them.
 *
 *   `npm`      -> ENOENT. npm is not an executable, it is a `.cmd` shim, and
 *                 the error names the command, so it reads as "npm is not
 *                 installed" rather than "this needs a shell".
 *   `npm.cmd`  -> EINVAL. Node refuses to execute `.cmd` and `.bat` files
 *                 without a shell, deliberately, since the 2024 hardening
 *                 for argument injection through the Windows command line.
 *
 * So the shim needs `shell: true`, which is where the trap closes: with a
 * shell, Node concatenates arguments instead of escaping them (DEP0190), and
 * an argument containing a space or a metacharacter stops meaning what it
 * says. Every argument this project passes to npm is a literal, so rather
 * than build a Windows quoting routine that would be exercised approximately
 * never and wrong when it was, anything needing quoting is refused outright.
 *
 * Everything else — terraform, aws, git — is a real executable and takes no
 * shell on any platform. That is exactly why the failure arrived so late:
 * every command before the build ran fine.
 */
const SHELL_UNSAFE = /[\s"'`$&|;<>()^%!]/;

export function spawnPlanFor(command, args = [], platform = process.platform) {
  const isShim = platform === 'win32' && ['npm', 'npx'].includes(command);
  if (!isShim) return { command, shell: false };

  const unsafe = args.filter((arg) => SHELL_UNSAFE.test(arg));
  if (unsafe.length > 0) {
    throw new DeployInputError(
      `Cannot run ${command} on Windows with these arguments: ${unsafe.join(', ')}. ` +
        'The .cmd shim needs a shell, and a shell concatenates arguments rather than escaping ' +
        'them, so an argument containing a space or a shell metacharacter would not survive ' +
        'intact. Pass literal arguments, or invoke the underlying tool directly.',
    );
  }

  return { command: `${command}.cmd`, shell: true };
}
