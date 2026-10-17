# Failure matrix

Every realistic way Zoryvex can fail, what the user sees, what the system
does, and how to test it.

Each row is marked by how well the behaviour is established:

- **VERIFIED** — observed against a live environment
- **CODE-READ** — traced through the implementation, not exercised
- **NOT VERIFIED** — could not be established

---

## Payments

| Failure | User sees | System does | Recovery | How to test | Risk |
| --- | --- | --- | --- | --- | --- |
| Card declined | Paystack's own message | Attempt stays `failed`; a **fresh reference** is issued on retry | Retry works | Test card on test env | Low — **VERIFIED** (3 live declines) |
| Abandoned checkout | Nothing; they closed the tab | Reconciliation ages it out after 30 min | Automatic | Open checkout, close it | Low — **VERIFIED** (8 live) |
| Double-click checkout | One checkout | Idempotency key returns the same attempt; browser also latches | None needed | Rapid double click | Low — **CODE-READ** + unit tests |
| Duplicate webhook | Nothing | Dedupe by SHA-256 of raw body; second returns `duplicate: true` | None needed | Send same signed event twice | Low — **VERIFIED in production** |
| Delayed webhook | "Checking again automatically" | Reconciliation verifies with Paystack hourly | Automatic ≤1 hr | Withhold webhook, wait | Low — **VERIFIED** (55 runs/14d) |
| Out-of-order webhook | Nothing | `isFresherThan` compares event `created_at`, not arrival | None needed | Replay older event after newer | Low — **CODE-READ** |
| Forged webhook | n/a | `401`, nothing written | n/a | POST with bad signature | Low — **VERIFIED in production** |
| Webhook never configured | Payment succeeds, access delayed | Reconciliation still grants ≤1 hr | Automatic | Unset dashboard URL | Medium — URL **VERIFIED** present |
| Paystack outage | Checkout fails to open | Error surfaced; nothing charged | Retry later | Cannot safely simulate | Medium — **NOT VERIFIED** |
| **Payment succeeds, entitlement fails** | Paid, no access | Webhook throws → Paystack retries (3 min ×4, then hourly ×72h); dedupe marker removed so retry re-attempts | Automatic | Force a downstream failure | **High — NOT VERIFIED in production** |
| Amount/currency mismatch | Refused | Plan price compared against live Paystack plan before checkout | n/a | Alter a plan amount in test | Low — **VERIFIED** (all 6 match) |
| Frontend says success, payment did not | Should never happen | Entitlement comes only from webhook or reconciliation. The browser never decides | n/a | Fake a client callback | Low — **CODE-READ** |

> **The one that matters most.** No production payment has ever succeeded, so
> the entire success path — webhook → entitlement → delivery — is
> **NOT VERIFIED in production**. It is verified in test.

---

## Authentication and sessions

| Failure | User sees | System does | Recovery | Risk |
| --- | --- | --- | --- | --- |
| Wrong sign-in code | Generic failure | Same response whether or not the account exists | Request another | Low — **CODE-READ** |
| Expired code | "Code has expired" | Single-use, conditional consume | Request another | Low — **CODE-READ** |
| Replayed code | Failure | Conditional write means the second use cannot succeed | Request another | Low — **CODE-READ** |
| Too many codes | Rate-limited | 5/email and 20/IP per 15 min | Wait | Low — **CODE-READ** |
| Expired session | Redirected to sign in | Idle and absolute expiry checked in code, not only TTL | Sign in again | Low — **CODE-READ** |
| Forged session cookie | `401` | Opaque hashed id looked up server-side | n/a | Low — **VERIFIED** (18/18 routes `401`) |
| Signed out elsewhere | `401` on next call | Sign-out revokes the **server** record | Sign in again | Low — **CODE-READ** |
| Email never arrives | Stuck on the code screen | SES accepted or it did not; no in-app retry loop | Request another | Medium — **NOT VERIFIED** in production |

---

## Authorization

| Attempt | Result | Risk |
| --- | --- | --- |
| No session on a protected route | `401` | Low — **VERIFIED**, 18/18 |
| Candidate reads another candidate | `404`/`403` | Low — **CODE-READ**, id comes from session |
| Employer reads another employer's role | `404` | Low — **CODE-READ** + tests |
| Candidate writes the employer's interest | `403` | Low — test-**VERIFIED** |
| Employer answers on the candidate route | `403` | Low — test-**VERIFIED** |
| Unpaid employer reads source address | Withheld, identity stripped from prose | Low — test-**VERIFIED**, proven by mutation |
| Unpaid employer expresses interest | `403`, nothing written | Low — test-**VERIFIED** |
| Guessed role id | `404` before any entitlement check | Low — **CODE-READ**; order prevents existence disclosure |

---

## Infrastructure

