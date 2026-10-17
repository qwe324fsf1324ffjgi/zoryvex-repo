# Monthly Cost Model

Ballpark estimates, not guarantees — see `docs/COST_GUARDRAILS.md`'s "before any optional spend" rule and
CLAUDE.md's "never claim completion from a compile/build alone" applied to cost claims too: nothing here is
proven until real CloudWatch/Cost Explorer data exists post-launch. Every unit price below was checked
against current sources 2026-08-18 (see `docs/SOURCES.md`) — re-verify before trusting this table again if
much time has passed, since AWS pricing changes.

## Traffic/MAU assumptions (stated explicitly, not measured)

- "Registered users" = candidates + employers combined, both environments share nothing. TEST data is
  separate and is not counted in these production-scale figures. It is **not** all synthetic, though: the
  TEST table holds real records created by exercising the live TEST environment, including the founder's own
  TEST candidate profile. None of it is production data, and none of it affects the figures below.
- Monthly active users (MAU) assumed at **20% of registered users** — a conservative, unverified guess for
  a proof-first hiring product, not a target or a promise.
- Per MAU per month: ~5 sessions, ~15 authenticated API calls (Lambda + API Gateway), ~3 REQUEST-authorizer
  invocations after the 30-second result cache absorbs the rest, ~10 DynamoDB read-request-units + 3
  write-request-units, ~60 CloudFront requests (page + asset loads across those sessions) and ~7.5 MB of
  CloudFront data transfer, ~2 transactional emails (magic-link sign-in, notifications).
- Evidence storage: ~1 MB average per candidate (mostly links, not large files), scanned once by GuardDuty
  Malware Protection for S3 on upload.
- Bedrock: off by default (`packages/config` feature flag) at every tier below — $0 until a future,
  separately evaluated and cost-capped decision turns it on, per `docs/COST_GUARDRAILS.md`. **Currently
  disabled, re-confirmed 2026-08-23.** This flag is not merely assumed off: the live TEST parameter was found
  set to `aiMatching: true` between 2026-08-18 and 2026-08-23 and was restored to `false` by one authorized
  correction (`docs/DECISIONS.md`, 2026-08-23). Bedrock spend for that window was still **$0** — the explain
  Lambda's log group holds 0 bytes and 0 log streams, so the path was never invoked.

## Fixed cost, present even at zero traffic

**CloudWatch alarms are the dominant idle-floor cost, not usage.** `infrastructure/modules/observability`
and `infrastructure/modules/messaging` define ~20 standard-resolution alarms per environment (API
errors/latency, Lambda errors/throttles/duration ×2 functions, DynamoDB throttles, CloudFront error rate,
auth-denied spike, plus 2 alarms × 4 queues for DLQ depth/message age).

**Projected, once production is applied: 40 alarms total across test + production.** AWS's Always Free tier
covers the first 10; the remaining ~30 bill at $0.10/alarm-month (verified 2026-08-18, see
`docs/SOURCES.md`) — **≈ $3.00/month, constant, regardless of traffic.** This is a real finding from writing
this cost model, not assumed going in — worth knowing before treating "close to zero at zero traffic" as
literal.

**Measured today (2026-08-23): 23 alarms actually exist, all `zoryvex-test`.** Production has never been
applied, so no production alarm exists; the CloudFront error-rate alarm is also deliberately undeployed
(`docs/DECISIONS.md`). On the same $0.10/alarm-month basis, 23 alarms less the 10 free = 13 billable ≈
**$1.30/month** at present, not $3.00. The $3.00 figure is the correct number to plan against, but it
applies only once production is deployed — treat the tier table's "0 users" alarm line as the post-production
projection, not as this month's bill.

Also present at every tier, all effectively $0 at this scale: Terraform state S3 bucket (a few KB), the
GuardDuty detector itself (only Malware Protection for S3's *usage* is billed — see below; enabling the
detector has no separate fixed fee), SNS topic (billed per notification, negligible), budgets/cost-anomaly
monitoring (AWS features, no charge), Route 53 (`$0` — confirmed, see below).

**Domain renewal** is billed annually by **Vercel**, not AWS (`zoryvex.space` is registrar/DNS-only there
per `CLAUDE.md`) — out of scope of the AWS cost tiers below. `docs/MANUAL_ACTIONS.md` records the current
renewal date (2027-07-28); the exact renewal price was not independently re-verified this phase.

## Route 53 confirmation

