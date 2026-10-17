#!/usr/bin/env node
// Phase 7 slice 10 — synthetic load/quota check.
//
// Default mode (no flags): prints the synthetic 10k/50k/100k-registered-user
// model from scripts/lib/load-quota-model.mjs. Pure computation, zero AWS
// calls, $0 cost — safe to run anywhere, including CI.
//
// `--live-probe <baseUrl>`: an explicit, human-invoked, opt-in extra step
// that empirically measures this AWS account's real shared Lambda
// concurrency-pool behavior (docs/RISK_REGISTER.md: "tracked for Phase 7's
// load-test slice to actually measure, not just note") by firing a small,
// bounded burst of concurrent GET requests at /health — a public,
// unauthenticated, zero-side-effect endpoint. Deliberately small (well
// under the account's documented 10-execution ceiling plus a modest margin
// to observe throttling, never anything resembling the literal 10k/50k/100k
// figures — this account's real hard concurrency ceiling makes a literal
// live rendition of those numbers both reckless and physically impossible
// without a prior AWS service-quota increase, which is explicitly a
// founder decision not made this phase). Never run automatically; never
// wired into npm run validate:all or CI.

import { evaluateAllScales } from './lib/load-quota-model.mjs';

function printModelReport() {
  console.log('Phase 7 slice 10 — synthetic load/quota model (no AWS calls, $0 cost)\n');
  for (const r of evaluateAllScales()) {
    console.log(`registered=${r.registeredUsers.toLocaleString()}  MAU=${r.mau.toLocaleString()}`);
    console.log(
      `  modeled avg ${r.avgRequestsPerSecond.toFixed(4)} req/s -> modeled peak ${r.modeledPeakRequestsPerSecond.toFixed(4)} req/s ` +
        `-> modeled peak concurrency ${r.modeledPeakConcurrentExecutions.toFixed(4)}`,
    );
    console.log(
      `  configured: throttle ${r.configuredThrottlingRateLimit}/s sustained, ${r.configuredThrottlingBurstLimit} burst; ` +
        `account concurrency ceiling ${r.accountConcurrencyCeiling}`,
    );
    console.log(
      `  within sustained throttle: ${r.withinSustainedThrottle}  within burst throttle: ${r.withinBurstThrottle}  ` +
        `within concurrency ceiling: ${r.withinConcurrencyCeiling}  -> boundsHold=${r.boundsHold}\n`,
    );
  }
  console.log(
    'Modelled headroom is measured against the real configured throttle and the real account ' +
      'concurrency ceiling. The service level objectives this environment is held to are in ' +
      'docs/SLO.md and are checked empirically by --live-probe, not by this model.',
  );
}

/**
 * The thresholds in docs/SLO.md, in the one place the probe reads them.
 *
 * Written here rather than inferred from a run, because an objective derived
 * from its own measurement is not an objective. Changing a number here means
 * changing the document, and the evidence file records both.
 */
import { existsSync as nodeExistsSync } from 'node:fs';

export const PROBE_PLAN = {
  route: '/health',
  totalRequests: 25,
  concurrency: 5,
  requestTimeoutMs: 6000,
  authentication: 'none',
};

/** Bound on the pre-measurement reachability check. Not an SLO number. */
export const PREFLIGHT_TIMEOUT_MS = 5000;

/**
 * The thresholds in docs/SLO.md, in the one place the probe reads them.
 *
 * Written before anything was measured, because an objective derived from its
 * own measurement is not an objective. Unchanged by the reachability work.
 */
export const SLO = {
  completionRate: 1, // every request must get an HTTP response
  successRate: 1, // every response must be HTTP 200
  maxServerErrors: 0,
  maxThrottledWithinBounds: 0,
  p50Ms: 800,
  p95Ms: 2500,
  maxMs: 5000,
};

export const OUTCOME = { PASS: 'PASS', FAIL: 'FAIL', UNMEASURED: 'UNMEASURED' };
export const EXIT = { PASS: 0, FAIL: 1, UNMEASURED: 2 };

function percentile(sortedMs, fraction) {
  if (sortedMs.length === 0) return null;
  const index = Math.min(sortedMs.length - 1, Math.ceil(fraction * sortedMs.length) - 1);
  return sortedMs[Math.max(0, index)];
}

/**
 * Runs `total` requests with at most `concurrency` in flight.
 *
 * A plain Promise.all over every request would offer all of them at once,
 * which measures something other than what docs/SLO.md describes: the
 * objective is stated at or below the per-function reservation, so the probe
 * has to hold the offered load there.
 */
