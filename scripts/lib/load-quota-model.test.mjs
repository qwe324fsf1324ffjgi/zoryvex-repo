import { describe, expect, it } from 'vitest';
import {
  ACCOUNT_LAMBDA_CONCURRENCY_CEILING,
  ACCOUNT_MINIMUM_UNRESERVED,
  CONFIGURED_API_GATEWAY_THROTTLE,
  COST_MODEL_ASSUMPTIONS,
  SYNTHETIC_SCALE_TIERS,
  evaluateAllScales,
  evaluateScale,
  modelRequestRates,
} from './load-quota-model.mjs';

describe('modelRequestRates', () => {
  it("derives MAU/API-call/authorizer-invocation counts from docs/COST_MODEL.md's own stated assumptions", () => {
    const result = modelRequestRates(10_000);
    expect(result.mau).toBe(2_000);
    expect(result.apiCallsPerMonth).toBe(30_000);
    expect(result.authorizerInvocationsPerMonth).toBe(6_000);
    expect(result.totalRequestsPerMonth).toBe(36_000);
  });

  it('scales linearly with registered users', () => {
    const at10k = modelRequestRates(10_000);
    const at100k = modelRequestRates(100_000);
    expect(at100k.totalRequestsPerMonth).toBe(at10k.totalRequestsPerMonth * 10);
  });

  it('rejects a negative or non-numeric registered-user count', () => {
    expect(() => modelRequestRates(-1)).toThrow();
    expect(() => modelRequestRates(NaN)).toThrow();
  });
});

describe('SYNTHETIC_SCALE_TIERS', () => {
  it('is exactly the three registered-user tiers docs/COST_MODEL.md itself uses', () => {
    expect(SYNTHETIC_SCALE_TIERS).toEqual([10_000, 50_000, 100_000]);
  });
});

describe('evaluateScale — real configured throttle (25/s sustained, 50 burst) and account ceiling (1000)', () => {
  it('confirms the currently-configured values this model checks against, so a future config change is caught by this test failing to compile the same numbers, not silently drifting', () => {
    expect(CONFIGURED_API_GATEWAY_THROTTLE).toEqual({
      throttlingRateLimit: 25,
      throttlingBurstLimit: 50,
    });
    // Was 10 for the whole of Phases 6 and 7, which was a new-account
    // restriction rather than the AWS default. Confirmed live at 1,000 on
    // 2026-08-28 via `aws lambda get-account-settings` and Service Quotas
    // (lambda L-B99A9384) in eu-west-1. This test failing is how a future
    // change to that number gets noticed instead of being assumed.
    expect(ACCOUNT_LAMBDA_CONCURRENCY_CEILING).toBe(1000);
    expect(ACCOUNT_MINIMUM_UNRESERVED).toBe(100);
  });

  it('leaves the reservation the TEST environment asks for comfortably inside the pool', () => {
    // The arithmetic that made a reservation impossible before, restated
    // against the real numbers so a change to either side of it fails here
    // rather than at apply time, which is how the original attempt at
    // reserved_concurrent_executions = 20 was discovered to be impossible.
    const functionsInTest = 44;
    const perFunction = 5;
    const reserved = functionsInTest * perFunction;
    const unreservedRemaining = ACCOUNT_LAMBDA_CONCURRENCY_CEILING - reserved;

    expect(reserved).toBe(220);
    expect(unreservedRemaining).toBe(780);
    expect(unreservedRemaining).toBeGreaterThanOrEqual(ACCOUNT_MINIMUM_UNRESERVED);

    // The module's own default of 20 would now fit, which is worth pinning
    // because an earlier draft of this test asserted it would not and was
    // wrong. It fits with almost nothing to spare: 880 reserved leaves 120
    // unreserved against a floor of 100. TEST uses 5 because the modelled
    // peak for the entire platform is 0.42, so 20 buys nothing real and
    // spends the buffer that absorbs any function added later.
    const maxReservable = ACCOUNT_LAMBDA_CONCURRENCY_CEILING - ACCOUNT_MINIMUM_UNRESERVED;
    expect(functionsInTest * 20).toBe(880);
    expect(functionsInTest * 20).toBeLessThanOrEqual(maxReservable);
    expect(functionsInTest * 21).toBeGreaterThan(maxReservable);
  });

  it("10k registered users stays within throttle and the account concurrency ceiling under this project's own documented MAU assumptions", () => {
    const result = evaluateScale(10_000);
    expect(result.boundsHold).toBe(true);
    expect(result.modeledPeakRequestsPerSecond).toBeLessThan(1);
    expect(result.modeledPeakConcurrentExecutions).toBeLessThan(1);
  });

  it('50k registered users stays within throttle and the account concurrency ceiling', () => {
    const result = evaluateScale(50_000);
    expect(result.boundsHold).toBe(true);
  });

  it('100k registered users stays within throttle and the account concurrency ceiling', () => {
    const result = evaluateScale(100_000);
    expect(result.boundsHold).toBe(true);
    // Real headroom check, not just a pass/fail: even at the largest
    // synthetic tier, modeled peak concurrency stays well under half the
    // account's hard 10-execution ceiling — quantifies the margin, not just
    // asserts it exists.
    expect(result.modeledPeakConcurrentExecutions).toBeLessThan(
      ACCOUNT_LAMBDA_CONCURRENCY_CEILING / 2,
    );
  });

  it("evaluateAllScales covers exactly the three synthetic tiers, all bounds holding at this project's documented usage assumptions", () => {
    const results = evaluateAllScales();
    expect(results).toHaveLength(3);
    expect(results.every((r) => r.boundsHold)).toBe(true);
  });

  it('a hypothetically much larger registered-user count would eventually exceed the configured throttle, proving this check is not a tautology', () => {
    // 50,000,000 registered users is far outside any tier this project's own
    // plan asks for — used only to prove the model can fail, not to assert
    // anything about this project's real trajectory.
    const result = evaluateScale(50_000_000);
    expect(result.boundsHold).toBe(false);
  });
});

describe('COST_MODEL_ASSUMPTIONS', () => {
  it('matches the exact per-MAU-per-month figures stated in docs/COST_MODEL.md', () => {
    expect(COST_MODEL_ASSUMPTIONS).toEqual({
      mauShareOfRegistered: 0.2,
      sessionsPerMauPerMonth: 5,
      authenticatedApiCallsPerMauPerMonth: 15,
      authorizerInvocationsPerMauPerMonth: 3,
    });
  });
});
