import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  ACCOUNT_LAMBDA_CONCURRENCY_CEILING,
  ACCOUNT_MINIMUM_UNRESERVED,
  RESERVATION_STATES,
  capacityFor,
} from './load-quota-model.mjs';
import {
  EXIT,
  OUTCOME,
  PROBE_PLAN,
  SLO,
  assertEvidencePathUnused,
  evaluateAgainstSlo,
  liveProbe,
  reachabilityPreflight,
} from '../load-quota-check.mjs';

/**
 * The probe is what turns docs/SLO.md from a document into an acceptance gate,
 * so the parts of it that decide pass, fail or unmeasured are tested rather
 * than trusted.
 *
 * The reachability work exists because the first real run reported SLO: FAIL
 * for a service that was returning 200. All 25 of its requests died at DNS and
 * the probe could not tell that apart from the environment refusing to answer.
 * Most of what follows keeps those two things separate in both directions: a
 * measuring failure must never read as a service failure, and an
 * application-stage failure must never hide behind UNMEASURED.
 */

const HOST = 'test-api.zoryvex.space';
const ADDRESSES = ['52.50.59.208', '54.77.144.136'];

const okDns = async () => ADDRESSES;
const okTls = async () => undefined;

function respondingImpl({ status = 200, ms = 120 } = {}) {
  const seen = [];
  const impl = async (opts) => {
    seen.push(opts);
    return { outcome: 'response', status, ms };
  };
  impl.seen = seen;
  return impl;
}

describe('reachability preflight', () => {
  it('rejects a target that is not a valid URL', async () => {
    const r = await reachabilityPreflight('not a url', { dnsImpl: okDns, tlsImpl: okTls });
    expect(r.ok).toBe(false);
    expect(r.stage).toBe('url');
  });

  it('rejects a non-https target', async () => {
    const r = await reachabilityPreflight('http://example.com/health', {
      dnsImpl: okDns,
      tlsImpl: okTls,
    });
    expect(r.ok).toBe(false);
    expect(r.stage).toBe('url');
  });

  it('reports a DNS failure as its own stage, with a non-sensitive reason', async () => {
    const r = await reachabilityPreflight(`https://${HOST}/health`, {
      dnsImpl: async () => {
        throw Object.assign(new Error('nope'), { code: 'EAI_AGAIN' });
      },
      tlsImpl: okTls,
    });
    expect(r.ok).toBe(false);
    expect(r.stage).toBe('dns');
    expect(r.reason).toContain('EAI_AGAIN');
    // The reason names the failure, not the machine it happened on.
    expect(r.reason).not.toMatch(/[A-Z]:\\|\/home\/|\/Users\//);
  });

  it('treats an empty address list as a DNS failure rather than proceeding', async () => {
    const r = await reachabilityPreflight(`https://${HOST}/health`, {
      dnsImpl: async () => [],
      tlsImpl: okTls,
    });
    expect(r.ok).toBe(false);
    expect(r.stage).toBe('dns');
  });

  it('reports a TCP/TLS failure as its own stage', async () => {
    const r = await reachabilityPreflight(`https://${HOST}/health`, {
      dnsImpl: okDns,
      tlsImpl: async () => {
        throw Object.assign(new Error('refused'), { code: 'ECONNREFUSED' });
      },
    });
    expect(r.ok).toBe(false);
    expect(r.stage).toBe('tcp-tls');
    expect(r.reason).toContain('ECONNREFUSED');
  });

  it('checks TLS against the real hostname, not the address', async () => {
    // SNI has to carry the name or the certificate will not match, and the
    // check would fail for a reason unrelated to reachability.
    const calls = [];
    await reachabilityPreflight(`https://${HOST}/health`, {
      dnsImpl: okDns,
      tlsImpl: async (address, port, servername) => {
        calls.push({ address, port, servername });
      },
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].servername).toBe(HOST);
    expect(ADDRESSES).toContain(calls[0].address);
    expect(calls[0].port).toBe(443);
  });

  it('succeeds without sending any HTTP request, so nothing is warmed', async () => {
    // Stopping at TLS is deliberate: a request to /health here would warm the
    // Lambda and make the first measured request faster than it honestly is,
    // improving the very latency figure being judged.
    const impl = respondingImpl();
    const r = await reachabilityPreflight(`https://${HOST}/health`, {
      dnsImpl: okDns,
      tlsImpl: okTls,
    });
    expect(r.ok).toBe(true);
    expect(impl.seen).toHaveLength(0);
  });

  it('caches the resolved addresses for the measurement to reuse', async () => {
    const r = await reachabilityPreflight(`https://${HOST}/health`, {
      dnsImpl: okDns,
      tlsImpl: okTls,
    });
    expect(r.ok).toBe(true);
    expect(r.addresses).toEqual(ADDRESSES);
    expect(r.hostname).toBe(HOST);
  });
});

describe('measurement uses the cached addresses', () => {
  it('never resolves DNS again during the 25 requests', async () => {
    let dnsCalls = 0;
    const pre = await reachabilityPreflight(`https://${HOST}/health`, {
      dnsImpl: async () => {
        dnsCalls += 1;
        return ADDRESSES;
      },
      tlsImpl: okTls,
    });
    const impl = respondingImpl();
    await liveProbe({
      addresses: pre.addresses,
      hostname: pre.hostname,
      port: pre.port,
      requestImpl: impl,
    });
    // One resolution, in preflight, and none afterwards.
    expect(dnsCalls).toBe(1);
    expect(impl.seen).toHaveLength(25);
    expect(impl.seen.every((o) => ADDRESSES.includes(o.address))).toBe(true);
  });

  it('keeps Host and TLS SNI as the real hostname on every request', async () => {
    const impl = respondingImpl();
    await liveProbe({ addresses: ADDRESSES, hostname: HOST, requestImpl: impl });
    expect(impl.seen.every((o) => o.hostname === HOST)).toBe(true);
    // The address varies; the name the server is asked for does not.
    expect(new Set(impl.seen.map((o) => o.hostname)).size).toBe(1);
  });

  it('runs exactly 25 requests at no more than 5 in flight', async () => {
    let inFlight = 0;
    let peak = 0;
    let served = 0;
    const impl = async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 1));
      inFlight -= 1;
      served += 1;
      return { outcome: 'response', status: 200, ms: 5 };
    };
    const measured = await liveProbe({ addresses: ADDRESSES, hostname: HOST, requestImpl: impl });
    expect(served).toBe(25);
    expect(measured.requested).toBe(25);
    expect(peak).toBeLessThanOrEqual(5);
    expect(peak).toBeGreaterThan(1);
  });
});

