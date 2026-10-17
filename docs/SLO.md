# Service level objectives

Phase 7 slice 10. Written before the probe that measures it, so the thresholds are a
commitment rather than a description of whatever happened to be observed.

**Scope, stated narrowly on purpose.** This is the bounded Slice 10 acceptance objective for
one route, `GET /health`, in the TEST environment. It is not a claim that every platform route
has been load-tested, and nothing here should be cited as one. The other routes have unit and
contract coverage and a live journey walked in Slice 11; none of them has a latency objective,
and inventing one from a health-check measurement would be worse than having none.

Scope is the TEST environment's HTTP API. Production has no SLO and will not get one by
copying this file: production traffic, cold-start profile and cost envelope are all
different, and an SLO inherited rather than chosen is not one.

## Why these exist at all

Slice 10 asks whether reserved concurrency and API throttling genuinely bound runaway cost,
and whether the environment meets a stated target under load. Neither question can be
answered without a number written down first. The load model
(`scripts/lib/load-quota-model.mjs`) reported for several phases that no SLO existed in this
repository and declined to invent one; this closes that gap.

## The numbers

Measured by `node scripts/load-quota-check.mjs --live-probe <baseUrl>` against `GET /health`:
25 requests, at most 5 in flight, 6,000ms per-request timeout, no authentication.

A request that times out has not produced a slow response. It has produced no response, so it
is counted against completion, recorded separately in the evidence, and never folded into the
429 or 5xx counts. Reading a timeout as a throttle would turn the environment failing to answer
into evidence that a guardrail worked.

| Objective                | Threshold                                                                                                          | Why this number                                                                                                                                                                |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Successful completion    | 100% of requests receive an HTTP response                                                                          | A request that gets no response at all is a failure of the environment, not of latency. There is no acceptable rate of this.                                                   |
| Error rate               | 100% of responses are HTTP 200, and zero are 5xx                                                                   | `/health` takes no input and depends on nothing that can legitimately fail. Anything other than 200 from it is a real fault.                                                   |
| Throttling within bounds | zero HTTP 429, when offered load stays at or below the per-function reservation and the API Gateway sustained rate | Throttling below the configured guardrail means the guardrail is set wrong. Throttling above it is the guardrail working, and is recorded separately rather than counted here. |
| Latency, median          | p50 at or below 800ms                                                                                              | Warm invocations of these handlers do a small number of single-digit-millisecond DynamoDB calls. 800ms is generous for that and still catches a real regression.               |
| Latency, tail            | p95 at or below 2500ms                                                                                             | Absorbs one cold start inside a small sample without excusing a broadly slow environment.                                                                                      |
| Latency, worst case      | max at or below 5000ms                                                                                             | A single cold start on a bundled Node handler should not approach this. Anything beyond it is a fault rather than a cold start.                                                |

## Three outcomes, not two

A run reports one of three things, and the third exists because the first real attempt got it
wrong. That run reported a failed SLO for a service that was returning 200: all 25 of its
requests died in DNS resolution and the probe had no way to say so, because a request that never
left the machine looked exactly like a request the environment refused to answer.

| Outcome      | Exit | Means                                                                                                                                            |
| ------------ | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `PASS`       | 0    | A genuine measurement, and every threshold above held.                                                                                           |
| `FAIL`       | 1    | Requests reached the measurement stage and the service genuinely breached a threshold.                                                           |
| `UNMEASURED` | 2    | DNS or pre-measurement TCP/TLS reachability stopped the run before any application request was sent. Nothing was measured, so nothing is judged. |

`UNMEASURED` records `verdict.passed` as `null` rather than `false`, reports latency as `null`
rather than a number or `NaN`, and sends zero application requests. It is not an SLO failure and
must not be reported as one: the service was not asked anything.

The reverse matters just as much. Once measurement has begun, a timeout, a connection error or a
missing HTTP response counts against the completion objective like any other failure to answer.
`UNMEASURED` covers being unable to reach the environment, never the environment failing once
reached.

Reachability is checked with DNS and a TCP/TLS connection only. No request is sent to `/health`
during that check, because warming the function would make the first measured request faster
than it honestly is and improve the very latency figure being judged. The addresses resolved
there are reused for all 25 measured requests, so the measurement performs no further DNS
lookup, while the Host header and TLS server name still carry the real hostname.

Each attempt writes to a new evidence filename. An existing file is never overwritten, because a
replaced result is a failed run quietly disappearing.

A threshold that is missed is missed. A run that breaches any row above is a failed run and
is reported as one; it is not re-described as a pass because the others held, and the
thresholds are not adjusted afterwards to fit a result.

## What the probe deliberately does not do

- It does not generate the 10k/50k/100k user load itself. Those tiers are modelled in
  `scripts/lib/load-quota-model.mjs` from `docs/COST_MODEL.md`'s own assumptions, and the
  model puts the whole platform's peak at well under one concurrent execution. Firing real
  traffic at that scale would measure AWS, not Zoryvex, and would cost money to prove
  something the arithmetic already shows.
- It does not target any third party. Only this environment's own `/health`.
- It does not write. `GET /health` has no side effects, so the probe is safe to repeat and
  leaves nothing to clean up.

## Guardrail demonstration

The probe can also fire a burst deliberately above the per-function reservation. That run is
expected to be throttled and is recorded as evidence that the cap is real, not as an SLO
result. Confusing the two would turn a working guardrail into a reported failure.

## Configured guardrails these objectives assume

- Per-function reserved concurrency in TEST: `var.lambda_reserved_concurrency`, currently 5.
  Two states, kept apart because they are different numbers and one of them is not yet real:

  | State                            | Functions                                      | Reserved | Unreserved | Above the 100 floor |
  | -------------------------------- | ---------------------------------------------- | -------- | ---------- | ------------------- |
  | Currently deployed               | 37 at 5                                        | 185      | 815        | yes                 |
  | Eventual committed configuration | 44 at 5, plus `verification_reminder_job` at 1 | 221      | 779        | yes                 |

  185 is what an operation today produces. It is not the total the committed configuration
  reaches, and describing it as such would understate the eventual reservation by 36.
  `verification_reminder_job` differs because it sets no reservation in the environment file
  and inherits the scheduled-job module's own default of 1.

- API Gateway: 25 requests/second sustained, 50 burst
  (`infrastructure/modules/api-gateway` defaults, unoverridden in TEST).

Both are asserted by `scripts/lib/load-quota-model.test.mjs`, so a change to either fails a
test rather than silently invalidating this document.
