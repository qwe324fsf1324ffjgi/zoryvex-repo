import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * A workspace can be given a full test suite and never be run.
 *
 * `packages/kit-templates` had three test files and its own
 * `vitest.config.ts`, and was missing from the root config's `projects` list.
 * Nothing failed, nothing warned, and `npm test` reported a healthy count the
 * whole time — the tests simply were not among the ones being counted. One of
 * them asserts that the free proof-gap preview never fabricates a candidate
 * or implies a payment has already happened, which is a claim this project
 * makes about itself in `docs/COMMERCIAL_RUNBOOK.md`.
 *
 * Finding that took noticing a filter match nothing. This makes it fail
 * instead.
 */

const root = join(import.meta.dirname, '..', '..');
const WORKSPACE_ROOTS = ['apps', 'packages', 'services'];

/** Every workspace directory that has its own vitest config. */
function workspacesWithTests() {
  const found = [];
  for (const group of WORKSPACE_ROOTS) {
    const groupDir = join(root, group);
    if (!existsSync(groupDir)) continue;
    for (const entry of readdirSync(groupDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const config = join(group, entry.name, 'vitest.config.ts');
      if (existsSync(join(root, config))) found.push(config.replaceAll('\\', '/'));
    }
  }
  // scripts/ is not an npm workspace but carries its own suite.
  if (existsSync(join(root, 'scripts', 'vitest.config.ts'))) found.push('scripts/vitest.config.ts');
  return found.sort();
}

function declaredProjects() {
  const source = readFileSync(join(root, 'vitest.config.ts'), 'utf8');
  const block = /projects:\s*\[([\s\S]*?)\]/.exec(source);
  expect(block, 'the root vitest config has no projects array').not.toBeNull();
  return [...block[1].matchAll(/'([^']+)'/g)].map((m) => m[1]).sort();
}

describe('the root vitest config runs every suite that exists', () => {
  it('finds suites to check, so this test cannot pass by matching nothing', () => {
    expect(workspacesWithTests().length).toBeGreaterThan(4);
  });

  it('declares every workspace that has a vitest config', () => {
    const missing = workspacesWithTests().filter((c) => !declaredProjects().includes(c));
    expect(
      missing,
      `these suites exist and never run: ${missing.join(', ')}. Add them to vitest.config.ts.`,
    ).toEqual([]);
  });

  it('declares nothing that does not exist', () => {
    // A stale entry is the quieter failure: vitest tolerates it, and the list
    // stops being a reliable description of what runs.
    const orphaned = declaredProjects().filter((c) => !existsSync(join(root, c)));
    expect(orphaned, `these projects are listed but absent: ${orphaned.join(', ')}`).toEqual([]);
  });
});
