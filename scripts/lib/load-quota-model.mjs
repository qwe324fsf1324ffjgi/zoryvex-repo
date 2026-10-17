// Pure, dependency-free synthetic load/quota model for Phase 7 slice 10.
//
// This does NOT send any request to AWS. It converts the registered-user
// scale tiers already used in docs/COST_MODEL.md (10k/50k/100k) into a
// modeled request rate using that same doc's own stated MAU/session/API-call
// assumptions, then checks the result against the two real, currently-
// configured guardrails: infrastructure/modules/api-gateway's throttle
// (throttling_rate_limit=25/s, throttling_burst_limit=50, both defaults,
// unset/unoverridden in infrastructure/envs/test/main.tf) and this AWS
// account's documented 10-total Lambda concurrent-execution ceiling
// (docs/RISK_REGISTER.md, confirmed live in Phase 6 via
// `aws lambda get-account-settings`).
//
// Every number not sourced from a repo file (peak-concentration ratio,
// average Lambda duration) is a labeled MODELING ASSUMPTION, not a verified
// SLO — no "documented SLO" doc exists in this repository as of this slice
// (checked: docs/ARCHITECTURE.md, docs/RUNBOOKS.md, docs/ACCEPTANCE_CRITERIA.md
// contain no SLO numbers), so this model reports capacity headroom/deficit
// against the real configured throttle and concurrency ceiling instead of
// against an SLO that does not yet exist — that absence is reported, not
// silently filled in.

// docs/COST_MODEL.md's own stated per-MAU-per-month assumptions.
export const COST_MODEL_ASSUMPTIONS = {
  mauShareOfRegistered: 0.2,
  sessionsPerMauPerMonth: 5,
  authenticatedApiCallsPerMauPerMonth: 15,
  authorizerInvocationsPerMauPerMonth: 3,
};

// infrastructure/modules/api-gateway/variables.tf defaults, unoverridden in
// infrastructure/envs/test/main.tf — the real configured values, not assumed.
export const CONFIGURED_API_GATEWAY_THROTTLE = {
  throttlingRateLimit: 25, // requests/second, sustained
  throttlingBurstLimit: 50, // requests, momentary burst
};

// Confirmed live via `aws lambda get-account-settings` and Service Quotas
// (lambda L-B99A9384) in eu-west-1 on 2026-08-28, under a one-off founder
// authorization for a read-only check.
//
// This was 10 for the whole of Phases 6 and 7, which is a new-account
// restriction rather than the AWS default. That restriction has been lifted
// and the applied value is now 1,000, which the same API reports as the AWS
// default for this quota. The separate request to raise it to 1,001 was
// closed without being granted, and did not need to be: 1,000 is enough for
// every function here to hold a real reservation, which is what the old
// ceiling made arithmetically impossible.
//
// AWS will not let the unreserved remainder fall below 100, so at most 900 of
// this can be reserved across all functions.
export const ACCOUNT_LAMBDA_CONCURRENCY_CEILING = 1000;
export const ACCOUNT_MINIMUM_UNRESERVED = 100;

/**
 * Two different reservation totals, kept apart on purpose.
 *
 * TEST currently runs 37 of the 45 functions the committed configuration
 * describes; the other 8 have never been deployed. Reporting one number for
 * both states is how "185 reserved" would quietly become a claim about the
 * whole environment, which it is not. The currently-deployed figure is what
 * an apply today produces. The eventual figure is what the committed
 * configuration reaches once the undeployed functions exist.
 *
 * verification_reminder_job is the reason the two counts are not simply 37
 * and 45 at the same per-function value: it owns a Lambda but sets no
 * reserved_concurrent_executions in the TEST environment file, so it inherits
 * the scheduled-job module's own default of 1 rather than the environment
 * variable's 5.
 */
export const RESERVATION_STATES = {
  currentlyDeployed: {
    functions: 37,
    perFunction: 5,
    exceptions: [],
    reserved: 37 * 5,
  },
  eventualCommitted: {
    // 44 environment sites at 5, plus verification_reminder_job at the
    // scheduled-job module default of 1.
    functions: 45,
    perFunction: 5,
    exceptions: [{ name: 'verification_reminder_job', reserved: 1 }],
    reserved: 44 * 5 + 1,
  },
};

/**
 * Reserved and unreserved totals for one state, against the real account pool.
 */