describe('outcomes and exit codes', () => {
  it('defines the three the operator relies on', () => {
    expect(OUTCOME).toEqual({ PASS: 'PASS', FAIL: 'FAIL', UNMEASURED: 'UNMEASURED' });
    expect(EXIT).toEqual({ PASS: 0, FAIL: 1, UNMEASURED: 2 });
  });

  it('passes a clean run', async () => {
    const measured = await liveProbe({
      addresses: ADDRESSES,
      hostname: HOST,
      requestImpl: respondingImpl({ status: 200, ms: 150 }),
    });
    expect(evaluateAgainstSlo(measured).passed).toBe(true);
  });

  it('fails a genuine SLO breach', async () => {
    const measured = await liveProbe({
      addresses: ADDRESSES,
      hostname: HOST,
      requestImpl: respondingImpl({ status: 200, ms: 9000 }),
    });
    const verdict = evaluateAgainstSlo(measured);
    expect(verdict.passed).toBe(false);
    expect(verdict.rows.find((r) => r.name === 'latency p95')?.pass).toBe(false);
  });

  it('counts an application-stage network error as a judged failure, not UNMEASURED', async () => {
    // The other direction: once measurement has begun, a request that dies is
    // the service failing to answer and must not hide behind unmeasured.
    const impl = async () => ({ outcome: 'network-error', ms: 30, reason: 'ECONNRESET' });
    const measured = await liveProbe({ addresses: ADDRESSES, hostname: HOST, requestImpl: impl });
    const verdict = evaluateAgainstSlo(measured);

    expect(measured.networkErrors).toBe(25);
    expect(measured.completionRate).toBe(0);
    expect(verdict.passed).toBe(false);
    // A verdict, not a null: this was measured and it failed.
    expect(verdict.passed).not.toBeNull();
  });

  it('counts a timeout against completion without calling it a throttle', async () => {
    const impl = async () => ({ outcome: 'timeout', ms: 6000, reason: 'TimeoutError' });
    const measured = await liveProbe({ addresses: ADDRESSES, hostname: HOST, requestImpl: impl });
    expect(measured.timeouts).toBe(25);
    expect(measured.throttled).toBe(0);
    expect(measured.serverErrors).toBe(0);
    expect(evaluateAgainstSlo(measured).passed).toBe(false);
  });
});

