#!/usr/bin/env node
// Runs the same checks CI runs, in the same order, so a green local run
// means a green PR. Stops at the first failure.
//
// "The same checks" is enforced, not asserted: scripts/lib/validate-parity.
// test.mjs reads .github/workflows/ci.yml's validate job and fails if this
// list and that job's steps stop matching. They had already drifted — this
// file was missing the bundle budget, both safe-shell builds, the safe-shell
// content assertion, and every Terraform fmt/validate step, so a local run
// could pass while CI failed on any of them. That is not a small annoyance
// here: this account is on GitHub Free with a fixed monthly Actions
// allowance, and a wasted CI run costs minutes that have already run out
// once.
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = join(import.meta.dirname, '..');

// Each step is [label, command, options]. `cwd` is relative to the repo root.
export const steps = [
  ['Format check', 'npm run format:check'],
  ['Lint', 'npm run lint'],
  ['Typecheck', 'npm run typecheck'],
  ['Unit/contract tests', 'npm test'],
  ['OpenAPI contract validate', 'npm run openapi:validate'],
  ['OpenAPI route coverage', 'npm run openapi:coverage'],
  ['Secret scan', 'npm run secrets:scan'],
  ['Terraform policy check', 'npm run terraform:policy'],
  ['Real-mode awareness check', 'npm run real-mode:check'],
  ['Product copy voice check', 'npm run copy:voice'],
  ['DynamoDB index grant check', 'npm run gsi:check'],
  ['Settlement table check', 'npm run fees:check'],
  ['Feature-flag env wiring check', 'npm run flags:wiring'],
  ['Project state schema check', 'npm run state:check'],
  ['Dependency audit', 'npm run audit:deps'],
  ['License check', 'npm run license:check'],
  ['Web production build', 'npm run build -w apps/web'],
  ['Static export assertion', 'npm run static-export:assert'],
  ['Page shell check', 'npm run pages:check'],
  ['Bundle budget assertion', 'npm run bundle:budget'],
  ['Safe-shell production build', 'npm run build -w apps/web-safe-shell'],
  ['Safe-shell static export assertion', 'npm run static-export:assert:safe-shell'],
  ['Safe-shell forbidden-content assertion', 'npm run safe-shell:assert'],
  ['Terraform fmt check', 'terraform fmt -recursive -check -diff infrastructure/'],
  // TF_DATA_DIR sends module installation to a throwaway directory, so a
  // validate never touches the real .terraform.
  //
  // Without it this step failed on any machine that had ever run a real
  // plan: `terraform init -backend=false` in an already-backend-initialised
  // directory still resolves the recorded S3 backend and fails on
  // credentials. CI never saw it, because a fresh checkout has no
  // .terraform — which is exactly the kind of difference that makes "green
  // locally" stop meaning anything.
  [
    'Terraform validate (bootstrap)',
    'terraform init -backend=false -input=false && terraform validate',
    {
      cwd: join('infrastructure', 'envs', 'bootstrap'),
      env: { TF_DATA_DIR: '.terraform-validate' },
    },
  ],
  [
    'Terraform validate (test)',
    'terraform init -backend=false -input=false && terraform validate',
    { cwd: join('infrastructure', 'envs', 'test'), env: { TF_DATA_DIR: '.terraform-validate' } },
  ],
  [
    'Terraform validate (production)',
    'terraform init -backend=false -input=false && terraform validate',
    {
      cwd: join('infrastructure', 'envs', 'production'),
      env: { TF_DATA_DIR: '.terraform-validate' },
    },
  ],
];

function main() {
  for (const [label, command, options = {}] of steps) {
    console.log(`\n▶ ${label}`);
    try {
      execSync(command, {
        cwd: options.cwd ? join(root, options.cwd) : root,
        stdio: 'inherit',
        env: { ...process.env, ...options.env },
      });
    } catch {
      console.error(`\n✗ ${label} failed.`);
      process.exit(1);
    }
  }

  console.log('\nAll checks passed.');
}

// Guarded so the parity test can import `steps` without running a full
// validate.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
