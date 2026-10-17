# Phase Register — authoritative, independently verified

One consolidated register of every numbered phase, slice, milestone, and open item, per the founder's
binding instruction to maintain "one authoritative phase register" and to "assume nothing reliable ...
until independently verified." This file is the single index; `.zoryvex/state.json` remains the machine-
readable state-of-record CLAUDE.md designates as ground truth, and this document cites it rather than
duplicating its full detail line-for-line.

## Execution compass

What Zoryvex is becoming — proof-first hiring for African AWS-cloud/DevOps/cloud-security candidates and
the employers hiring them, reducing résumé-only uncertainty through auditable, consent-gated evidence
rather than opaque AI scoring — is already the fixed product CLAUDE.md and `docs/PRODUCT_SPEC.md`/
`docs/ACCEPTANCE_CRITERIA.md` encode: one ₦95,000 Proof Hiring Kit, candidates free, the marketplace-
subscription CTA hard-gated behind 5 real discovery-opted matches per saved role (`docs/PRODUCT_SPEC.md:11`,
`docs/ACCEPTANCE_CRITERIA.md:40-46`), north-star = verified hires, not registrations or AI-output volume.
Nothing in this amendment changes that — it is confirmed, not introduced, and re-checked here rather than
restated in full.

1. **Verified current phase**: Phase 7 (auth/evidence/matching/privacy/operations on the real AWS backend),
   Slice 11 (deploy + verify + wrap-up). See the Phase 7 table below for full slice detail.
2. **Phase's purpose**: prove the product's core trust mechanics — real passwordless auth, real evidence
   upload with malware-scan gating, real deterministic matching, real privacy export/deletion — actually
   work against live AWS, not just in local-fake mode, before any commercial or production activation.
3. **Current outcome being pursued**: closing Slice 11's four acceptance gates with independently
   reproducible live-TEST evidence (two — matching, export — remain BLOCKED; EICAR passed 2026-08-25; Kit
   is open, same blocker as matching/export — see below).
4. **User journey improved**: directly the candidate evidence/matching journey and the employer role/Kit
   journey both described in the amendment — this slice is what proves those journeys' backend actually
   works, not just their UI against local fakes.
5. **Acceptance criterion being closed**: the six-bucket evidence taxonomy's "Independently verified live"
   bucket for deterministic matching, export, and the Kit flow (EICAR already closed this bucket — see
   EVIDENCE TAXONOMY row in `.zoryvex/state.json`).
6. **Evidence required**: a real HTTP/worker invocation against the deployed TEST Lambda + DynamoDB/SQS/S3,
   with before/after state captured directly, not inferred from a merged PR or green CI alone.
7. **Current blocker/dependency**: matching, export, and Kit all need a real human email-check for a fresh
   employer or candidate session — this is the only remaining blocker class; the earlier S3/Lambda network
   gap that also blocked EICAR turned out to be an addressing-style artifact and is now resolved (see the
   EICAR row below), so it never applied to matching/export/Kit's actual blocker anyway. Recorded in
   `.zoryvex/state.json`'s `blockers` array; every other unblocked item this session could reach has been
   finished (GSI permission fix, deletion gate, zip-determinism fix, EICAR, this register, the MLOps
   taxonomy foundation and its marketing-copy truthfulness pass).
8. **Next safe action**: none of this session's remaining reachable work is outstanding. What's left —
   matching/export/Kit acceptance, and any further MLOps enhancement beyond the taxonomy foundation
   (structured evidence tagging, search/filter UI, Kit-checklist autocomplete) — is either genuinely blocked
   on a human step or genuinely optional, not a dependency this session can close further on its own.
9. **Next three dependency-ordered milestones**: (a) once a human performs one real magic-link email-check
   for a fresh employer account, immediately run matching (score-check against
   `services/api/src/domain/matching-service.ts` computed before the run); (b) once a human does the same
   for the founder's existing candidate account (or a fresh one), run export; (c) if the founder wants the
   optional MLOps enhancements built anyway, structured evidence tagging by capability-area id is next in
   dependency order (it's what a search/filter UI or Kit-checklist autocomplete would eventually read from).
10. **Connection to final destination**: every Slice 11 gate is a precondition for `PHASE 7 PASSED`, which
    is itself the gate CLAUDE.md requires before asking the founder for Prompt 8 — nothing about production
    activation, Paystack going live, or marketplace subscriptions can be considered until this phase's real
    backend is proven, matching the amendment's own delivery route (foundations → TEST-verified product →
    Kit/payment lifecycle → CI/CD/rollback → adversarial review → production → stabilize → bounded growth).

