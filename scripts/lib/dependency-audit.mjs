// Pure logic behind scripts/dependency-audit.mjs.
//
// `npm audit` conflates two different outcomes in one non-zero exit: "this
// project depends on something vulnerable" and "I could not reach npm's
// advisory endpoint". The first must block. The second is a statement about
// npm's uptime, not about this repository, and blocking every deploy on a
// third party's availability is its own risk - especially with a limited
// number of deployments.
//
// These classify the two apart so the caller can retry one and fail on the
// other, and so a run that could not measure anything is never reported as
// a pass.

/**
 * Phrases npm uses when the audit endpoint itself failed, rather than when
 * it successfully reported findings. Matched case-insensitively against
 * combined stdout and stderr.
 */
const TRANSIENT_MARKERS = [
  'audit endpoint returned an error',
  'network timeout',
  'request to https://registry.npmjs.org',
  'ENOTFOUND',
  'ETIMEDOUT',
  'ECONNRESET',
  'ECONNREFUSED',
  'EAI_AGAIN',
  'socket hang up',
  '503 Service Unavailable',
  '429 Too Many Requests',
];

export const AUDIT_OUTCOME = {
  clean: 'clean',
  vulnerable: 'vulnerable',
  unreachable: 'unreachable',
};

/**
 * Decide what a completed `npm audit` run actually established.
 *
 * A zero exit is clean regardless of what was printed. A non-zero exit that
 * produced parseable findings is a real result and must block. A non-zero
 * exit carrying a transport failure measured nothing.
 *
 * Order matters: findings are checked before transport markers, so a run
 * that both reported vulnerabilities and logged a warning about a slow
 * request is still treated as vulnerable. Failing safe means never letting
 * a network warning downgrade a genuine finding.
 */
export function classifyAuditResult({ exitCode, stdout = '', stderr = '' }) {
  if (exitCode === 0) return AUDIT_OUTCOME.clean;

  const findings = parseFindings(stdout);
  if (findings !== null && findings.total > 0) return AUDIT_OUTCOME.vulnerable;

  const combined = `${stdout}\n${stderr}`.toLowerCase();
  const transient = TRANSIENT_MARKERS.some((marker) => combined.includes(marker.toLowerCase()));
  if (transient) return AUDIT_OUTCOME.unreachable;

  // Non-zero, no parseable findings, nothing that looks like a transport
  // failure. Unexplained, so it blocks: an audit gate that guesses in this
  // situation is not a gate.
  return AUDIT_OUTCOME.vulnerable;
}

/**
 * Counts from `npm audit --json`, or null when the output is not the JSON
 * report at all (which is itself how a transport failure usually presents).
 */
export function parseFindings(stdout) {
  let report;
  try {
    report = JSON.parse(stdout);
  } catch {
    return null;
  }
  const vulnerabilities = report?.metadata?.vulnerabilities;
  if (!vulnerabilities || typeof vulnerabilities !== 'object') return null;

  const counts = {
    critical: vulnerabilities.critical ?? 0,
    high: vulnerabilities.high ?? 0,
    moderate: vulnerabilities.moderate ?? 0,
    low: vulnerabilities.low ?? 0,
  };
  // Only the levels this gate blocks on count toward `total`. `npm audit`
  // was invoked with --audit-level=high, so a moderate finding is reported
  // but is not what makes the run fail.
  return { ...counts, total: counts.critical + counts.high };
}

/** Names the packages behind the blocking findings, for the failure message. */
export function blockingAdvisories(stdout) {
  let report;
  try {
    report = JSON.parse(stdout);
  } catch {
    return [];
  }
  const entries = Object.entries(report?.vulnerabilities ?? {});
  return entries
    .filter(([, value]) => value?.severity === 'high' || value?.severity === 'critical')
    .map(([name, value]) => `${name} (${value.severity})`)
    .sort();
}