**No Route 53 hosted-zone charge exists anywhere in this architecture.** No `aws_route53_zone` resource is
created by any module (enforced by `scripts/terraform-policy-check.mjs`) — DNS is entirely Vercel-managed,
per `docs/DNS_RUNBOOK.md`.

## Per-tier AWS cost (eu-west-1, pay-as-you-go — see `docs/adr/0003-cloudfront-pay-as-you-go-no-waf-at-launch.md`)

| Line item                                                                         |   0 users | 10,000 users (MAU 2,000) | 50,000 users (MAU 10,000) | 100,000 users (MAU 20,000) |
| --------------------------------------------------------------------------------- | --------: | -----------------------: | ------------------------: | -------------------------: |
| CloudWatch alarms (fixed)                                                         |     $3.00 |                    $3.00 |                     $3.00 |                      $3.00 |
| Lambda (requests + GB-seconds)                                                    |     $0.00 |                    $0.00 |                     $0.00 |                      $0.00 |
| API Gateway HTTP API                                                              |     $0.00 |                    $0.03 |                     $0.15 |                      $0.30 |
| DynamoDB (on-demand RU/WRU + storage + PITR)                                      |     $0.00 |                    $0.07 |                     $0.30 |                      $0.50 |
| S3 (site + evidence storage)                                                      |     $0.01 |                    $0.24 |                     $1.16 |                      $2.31 |
| CloudFront (requests; data transfer within free tier at every tier below)         |     $0.00 |                    $0.09 |                     $0.45 |                      $0.90 |
| SES (transactional email)                                                         |     $0.00 |                    $0.40 |                     $2.00 |                      $4.00 |
| GuardDuty Malware Protection for S3 (per GB scanned, 1 GB/month free)             |     $0.00 |                    $0.81 |                     $4.41 |                      $8.91 |
| CloudWatch Logs (ingestion, field-allowlisted so per-invocation size stays small) |    ~$0.00 |                    $0.90 |                     $4.50 |                      $9.00 |
| SQS (well within free tier at these volumes)                                      |     $0.00 |                    $0.00 |                     $0.00 |                      $0.00 |
| Cognito                                                                           |       N/A |                      N/A |                       N/A |                        N/A |
| Bedrock (off by default)                                                          |     $0.00 |                    $0.00 |                     $0.00 |                      $0.00 |
| **Total AWS (≈)**                                                                 | **~$3–4** |                **~$5–6** |               **~$16–17** |                **~$29–30** |

`Cognito` is listed as `N/A`, not `$0` folded silently into another line — Cognito is never used
(`docs/adr/0001-no-cognito-passwordless-email-auth.md`); the equivalent session-verification work is the
REQUEST authorizer, already counted inside the Lambda/API Gateway/DynamoDB lines above.

## Biggest cost drivers if this model is wrong

In rough order, if actual traffic/behavior differs materially from the assumptions above:

1. **CloudWatch Logs ingestion** — scales directly with Lambda invocation count and per-invocation log
   size; a verbose/unstructured log line (exactly what `docs/PRIVACY_AND_RETENTION.md`'s field-allowlist
   rule exists to prevent) would multiply this line the fastest.
2. **GuardDuty Malware Protection for S3** — scales with total bytes uploaded, not request count; a
   candidate uploading large files instead of links would move this line disproportionately.
3. **SES** — scales linearly with email volume; a notification-heavy feature added later (e.g. per-match
   employer emails) would move this line before anything else on this list.

None of these are provisioned/reserved capacity — every one is genuinely pay-per-use, so a spike shows up
as a cost-anomaly alert (already configured, see `docs/MANUAL_ACTIONS.md`) before it becomes a surprise
bill, and `docs/COST_GUARDRAILS.md`'s emergency script (see below) can cut off the expensive paths without
a deploy.

## Emergency cost lockdown

`scripts/emergency-cost-lockdown.mjs` (**exercised for real against TEST in Phase 6**, correcting an earlier
"reviewed but unexercised" note here: the lockdown was run, `/health` was confirmed returning `503`, then
`--restore` was run and `/health` confirmed `200` again, with no data touched — see
`docs/DEPLOYMENT_STATUS.md`. Never run against production.) sets
named Lambda functions' reserved concurrency to `0` (rejects new invocations immediately, without deleting
any code or data) and flips the `aiMatching`/contact-unlock-adjacent `packages/config` feature flags off via
Parameter Store, without a full `terraform apply` and without touching DynamoDB/S3 data.
