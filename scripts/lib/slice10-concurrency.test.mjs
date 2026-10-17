import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  EXPECTED,
  REPO_ROOT,
  applyConcurrency,
  isInside,
  loadBaseline,
  preflight,
  readFunctionNames,
  redactPath,
  resolveBaselinePath,
  rollbackPlanFor,
  validateBaseline,
} from '../slice10-concurrency.mjs';

/**
 * The operation this covers changes live infrastructure, so the guards that
 * decide whether it may run are tested rather than trusted. Nothing here
 * touches AWS: every AWS call is injected, which is also how the drift cases
 * below are produced without waiting for real drift to happen.
 */

const APPROVED = readFunctionNames();
let tmp;

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), 'slice10-'));
});
afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function goodBaseline(overrides = {}) {
  return {
    capturedAt: '2026-08-28T14:00:00.000Z',
    region: 'eu-west-1',
    accountLimit: 1000,
    accountUnreserved: 1000,
    functions: APPROVED.map((name) => ({
      name,
      reservedConcurrentExecutions: null,
      codeSha256: `sha-${name}`,
      lastModified: '2026-08-20T00:00:00.000+0000',
    })),
    ...overrides,
  };
}

/** An AWS stand-in that answers from a baseline, so drift can be injected. */
function fakeAws(baseline, { concurrency = {}, code = {}, lastModified = {}, account } = {}) {
  const calls = [];
  const impl = (args) => {
    calls.push(args);
    const [service, op] = args;
    if (service !== 'lambda') throw new Error(`unexpected service ${service}`);
    if (op === 'list-functions') {
      return {
        Functions: baseline.functions.map((f) => ({
          FunctionName: f.name,
          CodeSha256: code[f.name] ?? f.codeSha256,
          LastModified: lastModified[f.name] ?? f.lastModified,
        })),
      };
    }
    if (op === 'get-function-concurrency') {
      const name = args[args.indexOf('--function-name') + 1];
      const v = Object.hasOwn(concurrency, name) ? concurrency[name] : null;
      return v === null ? {} : { ReservedConcurrentExecutions: v };
    }
    if (op === 'get-account-settings') {
      return {
        AccountLimit: {
          ConcurrentExecutions: account?.limit ?? 1000,
          UnreservedConcurrentExecutions: account?.unreserved ?? 1000,
        },
      };
    }
    if (op === 'put-function-concurrency' || op === 'delete-function-concurrency') return {};
    throw new Error(`unexpected op ${op}`);
  };
  impl.calls = calls;
  impl.mutations = () =>
    calls.filter(
      (c) => c[1] === 'put-function-concurrency' || c[1] === 'delete-function-concurrency',
    );
  return impl;
}

describe('--baseline-file path handling', () => {
  it('is required, with no default and no fallback', () => {
    expect(() => resolveBaselinePath(['--preflight'])).toThrow(/required/);
    // A flag immediately after it is a missing value, not a path.
    expect(() => resolveBaselinePath(['--baseline-file', '--apply'])).toThrow(/required/);
  });

  it('rejects a relative path', () => {
    expect(() => resolveBaselinePath(['--baseline-file', 'baseline.json'])).toThrow(/absolute/);
    expect(() => resolveBaselinePath(['--baseline-file', './b.json'])).toThrow(/absolute/);
  });

  it('rejects a path inside the repository', () => {
    const inside = resolve(REPO_ROOT, 'docs/evidence/baseline.json');
    expect(() => resolveBaselinePath(['--baseline-file', inside])).toThrow(
      /outside the repository/,
    );
  });

  it('accepts an external path that exists', () => {
    const p = join(tmp, 'ok.json');
    writeFileSync(p, JSON.stringify(goodBaseline()));
    expect(resolveBaselinePath(['--baseline-file', p])).toBeTruthy();
  });

  it('rejects a missing file', () => {
    expect(() => resolveBaselinePath(['--baseline-file', join(tmp, 'nope.json')])).toThrow(
      /does not exist/,
    );
  });

  it('rejects an external symlink that resolves inside the repository', () => {
    // The case a textual check misses: the argument is outside the tree and
    // the file it names is not.
    const target = resolve(REPO_ROOT, 'package.json');
    const link = join(tmp, 'sneaky.json');
    let made = true;
    try {
      symlinkSync(target, link);
    } catch {
      // Windows without developer mode refuses symlink creation for an
      // unprivileged process. Skipped rather than silently passing.
      made = false;
    }
    if (!made) return;
    expect(() => resolveBaselinePath(['--baseline-file', link])).toThrow(/inside the repository/);
  });

  it('does not print the user-specific part of a path', () => {
    const shown = redactPath('/home/somebody/secret-session/scratch/baseline.json');
    expect(shown).not.toContain('somebody');
    expect(shown).not.toContain('secret-session');
    expect(shown).toContain('baseline.json');
  });

  it('knows what is inside the repository and what is beside it', () => {
    expect(isInside(resolve(REPO_ROOT, 'scripts'), REPO_ROOT)).toBe(true);
    expect(isInside(REPO_ROOT, REPO_ROOT)).toBe(true);
    // A sibling directory sharing the prefix must not count as inside.
    expect(isInside(REPO_ROOT + '-other', REPO_ROOT)).toBe(false);
  });
});