export function capacityFor(state) {
  const reserved = state.reserved;
  const unreserved = ACCOUNT_LAMBDA_CONCURRENCY_CEILING - reserved;
  return {
    reserved,
    unreserved,
    minimumUnreserved: ACCOUNT_MINIMUM_UNRESERVED,
    aboveFloor: unreserved >= ACCOUNT_MINIMUM_UNRESERVED,
  };
}

// Labeled modeling assumptions (test-design judgment, not a product
// requirement and not sourced from any repo doc):
//  - peakConcentrationMultiplier: a commonly used, conservative rule of
//    thumb for consumer web traffic — the single busiest second of a month
//    carries roughly 20x the flat monthly average rate. Deliberately
//    conservative (higher multiplier = stricter test), not tuned to pass.
//  - avgLambdaDurationSeconds: the thin API-route handlers in this codebase
//    (services/api/handlers/*) do a small number of single-digit-millisecond
//    DynamoDB calls behind minimal esbuild-bundled logic; 150ms is a
//    conservative (generous) assumption for req/s -> concurrent-execution
//    conversion, not a measured p99.
export const MODELING_ASSUMPTIONS = {
  peakConcentrationMultiplier: 20,
  avgLambdaDurationSeconds: 0.15,
};

const SECONDS_PER_30_DAY_MONTH = 30 * 24 * 60 * 60;

/**
 * Converts a registered-user count into modeled average and peak request
 * rates, using only docs/COST_MODEL.md's own stated assumptions plus the
 * labeled peak-concentration multiplier above.
 */
export function modelRequestRates(registeredUsers, assumptions = COST_MODEL_ASSUMPTIONS) {
  if (!Number.isFinite(registeredUsers) || registeredUsers < 0) {
    throw new Error(`registeredUsers must be a non-negative number, got ${registeredUsers}`);
  }
  const mau = registeredUsers * assumptions.mauShareOfRegistered;
  const apiCallsPerMonth = mau * assumptions.authenticatedApiCallsPerMauPerMonth;
  const authorizerInvocationsPerMonth = mau * assumptions.authorizerInvocationsPerMauPerMonth;
  const totalRequestsPerMonth = apiCallsPerMonth + authorizerInvocationsPerMonth;
  const avgRequestsPerSecond = totalRequestsPerMonth / SECONDS_PER_30_DAY_MONTH;

  return {
    registeredUsers,
    mau,
    apiCallsPerMonth,
    authorizerInvocationsPerMonth,
    totalRequestsPerMonth,
    avgRequestsPerSecond,
  };
}

/**
 * Applies the labeled peak-concentration multiplier to get a modeled peak
 * req/s, then checks it against the real configured API Gateway throttle
 * and the real account-wide Lambda concurrency ceiling.
 */
export function evaluateScale(
  registeredUsers,
  {
    costModelAssumptions = COST_MODEL_ASSUMPTIONS,
    throttle = CONFIGURED_API_GATEWAY_THROTTLE,
    concurrencyCeiling = ACCOUNT_LAMBDA_CONCURRENCY_CEILING,
    modelingAssumptions = MODELING_ASSUMPTIONS,
  } = {},
) {
  const rates = modelRequestRates(registeredUsers, costModelAssumptions);
  const modeledPeakRequestsPerSecond =
    rates.avgRequestsPerSecond * modelingAssumptions.peakConcentrationMultiplier;
  const modeledPeakConcurrentExecutions =
    modeledPeakRequestsPerSecond * modelingAssumptions.avgLambdaDurationSeconds;

  const withinSustainedThrottle = modeledPeakRequestsPerSecond <= throttle.throttlingRateLimit;
  const withinBurstThrottle = modeledPeakRequestsPerSecond <= throttle.throttlingBurstLimit;
  const withinConcurrencyCeiling = modeledPeakConcurrentExecutions <= concurrencyCeiling;

  return {
    ...rates,
    modeledPeakRequestsPerSecond,
    modeledPeakConcurrentExecutions,
    configuredThrottlingRateLimit: throttle.throttlingRateLimit,
    configuredThrottlingBurstLimit: throttle.throttlingBurstLimit,
    accountConcurrencyCeiling: concurrencyCeiling,
    withinSustainedThrottle,
    withinBurstThrottle,
    withinConcurrencyCeiling,
    boundsHold: withinSustainedThrottle && withinBurstThrottle && withinConcurrencyCeiling,
  };
}

/** The three registered-user tiers docs/COST_MODEL.md itself already uses. */
export const SYNTHETIC_SCALE_TIERS = [10_000, 50_000, 100_000];

export function evaluateAllScales(options = {}) {
  return SYNTHETIC_SCALE_TIERS.map((n) => evaluateScale(n, options));
}