**Verification key used below:**

- **VERIFIED (fresh, this session)** — checked directly against live git/GitHub/AWS state during the
  session that wrote this register, with the exact command and result citable.
- **VERIFIED (prior session, strong evidence)** — `.zoryvex/state.json` / `docs/DEPLOYMENT_STATUS.md`
  already record independently-gathered real evidence (specific CLI output, CloudWatch log lines, HTTP
  responses, or a named human's real browser session) — not a PR author's self-description, a green CI run
  alone, or a plan. Not re-derived from zero this session because doing so would need AWS services this
  session's own network cannot reach (see the Environment Constraints section) or would repeat work whose
  evidence quality already meets this same bar. Where this session _could_ spot-check a fragment of it
  live, that spot-check is noted.
- **BLOCKED** — the remaining acceptance requires either a human real-time action (checking a real email
  inbox) or an AWS surface this session's network cannot reach. Recorded honestly per the founder's
  instruction that a human-only blocker "must not stop the overall workflow" — every other unblocked item
  is finished first, and the blocker itself is not silently dropped.
- **OPEN — not yet attempted** — genuinely unstarted, not blocked, next in the safe dependency order.
- **N/A — not yet scoped** — no founder prompt has defined this phase's content yet; nothing exists to
  verify or implement.

## Environment constraints discovered this session (apply to every AWS-touching row below)

This session's Bash sandbox can reach every AWS regional control-plane endpoint used this session —
`sts`, `iam`, `ssm`, `dynamodb`, `sqs`, `logs`, `acm`, `s3`, and `lambda` — plus `github.com`/
`api.github.com` and the **raw AWS-generated execute-api URL** (confirmed live twice, via `curl` and the
Browser pane). **Revision, same day**: `s3`/`lambda` initially appeared unreachable, but the real cause was
addressing style, not a hard network block — this sandbox cannot resolve virtual-hosted-style per-resource
subdomains (`<bucket>.s3.<region>.amazonaws.com`) but CAN reach the bare regional endpoint
(`s3.<region>.amazonaws.com`); setting `AWS_ENDPOINT_URL_S3`/`AWS_ENDPOINT_URL_LAMBDA` to the bare endpoint
forces path-style addressing and fully restores access, confirmed by running
`scripts/verify-evidence-eicar-fail-closed.mjs` completely unmodified and by a successful
`aws lambda get-function-configuration` call. `apigateway.*`/`monitoring.*` (CloudWatch) were not retested
with this fix but are presumed likely fixable the same way. This project's own custom domains
(`test.zoryvex.space`, `test-api.zoryvex.space`) remain genuinely unreachable, unrelated to AWS addressing —
confirmed `curl` DNS-resolution failure (exit 6) from both the Bash sandbox and the Browser pane, while the
raw AWS URL behind the same API Gateway deployment answers `200` from both paths, so this is specific to
that external DNS name, not AWS or this environment's general connectivity. `email.*` (SES), `guardduty.*`,
and `budgets.amazonaws.com` were not retested with the endpoint-override fix and remain presumed reachable
the same way if ever needed, though not confirmed.

**MCP servers.** `docs/MANUAL_ACTIONS.md` records five configured at project scope in Phase 2 (21st/GitHub/
Filesystem/Context7/Playwright). Checked this session: **none of the five are connected** — the harness's
own system reminders list them as disconnected, and only `ccd_session` (chapter/task tools), the Browser
pane tool, and the `visualize` widget tool are actually callable right now. Every GitHub interaction this
session used the `gh` CLI directly, not the GitHub MCP; every AWS interaction used the `aws` CLI directly,
no AWS MCP is configured at all. This is stated plainly rather than silently substituted.

## Fresh ground-truth checks performed at the start of this register (all this session)

- **Git**: repo root `C:/Users/zerah/Documents/zoryvex`, single remote `origin` →
  `github.com/<owner>/zoryvex-platform` (owner redacted per CLAUDE.md, verified via `gh auth status` to
  match local identity), `HEAD` = `main` = `origin/main` = `e13fe412015316a6d92aa14738a7d56b1bc5b015`, no
  in-progress merge/rebase, no worktrees beyond the primary checkout, no tags. Working tree clean except
  `.terraform-plans/` (untracked, gitignored contents, never touched). Stale local/remote-tracking branches
  from already-merged PRs exist (`docs/phase-7-status-reconciliation-20260823`,
  `docs/phase-7-checkpoint-pr63-20260825`, `docs/phase-7-deletion-gate-verified-20260825`,
  `fix/dynamodb-index-arns-admin-roles-20260823`, `fix/deterministic-lambda-zip-timestamps-20260825`) plus
  two older ones not touched this session (`chore/v4.8-binding`, `docs/log-ci-deploy-config-manual-actions`)
  — left alone per CLAUDE.md's no-unplanned-deletion rule; not investigated further, not a blocker.
- **GitHub**: default branch `main`; branch protection returns 403 (GitHub Free plan on a private repo has
  no branch-protection feature — consistent with the Phase 1 finding, not a misconfiguration). PRs #1
  through #66 exist; **#1-#66 are all `MERGED`**, zero open, zero closed-without-merging except #32 (closed
  as superseded, recorded in `docs/MANUAL_ACTIONS.md`). Zero open issues, zero issues ever filed. Exactly 7
  repository Variables and 1 repository Secret (names/values-as-non-secret-config only — the ARNs stored as
  Variables are not secrets; `ALERT_EMAIL` is a Secret, value never read), matching
  `docs/MANUAL_ACTIONS.md`'s record exactly. Zero configured Environments.