describe('baseline loading', () => {
  it('rejects malformed JSON', () => {
    const p = join(tmp, 'bad.json');
    writeFileSync(p, '{ not json');
    expect(() => loadBaseline(p)).toThrow(/not valid JSON/);
  });

  it('rejects an unreadable path', () => {
    expect(() => loadBaseline(join(tmp, 'absent.json'))).toThrow(/could not be read/);
  });
});

describe('strict baseline validation', () => {
  it('accepts exactly the approved set', () => {
    expect(validateBaseline(goodBaseline(), APPROVED)).toBe(true);
  });

  it('rejects 36 functions', () => {
    const b = goodBaseline();
    b.functions = b.functions.slice(0, 36);
    expect(() => validateBaseline(b, APPROVED)).toThrow(/expected 37 functions/);
  });

  it('rejects 38 functions', () => {
    const b = goodBaseline();
    b.functions = [
      ...b.functions,
      {
        name: 'zoryvex-test-extra',
        reservedConcurrentExecutions: null,
        codeSha256: 'x',
        lastModified: 'y',
      },
    ];
    expect(() => validateBaseline(b, APPROVED)).toThrow(/expected 37 functions/);
  });

  it('rejects a duplicate, even though the count still reads 37', () => {
    // The nastiest of these: 37 entries covering 36 functions.
    const b = goodBaseline();
    b.functions[1] = { ...b.functions[0] };
    expect(() => validateBaseline(b, APPROVED)).toThrow(/duplicate functions/);
  });

  it('rejects an unexpected function', () => {
    const b = goodBaseline();
    b.functions[5] = { ...b.functions[5], name: 'zoryvex-test-not-approved' };
    expect(() => validateBaseline(b, APPROVED)).toThrow(/not in the approved set/);
  });

  it('rejects a non-TEST-prefixed function', () => {
    const b = goodBaseline();
    b.functions[0] = { ...b.functions[0], name: 'zoryvex-prod-payments' };
    expect(() => validateBaseline(b, APPROVED)).toThrow(/TEST prefix|not in the approved set/);
  });

  it('rejects a missing prior concurrency state', () => {
    const b = goodBaseline();
    const { reservedConcurrentExecutions, ...withoutState } = b.functions[0];
    void reservedConcurrentExecutions;
    b.functions[0] = withoutState;
    expect(() => validateBaseline(b, APPROVED)).toThrow(/no recorded prior concurrency state/);
  });

  it('rejects a missing hash', () => {
    const b = goodBaseline();
    b.functions[2] = { ...b.functions[2], codeSha256: '' };
    expect(() => validateBaseline(b, APPROVED)).toThrow(/missing CodeSha256/);
  });

  it('rejects a missing timestamp', () => {
    const b = goodBaseline();
    b.functions[3] = { ...b.functions[3], lastModified: '' };
    expect(() => validateBaseline(b, APPROVED)).toThrow(/missing LastModified/);
  });

  it('rejects a baseline with no functions array at all', () => {
    expect(() => validateBaseline({}, APPROVED)).toThrow(/malformed/);
  });
});

describe('preflight drift detection', () => {
  it('passes when live state matches the baseline', () => {
    const b = goodBaseline();
    const result = preflight(b, { awsImpl: fakeAws(b) });
    expect(result.passed).toBe(true);
    expect(result.unreservedCount).toBe(37);
    expect(result.limit).toBe(1000);
    expect(result.unreserved).toBe(1000);
  });

  it('catches concurrency drift', () => {
    const b = goodBaseline();
    const aws = fakeAws(b, { concurrency: { [APPROVED[0]]: 5 } });
    const result = preflight(b, { awsImpl: aws });
    expect(result.passed).toBe(false);
    expect(result.problems.some((p) => p.includes('concurrency drifted'))).toBe(true);
  });

  it('catches code-hash drift', () => {
    const b = goodBaseline();
    const aws = fakeAws(b, { code: { [APPROVED[1]]: 'a-different-build' } });
    const result = preflight(b, { awsImpl: aws });
    expect(result.passed).toBe(false);
    expect(result.problems.some((p) => p.includes('CodeSha256 drifted'))).toBe(true);
  });

  it('catches LastModified drift', () => {
    const b = goodBaseline();
    const aws = fakeAws(b, { lastModified: { [APPROVED[2]]: '2026-08-28T09:00:00.000+0000' } });
    const result = preflight(b, { awsImpl: aws });
    expect(result.passed).toBe(false);
    expect(result.problems.some((p) => p.includes('LastModified drifted'))).toBe(true);
  });

  it('catches a function that no longer exists', () => {
    const b = goodBaseline();
    const shrunk = { ...b, functions: b.functions };
    const aws = fakeAws({ functions: b.functions.slice(1) });
    const result = preflight(shrunk, { awsImpl: aws });
    expect(result.problems.some((p) => p.includes('no longer exists'))).toBe(true);
  });

  it('catches an account whose pool or unreserved figure has moved', () => {
    const b = goodBaseline();
    const aws = fakeAws(b, { account: { limit: 1000, unreserved: 815 } });
    const result = preflight(b, { awsImpl: aws });
    expect(result.passed).toBe(false);
    expect(result.problems.some((p) => p.includes('account unreserved'))).toBe(true);
  });
});