async function runPool(total, concurrency, task) {
  const results = new Array(total);
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, total) }, async () => {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= total) return;
      results[index] = await task(index);
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * Checks the endpoint is reachable before anything is measured.
 *
 * This exists because the first real run reported SLO: FAIL for a service that
 * was returning 200. Every one of its 25 requests died at DNS, and the probe
 * had no way to say so: a request that never left the machine looked exactly
 * like a request the environment refused to answer. That is a measuring
 * failure being recorded as a service failure, which is the worst direction
 * for this to be wrong in.
 *
 * It deliberately stops at TCP and TLS. Sending a request to /health here
 * would warm the Lambda and make the first measured request faster than it
 * honestly is, quietly improving the very latency figure being judged.
 */
export async function reachabilityPreflight(
  target,
  { timeoutMs = PREFLIGHT_TIMEOUT_MS, dnsImpl, tlsImpl } = {},
) {
  let url;
  try {
    url = new URL(target);
  } catch {
    return { ok: false, stage: 'url', reason: 'target is not a valid URL' };
  }
  if (url.protocol !== 'https:') {
    return { ok: false, stage: 'url', reason: `expected https, got ${url.protocol}` };
  }
  const hostname = url.hostname;
  const port = Number(url.port || 443);

  let addresses;
  try {
    addresses = await (dnsImpl ?? dnsResolve4)(hostname);
  } catch (err) {
    return {
      ok: false,
      stage: 'dns',
      reason: `IPv4 resolution failed (${err?.code ?? err?.name ?? 'error'})`,
    };
  }
  if (!Array.isArray(addresses) || addresses.length === 0) {
    return { ok: false, stage: 'dns', reason: 'IPv4 resolution returned no addresses' };
  }

  try {
    await (tlsImpl ?? tlsReachable)(addresses[0], port, hostname, timeoutMs);
  } catch (err) {
    return {
      ok: false,
      stage: 'tcp-tls',
      reason: `TCP/TLS to the resolved address failed (${err?.code ?? err?.name ?? 'error'})`,
    };
  }

  return {
    ok: true,
    hostname,
    port,
    addresses,
    path: url.pathname === '/' ? PROBE_PLAN.route : url.pathname,
  };
}

async function dnsResolve4(hostname) {
  const { promises } = await import('node:dns');
  return promises.resolve4(hostname);
}

/** Opens TLS to one address and closes it. No HTTP is sent. */
async function tlsReachable(address, port, servername, timeoutMs) {
  const tls = await import('node:tls');
  await new Promise((resolve, reject) => {
    const socket = tls.connect({ host: address, port, servername, timeout: timeoutMs }, () => {
      socket.destroy();
      resolve();
    });
    socket.once('timeout', () => {
      socket.destroy();
      reject(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }));
    });
    socket.once('error', (err) => {
      socket.destroy();
      reject(err);
    });
  });
}

/**
 * One measured request, sent to an already-resolved address.
 *
 * Connecting by address is what stops the measurement doing its own DNS: the
 * preflight resolved once, and the 25 requests reuse that answer. Host and
 * servername carry the real hostname so the API and the certificate both see
 * the name they expect rather than an IP.
 */
async function addressedRequest({ address, port, hostname, path, timeoutMs }) {
  const https = await import('node:https');
  const startedAt = Date.now();
  return new Promise((resolve) => {
    const req = https.request(
      {
        host: address,
        port,
        path,
        method: 'GET',
        servername: hostname,
        headers: { Host: hostname },
        timeout: timeoutMs,
      },
      (res) => {
        res.resume();
        res.once('end', () =>
          resolve({ outcome: 'response', status: res.statusCode, ms: Date.now() - startedAt }),
        );
      },
    );
    req.once('timeout', () => {
      req.destroy();
      resolve({ outcome: 'timeout', ms: Date.now() - startedAt, reason: 'TimeoutError' });
    });
    req.once('error', (err) => {
      resolve({
        outcome: err?.code === 'ETIMEDOUT' ? 'timeout' : 'network-error',
        ms: Date.now() - startedAt,
        reason: err?.code ?? err?.name ?? 'Error',
      });
    });
    req.end();
  });
}

/**
 * Measures the TEST health route against docs/SLO.md.
 *
 * Only ever called after a successful preflight, and only with addresses that
 * preflight already resolved.
 */
