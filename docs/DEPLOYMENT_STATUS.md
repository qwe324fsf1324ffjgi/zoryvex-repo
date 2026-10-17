# Deployment Status

Current status: **TEST ENVIRONMENT DEPLOYED, DEPLOYED-THROUGH-CI, AND UNDER LIVE PHASE 7 ACCEPTANCE**
(Phase 7, Slice 11 in progress). Production remains **NOT DEPLOYED** — no production AWS application
resource, DNS record, or Paystack live object has been created; production stays maintenance/disabled this
phase per Prompt 6.

As of Phase 7 Slice 9, every test-environment deploy runs through the real CI/CD pipeline
(`.github/workflows/ci.yml`'s `Deploy (test)` job), not a local ad-hoc apply: GitHub Actions OIDC assumes
`arn:aws:iam::<AWS_ACCOUNT_ID>:role/zoryvex-test-deploy` with zero static AWS keys, runs a fresh
`terraform plan`/`apply`, and smoke-tests `/health` before the run is considered green. Proven repeatedly for
real, most recently for PR #41 (run `32465686860`).

As of Phase 7 Slice 11, the real backend has been exercised live against the TEST environment for the first
time (not just deployed) — see the "Phase 7 Slice 11 live acceptance" table below.

## How to read this file (evidence taxonomy)

Every status in this file belongs to exactly one of six buckets. A merged PR, a green CI run, or a PR
author's own description is **never** on its own evidence of a passed gate.

| Bucket | Means |
|---|---|
| **Implemented** | Code or infrastructure exists. Not deployed, not exercised. |
| **Deployed to TEST** | Live in AWS. Not yet exercised or verified. |
| **Independently verified live** | A real acceptance test passed, with the evidence cited alongside it. |
| **Attempted, failed** | A real run happened and failed. Evidence cited. |
| **Unconfirmed — evidence missing** | A claim exists, but nothing independent supports it. |
| **Not yet tested** | Nothing has been attempted. |

This file was last reconciled against live, read-only evidence on **2026-08-23**, at `main` commit
`9c64f59` (PR #61). Twenty PRs (**#42 through #61**) merged between 2026-08-21 and 2026-08-22; merging them
is recorded as *Implemented*, and only the specific gates listed below carry anything stronger.

As of Phase 4, `apps/web` is the **complete local product** — public marketing site, authenticated candidate
app, authenticated employer app, and a founder/admin console — running entirely against
`packages/local-adapters`' deterministic, `localStorage`-backed fake implementations of every adapter
interface, seeded with clearly-labeled fictional test data. `apps/web-safe-shell` is a separate, minimal
build proven to contain none of the Kit/pricing/checkout/founder-photo/contact-link content.

As of Phase 6, the **real AWS test environment** is applied end-to-end from `infrastructure/envs/test`, with
DNS live at `test.zoryvex.space` / `test-api.zoryvex.space` via Vercel (nameservers/registrar only — no
Route 53, no Vercel hosting project). Every layer below is stated from a passed acceptance test, not from a
successful `terraform apply` or build alone.

| Layer | Status |
|---|---|
| Frontend (S3 + CloudFront) | **Independently verified live.** `test.zoryvex.space` serves the real `apps/web` static export over valid TLS; CloudFront OAC, security headers, and short-TTL HTML cache policy all live. Confirmed against the deployed artifact 2026-08-23, not against a build: `Last-Modified: Sat, 22 Aug 2026 19:24:28 GMT` falls inside the `Deploy (test)` window (19:17:14–19:26:46) of CI run `32592992725`, proving the S3 sync now really happens (PR #59); and the shipped bundle `/_next/static/chunks/3bvouaq07d0qu.js` contains the real API host with a matching `connect-src` CSP, proving the site builds in real-API mode rather than local-fake mode (PR #60). |
| API (API Gateway + Lambda) | **Deployed.** `test-api.zoryvex.space/health` returns real `200 {"status":"ok",...}` over valid TLS, through the full custom-domain → API Gateway `$default` stage → Lambda path. |
| Auth (REQUEST authorizer, no Cognito) | **Deployed and live-acceptance-tested.** Real passwordless magic-link flow proven end to end against TEST for the first time this phase: `POST /auth/request-code` → real SES email received → `POST /auth/consume-code` (fresh, format-validated token) → `200` with a real session cookie + CSRF token. Reaching this required finding and fixing three runtime defects discovered in TEST (found by running the deployed TEST environment, not in code review — production has never been deployed or exercised): a Lambda ESM bundling crash, a missing SES configuration-set IAM grant, and a DynamoDB reserved-keyword bug in token consumption (PR #38/#40/#41; PR #39 added the exception logging that made the latter two diagnosable at all). The TEST **frontend** `/auth/callback` page, previously recorded here as returning 404, now exists (PR #45, honest success state added by PR #47) and **`GET https://test.zoryvex.space/auth/callback` returns `200`, verified live 2026-08-23** — that 404 record is stale and is corrected here. The full browser candidate journey is now separately verified; see the Slice 11 table. |
| Data (DynamoDB) | **Deployed.** `zoryvex-test-core` table `ACTIVE`, correct key schema (PK/SK) + all 3 GSIs. **Item count corrected 2026-08-23: 145 items, not 0** (the "0 items — no real users yet" reading dated from Phase 6, before any live exercise). These are accumulated TEST-environment records produced by real use of the TEST environment: 53 rate-limit windows, 36 auth tokens, 25 account items, 22 sessions, 5 audit events, and 4 candidate items (3 profiles + 1 evidence claim). Not all of it is synthetic — `CANDIDATE#8364549a…` is the founder's own real TEST candidate profile from the 2026-08-22 browser journey, not a fixture. **None of it is production data**; production has never been deployed. See the "still open" note below the Slice 11 table for the unreconciled-residue item, which covers this same 145 and should not be counted twice. Backup/restore rehearsed for real this phase: on-demand backup created, restored to a temp table, restored table verified `ACTIVE` with matching key schema/GSIs, both temp table and backup deleted afterward. Deletion protection/PITR deliberately off in test (on by design in production, not yet applied). |
| Evidence storage (S3) | **Deployed.** Public access fully blocked (all 4 flags), `BucketOwnerEnforced` ownership, AES256 default encryption, GuardDuty Malware Protection for S3 active. CORS verified: `PUT` only, restricted to exactly `https://test.zoryvex.space`. |
| Messaging (SQS + DLQ) | **Deployed and functionally proven.** 4 queues + 4 DLQs exist; redrive policy confirmed (`maxReceiveCount: 5`); a real message was sent, received, and deleted end-to-end on the webhooks queue. |
| Observability (CloudWatch + SNS) | **Deployed and functionally proven.** Alarms live for API/Lambda/DynamoDB/SES/auth-failure; SNS → founder-email subscription confirmed via `aws cloudwatch set-alarm-state` triggering a real received email. CloudFront error-rate alarm deliberately not deployed — reproduced `aws_cloudwatch_metric_alarm` provider region limitation, see `docs/DECISIONS.md`/`docs/RISK_REGISTER.md`. |
| Email (SES) | **Deployed, production access approved.** Domain identity `zoryvex.space` verified (DKIM + MAIL FROM + CAA all live), **production access enabled** (out of sandbox). A real test email was sent through the `zoryvex-space` configuration set to the founder's personal Gmail and confirmed received. |
| Secrets (Parameter Store) | **Deployed.** `/zoryvex/test/paystack/secret-key` created as Standard SecureString via Terraform with an unusable placeholder (`lifecycle.ignore_changes = [value]`); founder replaced it manually in the Console (version 1→2, confirmed via metadata only, value never decrypted/echoed); a follow-up `terraform plan` confirmed no drift. |
| Emergency cost lockdown | **Rehearsed for real.** `scripts/emergency-cost-lockdown.mjs` run against test: reserved concurrency set to 0 on `authorizer`/`health` (confirmed `/health` returned `503`), then `--restore` run and feature flags reset (confirmed `/health` returned `200` again). No data was touched at any point. |
| DNS (zoryvex.space via Vercel) | **Live for test only.** `test`/`test-api` CNAMEs, ACM validation CNAMEs, SES DKIM/MAIL-FROM/SPF/DMARC, and 4 Amazon CAA records all entered in Vercel and verified via two independent DNS-over-HTTPS resolvers plus a real isolated-browser check. Production DNS untouched. |
| Paystack live checkout | Not created; still local-adapter-simulated only. `PAYSTACK LIVE: FOUNDER-CONFIRMED ACTIVE` (account-level) remains a founder-supplied status, not independently re-verified this phase. |
| Terraform state (S3 backend) | **Deployed.** `infrastructure/envs/bootstrap` applied (state bucket only — versioning, AES256 encryption, public access blocked, S3-native locking proven via a real lock/release cycle). |
| Certificate/SES foundation | **Deployed.** `infrastructure/envs/foundation` applied — 2 ACM certs (test CloudFront + test API, both `ISSUED` after a CAA-driven replace-and-reissue) + the SES domain identity. |
| CI/CD (GitHub Actions) | **Independently verified live (Phase 7 Slice 9)** — the pipeline has performed real deploys repeatedly, which is why this row carries a bucket stronger than *Implemented*. GitHub Actions OIDC provider + `zoryvex-test-deploy` role applied and in real use; `.github/workflows/ci.yml`'s `Deploy (test)` job assumes the role via `id-token: write` (zero static keys), runs `scripts/deploy.mjs --env test --confirm test --apply`, and smoke-tests `/health`. Correctly `skipping` on PR branches, auto-triggered on every push to `main`; every deploy this session (PRs #37-#41) ran through this real pipeline, not a local ad-hoc apply. |
| Deployment/rollback tooling | **Independently verified live for the deploy path; `rollback.mjs` is *Not yet tested* (Phase 7 Slice 9).** `scripts/deploy.mjs --env test --confirm test --apply` is the exact command CI runs on every push to `main`; it always generates a fresh plan before applying (confirmed by source read), so it cannot be used to apply a specific pre-reviewed local plan file — local applies during this phase used `terraform apply <pinned-plan-path>` directly instead. `rollback.mjs`'s automatic-rollback-on-smoke-failure path has not yet been triggered for real (every deploy this phase passed its smoke test). |
| Launch mode selected | `null` — see `.zoryvex/state.json` `selectedLaunchMode` |

## Phase 7 Slice 11 live acceptance (real TEST environment, not build/compile alone)

| Capability | Status |
|---|---|
| Backend magic-link auth round trip | **PASSED.** Real `request-code` → real SES email → real `consume-code` → `200` with session cookie + CSRF token, verified via a purpose-built, security-reviewed local helper that never exposes the token/cookie/CSRF value to the assistant (SecureString entry, format pre-validation, no shell-history/CLI-argument exposure). |
| Evidence upload/download/integrity | **PASSED.** One synthetic, non-sensitive text file: presigned-POST upload → GuardDuty malware scan → clean/downloadable transition (1 of 6 max bounded checks) → authorized presigned-GET download → SHA-256 byte-for-byte match. The synthetic S3 object and its DynamoDB `EvidenceFile` record were deterministically deleted afterward; zero residual confirmed directly via AWS CLI. |
| Live TEST candidate journey (sign-in, AWS cloud onboarding, profile load, profile save) | **Independently verified live.** Exercised by the founder in a real browser on `test.zoryvex.space`, 2026-08-22. Corroborated independently by read-only DynamoDB evidence: candidate profile `8364549a…` carries `updatedAt 2026-08-22T19:36:14.113Z`, ten minutes after that day's final deploy completed and after the CORS fix went live, so a real save reached the real table. |
| Four live-use defects (PR #57, #59, #60, #61) | **Independently verified live — CLOSED, not open.** CSRF header no longer attached to GETs (#57); deploy now syncs the built site to S3 (#59); the deploy build sets the real API base URL, fixing the local-fake regression #59 introduced (#60); API Gateway CORS allow-lists `x-zoryvex-csrf` plus `PATCH`/`DELETE` (#61). Evidence for #59/#60 in the Frontend row above; for #61, a real `OPTIONS` preflight to `test-api.zoryvex.space/candidates/me` returned `204` with `access-control-allow-methods: DELETE,GET,OPTIONS,PATCH,POST` and `access-control-allow-headers: authorization,content-type,x-zoryvex-csrf` on 2026-08-23. |
| GSI1 index permission fix (PR #43/#44) | **Deployed to TEST, independently verified.** Read from deployed IAM, not from Terraform source: `get-role-policy` on both `zoryvex-test-matches-recompute-exec` and `zoryvex-test-privacy-deletion-worker-exec` returns a `ScopedTableAccess` statement whose `Resource` includes the GSI1 index ARN beside the base table ARN. CloudWatch corroborates the before/after: `AccessDeniedException` on `dynamodb:Query` against `/index/GSI1` at 2026-08-21 13:13:33 UTC, then a clean error-free invocation at 14:08:30 UTC. **This certifies the permission only — not that matching or deletion works.** |
| Deterministic matching | **Unconfirmed — evidence missing.** Not "not yet run": an attempt on 2026-08-21 failed with the real `AccessDenied` above, PR #44 fixed the grant, and one post-fix invocation at 14:08:30 UTC logged no error — but left **no `Match` record**, so it proves nothing. Verified 2026-08-23: zero `MATCH#` items in `zoryvex-test-core`, and the matcher's log group holds only two streams, both from 2026-08-21. |
| Matching test fixtures | **Gone — recorded as fact.** PR #44 stated the synthetic role/candidate/evidence set "remains valid and preserved". It does not. Filtered scans on 2026-08-23 return **zero** `ROLE#`, **zero** `EMPLOYER#`, and **zero** `MATCH#` items; only 4 `CANDIDATE#` items survive (3 profiles, 1 evidence claim), and `GetItem` shows **all three candidates have `discoveryOptIn: false`**, with GSI1 returning no discovery-opted candidate on any of the three launch tracks. A retest must rebuild isolated synthetic fixtures first, and an empty result must be treated as a FAIL, never a pass. |
| Export/deletion | **Attempted, failed — not yet retested.** A real deletion run before the permission fix failed with `AccessDeniedException` on `dynamodb:Query` against GSI1, retried to `maxReceiveCount: 5`, and dead-lettered; because the failing query came after file deletion in the worker's sequence, the synthetic candidate's evidence record was deleted while its profile, account, and session survived. The grant is now confirmed deployed, but **no successful deletion run has happened since**, and export has never been exercised against live TEST at all. |
| EICAR fail-closed rejection | **Unconfirmed — evidence missing.** PR #42's body asserts a live pass (`GuardDutyMalwareScanStatus=THREATS_FOUND` on the first check, object deleted, real evidence bucket untouched), but that rests **solely on the PR author's own prose**. Checked 2026-08-23: `eicar` appears nowhere in `.github/**`, `scripts/validate.mjs`, or `package.json`, so the verifier runs in no workflow and **no CI log can contain the result** — its own header states it is run manually and is "never part of CI". PR #42's diff is three tooling files with no captured output or artifact. Must not be upgraded to passed without an independently captured result. |
| Proof Hiring Kit order/webhook/generation | **Not yet tested, and still fully simulated.** Every `apps/web/app/employer/(app)/*` page imports `getLocalAdapters`, so the employer checkout path is local-fake only; zero `KITORDER#` items exist in TEST. This gate must never be exercised against live Paystack. |
| TEST feature-flag drift (`aiMatching`, `contactUnlocks`) | **Found, then corrected — TEST only, independently verified.** On 2026-08-23 the live `/zoryvex/test/feature-flags` parameter held `{"aiMatching":true,"contactUnlocks":true}` — two keys only, contradicting the source-controlled four-key all-false document and the rule that `aiMatching` stays off until the AI evaluation gate passes. `get-parameter-history` shows it turned `true` at **2026-08-18T23:36:09+01:00**, 49 seconds after an all-false write, and stayed true for ~4 days. All writes were made under the founder's SSO AdministratorAccess assumed role; AWS history **cannot** distinguish a human from an authorized local agent acting under that same role, so no claim is made about who acted. **No harm occurred:** the only reader of `aiMatching` is `bedrock-explain-service.ts:185`, and `/aws/lambda/zoryvex-test-matches-explain` holds **0 bytes and 0 log streams** — the Bedrock path was never invoked, so there was no model call, no spend, and no AI output. `contactUnlocks` is read by no `services/api` code at all. Corrected by one bounded, founder-authorized `put-parameter` (version 3 → 4 at 2026-08-23T13:39:24+01:00) restoring all four keys to `false`. No Terraform, no deploy, nothing production, nothing Paystack. |
| Dead-letter / failure-queue residue | **Independently verified live — none exists.** Correcting an earlier suspicion that the failed 2026-08-21 deletion left a dead-lettered message behind: on 2026-08-23 all four of `zoryvex-test-deletion`, `zoryvex-test-deletion-dlq`, `zoryvex-test-evidence-processing`, and `zoryvex-test-evidence-processing-dlq` report `ApproximateNumberOfMessages: 0` and `ApproximateNumberOfMessagesNotVisible: 0`. |
| TEST frontend `/auth/callback` | **Independently verified live — the earlier 404 record is stale.** The page exists (PR #45, #47) and returns `200` as of 2026-08-23. One minor open item: the trailing-slash variant `/auth/callback/` returns 404, which is site-wide CloudFront route-rewrite behaviour (`/candidate/profile` → 200, `/candidate/profile/` → 404) rather than an auth defect. Worth confirming the magic-link email builds its URL without a trailing slash before real users depend on it. |

Still open, and deliberately not closed by this reconciliation: a
Lambda build/zip non-determinism finding, the `dynamodb_index_arns` defect class now recorded in
`docs/RISK_REGISTER.md`, and the 145 accumulated TEST records in `zoryvex-test-core` broken down in the
Data row above, which no gate has ever reconciled. Most are disposable machine-generated artefacts
(rate-limit windows, auth tokens, sessions), but the set also includes the founder's own real TEST candidate
profile, so a future cleanup must be selective rather than a blanket wipe.

**PR #32** is no longer listed as open above: its unique evidence (the 7 repository Variables and the
`ALERT_EMAIL` secret configured for CI-driven test deploys) has been incorporated into
`docs/MANUAL_ACTIONS.md` on this branch. It should be closed as **superseded only after this reconciliation
PR merges** — not before, and not merged separately, since merging both would duplicate the entry and
conflict on the same line.

Closed since the previous revision of this file, and not to be re-opened: the `/auth/callback` 404, and the
CSP/hydration console-error finding on the live marketing site (fixed by PR #46).

Update this file at the end of every phase that changes deployment reality. Never mark a layer "deployed"
from a passing build or a successful compile alone — only from a passed acceptance test for that layer.

## Phase 7 slice 10 — reserved concurrency and the health-route SLO (2026-08-28)

**Deployed to TEST, by AWS API rather than Terraform.** All 37 currently-deployed TEST Lambda
functions now hold a reserved concurrency of 5. That is 185 of the account's 1,000, leaving 815
unreserved against the 100 AWS requires. The eventual committed configuration reaches 221 reserved
and 779 unreserved once the 8 undeployed functions exist; 185 is the live figure and is not the
eventual total.

**Why not Terraform.** `aws_lambda_function` carries `filename` and `source_code_hash` on the same
resource as `reserved_concurrent_executions`, and the bundles on disk differ from what TEST runs, so
a targeted plan still showed a real code-hash change on all 37. A concurrency change is not
authorization to ship code, so the change went through `lambda:PutFunctionConcurrency` and nothing
else. Terraform remains the declared desired configuration: its 44 sites read
`var.lambda_reserved_concurrency`, and the drift between declared and live is deliberate and
recorded here rather than resolved by an unauthorized deploy.

**Independently verified after the change**, reading AWS fresh rather than trusting the tool that
made it: 37/37 at reservation 5, 37/37 `CodeSha256` unchanged, 37/37 `LastModified` unchanged, no
unapproved function reserved, account limit 1000, unreserved 815. Unchanged hashes and timestamps
are the evidence that no code shipped alongside the concurrency change.

**Quota.** The ceiling of 10 that blocked every earlier attempt was a new-account restriction rather
than the AWS default. It has been lifted to the default of 1000, which is sufficient. The separate
request to raise it to 1001 shows `CASE_CLOSED` and was never granted; it did not need to be.

**SLO.** `docs/SLO.md` was written before anything was measured. One valid probe against
`GET /health`: 25 requests, at most 5 in flight, 6,000ms timeout, no authentication. 25/25 HTTP 200,
zero 429, zero 5xx, zero timeouts, zero network errors, p50 387ms, p95 1159ms, max 1207ms. Every
threshold met. Evidence `docs/evidence/slice10-probe-2026-08-28b.json`, sha256
`ea2ea549c7b3eea93b953e1002baa9fa3ddbfdc19b5b78ba3a6289f496211744`.

**The first attempt is preserved, not replaced.** It reported a failed SLO for a service that was
returning 200: all 25 requests died in local DNS resolution and the probe could not tell that apart
from the environment refusing to answer. It is kept unaltered at
`docs/evidence/slice10-probe-unmeasured-dns-2026-08-28.json`, sha256
`9f86de4fb99cda6cd55d3435658cad10996714fdd6ee1614d4411d2c9d87f4f2`, and is an UNMEASURED run rather
than an SLO failure.

**Still open, and not closed by this slice.** Eight committed functions remain undeployed to TEST,
`candidates_graded_task_route` among them, so the graded tasks have no reachable route there. A full
`terraform apply` currently contains those 56 additions, a code redeployment of all 37 bundles, and
an unrelated change to the CI deploy-role IAM policy. None of that is slice 10 and none of it was
applied. Production was not touched at any point.

## The 8 undeployed functions, deployed (2026-08-28)

The gap recorded above is closed. A founder-authorized local `terraform apply` of a targeted plan
added 56 resources, changed 2, and destroyed nothing.

**Now live in TEST:** `candidates-evidence-get`, `candidates-evidence-verify-begin`,
`candidates-evidence-verify`, `candidates-graded-task`, `kit-status`, `matches-evidence`,
`matches-get-contact`, `verification-reminder`, each with its role, policy, log group and, for the
seven routes, its integration, route and permission. All seven routes are CUSTOM authorized. The
scheduled job was created `DISABLED` and will not run until somebody enables it deliberately.

`candidates-graded-task` matters beyond its own row: the graded practical tasks have had no
reachable route in TEST until now, so they existed, passed CI, and could not be used.

**The two changes were named before they were applied, not discovered afterwards.** One was the
feature-flags SSM parameter description, pre-existing drift between deployed and committed. The
other was the shared authorizer's Lambda code: the seven new routes depend on it, Terraform 1.15.8
has no `-exclude`, and targeting cannot drop a dependency. That redeploy was put to the founder as
its own decision and accepted, rather than carried in under a heading about adding functions.

**Rollback was prepared before the apply, not assumed.** The authorizer has only `$LATEST` and no
published versions, so AWS held no snapshot of what was running. Its deployed bundle was downloaded
and verified byte-exact against the live `CodeSha256`
(`3rcIxt0uZii6c5t0QEYchS86tptsupPtC43tEcr+3io=`) and kept outside the repository, so restoring auth
is one `update-function-code` call rather than a rebuild-and-apply cycle with every authenticated
route down.

**Independently verified afterwards**, reading AWS fresh rather than trusting Terraform's summary:
45 functions, 8/8 new present, exactly one pre-existing code change and it is the authorizer, zero
unauthorized code changes, 44 functions at reservation 5 plus `verification-reminder` at 1, zero
unreserved, account limit 1000 and unreserved **779**. Live concurrency now equals the committed
configuration at **221 reserved**, so the deliberate 185/221 divergence recorded earlier is closed.

**Smoke tested.** `/health` returns 200. Both new authorized routes return a clean **401**, not a
500 and not a 404 — which is what proves the redeployed authorizer is running, the routes are wired
to it, and they are protected rather than exposed.

**What remains, stated from measurement rather than a plan.** A fresh full `terraform plan` could
not be produced: four attempts were blocked by the same intermittent local resolver fault that
caused the unmeasured probe earlier. From the applied plan and the verified baseline, the remaining
drift is the 36 other Lambda bundles whose on-disk code differs from what is deployed, plus the CI
deploy-role IAM policy change that has been pending all session. Both stay out of scope here and
neither was applied. Production untouched throughout.

## What the CI/CD pipeline will do on the first merge to `main` (measured 2026-08-30)

GitHub Actions is still unavailable on a billing gate, so `deploy-test` has never run against the current
state. Everything below was measured locally, read-only, so that the first unattended run is not also the
first time anyone finds out.

**The plan.** `0 to add, 40 to change, 0 to destroy` — 39 Lambda bundles whose on-disk code differs from
what is running, plus the CI deploy role's own inline policy (adding `ssm:GetParameter` on
`last-good-commit` and `PassRole` to `scheduler.amazonaws.com`). Nothing is destroyed, so the
stateful-destroy guard has nothing to catch. Zip builds are reproducible, so those 39 are genuine code
differences: five of the eight functions deployed on 2026-08-28 do not appear in the plan at all.

**The role's permissions, simulated against the policy actually deployed** — not the committed one, since
that is what the first run assumes with. `lambda:UpdateFunctionCode`, `iam:PutRolePolicy` on itself,
`scheduler:GetSchedule`/`UpdateSchedule`, `ssm:PutParameter`, `s3:PutObject`/`DeleteObject` on the site
bucket, and `s3:GetObject`/`PutObject` on the state bucket: all `allowed`. One `implicitDeny`,
`ssm:GetParameter` on `last-good-commit`, which is the gap this very apply closes and which `deploy.mjs`
never needs (it writes that parameter and swallows a failure rather than failing a good deploy).

**The OIDC path is real, not assumed.** The account-level OIDC provider exists, and
`module.ci_deploy_role.aws_iam_role.this` does not appear in the plan, which means the deployed trust
policy already matches the committed exact-subject claim.

**Two things the run would have got wrong, now fixed.** `webauthn_rp_id` was set only in the gitignored
`terraform.tfvars` and would have been applied as `""`, breaking founder-admin WebAuthn step-up; it is now
derived from `app_origin`'s host. And `deploy-test` would have proceeded with e2e skipped if
`changed-paths` had failed; it now requires both to have actually succeeded. Full reasoning in
`docs/DECISIONS.md`, 2026-08-30.

**One thing the deploy fixes that is broken today.** `WEBAUTHN_RP_ID` is `""` on the four deployed WebAuthn
Lambdas right now, and `aws-webauthn-dependencies.ts` throws on an empty value at cold start, so
founder-admin step-up currently returns 500. The pending apply sets it to `test.zoryvex.space`.

**One thing the deploy will not fix, by design.** `payments` and `contactUnlocks` are `false` in the live
`/zoryvex/test/feature-flags` document and `true` in Terraform. `ignore_changes = [value]` means no apply
will ever move them, so a Kit purchase in TEST will keep returning "Kit purchases are currently
unavailable" until the founder writes the parameter deliberately. Tracked in `docs/MANUAL_ACTIONS.md`;
`npm run flags:check` reports the current difference, and `deploy.mjs` now prints it after every deploy.

**Local gates at the time of measurement.** `npm run validate:all` green across all 21 steps (85 test
files, 1079 tests), Playwright 215 passed / 0 failed. `npm run gsi:check` clean for both environments.

## Corrections to this file's own earlier claims (2026-08-30)

The plan a merge to `main` would apply is now **0 to add, 43 to change, 0 to destroy** — three more than
the 40 recorded above, because `webauthn_rp_id` is now derived (four Lambdas gain a real
`WEBAUTHN_RP_ID`), the CloudFront distribution's cache behaviours are corrected, and the site bucket
policy re-resolves as a side effect of the distribution update. Still no destroys.

Two things in this environment are broken today and are fixed by that same apply, neither previously
recorded anywhere:

- `WEBAUTHN_RP_ID` is `""` on all four deployed WebAuthn Lambdas, and
  `aws-webauthn-dependencies.ts` throws on an empty value at cold start. Founder-admin step-up returns 500.
- `zoryvex-test-privacy-consent` has a table-only DynamoDB policy while reaching a GSI1 Query, so a
  candidate opting out of discovery gets an error after the opt-out is already written.

One thing that apply will not fix, by design: the live feature-flag document and Terraform can disagree,
because `ignore_changes = [value]` means no apply moves the live value. See `docs/MANUAL_ACTIONS.md`.
**Corrected 2026-09-05:** this paragraph used to state as current fact that `payments` and
`contactUnlocks` were `false` live. They are not. The live document read
`{"payments": true, "aiMatching": false, "publicDiscovery": false, "contactUnlocks": true,
"verificationReminders": false}` when checked directly on 2026-09-05, so paid checkout and contact
unlocks are enabled in TEST and `aiMatching` is correctly still off. The old sentence was left standing
long enough that it would have been read as a blocker on the Subscribe acceptance test; it was not one.

One thing that is *not* broken, recorded because a first reading of it here said otherwise: the
distribution's `*.html` cache behaviour never matched a real request, but HTML was never cached for a day
either — the sync script uploads it with `max-age=0, must-revalidate` and CloudFront honours that over the
policy default. Verified with `curl` against the live site. The fix is defence in depth, not a repair.


## Deployment 1 of 2 — landed and verified live (2026-09-05)

`main` is at `04f079f`, the squash of PR #99. PR #98 had already been merged into #99's branch as a merge
commit before that squash, so both PRs shipped in **one** Deploy run. This was deliberate and is the
reason the two were not merged separately: `ci.yml`'s concurrency group queues on `main` rather than
cancelling, so two merges would have produced two Deploy runs and spent both remaining deployments.
Because the repository allows squash merges only, #98's commits are not ancestors of `main` and GitHub
could not close it automatically; it was closed by hand with that reason recorded on the PR. Its content
is on `main` — the three files were compared blob-by-blob against the tested branch and are identical,
and `git diff cd9ace2 origin/main` is empty, so what CI proved green is exactly what deployed.

CI run `33930674069`: Validate success, End-to-end/accessibility (Playwright) success, Deploy (test)
success at `2026-09-05T00:06:41Z`.

### Independently verified live, not inferred from the green check

`scripts/verify-deployment.mjs` was run against `https://test.zoryvex.space` and
`https://test-api.zoryvex.space` immediately **before** and **after** the deploy, with
`--expect-version 04f079f84c746dee182f6f1bfd1a3e6ad3367742`.

| | Before | After |
|---|---|---|
| Checks passed | 9/14 | **14/14** |
| API reports a build version | FAIL — `undefined` | PASS — `04f079f8…` |
| API reports its environment | FAIL — `undefined` | PASS — `test` |
| Deployed build is the expected commit | FAIL | PASS |
| Pricing page shows all 7 current prices | FAIL — missing 500,000, 800,000, 1,400,000, 1,800,000, 4,000,000 | PASS |
| `robots.txt` refuses crawlers | FAIL — 404 | PASS — `User-Agent: * Disallow: /` |

The other nine checks passed in both runs: `/health` 200, all 37 pages 200, unknown path 404, five
security headers, CSP naming the API origin, eight protected endpoints refusing anonymous callers, two
forged webhooks rejected 401, invalid peer token 404.

The before/after pair is the point. A green Deploy job proves a job ran; only the version the running API
now reports proves *which commit* is serving. Until this deploy, nothing in the deployed system could
answer that question at all, and every previous claim in this file about what was live rested on
inference. It no longer has to.

### Prices reconciled after the deploy

The deployed site began showing the doubled prices while `/zoryvex/test/paystack/plan-codes` still pointed
at the Paystack plans charging the old amounts — a real mismatch window, closed within minutes of the
deploy. All six test-mode plans at the new amounts already existed, so **nothing was created at Paystack**;
only the parameter was rewritten, then read back identical. `npm run plans:check test` then reported all
three sources agreeing: contracts, the parameter, and live Paystack, at 300,000 / 500,000 / 800,000 /
1,400,000 / 1,800,000 / 4,000,000.

### Subscription checkout — independently verified live, same day

Recorded as UNVERIFIED when this section was first written, and closed hours later. The founder pressed
Subscribe in TEST on **two** tiers. Both reached Paystack; both were then left uncompleted, deliberately,
so no card detail was ever entered and no money moved.

Verified by querying **Paystack's own API** for each reference, not by reading our own records back:

| Tier | Our `PaymentAttempt` | Paystack `transaction/verify` | Plan code |
|---|---|---|---|
| Team, founding | NGN 800,000 | 80,000,000 kobo = NGN 800,000 | `PLN_ba1hd35x5h86hex` |
| Partner, founding | NGN 1,800,000 | 180,000,000 kobo = NGN 1,800,000 | `PLN_aojctxxiqr0voeb` |

Both plan codes are exactly the ones written to `/zoryvex/test/paystack/plan-codes` after the deploy, and
both amounts are the doubled prices from `packages/contracts`. This is what proves the repointing was
correct and correctly *ordered*: had the parameter been rewritten before the deploy instead of after,
Paystack would have been holding NGN 400,000 and NGN 900,000 against pages showing double those figures.

Both transactions read `abandoned` / "The transaction was not completed". That is the correct outcome of
stopping at the Paystack page, not a failure. They will not linger on the reconciliation work list either:
`zoryvex-test-billing-reconciliation` is ENABLED, revisits unfinished attempts after
`RECONCILE_AFTER_MINUTES` = 30, and ages anything Paystack still reports unfinished to `abandoned` after
`ABANDON_AFTER_HOURS` = 24 — a terminal status, which removes the GSI2 keys and drops the row off the list.

**What this does not cover:** completing a payment and the webhook then activating a subscription. That
remains untested for subscriptions. The equivalent path was proven end to end for the Kit on 2026-08-26
(order `pending` -> `succeeded`, one clean webhook invocation, a real generated artifact), but a
subscription is a different Paystack object and inherits nothing from that run.

## Deployment 10 — 2026-09-09 — two routes removed, the third proven, and a billing page that hid its own plans

Run 34379842690, `main` at `aa0ff90dfbf9e64ca4639f5df7423b04db937aed`. All four CI jobs green,
`verify-deployment` 14/14 re-run independently from this machine afterwards. No Terraform changed on
the branch, so the destroy and blanking guards had nothing to fire on.

Five commits, including the Vitest advisory patch held back from deployment 9 on the grounds that it
would have spent a metered deploy to republish byte-identical code. This is the push carrying real
application code that it was waiting for.

### The two removals, verified as absent rather than assumed gone

Founder instructions: "remove upload file feature" and "remove ask someone to confirm this". The
reasoning is in ADR 0006; the short version is that a file is the candidate's own and a colleague is
somebody they picked, so neither could ever make a claim verified, and both sat on the evidence page
looking like progress.

Read back out of the deployed bundle rather than from the diff:

```
/confirm-work                        404          the colleague's landing page is gone
"Upload a file"                      0 hits       evidence form bundle
"Sending your file"                  0 hits       evidence form bundle
"Ask someone to confirm"             0 hits       evidence form and verify page bundles
"Link to it" / "No attachment"       1 hit each   the two options that remain
"Not checkable. Nothing outside you" 1 hit        the rewritten hint
```

The page count in `verify-deployment` went from 37 to 36, which is the confirm-work page and is the
only route that left.

### The gist route, tested against GitHub for the first time

This is the commit that makes the removals safe rather than reckless. Taking away two routes narrows
supply to candidates holding a certification or owning a public repository, which is only acceptable
if the repository route works.

Every previous test of it handed the verifier a payload we wrote. That proves the logic and proves
nothing about whether GitHub still returns `public`, `owner.login`, `files[].content`,
`files[].truncated`, `fork`, `size` and `contributions` in the shape the code reads. Six new tests
make real calls: 6 passed on 2026-09-09, covering the gist shape, the login proven from a code in the
body, the refusal when it is absent, a real repository verified with its commit count, the refusal
when the proven account does not own it, a 404 returning null rather than throwing, and both URL forms
GitHub hands a candidate.

Opt-in rather than part of `validate:all`, so a GitHub outage or an exhausted anonymous rate limit
cannot turn CI red for something that is not a fact about this code.

The instructions a candidate reads come from the server, not the bundle, so they were confirmed by
downloading the deployed `candidates-evidence-verify-begin` Lambda and reading them out of it:

```
Go to gist.github.com, signed in as the GitHub account that owns the work.
Type zoryvex-verification.txt into the filename box.
Press the dropdown arrow beside the green [Create secret gist button]
verification-nonce-candidate          the rate-limit kind, present
```

The downloaded artifact was deleted after the check.

### The billing page that hid every plan, including from somebody trying to come back

Founder instructions: "Make sure they can see all plans even when subscribe to one" and "make sure
when subscription is cancelled they can still resubscribe to any plan". One line of code.

The plans section rendered only when there was no subscription or one already fully ended. So an
employer part-way through a paid month saw no plans at all on the page they pay on. Worse, cancelling
did not bring them back: cancelling moves a subscription to `non-renewing` and leaves access running
to the end of the period already paid for, and `non-renewing` is not `cancelled`. The plans stayed
hidden for the rest of the month while the cancel dialog promised, in as many words, "You can
subscribe again later".

The gate now matches what the server enforces rather than guessing wider. `subscription-service`
refuses a second subscription at `active` and `attention` and accepts one at every other status,
which is exactly what makes restarting after a cancellation work.

Ten tests, and two of them fail when `non-renewing` is treated as live again, which was checked by
reintroducing that bug and watching them go red.

Confirmed in the deployed billing bundle: `All marketplace plans`, `Moving to a different plan`,
`Cancel to switch`, `Your subscription is ending`, `start any plan below right now`, and the founding
warning, one hit each.

### Still outstanding after this deploy

The upload/scan/download pipeline, the three peer endpoints and the graded-task catalogue are all in
the codebase and all unreachable. Deleting their S3 bucket, GuardDuty malware protection, EventBridge
rule, queue and API routes is a Terraform destroy needing founder approval, recorded in ADR 0006 and
ADR 0005. They should go together in one reviewed destroy.

The two founder-run acceptance tests are now one. Attaching a file is no longer a feature, so it
cannot be tested and does not need to be. Asking a colleague to confirm is likewise gone. What remains
unproven by anything here is the gist route end to end with a real signed-in candidate: the check
itself is now tested against live GitHub, and what has never been observed is a candidate getting a
code, publishing it, and pressing the button.

## Deployment 9 — 2026-09-09 — the price floor, file evidence, and a check that could be run all day

Run 34364875101, `main` at `38880d1cbef4e92fd7e17220ee171d04e02b33e8`. All four CI jobs green,
`verify-deployment` 14/14 against the exact SHA, re-run independently from this machine afterwards
rather than read off the CI log.

The Terraform plan was `+0 ~58 -0`: 56 Lambda code updates and two IAM role policies whose text is
unknown until apply only because it interpolates the ARN of a function being republished. Both are the
same single-function `InvokeOwnFunctionOnly` statement they were before. No Terraform changed on this
branch at all, so every one of the 58 is code churn, and the destroy and blanking guards both stayed
quiet on their own rather than being passed a flag.

### The price floor, and why the ladder was compressed instead of scaled

Founder instruction: "lowest price even for founder should be 800000". That was the only number given,
and it could not be applied on its own. Founding Scout was 300,000 while founding Team was already
800,000, so lifting the floor alone would have put two tiers at one price.

The ceiling is not the founder's to set. Paystack's Starter Business limit is 8,000,000 collected for
the life of the account, so 4,000,000 is the most any single charge can be and still leave room for its
own renewal. Scaling the old ladder to a 800,000 floor would have put standard Partner near 10,700,000,
above the entire account limit. That is the same failure a 10,000,000 price already caused on
2026-09-04, so the ladder was compressed to fit rather than multiplied and discovered later.

The deployed pricing page serves all seven current figures: 95,000 for the Kit, then
800,000 / 1,200,000 / 1,400,000 / 2,000,000 / 2,400,000 / 4,000,000.

### Paystack plans recreated first, which is the opposite order to deployment 1

A Paystack Plan's amount cannot be edited, so five of the six had to be recreated. This ran before the
site went out, and deployment 1 ran the other way round. Both orders were chosen for the same reason.
There, prices had risen and repointing the plans first would have charged more than the page showed, so
the site went first. Here, prices have risen again, so deploying first would have shown 800,000 while
Paystack still billed 300,000. Recreating first undercharges nobody in either direction.

It was automated rather than done by hand, and needed no pasted secret: the test key was already in
Parameter Store, the script read it from there, asserted the `sk_test_` prefix before writing anything,
and never printed the value. The old plan-code mapping was captured as the rollback first.
`plans:check` afterwards compared three independent sources, contracts, the parameter, and Paystack's
own API, and all six agree.

### File evidence, which had never been possible in production

`Evidence.fileId` existed in the contract with nothing anywhere that could set it. The form deliberately
hid the upload option in real mode, with an honest comment saying so, so nothing was ever silently
discarded. The gap was narrower than "uploads are broken" and worse than it looked: a candidate could
not attach a file to a claim at all.

The chain is now joined end to end, and the service refuses a file it should not trust rather than
accepting a row and hoping. A missing file is a 404; a file whose scan has not finished is refused by
name; a file with no accepted key is refused as still processing. The upload UI shows "Sending your
file…" and deliberately shows no percentage, because a presigned POST gives the browser nothing
truthful to count.

The evidence bucket still allows `POST` and only `POST`, from the app origin alone, so the CORS fix from
deployment 4 is intact and still matches the method the API actually signs.

### The verification check, which anyone could previously run all day

`verifyEvidence` reached GitHub with nothing bounding how often. GitHub's unauthenticated limit is 60
requests an hour per IP, shared by every candidate on a warm Lambda, so one signed-in account pressing
the button in a loop could have exhausted verification for everybody and cost nothing to do.

Both entry points are now bounded per candidate before any fetch is made, not after: 12 checks and 20
nonces an hour, on the existing fixed-window counter rather than a second mechanism invented for this.

### A claim the check does not actually make

The repository page told candidates a fork would be refused, full stop. GitHub's `fork` flag is only set
by the Fork button. A project cloned and pushed as a new repository is not marked at all, and the check
cannot see it. The copy now says exactly that, out loud, on the page where the candidate is deciding
what to submit. It is a weaker claim and a true one.

### The track that was never only AWS

Founder decision, and one CLAUDE.md had explicitly reserved to the founder: the `aws_cloud` track is
labelled "Cloud engineering". The identifier is unchanged, so no stored row moved. The deployed marketing
pages carry "Cloud engineering" 26 times between them and "AWS cloud" zero times, and the application
bundle carries the new label and not the old one.

### Still outstanding after this deploy

Two acceptance tests need a signed-in candidate and cannot be run from here: attaching a file to a piece
of evidence, and asking a colleague to confirm one from a real work address. The `graded_task` catalogue
deletion from ADR 0005 is still deferred, because it is a Terraform destroy and needs explicit approval.
A moderate Vitest path-traversal advisory is patched and verified locally but deliberately unpushed: it
touches devDependencies only, cannot reach the deployed artifact, and pushing it alone would spend a
metered deploy to republish byte-identical code. It rides the next code push.

## Deployment 8 — 2026-09-09 — a year-long sign-in, and a critical advisory that arrived mid-session

Run 34317187997, `main` at `64440a714d51d9a3976961b06dfce7df53bc70f9`. All four CI jobs green,
`verify-deployment` 14/14 against the exact SHA.

### The sign-in duration, proven from the deployed artifact

Founder instruction: "Make the sign in last 1 year." Both clocks moved for the three self-serve roles,
not only the absolute cap. Raising the cap alone would have left the idle clock at 30 days, so somebody
using the product twice a year would still have been sent back to their inbox, and the instruction
would have been satisfied in the file and not on the screen.

Verified by reading the deployed Lambda bundle out of AWS rather than by trusting the plan:

```
QM = 365*24*60          idle, in minutes
eU = 365*24             absolute, in hours
idleMinutes:QM, absoluteHours:eU        x3, the self-serve roles
idleMinutes:30, absoluteHours:12        founder_admin, untouched
```

`maxAgeSeconds` is `absoluteHours * 3600`, so the cookie a browser receives carries 31,536,000 seconds.
The downloaded artifact was deleted after the check.

`founder_admin` is deliberately unchanged and is the reason this is a table rather than one number: it
reads the exception queue and acts on other people's records, and its blast radius is the whole
platform.

ADR 0001 requires an idle expiry and an absolute expiry, both enforced server-side, and does not name
durations. Both still exist and still end a session. The test proving activity cannot slide the
absolute cap forward was updated rather than deleted, and a new test pins the year through the cookie's
own `Max-Age`, which is what a browser actually obeys. Shortening the constant back to 90 days fails it.

**The cost, recorded rather than implied:** a session cookie stolen from a device stays valid for up to
a year. Sign-out and revoke-all are the answer for a lost device; the shared-device answer is to sign
out rather than rely on a clock nobody was watching.

### A critical advisory, and an honest read of the exposure

`validate:all` passed in the morning and failed in the afternoon with no code change between: the
advisory database moved. Next.js unauthenticated RCE (windows-hosted servers, and the image
optimization API via AVIF), sharp via libheif, js-yaml CPU exhaustion.

What that actually means here is narrower than the severity suggests, and saying so is not
minimising it. This app is a static export to S3 and CloudFront with no Next.js server runtime, and its
images are `unoptimized`, so neither RCE describes the deployed surface. `js-yaml` reaches the tree only
through eslint and the OpenAPI validator, both reading files from this repository.

Low real risk, minor fixes available, so they were taken rather than argued with: `next` 16.3.1 to
16.3.4, `sharp` 0.35.3 to 0.35.4, and a `js-yaml` override to `^4.3.2`, which both consumers accept
because their ranges already admit it.

Upgrading Next.js is a real change and was re-verified rather than assumed: validate:all green, 2268
unit tests, desktop 129/129, mobile 126 passed with 3 skipped, first-load JS unchanged at 180.5 KB.

### Checked for regression after the deploy

The evidence bucket still allows `POST`, so the upload fix from deployment 4 is intact, and
`zoryvex-test-public-proof` still carries `TABLE_NAME` alone, so the blanking from deployment 7 held.

## Deployment 7 — 2026-09-09 — photos out, a link in, and a guard that did its job

Run 34243805756, `main` at `63741c53995a16144c03f26ea4b13429a367e8cd`. `verify-deployment` 14/14
against the exact SHA.

### The first attempt was refused, correctly

The push deploy for `cad0f45` (run 34242317372) failed at the plan, and should have:

```
BLOCKED: this plan would replace live, non-empty configuration with empty values:
  - module.public_proof_route ... EVIDENCE_BUCKET_NAME "zoryvex-test-evidence-..." -> null
```

`deploy.mjs` refuses any plan that replaces a live, non-empty setting with an empty one, because that
is precisely what a missing GitHub repository variable looks like: it arrives as an empty string, and
the variable's own default makes it read as a deliberate choice. The guard cannot tell that apart from
a setting somebody meant to remove, and should not try.

Here the removal was deliberate: profile photos are gone, so the public-proof function no longer reads
that bucket. There was no way to say so. `--allow-blanking` existed in `deploy.mjs` and the workflow
hardcoded the command without it, leaving only two bad options: pass the flag on every deploy, which
retires the guard permanently to solve one case, or apply by hand outside the pipeline.

Neither was taken. The flag is now a `workflow_dispatch` input, off by default, so an automatic push
still cannot blank anything. Removing a setting is a deliberate two-step: the push deploy refuses and
names the setting, then a person re-runs manually with the box ticked. The decision is recorded as its
own run rather than buried in a diff, which is better provenance than weakening the guard would have
produced. Nothing was applied by the refused run.

### Verified live, after the deploy

| Verified | How |
| --- | --- |
| Not a no-op | The live API reports `63741c5…`, the exact pushed SHA |
| The blanking actually applied | `zoryvex-test-public-proof` now carries `TABLE_NAME` and nothing else. `EVIDENCE_BUCKET_NAME` is gone, read back from AWS |
| Uploads still work | `get-bucket-cors` on the evidence bucket still returns `["POST"]`. Removing photos did not disturb the fix from deployment 4, because evidence files use the same pipeline |
| Photos are gone from the client | No deployed chunk contains "Add a photo" or "Your photo" |
| The replacement is live | The profile chunk contains "Another link" |
| The gist is explained | The verify chunk contains "What a gist is" and "Why it proves anything" |
| Nothing broke | 14/14 deployment checks; zero console errors across home, proof and pricing |

### What changed, and the reasoning worth keeping

Photos were removed end to end: component, contract field, server validation, public-proof minting,
OpenAPI entries, tests, and the Lambda's IAM read access to the evidence bucket. The grant went with
the feature deliberately. An unauthenticated route holding read access to a bucket it no longer
touches is exactly the permission somebody finds a year later and cannot explain.

In their place, one general link field. `LinkedInUrlSchema` stays pinned to one host, because a field
claiming to be a LinkedIn profile should be one. The new field makes the opposite promise, so the
constraint moved rather than disappeared: https, no embedded credentials, a real host, bounded length.
Not *which* host, because that was the part doing the excluding. An employer sees it labelled "A link
they gave. Zoryvex has not checked what is behind it." — the same words a colleague's confirmation
already carries. Showing an unverified thing and saying so is honest; hiding it is merely quiet.

Doing that surfaced a hand-written duplicate of the contact type on the employer role page. A new
channel would have arrived from the API and the page would have been structurally unable to show it,
because the type said it did not exist. It now uses the client's own type.

## Deployment 6 — 2026-09-08 — the race under the flaky suite

Run 34229291449, `main` at `d64b414`. All four CI jobs green, `verify-deployment` 14/14 against the
exact SHA.

### What this actually fixed

The intermittent e2e failures on this branch were blamed on the machine, which has 2.1GB free of 7.9GB
and did make everything slower. That was the trigger. The cause was a race repeated in ten spec files.

Each carried its own copy of a helper reading `sent[sent.length - 1]` from the demo outbox, immediately
after clicking "Send sign-in code", with nothing waiting for that click to produce anything. Under load
the read lands before the new message exists and returns the PREVIOUS test's code. That code is valid,
for a different account, one that has usually finished onboarding, so sign-in succeeds and the app
correctly routes elsewhere. The failure then surfaces far away: a URL that should be
`/candidate/onboarding` arriving as `/candidate/profile`, or a live region found empty because the page
belonged to somebody else. Both were seen on this branch, and it is why each passed alone and failed
only in a full run.

One shared helper in `tests/support/outbox.ts` now waits for the message addressed to the person
signing in. It can neither return early nor return somebody else's code. Ten duplicates are gone.

Fixing it exposed a worse problem in passing. The test asserting that an unrecognized email is rejected
from the admin sign-in was reading the newest message in the outbox, which is a valid code for a real
account. That test could have passed for entirely the wrong reason.

| Measure | Before | After |
| --- | --- | --- |
| Mobile e2e | 125 passed, 1 failed, 14.5m | 126 passed, 3 skipped, 0 failed, 9.4m |
| Desktop e2e | 129/129, 6.2m | 129/129, 5.0m |

Faster as well as green, because tests no longer wait out assertions that were never going to pass.

### Also in this deployment

The skip link was the only focusable element without a focus ring of its own and fell back to Chrome's
amber default, off-palette in an ink, warm-white and emerald product. It was always visible, so this
was consistency rather than accessibility. Covered by two keyboard tests that already existed
(`home.spec.ts` "skip link is the first focusable element", `kit-document.spec.ts` "Tab reaches the
skip link first, with a visible focus outline"), both passing.

Two unit tests I had written earlier on this branch timed out under `validate:all`, which runs enough
in parallel to slow the machine. They filled two URL fields with `userEvent.type`, which dispatches one
keystroke per character. Pasting is a single event and a real user action; file execution went from
16.1s to 2.16s. Checked against the bug rather than assumed harmless: reintroducing the missing
explanation still fails four of the ten.

### A note on verification method, because it cost hours

Four separate times a check reported a defect that did not exist: `grep` reading `--color-...` as
option flags; a screenshot taken mid-scroll showing blank sections; a trailing slash hitting the 404
page; and `getComputedStyle` after a programmatic `focus()` in a pane whose window is not focused,
which reads the unfocused base state. Every one looked like a real bug and none was. Confirm the
instrument before believing the reading.

## Deployment 5 — 2026-09-08 — hero rhythm, verified in a browser

Run 34218096378, `main` at `de5fab6ad102b9f9d63bbee4fb10848590bc1a15`. All four CI jobs green.
`verify-deployment` 14/14 against the exact SHA.

Two spacing changes and no claim altered. The hero was one centred paragraph carrying four separate
facts, rendering as about ten centred lines at 375px, and `Section` carried `py-12` at every width so
two stacked sections put 96px of nothing between them on a phone. The hero is now three units,
re-broken rather than re-written because those claims are load-bearing, and section padding is `py-8`
below `sm`. The measurable effect is that the primary call to action is above the fold at 375x812,
where it previously was not.

This is the first deployment whose UI was checked in a real browser rather than reasoned about from
source. What that found:

| Checked | Result |
| --- | --- |
| Console errors across 7 public pages | None |
| Internal links | 19 pages crawled plus rendered DOM anchors; all resolve |
| Horizontal overflow at 320px | None on home, pricing, how-verification-works |
| Protected route redirect | `/candidate/profile` and `/candidate/account` reach sign-in in under 2s |
| API calls from public pages | Zero. `/pricing` loads 9 resources and calls the API not at all |

Two things looked like defects and were not, both worth recording because the checks were wrong rather
than the app. A `401` on `/auth/session` appears in the console after visiting a protected route while
signed out: that is the designed "am I signed in" probe and the only way a browser can ask. And a
screenshot taken mid-scroll showed two blank screens on the home page, which the DOM disproved.

### The upload fix, verified at the network level after deployment 5

Deployment 4 recorded the CORS fix as correct in AWS but the upload itself as unproven. Most of that
gap is now closed without a candidate session, because S3 answers CORS preflights directly and the
preflight is the thing that was broken.

| Request | Result | What it establishes |
| --- | --- | --- |
| `OPTIONS` with `Access-Control-Request-Method: POST`, `Origin: https://test.zoryvex.space` | `200`, `Access-Control-Allow-Origin: https://test.zoryvex.space`, `Access-Control-Allow-Methods: POST` | A browser will be allowed to send the real upload |
| Same, with `PUT` (no longer listed) | `403`, no CORS headers at all | The exact failure POST produced before deployment 4, reproduced on demand |
| Same, with `POST` from `https://evil.example` | `403` | The rule was widened by one method, not loosened to any origin |

The third row is the point of the other two. Widening a CORS rule is the kind of change that fixes a
bug and opens a hole in the same line, so the foreign-origin case was checked rather than assumed.

**Still not established by this.** That S3 accepts the presigned POST policy the API signs, and that
the GuardDuty scan-and-promote pipeline runs on the uploaded object. Generating a genuinely signed
upload needs a candidate session, and writing even synthetic files into the real evidence bucket is
deliberately avoided: an isolated scan-test bucket exists precisely so that tests never touch it.
Those two remain founder-observable only.

## Deployment 4 — 2026-09-08 — the uploads that had never worked

Run 34209187372, `main` at `ac0417cdfeb5ee2b5af80a6737ea8c050180dfda`, thirteen commits fast-forwarded
from `d6dfe71`. Plan summary `0 to add, 60 to change, 0 to destroy`: nothing destroyed, nothing replaced.
Fifty-six of the sixty are Lambda `source_code_hash` updates, which is the shape of every deploy here
because the bundles share common code.

All four CI jobs green: doc-only detection, Validate, Playwright, Deploy (test).

### What this fixed, and how it was found

The evidence bucket allowed `PUT` and nothing in the product has ever issued one. The API signs a
presigned POST (`createPresignedPost` in `src/repositories/s3-presign-repository.ts`) and the browser
sends a multipart POST. S3 only attaches `Access-Control-Allow-Origin` to a response whose method is
allow-listed, so every browser upload failed before a byte reached storage. That is one CORS line
standing between the product and every file feature it has: profile photos and all file evidence.

`docs/DATA_MODEL.md` already said "presigned POST", and so did the application code. Only the Terraform
disagreed. The bug was never a misunderstanding; it was one line of infrastructure contradicting two
sources that were already correct.

No test could have caught it. Playwright's webServer never sets `NEXT_PUBLIC_API_BASE_URL`
(`scripts/real-mode-awareness-check.mjs`), so the suite runs against local fakes and the browser-to-S3
hop is exercised nowhere in CI. A guard in `scripts/terraform-policy-check.mjs` now reads the signed
method out of the signing code and fails when the bucket disagrees, proven by reintroducing the bug.

### Verified live, after the deploy

| Verified | How |
| --- | --- |
| The deploy was not a no-op | The live API reports build version `ac0417c…`, the exact pushed SHA |
| Nothing regressed | `verify-deployment` 14/14; CI e2e 255 passed / 3 skipped |
| The upload fix is live | `get-bucket-cors` on the evidence bucket now returns `["POST"]`, read directly from AWS. It returned `["PUT"]` before the deploy, which is how the bug was confirmed rather than inferred |
| The confirmation notice can send | `zoryvex-test-peer-confirm` now carries `SES_CONFIGURATION_SET_NAME` and `SIGN_IN_EMAIL_FROM`. It carried neither before, so the notice would have failed with the same AccessDenied that took down the request route in deployment 3 |
| Destructive actions look destructive | Deployed CSS carries `--color-error-800`, `--color-error-900` and `.bg-error-700`, and four `:active` selectors where it had three |
| Touch targets shipped | Deployed CSS carries `min-height:calc(var(--spacing) * 11)` and `* 12` |
| New copy is live | The deployed chunks contain "Make your own proof page", "specialism", "Dismiss notification" and "and this turns on" |

### Still not verified, and it cannot be verified from here

**Whether a photo actually uploads.** The CORS rule is correct in AWS and the code path is unchanged and
tested, but no probe available here can authenticate as a candidate and put a real file through the
browser-to-S3 hop. That is the same gap that let the bug live in the first place, and it closes only
when a person adds a photo on `https://test.zoryvex.space/candidate/profile`.

The peer-confirmation acceptance test from deployment 3 also remains founder-run and unobserved.

### One small finding, not fixed

The site serves `trailingSlash: false`, so `/proof` is 200 and `/proof/` is 404, for every route. It is
pre-existing, `verify-deployment` passes 37/37 without trailing slashes, and a shared link with a
trailing slash would 404 rather than redirect. Worth a CloudFront redirect eventually; not touched here
because it was not what this deployment was for.

## Deployment 3 — 2026-09-06 — the founder's evidence and matching review

Run 34041216203, `main` at `47e41aeb96a81ddc6c74c312362a50a924bc6348`. Plan summary `+1 ~61 -0`: one
resource added, sixty-one changed, **nothing destroyed**. Applied from the saved plan, never a fresh one.

Merged by fast-forwarding `main` rather than through a pull request. CI triggers on both `pull_request`
and `push: [main]`, so a PR would have spent a second Actions run re-running validation that had already
passed locally, and the founder has twice restricted Actions minutes to deploys only. Branch protection
is unavailable on this repository's plan, so nothing enforcing was bypassed.

| Verified | How |
| --- | --- |
| The deploy was not a no-op | The live API reports build version `47e41ae…`, the exact pushed SHA |
| Nothing regressed | `verify-deployment` 14/14; CI e2e 255 passed / 3 skipped, matching the local run exactly |
| Retired copy is gone | The homepage no longer sells "a practical task scored against a published rubric" |
| New copy is live | It now describes two methods: a certification confirmed with its issuer, or proven repository control |
| Pressed states shipped | The deployed stylesheet carries 3 `:active` selectors where it previously had zero, plus `--color-accent-800` |
| The skip link is intact | `focus:not-sr-only:focus{clip-path:none;…}` present in the deployed CSS, and the desktop keyboard e2e test passes |

**Not verified, and it is the reason this deployment existed.** Whether "ask someone to confirm this"
now actually sends is unproven. The missing SES configuration-set grant was in the applied plan, but an
end-to-end send needs an authenticated candidate with an unverified claim, which no probe available here
can produce. Until a real send is observed, that fix is code-evidence confirmed and live-behaviour
unverified. The acceptance test is founder-run and is written down in `.zoryvex/state.json`.

## Deployment 2 of 2 — landed and verified live (2026-09-05)

`main` is at `c660be3a1820a8cda0c4c46c565420ee52f0f191`, the squash of PR #101. PR #100 had already been
merged into that branch locally, so both shipped in **one** Deploy run rather than two; because the
repository allows squash merges only, #100's commits are not ancestors of `main` and it was closed by hand
with that reason recorded, the same way #98 was after Deployment 1. Its content was confirmed present on
`main` before closing.

CI run `33960703929`: Validate success, End-to-end/accessibility (Playwright) success, Deploy (test)
success.

### Verified against the running system

`scripts/verify-deployment.mjs` was run before and after, with `--expect-version` set to the real full SHA
read from `git rev-parse origin/main`.

| | Before | After |
|---|---|---|
| Checks passed | 13/14 | **14/14** |
| Deployed build is the expected commit | FAIL — still serving `04f079f8…` | PASS — `c660be3a…` |

Everything else passed in both runs, which is the point: the only thing that changed was the commit being
served. The deployed version string matches `origin/main` byte for byte.

Also re-checked live after the deploy, rather than assumed:

- `npm run plans:check test` — contracts, `/zoryvex/test/paystack/plan-codes` and live Paystack all agree
  at 300,000 / 500,000 / 800,000 / 1,400,000 / 1,800,000 / 4,000,000.
- CORS — an untrusted origin receives **no** `access-control-allow-origin` header; the real origin receives
  an exact echo with `allow-credentials: true`, never a wildcard.
- The back/forward-cache fix is in the shipped bundle: `pageshow` appears in two deployed chunks behind
  `/employer/billing`, so the Subscribe buttons recover after a buyer presses Back rather than staying
  dead.

### One correction worth recording

The first post-deploy verification reported 14 checks with 1 failure, and the failure was not the
deployment. `--expect-version` had been given a full SHA extrapolated from the short `c660be3` rather than
read from git, so it compared the live build against a commit that does not exist. The deployed value was
correct all along. Re-run with `git rev-parse origin/main`, it is 14/14. A verification script is only as
good as the value handed to it.

### Still true after this deployment

Production remains **NOT DEPLOYED**. There is no production deploy path in this repository: `ci.yml` has
one deploy job and it targets TEST. Production appears only in a `terraform validate` step. `PHASE 10
COMMERCIAL GO` remains blocked on CAC, NRS and NDPC, all recorded `NOT AUTHORIZED BY FOUNDER`.