| Failure | User sees | System does | Recovery | Risk |
| --- | --- | --- | --- | --- |
| Lambda timeout | Error, or a slow page | Verify route has 20s for three sequential GitHub calls | Retry | Low — **CODE-READ** |
| Lambda concurrency exhausted | `429` | All 55 functions have reserved concurrency | Automatic | Low — **VERIFIED**, 0 unreserved |
| DynamoDB throttling | Slow or failing | On-demand billing scales | Automatic | Low — **CODE-READ** |
| API Gateway 5xx | Generic failure | Logged; alarms exist | Retry | Medium — **NOT VERIFIED** |
| CloudFront cache serving old build | Stale page | TTL expiry, or invalidation | Invalidate | Low — **CODE-READ** |
| Certificate expiry | Browser warning | ACM auto-renews | Automatic | Low — **VERIFIED**, all ISSUED to 2027-03 |
| DNS failure | Site unreachable | Nothing — external | Fix at registrar | Medium — **VERIFIED** as a real local failure mode |
| S3 bucket public by accident | Data exposure | All 4 public-access blocks on both buckets | n/a | Low — **VERIFIED**, direct fetch `403` |
| Terraform drift | Nothing visible | Nothing detects it automatically | `plan -detailed-exitcode` | Medium — **VERIFIED** currently `0` |
| Stale state lock | Deploy hangs | Native S3 lock | Inspect, then clear | Medium — **VERIFIED** none present |

---

## External integrations

| Failure | User sees | System does | Risk |
| --- | --- | --- | --- |
| GitHub rate limit | "GitHub unavailable" — **never** a failed check | 403/429 → `UpstreamUnavailableError` | **Medium — 60/hr measured, token empty** |
| GitHub API shape change | Verification fails | Opt-in live suite catches it | Medium — **VERIFIED** 6/6 today |
| Gist deleted mid-verify | "Gist could not be found" | Fails closed | Low — **CODE-READ** |
| Repo made private after verify | Stays verified until re-checked | No re-check job exists | **Medium — NOT VERIFIED** |
| Credly unavailable | Verification fails | Same upstream error path | Medium — **NOT VERIFIED** |
| SES rejects a send | Nothing — notices are non-fatal | Audit row written | Medium — **CODE-READ** |
| SES reputation damage | Emails stop arriving | Account-level suspension above 5% bounce | **High** — why tests use the mailbox simulator |

---

## Notifications

| Failure | User sees | System does | Risk |
| --- | --- | --- | --- |
| Interest notice fails | Nothing | Interest still recorded; `employer_interest_notice_failed` audit row | Medium — **CODE-READ** |
| Duplicate interest notice | One email | Transition check + 24h rate limit | Low — test-**VERIFIED** |
| Candidate opted out mid-flight | No email | Discovery opt-in re-read at send time | Low — test-**VERIFIED** |
| Candidate never opens email | Nothing lost | Role stays on Matches permanently | Low — **CODE-READ** |
| `verificationReminders: true` with no function | Nothing | Flag on, no Lambda, no schedule in production | **Medium — VERIFIED as a real gap** |

---

## Frontend

| Failure | User sees | System does | Risk |
| --- | --- | --- | --- |
| Refresh mid-form | Unsaved fields lost | Autosave on some screens | Low — **CODE-READ** |
| Double-click a button | One request | In-flight latch | Low — test-**VERIFIED** |
| API 500 on a panel | "Could not load… try again" | Distinguished from "nothing to show" | Low — **CODE-READ** |
| Billing call fails | **Was** "needs a subscription" to paying users | Now silent until known | Low — fixed 2026-09-14 |
| Demo build shipped | Pages 200, nobody signs in | Deploy asserts against built pages | **High** — happened 2026-09-11, now guarded |
| Mobile horizontal overflow | Sideways scroll | Measured in CI at 375px | Low — **VERIFIED** on live production |

---

## Deployment

| Failure | Sees | Recovery | Risk |
| --- | --- | --- | --- |
| Deploy silently no-ops | Old version still live | Check `/health` version, never the exit code | **High** — has happened here |
| Terraform applies, bundle stale | New infra, old code | Smoke test compares deployed commit | Medium — **VERIFIED** guard exists |
| DNS dies mid-apply | Partial apply | Fresh plan on a stable link. **Never retry blind** | **High — VERIFIED**, two aborted applies |
| Rollback fails | Still broken | Manual reviewed plan | **High — rollback never exercised** |
| Missing env var | Silent misbehaviour | `requireEnv` throws; non-fatal callers swallow it | **Medium — VERIFIED**, this hid a broken notice |
| Missing IAM grant | Silent failure | Same swallowing problem | Medium — now guarded by a Terraform-reading test |

---

## The five worth acting on

Ranked by expected harm, not by how easy they are to fix.

1. **Payment success path unproven in production.** One real ₦95,000 purchase
   settles it.
2. **Rollback never exercised.** The first real use will be during an
   incident, which is the worst time to discover a flaw.
3. **GitHub token empty.** 60 requests/hour platform-wide, ~20 verifications.
   Not biting yet; a wall when candidates arrive.
4. **`verificationReminders: true` with no function.** Inert now. Deploying
   that function would immediately start emailing real candidates with no
   deliberate decision.
5. **No re-check for a repository that goes private after verification.** A
   proof can outlive its own truth.
