import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Every Terraform variable the CI deploy needs must actually reach it.
 *
 * This exists because of a real deploy failure on 2026-09-02. Two new
 * variables were added for the public proof handlers, given values in
 * `terraform.tfvars`, and left without defaults. The local plan worked
 * perfectly — because `terraform.tfvars` is gitignored, so it exists on a
 * workstation and never on a runner. CI planned `No value for required
 * variable` twice and the deploy stopped.
 *
 * Scoped to `test` deliberately, and the first draft of this file was wrong
 * about that in two ways worth recording so nobody re-adds them.
 *
 * It checked production too, which fails by design: production declares no
 * defaults at all, on purpose, and `.github/workflows/ci.yml` never deploys
 * it. `scripts/release.mjs` does, behind its own stronger confirmation, with
 * values supplied at that moment. "Not in the workflow" is the correct state
 * for all 52 of them.
 *
 * It also flagged any variable defaulting to `""`, on the theory that an
 * empty default plus a missing CI value deploys an empty string quietly.
 * That is a real failure mode — it is what `detectBlankingRegressions` was
 * written for — but an empty default is also a legitimate sentinel here.
 * `webauthn_rp_id` defaults to empty precisely so `main.tf` can derive it
 * from `app_origin`'s host, which is what it has to equal anyway. Flagging
 * that would have demanded a workflow variable for a value the configuration
 * computes correctly on its own.
 *
 * So the rule left is the narrow one that was actually broken: for the
 * environment CI deploys, a variable is either defaulted or passed as
 * `TF_VAR_*`, and anything in neither category cannot be planned at all.
 */

const root = join(import.meta.dirname, '..', '..');
const workflow = readFileSync(join(root, '.github', 'workflows', 'ci.yml'), 'utf8');
const testVariables = readFileSync(
  join(root, 'infrastructure', 'envs', 'test', 'variables.tf'),
  'utf8',
);

function declaredVariables(tf) {
  const found = [];
  const pattern = /variable\s+"([a-z0-9_]+)"\s*\{([\s\S]*?)\n\}/g;
  let match;
  while ((match = pattern.exec(tf)) !== null) {
    found.push({ name: match[1], hasDefault: /\n\s*default\s*=/.test(match[2]) });
  }
  return found;
}

describe('the CI deploy can supply every test variable', () => {
  it('parses the variable file at all', () => {
    // Guards the guard: a regex that matched nothing would make the
    // assertion below pass for the wrong reason.
    const variables = declaredVariables(testVariables);
    expect(variables.length).toBeGreaterThan(20);
    expect(variables.map((v) => v.name)).toContain('api_deployment_package_path');
    expect(variables.some((v) => v.hasDefault)).toBe(true);
  });

  it('leaves nothing for a gitignored tfvars file to supply', () => {
    const unsupplied = declaredVariables(testVariables)
      .filter((variable) => !variable.hasDefault)
      .filter((variable) => !workflow.includes(`TF_VAR_${variable.name}:`))
      .map((variable) => variable.name);

    expect(
      unsupplied,
      'These test variables have no default and are not passed as TF_VAR_* by ' +
        '.github/workflows/ci.yml, so a CI plan cannot supply them. They would work locally only ' +
        'because terraform.tfvars is gitignored, which is exactly how this was missed on ' +
        '2026-09-02. Give each one a default if its value is identical in every environment (build ' +
        'output paths are), or add it to the workflow if it genuinely differs.',
    ).toEqual([]);
  });

  it('would have caught the failure that prompted it', () => {
    // The two public-proof variables, as they were written: declared, used,
    // and supplied only by the gitignored file.
    const asShipped = `
variable "public_proof_deployment_package_path" {
  description = "Zip for the unauthenticated public proof page handler."
  type        = string
}
`;
    const unsupplied = declaredVariables(asShipped)
      .filter((variable) => !variable.hasDefault)
      .filter((variable) => !workflow.includes(`TF_VAR_${variable.name}:`))
      .map((variable) => variable.name);
    expect(unsupplied).toEqual(['public_proof_deployment_package_path']);
  });
});
