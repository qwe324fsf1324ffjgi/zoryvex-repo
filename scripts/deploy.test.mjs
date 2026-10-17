import { describe, expect, it } from 'vitest';
import { smokeTest } from './deploy.mjs';

function fakeFetch(responses) {
  let i = 0;
  return async () => {
    const next = responses[Math.min(i, responses.length - 1)];
    i += 1;
    if (next instanceof Error) throw next;
    // A 2xx may still carry the WRONG build. `{ version }` entries model a
    // healthy response from a specific build, which is what the version
    // assertion below actually discriminates on.
    if (typeof next === 'object' && next !== null) {
      return { ok: true, status: 200, json: async () => next };
    }
    return { ok: next === 'ok', status: next === 'ok' ? 200 : 500 };
  };
}

describe('smokeTest', () => {
  it('resolves immediately on a first-try 2xx', async () => {
    await expect(
      smokeTest('https://example.test/health', { fetchImpl: fakeFetch(['ok']), delayMs: 0 }),
    ).resolves.toBe(true);
  });

  it('retries through transient failures and eventually succeeds', async () => {
    const fetchImpl = fakeFetch(['fail', 'fail', 'ok']);
    await expect(
      smokeTest('https://example.test/health', { fetchImpl, attempts: 5, delayMs: 0 }),
    ).resolves.toBe(true);
  });

  it('throws after exhausting attempts against a persistent failure', async () => {
    const fetchImpl = fakeFetch(['fail']);
    await expect(
      smokeTest('https://example.test/health', { fetchImpl, attempts: 3, delayMs: 0 }),
    ).rejects.toThrow(/Non-2xx/);
  });

  it('treats a thrown network error the same as a bad status, and still retries', async () => {
    const fetchImpl = fakeFetch([new Error('ECONNREFUSED'), 'ok']);
    await expect(
      smokeTest('https://example.test/health', { fetchImpl, attempts: 3, delayMs: 0 }),
    ).resolves.toBe(true);
  });
});

/**
 * The gap these cover: /health answering 2xx proves something is alive, not
 * that the deploy landed. The previous build answers 2xx identically, so a
 * deploy that silently changed nothing used to pass the smoke test. These
 * assert the version comparison actually discriminates.
 */
describe('smokeTest version assertion', () => {
  it('passes when the deployed build reports the commit being deployed', async () => {
    const fetchImpl = fakeFetch([{ status: 'ok', version: 'sha-new' }]);
    await expect(
      smokeTest('https://example.test/health', {
        fetchImpl,
        delayMs: 0,
        expectedVersion: 'sha-new',
      }),
    ).resolves.toBe(true);
  });

  it('fails a healthy endpoint still serving the previous build', async () => {
    // The exact silent no-op this exists to catch: 200, valid body, wrong code.
    const fetchImpl = fakeFetch([{ status: 'ok', version: 'sha-old' }]);
    await expect(
      smokeTest('https://example.test/health', {
        fetchImpl,
        attempts: 2,
        delayMs: 0,
        expectedVersion: 'sha-new',
      }),
    ).rejects.toThrow(/Deployed version mismatch/);
  });

  it('tolerates a warm container briefly serving the old build, then succeeding', async () => {
    const fetchImpl = fakeFetch([
      { status: 'ok', version: 'sha-old' },
      { status: 'ok', version: 'sha-new' },
    ]);
    await expect(
      smokeTest('https://example.test/health', {
        fetchImpl,
        attempts: 4,
        delayMs: 0,
        expectedVersion: 'sha-new',
      }),
    ).resolves.toBe(true);
  });

  it('fails rather than passes when the response carries no version at all', async () => {
    // Otherwise a rollback to a build predating this field would quietly
    // stop being checked while still reporting a passing smoke test.
    const fetchImpl = fakeFetch([{ status: 'ok' }]);
    await expect(
      smokeTest('https://example.test/health', {
        fetchImpl,
        attempts: 2,
        delayMs: 0,
        expectedVersion: 'sha-new',
      }),
    ).rejects.toThrow(/no version/);
  });

  it('keeps the old behaviour when no version is expected', async () => {
    const fetchImpl = fakeFetch(['ok']);
    await expect(smokeTest('https://example.test/health', { fetchImpl, delayMs: 0 })).resolves.toBe(
      true,
    );
  });
});