describe('apply', () => {
  it('makes zero mutation calls when preflight fails', () => {
    // The property that matters most here. A failed preflight must not leave
    // the account half-changed, which means not changing it at all.
    const b = goodBaseline();
    const aws = fakeAws(b, { code: { [APPROVED[0]]: 'drifted' } });
    const result = applyConcurrency(b, { awsImpl: aws });

    expect(result.aborted).toBe(true);
    expect(result.applied).toBe(0);
    expect(aws.mutations()).toHaveLength(0);
  });

  it('proceeds to the apply stage when preflight passes', () => {
    const b = goodBaseline();
    const aws = fakeAws(b);
    const result = applyConcurrency(b, { awsImpl: aws });

    expect(result.aborted).toBe(false);
    expect(result.applied).toBe(37);
    const puts = aws.mutations();
    expect(puts).toHaveLength(37);
    expect(puts.every((c) => c[1] === 'put-function-concurrency')).toBe(true);
    expect(puts.every((c) => c[c.indexOf('--reserved-concurrent-executions') + 1] === '5')).toBe(
      true,
    );
  });

  it('rolls every changed function back when one change fails partway', () => {
    const b = goodBaseline();
    const inner = fakeAws(b);
    let puts = 0;
    const failing = (args) => {
      if (args[1] === 'put-function-concurrency') {
        puts += 1;
        if (puts === 10) throw new Error('AWS said no');
      }
      return inner(args);
    };
    failing.calls = inner.calls;

    const result = applyConcurrency(b, { awsImpl: failing });
    expect(result.aborted).toBe(true);
    expect(result.applied).toBe(0);
    expect(result.rolledBackFrom).toBe(9);
    // All 37 were unreserved, so every restoration is a delete rather than a
    // guessed number.
    const deletes = inner.calls.filter((c) => c[1] === 'delete-function-concurrency');
    expect(deletes).toHaveLength(9);
    expect(result.rollbackFailures).toEqual([]);
  });

  it('reports rollback failures explicitly rather than swallowing them', () => {
    const b = goodBaseline();
    const inner = fakeAws(b);
    let puts = 0;
    const hostile = (args) => {
      if (args[1] === 'put-function-concurrency') {
        puts += 1;
        if (puts === 3) throw new Error('AWS said no');
      }
      if (args[1] === 'delete-function-concurrency') throw new Error('rollback refused');
      return inner(args);
    };
    hostile.calls = inner.calls;

    const result = applyConcurrency(b, { awsImpl: hostile });
    expect(result.aborted).toBe(true);
    expect(result.rollbackFailures).toHaveLength(2);
    expect(result.rollbackFailures[0]).toMatch(/rollback refused/);
  });
});

describe('rollback plan', () => {
  it('deletes for a previously-unreserved function and restores a number otherwise', () => {
    expect(
      rollbackPlanFor([
        { name: 'zoryvex-test-health', reservedConcurrentExecutions: null },
        { name: 'zoryvex-test-authorizer', reservedConcurrentExecutions: 3 },
      ]),
    ).toEqual([
      { name: 'zoryvex-test-health', action: 'delete-function-concurrency' },
      { name: 'zoryvex-test-authorizer', action: 'put-function-concurrency', value: 3 },
    ]);
  });
});

describe('expected account arithmetic', () => {
  it('is the 37/185/815 the founder approved, above the floor', () => {
    expect(EXPECTED.functions).toBe(37);
    expect(EXPECTED.reservedAfter).toBe(185);
    expect(EXPECTED.unreservedBefore).toBe(1000);
    expect(EXPECTED.unreservedAfter).toBe(815);
    expect(EXPECTED.unreservedAfter).toBeGreaterThanOrEqual(EXPECTED.minimumUnreserved);
  });
});

describe('the approved function list', () => {
  it('is 37 unique TEST names', () => {
    expect(APPROVED).toHaveLength(37);
    expect(new Set(APPROVED).size).toBe(37);
    expect(APPROVED.every((n) => n.startsWith('zoryvex-test-'))).toBe(true);
  });

  it('refuses a list containing a non-TEST name', () => {
    const p = join(tmp, 'names.txt');
    const names = Array.from({ length: 36 }, (_, i) => `zoryvex-test-fn-${i}`);
    names.push('zoryvex-prod-payments');
    mkdirSync(tmp, { recursive: true });
    writeFileSync(p, names.join('\n') + '\n');
    expect(() => readFunctionNames(p)).toThrow(/Refusing/);
  });
});
