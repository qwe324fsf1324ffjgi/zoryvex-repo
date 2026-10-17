import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { steps } from '../validate.mjs';

/**
 * `npm run validate:all` exists so a green local run means a green PR. That
 * promise is only true while its step list matches CI's, and the two had
 * already drifted apart: the local list was missing the bundle budget, both
 * safe-shell builds, the safe-shell content assertion, the Terraform fmt
 * check and all three Terraform validates.
 *
 * The cost of that drift is specific here rather than theoretical. This
 * account is on GitHub Free, Actions has already been unavailable for days
 * after exhausting the monthly allowance, and a PR that fails on a check the
 * local run never ran spends those minutes for nothing.
 */

const root = join(import.meta.dirname, '..', '..');
const workflow = readFileSync(join(root, '.github', 'workflows', 'ci.yml'), 'utf8');

/** The `run:` commands of the validate job, in order, single-line and blocks. */
function ciValidateCommands() {
  const jobStart = workflow.indexOf('\n  validate:');
  const jobEnd = workflow.indexOf('\n  e2e:');
  expect(jobStart, 'validate job not found in ci.yml').toBeGreaterThan(-1);
  expect(jobEnd, 'e2e job not found in ci.yml').toBeGreaterThan(jobStart);

  const job = workflow.slice(jobStart, jobEnd);
  const commands = [];
  const lines = job.split('\n');

  for (let i = 0; i < lines.length; i += 1) {
    const single = /^\s*run:\s*(?!\|)(\S.*)$/.exec(lines[i]);
    if (single) {
      commands.push(single[1].trim());
      continue;
    }
    if (/^\s*run:\s*\|\s*$/.test(lines[i])) {
      // A block scalar — take its lines and join them the way validate.mjs
      // expresses the same thing, with &&.
      const block = [];
      for (let j = i + 1; j < lines.length; j += 1) {
        if (!/^\s{10,}\S/.test(lines[j])) break;
        block.push(lines[j].trim());
      }
      commands.push(block.join(' && '));
    }
  }

  return commands;
}

describe('validate:all matches the CI validate job', () => {
  const ciCommands = ciValidateCommands();
  const localCommands = steps.map(([, command]) => command);

  it('finds the workflow steps at all', () => {
    // Guards the test itself: a parser that silently matches nothing would
    // make every assertion below pass for the wrong reason.
    expect(ciCommands.length).toBeGreaterThan(10);
    expect(ciCommands).toContain('npm run lint');
  });

  it('runs every check CI runs, in the same order', () => {
    // CI has setup-only steps (checkout, setup-node, npm ci, setup-terraform)
    // that a local run does not need. Everything else must match exactly.
    const setupOnly = ['npm ci'];
    const expected = ciCommands.filter((c) => !setupOnly.includes(c));
    expect(localCommands).toEqual(expected);
  });

  it('runs the Terraform validates from the right directories', () => {
    const terraformSteps = steps.filter(([label]) => label.startsWith('Terraform validate'));
    expect(terraformSteps).toHaveLength(3);
    for (const [, , options] of terraformSteps) {
      expect(options?.cwd, 'a terraform validate step has no cwd').toBeTruthy();
    }
    expect(terraformSteps.map(([, , o]) => o.cwd.replaceAll('\\', '/'))).toEqual([
      'infrastructure/envs/bootstrap',
      'infrastructure/envs/test',
      'infrastructure/envs/production',
    ]);
  });
});
