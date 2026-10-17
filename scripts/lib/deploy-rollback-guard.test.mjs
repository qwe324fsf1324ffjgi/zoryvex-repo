import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Guards a real recursion bug found in a 2026-08-27 audit.
 *
 * scripts/deploy.mjs rolls back automatically when its smoke test fails, and
 * scripts/rollback.mjs performs that rollback by re-invoking deploy.mjs to
 * redeploy the last known-good commit. With no guard, a rollback whose own
 * smoke test also fails triggers another rollback, which triggers another
 * deploy, without bound — running a real `terraform apply` every cycle and
 * burning CI minutes until the job is killed.
 *
 * That is the LIKELY failure shape, not an exotic one: a smoke test failing
 * for an infrastructure reason (expired certificate, bad state, an AWS
 * incident) is not fixed by redeploying older application code, so the
 * rollback fails exactly the same way the deploy did.
 *
 * These assert the wiring by reading the scripts, because the alternative —
 * actually executing them — would shell out to terraform and AWS. They are
 * deliberately about the contract between the two files, which is the thing
 * that broke.
 */

const root = join(import.meta.dirname, '..', '..');
const deploySource = readFileSync(join(root, 'scripts', 'deploy.mjs'), 'utf8');
const rollbackSource = readFileSync(join(root, 'scripts', 'rollback.mjs'), 'utf8');

describe('deploy/rollback recursion guard', () => {
  it('deploy.mjs accepts --no-auto-rollback and threads it into runDeploy', () => {
    expect(deploySource).toContain('--no-auto-rollback');
    expect(deploySource).toMatch(/autoRollback\s*=\s*true/);
  });

  it('deploy.mjs skips the rollback entirely when auto-rollback is disabled', () => {
    // The guard must sit BEFORE the rollback is spawned, otherwise it does
    // nothing; assert on ordering, not just presence.
    const guardIndex = deploySource.indexOf('if (!autoRollback)');
    const rollbackSpawnIndex = deploySource.indexOf("'rollback.mjs'");
    expect(guardIndex).toBeGreaterThan(-1);
    expect(rollbackSpawnIndex).toBeGreaterThan(-1);
    expect(guardIndex).toBeLessThan(rollbackSpawnIndex);
  });

  it('rollback.mjs always passes --no-auto-rollback when it re-invokes deploy', () => {
    // This is the single line that actually breaks the cycle. If a future
    // edit drops it, the loop comes back silently.
    expect(rollbackSource).toContain("'deploy.mjs'");
    expect(rollbackSource).toContain("'--no-auto-rollback'");
  });

  it("a failing rollback does not replace the deploy's original error", () => {
    // The original failure is what explains the bad deploy; the rollback's
    // own failure must not mask it.
    expect(deploySource).toContain('Rollback ALSO failed');
    expect(deploySource).toMatch(/catch \(rollbackErr\)/);
  });
});

describe('production is never auto-rolled-back', () => {
  /**
   * rollback.mjs redeploys by shelling out to deploy.mjs, whose CLI refuses
   * `--env production` under any flag. The production rollback chain could
   * therefore only ever fail — and it failed late, after already checking
   * out old code and rebuilding. Both ends now refuse it up front.
   */
  it('deploy.mjs skips the rollback for production instead of spawning one that cannot work', () => {
    const productionGuard = deploySource.indexOf("if (env === 'production')");
    const rollbackSpawn = deploySource.indexOf("'rollback.mjs'");
    expect(productionGuard).toBeGreaterThan(-1);
    expect(productionGuard).toBeLessThan(rollbackSpawn);
    expect(deploySource).toContain('Production is never auto-rolled-back');
  });

  it('rollback.mjs refuses production before it touches the working tree', () => {
    const productionGuard = rollbackSource.indexOf("if (env === 'production')");
    const firstCheckout = rollbackSource.indexOf("'checkout'");
    expect(productionGuard).toBeGreaterThan(-1);
    expect(firstCheckout).toBeGreaterThan(-1);
    expect(productionGuard).toBeLessThan(firstCheckout);
  });

  it('rollback.mjs restores the working tree even when the redeploy fails', () => {
    // The checkout of old code must always be undone. Without a `finally`,
    // a failed build or redeploy left the tree reverted to an old commit.
    expect(rollbackSource).toMatch(/}\s*finally\s*{/);
    const finallyIndex = rollbackSource.search(/}\s*finally\s*{/);
    const restoreIndex = rollbackSource.indexOf("'HEAD'");
    expect(restoreIndex).toBeGreaterThan(finallyIndex);
  });
});