describe('missing latency', () => {
  it('is null rather than NaN, so the evidence stays readable', async () => {
    const impl = async () => ({ outcome: 'network-error', ms: 30, reason: 'ECONNRESET' });
    const measured = await liveProbe({ addresses: ADDRESSES, hostname: HOST, requestImpl: impl });

    expect(measured.p50Ms).toBeNull();
    expect(measured.p95Ms).toBeNull();
    expect(measured.maxMs).toBeNull();
    expect(Number.isNaN(measured.p50Ms)).toBe(false);

    // And survives serialization as null rather than becoming one silently.
    const round = JSON.parse(JSON.stringify(measured));
    expect(round.p50Ms).toBeNull();
    expect(round.maxMs).toBeNull();
  });

  it('fails its threshold rather than passing a comparison against null', () => {
    const verdict = evaluateAgainstSlo({
      requested: 25,
      responded: 0,
      timeouts: 0,
      networkErrors: 25,
      noResponse: 25,
      statusCounts: {},
      ok: 0,
      throttled: 0,
      serverErrors: 0,
      completionRate: 0,
      successRate: 0,
      p50Ms: null,
      p95Ms: null,
      maxMs: null,
    });
    expect(verdict.rows.find((r) => r.name === 'latency p50')?.pass).toBe(false);
    expect(verdict.rows.find((r) => r.name === 'latency max')?.pass).toBe(false);
  });
});

describe('evidence integrity', () => {
  it('refuses to overwrite a result that already exists', () => {
    expect(() => assertEvidencePathUnused('/tmp/x.json', { existsImpl: () => true })).toThrow(
      /already used/,
    );
  });

  it('allows an unused path', () => {
    expect(assertEvidencePathUnused('/tmp/new.json', { existsImpl: () => false })).toBe(true);
  });

  it('keeps the archived DNS-failure result at its original hash', () => {
    // The first attempt is preserved as what it was: a run that could not
    // measure. Its bytes are the record that the failure was real and was not
    // quietly replaced by a later, better-looking one.
    const archived = resolve(
      import.meta.dirname,
      '../../docs/evidence/slice10-probe-unmeasured-dns-2026-08-28.json',
    );
    expect(existsSync(archived)).toBe(true);
    const hash = createHash('sha256').update(readFileSync(archived)).digest('hex');
    expect(hash).toBe('9f86de4fb99cda6cd55d3435658cad10996714fdd6ee1614d4411d2c9d87f4f2');
  });
});

describe('the measured configuration', () => {
  it('is unchanged by the reachability work', () => {
    expect(PROBE_PLAN).toEqual({
      route: '/health',
      totalRequests: 25,
      concurrency: 5,
      requestTimeoutMs: 6000,
      authentication: 'none',
    });
  });

  it('keeps every SLO threshold exactly as written', () => {
    expect(SLO).toEqual({
      completionRate: 1,
      successRate: 1,
      maxServerErrors: 0,
      maxThrottledWithinBounds: 0,
      p50Ms: 800,
      p95Ms: 2500,
      maxMs: 5000,
    });
  });
});

describe('capacity accounting', () => {
  it('reports the currently deployed state and the eventual one as different numbers', () => {
    const current = capacityFor(RESERVATION_STATES.currentlyDeployed);
    const eventual = capacityFor(RESERVATION_STATES.eventualCommitted);
    expect(current.reserved).toBe(185);
    expect(current.unreserved).toBe(815);
    expect(eventual.reserved).toBe(221);
    expect(eventual.unreserved).toBe(779);
    expect(eventual.reserved - current.reserved).toBe(36);
  });

  it('keeps both states above the floor AWS enforces', () => {
    expect(capacityFor(RESERVATION_STATES.currentlyDeployed).aboveFloor).toBe(true);
    expect(capacityFor(RESERVATION_STATES.eventualCommitted).aboveFloor).toBe(true);
    expect(ACCOUNT_MINIMUM_UNRESERVED).toBe(100);
    expect(ACCOUNT_LAMBDA_CONCURRENCY_CEILING).toBe(1000);
  });
});