export async function liveProbe({
  addresses,
  hostname,
  port = 443,
  path = PROBE_PLAN.route,
  total = PROBE_PLAN.totalRequests,
  concurrency = PROBE_PLAN.concurrency,
  timeoutMs = PROBE_PLAN.requestTimeoutMs,
  label = 'within bounds',
  requestImpl = addressedRequest,
}) {
  const startedAtIso = new Date().toISOString();
  const started = Date.now();
  const outcomes = await runPool(total, concurrency, (i) =>
    requestImpl({
      address: addresses[i % addresses.length],
      port,
      hostname,
      path,
      timeoutMs,
    }),
  );
  const wallClockMs = Date.now() - started;

  const latencies = [];
  const statusCounts = {};
  let timeouts = 0;
  let networkErrors = 0;
  for (const o of outcomes) {
    if (o.outcome === 'response') {
      latencies.push(o.ms);
      statusCounts[o.status] = (statusCounts[o.status] ?? 0) + 1;
    } else if (o.outcome === 'timeout') {
      timeouts += 1;
    } else {
      networkErrors += 1;
    }
  }
  latencies.sort((a, b) => a - b);

  const responded = latencies.length;
  const ok = statusCounts[200] ?? 0;
  const throttled = statusCounts[429] ?? 0;
  const serverErrors = Object.entries(statusCounts)
    .filter(([status]) => Number(status) >= 500)
    .reduce((sum, [, count]) => sum + count, 0);

  return {
    label,
    requested: total,
    concurrency,
    requestTimeoutMs: timeoutMs,
    hostname,
    responded,
    // Kept apart from every HTTP outcome on purpose. A timeout is not a 429
    // and not a 5xx, and folding it into either would misreport the
    // environment failing to answer as a guardrail firing.
    timeouts,
    networkErrors,
    noResponse: timeouts + networkErrors,
    statusCounts,
    ok,
    throttled,
    serverErrors,
    completionRate: responded / total,
    successRate: ok / total,
    // null rather than NaN: a request that never answered has no latency, and
    // NaN serializes to null anyway while comparing false against everything,
    // which makes the evidence harder to read for no gain.
    p50Ms: percentile(latencies, 0.5),
    p95Ms: percentile(latencies, 0.95),
    maxMs: latencies.length === 0 ? null : latencies[latencies.length - 1],
    wallClockMs,
    startedAt: startedAtIso,
    measuredAt: new Date().toISOString(),
  };
}

/**
 * Compares one measured run against docs/SLO.md and says which rows held.
 *
 * A breached threshold is a breach: nothing here rounds, relaxes, or
 * reinterprets one, and a missing latency fails rather than passing by
 * accident on a comparison against null.
 */
export function evaluateAgainstSlo(measured) {
  const within = (v, limit) => typeof v === 'number' && Number.isFinite(v) && v <= limit;
  const rows = [
    {
      name: 'successful completion',
      threshold: `${SLO.completionRate * 100}% receive an HTTP response`,
      observed:
        `${(measured.completionRate * 100).toFixed(1)}%` +
        (measured.noResponse > 0
          ? ` (${measured.timeouts} timed out, ${measured.networkErrors} network errors)`
          : ''),
      pass: measured.completionRate >= SLO.completionRate,
    },
    {
      name: 'error rate',
      threshold: `${SLO.successRate * 100}% HTTP 200`,
      observed: `${(measured.successRate * 100).toFixed(1)}%`,
      pass: measured.successRate >= SLO.successRate,
    },
    {
      name: 'server errors',
      threshold: `at most ${SLO.maxServerErrors}`,
      observed: String(measured.serverErrors),
      pass: measured.serverErrors <= SLO.maxServerErrors,
    },
    {
      name: 'throttling within bounds',
      threshold: `at most ${SLO.maxThrottledWithinBounds} HTTP 429`,
      observed: String(measured.throttled),
      pass: measured.throttled <= SLO.maxThrottledWithinBounds,
    },
    {
      name: 'latency p50',
      threshold: `<= ${SLO.p50Ms}ms`,
      observed: measured.p50Ms === null ? 'no responses' : `${measured.p50Ms}ms`,
      pass: within(measured.p50Ms, SLO.p50Ms),
    },
    {
      name: 'latency p95',
      threshold: `<= ${SLO.p95Ms}ms`,
      observed: measured.p95Ms === null ? 'no responses' : `${measured.p95Ms}ms`,
      pass: within(measured.p95Ms, SLO.p95Ms),
    },
    {
      name: 'latency max',
      threshold: `<= ${SLO.maxMs}ms`,
      observed: measured.maxMs === null ? 'no responses' : `${measured.maxMs}ms`,
      pass: within(measured.maxMs, SLO.maxMs),
    },
  ];
  return { rows, passed: rows.every((r) => r.pass) };
}

function printSloVerdict(verdict) {
  console.log('\nAgainst docs/SLO.md:');
  for (const row of verdict.rows) {
    console.log(
      `  ${row.pass ? 'PASS' : 'FAIL'}  ${row.name}: ${row.observed} (threshold ${row.threshold})`,
    );
  }
}

