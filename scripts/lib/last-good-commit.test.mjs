import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  lastGoodCommitParameterName,
  readLastGoodCommit,
  recordLastGoodCommit,
} from '../rollback.mjs';

/**
 * Guards a real bug found in a 2026-08-27 audit.
 *
 * The last-known-good marker used to be a file under `.terraform-plans/`,
 * written by deploy.mjs after a successful smoke test and read back by
 * rollback.mjs on the next failure. The real deploy path is the `Deploy
 * test` job in .github/workflows/ci.yml: a fresh checkout, no cache, no
 * downloaded artifact, and a workspace discarded when the job ends. The
 * marker written by one run therefore never existed for the next, so every
 * CI rollback exited 1 with "Nothing to roll back to" and the automatic
 * app-code rollback could not fire in the only environment it was built for.
 *
 * It now lives in SSM, beside the environment it describes.
 */

const SHA = 'a'.repeat(40);
const OTHER_SHA = 'b'.repeat(40);

/** Records the argv it was handed and returns a canned stdout. */
function fakeExec(stdout, { throws = false } = {}) {
  const calls = [];
  const exec = (cmd, args) => {
    calls.push({ cmd, args });
    if (throws) throw new Error('AccessDenied');
    return stdout;
  };
  return { exec, calls };
}

describe('lastGoodCommitParameterName', () => {
  it('is an environment-scoped SSM path, not a workspace file', () => {
    expect(lastGoodCommitParameterName('test')).toBe('/zoryvex/test/last-good-commit');
    // The bug in one assertion: a path under the build workspace cannot
    // survive the job that wrote it.
    expect(lastGoodCommitParameterName('test')).not.toContain('.terraform-plans');
  });

  it('rejects an unknown environment rather than inventing a namespace', () => {
    expect(() => lastGoodCommitParameterName('staging')).toThrow();
  });

  it('keeps production and test in separate parameters', () => {
    expect(lastGoodCommitParameterName('production')).not.toBe(lastGoodCommitParameterName('test'));
  });
});

describe('recordLastGoodCommit', () => {
  it('writes a plain String parameter with the trimmed sha', () => {
    const { exec, calls } = fakeExec('');
    expect(recordLastGoodCommit('test', `${SHA}\n`, { exec })).toBe(true);

    const { cmd, args } = calls[0];
    expect(cmd).toBe('aws');
    expect(args).toContain('put-parameter');
    expect(args[args.indexOf('--name') + 1]).toBe('/zoryvex/test/last-good-commit');
    expect(args[args.indexOf('--value') + 1]).toBe(SHA);
    // A git sha is not a secret; SecureString here would need a KMS grant
    // the deploy role deliberately does not have.
    expect(args[args.indexOf('--type') + 1]).toBe('String');
    // Without --overwrite the second deploy in an environment fails.
    expect(args).toContain('--overwrite');
  });

  it('never throws when the write fails, so a successful deploy is not rolled back', () => {
    // The reason this matters: recordLastGoodCommit is called from inside
    // runDeploy's try block, AFTER the smoke test has already passed.
    // Throwing here would drop into the catch and roll back a deploy that
    // actually worked, turning a bookkeeping miss into an outage.
    const { exec } = fakeExec('', { throws: true });
    expect(() => recordLastGoodCommit('test', SHA, { exec })).not.toThrow();
    expect(recordLastGoodCommit('test', SHA, { exec })).toBe(false);
  });
});

describe('readLastGoodCommit', () => {
  it('returns the recorded sha', () => {
    const { exec, calls } = fakeExec(`${OTHER_SHA}\n`);
    expect(readLastGoodCommit('test', { exec })).toBe(OTHER_SHA);
    expect(calls[0].args).toContain('get-parameter');
  });

  it('returns null when the parameter has never been written', () => {
    // An absent parameter makes the AWS CLI exit non-zero.
    const { exec } = fakeExec('', { throws: true });
    expect(readLastGoodCommit('test', { exec })).toBeNull();
  });

  it('returns null for the literal "None" the CLI prints for a null value', () => {
    const { exec } = fakeExec('None\n');
    expect(readLastGoodCommit('test', { exec })).toBeNull();
  });

  it('rejects a value that is not a commit sha instead of handing it to git', () => {
    const { exec } = fakeExec('HEAD~5; rm -rf /\n');
    expect(readLastGoodCommit('test', { exec })).toBeNull();
  });

  it('rejects a truncated sha', () => {
    const { exec } = fakeExec('a1b2c3d\n');
    expect(readLastGoodCommit('test', { exec })).toBeNull();
  });
});

describe('the marker no longer touches the build workspace', () => {
  const source = readFileSync(join(import.meta.dirname, '..', 'rollback.mjs'), 'utf8');

  it('rollback.mjs writes no file for the marker', () => {
    // If a future edit reintroduces a workspace file, the CI rollback goes
    // silently dead again — nothing else in the suite would notice.
    expect(source).not.toContain('writeFileSync');
    expect(source).not.toContain('last-good-commit.txt');
  });
});