- **AWS reachable-surface spot checks**: exactly **one** DynamoDB table exists (`zoryvex-test-core`,
  `ACTIVE`, 3 GSIs, 145 items) — no production table. Exactly **three** SSM parameters exist under
  `/zoryvex/` and all three are under `/zoryvex/test/` — zero under `/zoryvex/production/`. Exactly **51**
  IAM roles exist: 11 AWS-service-linked roles plus 40 `zoryvex-test-*` roles (34 Lambda exec roles
  matching `scripts/build-lambda.mjs`'s handler list, `zoryvex-test-deploy`, `zoryvex-test-health-check-
scheduler`, `zoryvex-test-guardduty-malware-protection`) — **zero** roles with "production" in the name,
  zero unexplained roles. ACM: exactly one cert per region matches the two known TEST domains
  (`test-api.zoryvex.space` in `eu-west-1`, `test.zoryvex.space` in `us-east-1`), both `ISSUED`.
- **Live health, two independent paths**: `curl` from this Bash sandbox and a real page load in the
  Browser pane both hit `https://09ccch2zi4.execute-api.eu-west-1.amazonaws.com/health` and got
  `{"status":"ok","timestamp":"2026-08-25T11:57:46.823Z"}` (Browser-pane check) — the real deployed TEST
  API is live and healthy at the moment this register was written, confirmed twice, independently of CI.

This directly answers the founder's "production untouched" requirement with fresh first-party evidence
rather than a document's memory of a past check.

---

## Phase 0 — Environment, tooling, and path readiness

**VERIFIED (prior session, strong evidence).** `.zoryvex/state.json`'s "Phase 0 overall gate" row plus 15
individual tool/path checks (Claude Code version, git/gh/Node/Terraform/AWS-CLI versions, project path not
a symlink, ANTHROPIC_API_KEY unset, Docker present-not-used). All PASS except two non-blocking WARN/PENDING
items (Windows lifecycle-page fetch timeout; AWS SSO session state, immaterial since routinely re-verified
before any AWS-touching phase). Not re-derived fresh this session — no reason to doubt it, and every tool
this session actually used (`git`, `gh`, `aws`, `node`, `terraform` was not invoked this session) worked
exactly as that gate predicted.

## Phase 1 — Provider account setup (GitHub, AWS, Vercel domain registrar, Paystack, contact assets)

**VERIFIED (prior session, strong evidence)**, sections 1-6 in `.zoryvex/state.json`. This session's fresh
GitHub check (branch protection 403, exactly 7 Variables/1 Secret, GitHub Free plan behavior) corroborates
Section 2 independently. AWS Section 3 (root MFA, no access keys, Identity Center) and Paystack Section 5
were not independently re-checked this session — Paystack has **no configured API access or MCP in this
environment at all** (confirmed: no Paystack credentials, no Paystack MCP among the connected tools), so
any Paystack-state claim this session would have to come from the same founder-dashboard verification
`docs/MANUAL_ACTIONS.md` already records (2026-08-15, human action) — restated as **Unconfirmed by this
session specifically**, not re-verified, not contradicted.

## Phase 2 — MCP capability configuration (21st/GitHub/Filesystem/Context7/Playwright)

**VERIFIED (prior session)** that these were configured. **This session's own environment**: none of the
five are connected (see Environment Constraints above) — this is a session/environment fact, not a
regression in the configuration itself, and is recorded honestly rather than glossed over.

## Phase 3 — Foundation: monorepo scaffold, guardrails, CI gate

**VERIFIED (prior session, strong evidence).** PR #1-#2, CI green, `scripts/scan-secrets.mjs`/`check-
licenses.mjs`/the PreToolUse safety hook all exist and are still active today — this session's own
`npm run validate:all` run (during the Lambda zip-determinism fix) exercised this exact CI gate set live
and it passed clean, which is a fresh, direct re-confirmation that Phase 3's gate machinery still works.

## Phase 4 — Complete local product (marketing site, candidate/employer/admin apps against local fakes)

**VERIFIED (prior session, strong evidence).** 88/88 Playwright + 79/79 Vitest at the time. This session's
own `npm run validate:all` run rebuilt and re-tested the whole monorepo (including `apps/web`'s production
build, which generated all 32 routes cleanly) and it passed — a fresh partial re-confirmation that the
local-fake product still builds and type-checks correctly today, though the full historical Playwright/
Vitest counts were not re-tallied this session (no reason to expect regression; nothing in this session's 3
PRs touched `apps/web` application code, only `scripts/build-lambda.mjs` and `.zoryvex/state.json`).

## Phase 5 — Terraform foundation, no-Cognito resolution, deployment/rollback tooling, CI validation gate

**VERIFIED (prior session, strong evidence).** No-Cognito enforced as a CI gate
(`scripts/terraform-policy-check.mjs`), not just a written rule — this session's own PR #63 and #66 both
ran this exact gate live (via CI's `Validate` job) and it passed both times, a fresh re-confirmation the
gate is still wired in and still enforced, not just historically true.

## Phase 6 — Real AWS TEST environment stood up and accepted

**VERIFIED (prior session, strong evidence)** across bootstrap, cert/SES foundation, DNS, Terraform apply,
static site deploy, and the multi-part TEST ENVIRONMENT ACCEPTANCE gate (real health check, TLS/DNS, upload
constraints, queue/DLQ, real SES email received by the founder, backup/restore rehearsal, spend alarms,
emergency-lockdown rehearsal). This session's fresh spot-checks corroborate the infrastructure is still
exactly as recorded: the DynamoDB table, all 3 GSIs, and 145 items match state.json's own last count
precisely; both ACM certs are still `ISSUED`; all 40 `zoryvex-test-*` IAM roles exist and none are
unexplained; SQS queues (`zoryvex-test-deletion` and its DLQ) were used for real this session and behaved
exactly as documented (redrive-capable, currently empty). Not re-verified fresh this session (blocked by
this environment's network, see above): S3 bucket policies, CloudFront distribution config, SES sending
identity/DKIM, GuardDuty Malware Protection plan config, budget/cost-anomaly-monitor subscriptions — all
carried forward from prior-session real evidence, none contradicted by anything found this session.

## Phase 7 — Auth, evidence, matching, privacy, and operations on the real AWS backend

**ACTIVE, not passed.** `exactSuccessPhrase` remains `"PHASE 7 PASSED"`, not yet achieved. Slice-by-slice:

| Slice                                              | Status                             | Evidence                                                                                                                                                                              |
| -------------------------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Passwordless auth + sessions + WebAuthn step-up | Implemented, merged (PR #16)       | Real round trip independently verified live (see slice 11 row)                                                                                                                        |
| 2. DynamoDB repository layer                       | Implemented, merged (PR #17)       | Exercised for real this session (candidate/match repositories, deletion gate)                                                                                                         |
| 3. Evidence pipeline (upload/scan/download)        | Implemented, merged (PR #18)       | Upload/download/integrity independently verified live 2026-08-21; EICAR fail-closed **VERIFIED (fresh, this session)** — see below                                                    |
| 4. Proof Hiring Kit domain                         | Implemented, merged (PR #19)       | Not yet exercised against live TEST — OPEN, see below                                                                                                                                 |
| 5. Privacy: consent/contact-unlock/export/deletion | Implemented, merged (PR #20)       | Deletion (match+profile path) **VERIFIED (fresh, this session)** — see below. Export remains BLOCKED.                                                                                 |
| 6. Matching baseline + gated Bedrock path          | Implemented, merged (PR #21)       | Scoring algorithm read and confirmed deterministic this session (`services/api/src/domain/matching-service.ts`); live acceptance remains BLOCKED, see below                           |
| 7. Operations/automation                           | Implemented, merged (PR #22)       | Not independently re-verified this session                                                                                                                                            |
| 8. Session read/CRUD + real API client             | Implemented, merged (PR #23/#24)   | Candidate journey independently verified live 2026-08-22 (founder's real browser)                                                                                                     |
| 9. CI-driven OIDC deploy pipeline                  | **VERIFIED (fresh, this session)** | Exercised for real 5 times this session (PR #63/#64/#65/#66 deploys), OIDC role assumption confirmed via CI logs each time, zero static keys, every run's `/health` smoke test passed |
| 10. Load/quota model + regression coverage         | PARTIAL (unchanged)                | Lambda reserved-concurrency quota increase still requested-but-unconfirmed; must not be polled without separate founder authorization (unchanged instruction, respected this session) |
| 11. Deploy + verify + wrap-up                      | IN PROGRESS                        | See the four gates immediately below                                                                                                                                                  |

### Slice 11 gates, individually

- **GSI-permission defect class** — **VERIFIED (fresh, this session).** Read-only audit found
  `admin_exceptions_route` (needs GSI3) and `roles_list_route` (needs GSI2) missing the same IAM-grant
  defect PR #43/#44 had already fixed once for GSI1. Fixed in PR #63, deployed, and independently
  re-verified directly against live IAM this session: `aws iam get-role-policy` on both
  `zoryvex-test-admin-exceptions-exec` and `zoryvex-test-roles-list-exec` returns exactly
  `[base table ARN, correct single GSI ARN]`.
- **Deletion (candidate profile + match path)** — **VERIFIED (fresh, this session).** A synthetic isolated
  fixture (`CANDIDATE#.../PROFILE` + `ROLE#.../MATCH#...` with the exact GSI1 keys access pattern #24
  requires) was written directly to `zoryvex-test-core`, baseline-confirmed via a live GSI1 query, deleted
  via one real SQS message to `zoryvex-test-deletion` that triggered the real deployed
  `privacy-deletion-worker` Lambda (RequestId `3b1b9d99...`, 952ms, zero errors), confirmed gone via
  post-run DynamoDB reads, corroborated by a real `AUDIT#` `candidate_deleted` event and both the deletion
  queue and its DLQ at 0 messages afterward. **Honest scope limit**: no Evidence/S3-file items were in the
  fixture (S3 unreachable from this session's environment), so the S3 evidence-object-deletion sub-path
  remains unexercised.
- **Deterministic matching against live TEST** — **BLOCKED.** `POST /roles/:roleId/recompute-matches` is
  HTTP-only and requires `requireSessionContext` with role `employer_admin`/`employer_member`
  (`services/api/handlers/matches/recompute.ts`). Zero `EMPLOYER#`/`ROLE#` items currently exist in
  `zoryvex-test-core`, so a fresh employer account is required, which requires a real magic-link email
  round trip — a human checking a real inbox, the same pattern every prior auth-round-trip gate in this
  project used (`docs/DEPLOYMENT_STATUS.md`'s "purpose-built, security-reviewed local helper" line).
  Deliberately **not** routed around by forging an auth token from the token-pepper secret, or by directly
  invoking the Lambda with a fabricated `requestContext.authorizer` object once Lambda's control plane
  turned out to be reachable (see the EICAR row below) — both would mean asserting a session that was never
  actually verified, the exact thing this gate exists to prove really happened.
- **Export (self-service data export)** — **BLOCKED**, same reason: `services/api/handlers/privacy/
export.ts` requires `requireSessionContext` with role `candidate`, HTTP-only, no queue/worker alternate
  path the way deletion had. Never exercised against live TEST at all — not attempted-and-failed, simply
  unreachable without the same human email-check step.
- **EICAR fail-closed** — **VERIFIED (fresh, this session).** The S3 gap recorded in the original
  Environment Constraints section turned out to be an addressing-style artifact, not a hard block: this
  sandbox can reach the bare regional endpoint (`s3.<region>.amazonaws.com`) but not virtual-hosted-style
  per-bucket subdomains. Setting `AWS_ENDPOINT_URL_S3=https://s3.eu-west-1.amazonaws.com` forces path-style
  addressing and fully restores access, with zero change to `scripts/verify-evidence-eicar-fail-closed.mjs`
  itself. Ran it exactly as designed against the isolated EICAR bucket and got a genuine, directly-captured
  result: `PASS: GuardDuty correctly flagged the EICAR test file as THREATS_FOUND.` — the object was streamed
  via stdin only (never touched local disk) and deleted immediately after (confirmed gone via a follow-up
  `HeadObject` 404; the real evidence bucket was never touched). The same fix revealed Lambda's control
  plane is reachable too (`aws lambda get-function-configuration` succeeded) — this does **not** unblock
  matching/export, since the missing piece there is a real verified session, not network reachability; see
  the matching row above for why directly invoking those Lambdas was deliberately declined anyway.
- **Proof Hiring Kit order/webhook/generation** — **OPEN — not yet attempted**, and also gated behind the
  same employer-auth blocker for its preview/order endpoints (checked this session:
  `services/api/handlers/kit/preview.ts` requires an employer session too, so there is no unauthenticated
  "free preview" surface to test around the blocker). Must never touch live Paystack per every standing
  instruction; stays last in sequence regardless.

### Non-blocking open items carried forward

- **Lambda build/zip non-determinism** — **RESOLVED and independently confirmed live, twice, this session**
  (PR #66). Root cause confirmed empirically (`yazl`'s `addFile()` stamps each zip entry with the bundle
  file's own fresh mtime unless an explicit `mtime` is passed); fixed by pinning a fixed date. All 37 handler
  zips are byte-identical across independent local rebuilds. The one-time transition deploy correctly showed
  all 37 Lambdas changing for real (the zips' bytes genuinely changed that one time). The proof this actually
  fixed the live pipeline: the next two docs-only deploys (PR #67's merge and PR #68's merge) both produced
  `Plan summary: +0 ~0 -0` — a completely empty plan — where every prior docs-only deploy this session showed
  `~37` or `~39` in-place changes. Fully closed, not a remaining open item.
- 145 accumulated TEST-environment DynamoDB records — unreconciled, not all synthetic (includes the
  founder's own real TEST candidate profile), so any cleanup must stay selective. Not touched this session.
- Trailing-slash 404 on extensionless CloudFront routes — unconfirmed whether the magic-link email itself
  builds URLs without a trailing slash. Not checked this session (needs the custom domain, unreachable).
- Playwright MCP reconnect, CloudFront error-rate alarm (documented cross-region Terraform provider
  limitation), visual-regression-snapshot gap from Phase 4 — all carried forward unchanged, none touched
  this session.
- AWS Lambda concurrency quota increase case — remains open, must not be polled without separate founder
  authorization. Not polled this session.

## Amendments integrated (2026-08-25)

Three binding amendments landed mid-session, each explicitly requiring integration into this register and
`.zoryvex/state.json` without restarting or repeating completed work. All three are additive/clarifying —
none contradicts anything already built or already recorded as passed.

- **Product-direction amendment**: confirms, not changes, the fixed product already encoded in `CLAUDE.md`
  and `docs/PRODUCT_SPEC.md`/`docs/ACCEPTANCE_CRITERIA.md` (one NGN 29,000 Kit — the price at the time; raised to 95,000 on 2026-08-30 — candidates free, the 5-real-
  match marketplace gate, verified-hires as the north star). Answered by adding the Execution Compass
  section above; no code or further doc change was needed since the repo already matched the amendment.
- **MLOps role-taxonomy amendment**: expands the three launch tracks to four by adding **one** new canonical
  `LaunchTrack` value, `mlops` — not four separate structural tracks for MLOps Engineering / ML Platform
  Engineering / ML Infrastructure Engineering / AI Platform Engineering. Reasoning: the launch track is a
  _structural_ partition (GSI1's `TRACK#<launchTrack>` discovery key, `docs/DATA_MODEL.md` access pattern
  #7, and the denominator the 5-real-match marketplace gate counts against per role). Splitting one small
  emerging specialism into four near-identical structural tracks would fragment matches across four tiny
  buckets, making the 5-match gate materially harder to reach for a candidate pool this is meant to serve —
  directly working against the amendment's own commercial mechanics. The amendment's own wording supports
  this: "treat related titles as **discoverable aliases** while preserving their distinctions" describes a
  search/label layer, not four separate partitions. Design: `mlops` is the one new `LaunchTrackSchema` enum
  value; a new canonical, versioned taxonomy module carries the alias job titles (MLOps Engineer, ML
  Platform Engineer, ML Infrastructure Engineer, AI Platform Engineer, and related titles), the 20 listed
  MLOps capability areas as a structured skill/evidence-category vocabulary for employer filters, evidence
  tagging, and Kit checklist generation, and explicit non-membership guidance (a data scientist, generic AI
  engineer, or generic cloud engineer is not automatically MLOps). This is additive and backward-compatible
  — existing candidate/role/match records are untouched; `mlops` is a new selectable value, not a migration.
  Mapped into the existing phase sequence exactly as the amendment specifies (Phase 3 taxonomy/schema, Phase
  4 UI, Phase 7 evidence/matching/search/consent/operations, Phase 8 Kit purchase, Phase 9 CI/migration,
  Phase 10 adversarial review, Phase 11 controlled release, Phase 12 monitoring) — implementation begins with
  the Phase 3/7-level taxonomy-and-schema foundation, since every later layer depends on it; not attempted
  in a single pass given its genuine cross-cutting size (candidate UI, employer UI, matching, evidence
  schemas, Kit generation, tests, and ~10 docs), sliced the same way every other multi-file Phase 7 change
  in this project has been sliced (one branch/PR per coherent layer, each independently reviewed and merged).
- **Paystack-scope amendment**: narrows Phase 8's Paystack surface to the eight listed responsibilities
  (initialize, redirect, receive signed webhooks, verify, check idempotency, record minimal reconciliation
  evidence, handle failure/unavailability truthfully) plus a founder-only, read-only, warning-threshold
  collection-limit indicator — explicitly forbidding any Zoryvex-side control that stops, throttles, or
  pretends to change Paystack's own provider limit. **One real correction made to existing documentation**:
  `docs/PRODUCT_SPEC.md`'s Paystack section previously stated "Zoryvex's own hard checkout cap ... currently
  NGN 6,000,000 ... enforced server-side on every new Kit/subscription checkout" — exactly the kind of
  automatic-stop-at-6M plan this amendment says to remove. Corrected to describe NGN 6,000,000 as the first
  **warning** threshold (75% of the current NGN 8,000,000 Starter Business limit) on a private founder/admin
  indicator, not a checkout cutoff, with the full five-tier warning scale from the amendment. Checked and
  confirmed: no code anywhere in `services/`, `apps/`, `packages/`, or `scripts/` implemented a 6M cap either
  — this was a documentation-only conflict, now resolved. The collection-limit indicator itself is Phase 8
  (production-deployment) scope per the amendment's own text ("After production deployment, provide..."),
  so it is recorded here as scoped-but-not-yet-built, not implemented this session.

## MLOps taxonomy implementation — what was built, verified, and deliberately left as future enhancement

- **Built and merged**: `mlops` LaunchTrack (PR #69), canonical alias/capability taxonomy module (PR #69),
  public marketing copy across six real user-facing surfaces (PR #70), the CLAUDE.md-supersession decision
  record (`docs/DECISIONS.md`, part of PR #69).
- **Verified already working end-to-end with zero further code**, because the existing codebase was already
  built generically against `LaunchTrack` rather than hard-coded per-track logic: `npm run typecheck` across
  every workspace found exactly one place needing an update for the new value
  (`LAUNCH_TRACK_LABELS`, a strict `Record<LaunchTrack, string>`) — every candidate/employer UI dropdown
  (`onboarding`, `roles/new`) iterates that record generically, `role-service.ts`/`candidate-profile-
service.ts` type `launchTrack: LaunchTrack` with no hard-coded list, matching (`matching-service.ts`)
  scores any role's free-text `mustHaveWork` against any candidate's free-text evidence claims regardless of
  track, and `docs/ACCEPTANCE_CRITERIA.md`'s criteria are already track-agnostic (checked directly — no row
  names a specific track or needs an MLOps-specific addition). This means an employer can already create an
  MLOps role and a candidate can already build an MLOps profile that matches against it, today, using the
  free-text mechanism every other track already uses.
- **Deliberately not built this session, as optional future enhancement rather than a closing functional
  gap**: (1) structured per-claim skill/evidence tagging by the taxonomy's capability-area ids (currently all
  evidence is free text, which already works via keyword-overlap matching); (2) employer-facing candidate
  search/filter UI (does not exist for _any_ track today — the product works via employer-creates-role →
  system auto-matches opted-in candidates, not manual browsing — building this from scratch "for MLOps"
  would be speculative scope well beyond the amendment's taxonomy request); (3) surfacing the capability
  taxonomy as autocomplete suggestions in the Kit checklist/role-creation UI (a genuine but purely cosmetic
  improvement); (4) adding an `mlops` example to `packages/local-adapters/src/fixtures/roles.ts` — checked,
  and declined deliberately: those three fixtures are precision-built to test the marketplace 5-match gate
  at exactly 5/4/0 matches each, and a 4th role would need matching new candidate/match fixtures to be
  meaningful, carrying real risk of subtly disturbing that specific test design for cosmetic value only.

## Phase 8 — Paystack test-mode payment slice (2026-08-25)

**Implemented, TEST mode only, not yet independently verified live** (blocked on the same human-session
requirement as Phase 7's matching/export gates — see below). No founder prompt has formally opened "Phase
8" by name; this work proceeded under the founder's explicit, binding instruction to "begin the minimal
Phase 8 Paystack test-mode slice now," which is itself the required authorization.

Built exactly the eight-point amendment scope, no more: `services/api/src/lib/paystack-client.ts` (the
only two outbound Paystack calls anywhere in this codebase — initialize, verify); `kit-service.ts`'s
`requestKitOrder` now returns a real `authorizationUrl`; `paystack-webhook-service.ts` independently
verifies status/reference/currency/amount via a second server-to-server call before granting any
entitlement, never trusting the webhook body's claims alone; `checkout/page.tsx` wired to redirect to the
real Paystack hosted checkout when `NEXT_PUBLIC_API_BASE_URL` is configured. Terraform: `kit_create_order_route`
granted the same `secure_ssm_parameter_arns`/`PAYSTACK_SECRET_KEY_PARAM` access the webhook route already
had, plus `APP_ORIGIN` for the callback URL — mirrored in both `test` and `production` (production
source-only, not applied). Full reasoning, including two deliberate design choices (verify independently
rather than trust the webhook body; swallow verify-unreachable rather than let it interact badly with
webhook idempotency) and one deliberate scope boundary (the role page's Kit-status display stays
local-fake-only, not one of the eight points), recorded in `docs/DECISIONS.md`'s 2026-08-25 entry and
`docs/PAYMENTS.md`'s new "Implementation status" section.

**Verified before merge**: `npm run typecheck` clean across every workspace; `npm test` green (490/490,
+9 new); `terraform fmt`/`validate` clean for both environments; `terraform-policy-check.mjs` clean (71
files); `scan-secrets.mjs` clean. TEST mode only, enforced structurally (whichever secret key is
configured in `/zoryvex/test/paystack/secret-key` — this codebase has no live-mode code path at all, only
one client module with no branch on environment). Production and live Paystack remain completely untouched.

**Independently verified live 2026-08-26**, which this section previously said was still outstanding. Three
real defects were found and fixed in sequence before it worked — a missing `idempotency-key` in the API's
CORS allow-headers, a colon in the Paystack reference that Paystack rejects, and a Test Webhook URL in the
Paystack dashboard pointing at the wrong host — and then one real TEST-mode checkout completed end to end:
`KITORDER#aa2340a5` moved pending -> succeeded and `KITARTIFACT#00001` was generated ~15s later, confirmed
by reading DynamoDB directly. That round trip also proves the `paystack-client.ts` field mapping that
`docs/RISK_REGISTER.md` had carried as unverified, `currency` casing included: the order cannot reach
`succeeded` unless the independent verify call returns `status: 'success'`, a matching reference, `NGN`
uppercase, and the exact kobo amount.

**The role page's Kit-status display, recorded here and in `docs/DECISIONS.md` as a deliberate scope
boundary, is closed.** `GET /roles/{roleId}/kit-status` exists, is deployed, and both the employer
dashboard and the role page read it.

## Phases 9-12

**N/A — not yet implemented.** No founder prompt has formally opened these phases. Phase 10 (adversarial
review) and the remaining pre-production items are the next planned work once Phase 8/7 close out.

## Production and live Paystack status

**Unchanged, fresh evidence this session**: zero DynamoDB tables, zero SSM parameters, and zero IAM roles
reference `production` in any AWS-reachable surface this session checked. `.github/workflows/ci.yml` has no
production-apply job (unchanged from prior verification). No Paystack call of any kind was made or attempted
this session — no Paystack credentials or MCP are even present in this environment.