/**
 * Refuses to write over a result that already exists.
 *
 * An overwritten probe result is an unrepeatable measurement quietly replaced
 * by a later one, which is exactly how a failed run disappears.
 */
export function assertEvidencePathUnused(path, { existsImpl } = {}) {
  const exists = existsImpl ?? nodeExistsSync;
  if (exists(path)) {
    throw new Error(
      `Evidence path already used: ${path}. Give a new filename; results are never replaced.`,
    );
  }
  return true;
}

async function main() {
  const args = process.argv.slice(2);
  printModelReport();

  const liveIdx = args.indexOf('--live-probe');
  if (liveIdx === -1) {
    console.log(
      '\n(--live-probe <baseUrl> not passed — skipping the real-AWS empirical measurement.)',
    );
    return;
  }

  const baseUrl = args[liveIdx + 1];
  if (!baseUrl || baseUrl.startsWith('--')) {
    console.error(
      '\n--live-probe requires a base URL, e.g. --live-probe https://test-api.zoryvex.space',
    );
    process.exitCode = EXIT.FAIL;
    return;
  }

  const evidencePath = args.includes('--evidence') ? args[args.indexOf('--evidence') + 1] : null;
  if (!evidencePath || evidencePath.startsWith('--')) {
    console.error('\n--evidence <new-file> is required, and every attempt needs its own filename.');
    process.exitCode = EXIT.FAIL;
    return;
  }

  const { existsSync, writeFileSync } = await import('node:fs');
  try {
    // Checked before anything runs, so a result is never produced and then
    // discovered to have nowhere safe to go.
    assertEvidencePathUnused(evidencePath, { existsImpl: existsSync });
  } catch (err) {
    console.error(`\n${err.message}`);
    process.exitCode = EXIT.FAIL;
    return;
  }

  const target = `${baseUrl.replace(/\/$/, '')}${PROBE_PLAN.route}`;
  console.log(`\nReachability preflight (no HTTP sent, nothing warmed): ${target}`);
  const pre = await reachabilityPreflight(target);

  if (!pre.ok) {
    // Not an SLO failure. Nothing was measured, so there is nothing to judge,
    // and calling this FAIL would blame the service for the probe's inability
    // to reach it.
    console.error(`  UNMEASURED at the ${pre.stage} stage: ${pre.reason}`);
    const record = {
      plan: PROBE_PLAN,
      slo: SLO,
      outcome: OUTCOME.UNMEASURED,
      unmeasured: { stage: pre.stage, reason: pre.reason, at: new Date().toISOString() },
      measured: {
        requested: PROBE_PLAN.totalRequests,
        applicationRequestsSent: 0,
        responded: 0,
        p50Ms: null,
        p95Ms: null,
        maxMs: null,
      },
      verdict: { passed: null, rows: [] },
    };
    writeFileSync(evidencePath, JSON.stringify(record, null, 2) + '\n');
    console.error(`\nOutcome: ${OUTCOME.UNMEASURED}. No application request was sent.`);
    console.error(`Evidence written to ${evidencePath}`);
    process.exitCode = EXIT.UNMEASURED;
    return;
  }

  console.log(`  resolved ${pre.addresses.length} IPv4 address(es), TLS reachable.`);
  console.log(
    `\nLive probe: ${PROBE_PLAN.totalRequests} requests, ${PROBE_PLAN.concurrency} in flight, ` +
      `${PROBE_PLAN.requestTimeoutMs}ms timeout, GET ${target}`,
  );

  const measured = await liveProbe({
    addresses: pre.addresses,
    hostname: pre.hostname,
    port: pre.port,
    path: pre.path,
  });
  const verdict = evaluateAgainstSlo(measured);

  console.log(`  responded ${measured.responded}/${measured.requested}`);
  for (const [status, count] of Object.entries(measured.statusCounts).sort()) {
    console.log(`    HTTP ${status}: ${count}`);
  }
  if (measured.timeouts > 0) console.log(`    timed out (no HTTP response): ${measured.timeouts}`);
  if (measured.networkErrors > 0) {
    console.log(`    network errors (no HTTP response): ${measured.networkErrors}`);
  }
  printSloVerdict(verdict);

  const outcome = verdict.passed ? OUTCOME.PASS : OUTCOME.FAIL;
  console.log(`\nOutcome: ${outcome}`);

  writeFileSync(
    evidencePath,
    JSON.stringify({ plan: PROBE_PLAN, slo: SLO, outcome, measured, verdict }, null, 2) + '\n',
  );
  console.log(`Evidence written to ${evidencePath}`);

  process.exitCode = verdict.passed ? EXIT.PASS : EXIT.FAIL;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
