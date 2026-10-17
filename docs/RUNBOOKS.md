# Runbooks

Operational incident response. Distinct from `docs/LOOP_RUNBOOK.md` (how this multi-phase build process
itself runs) and `docs/COMMERCIAL_RUNBOOK.md` (commercial/growth operating rules) — this document is about
what a human does when something is actually broken. Nothing in this document is itself authorization to
act; it is the plan a founder-approved action follows.

There _is_ something to run it against now, which an earlier version of this line denied: the TEST
environment is live, with 45 Lambdas, a CloudFront-fronted site on `test.zoryvex.space`, and one real
Paystack test-mode transaction that completed end to end. Production remains unapplied. See
`docs/DEPLOYMENT_STATUS.md`.

## Incident (general)

1. Identify the blast radius: which layer (`docs/ARCHITECTURE.md`'s frontend/API/data/evidence) is
   affected, and whether it's read or write traffic.
2. Check CloudWatch for the affected Lambda(s)/API Gateway stage — error rate, latency, throttling.
3. If the cause is a bad deploy, prefer `scripts/rollback.mjs --env <env> --confirm <env> --app-code-only`
   (real as of Phase 5, reviewed but not yet exercised against a real deployment — see its own file header)
   over a forward-fix under pressure.
4. Record the incident: what broke, when noticed, when mitigated, root cause, follow-up — in a dated entry
   appended to this file (not a separate ticket system, to keep one place a non-technical founder can read).

## Spend spike

1. The budget/cost-anomaly alerts already configured (see `docs/MANUAL_ACTIONS.md` "AWS billing/cost
   protections reused") are the first signal — this runbook starts once one fires.
2. Identify which service is driving the spike via Cost Explorer, cross-referenced against
   `docs/COST_GUARDRAILS.md`'s expected-cost model.
3. If a feature flag (`packages/config`) is the fastest safe lever (e.g. `aiMatching` runaway invocation
   volume), disable it first — that's a config change, not a deploy, and reversible in seconds.
4. If the driver is a genuine traffic spike rather than a bug, this is a product/business decision (pricing,
   capacity), not purely operational — escalate to the founder rather than silently absorbing the cost.

## Webhook backlog

1. Paystack retries failed webhook deliveries on its own schedule; a backlog usually means the endpoint was
   erroring, not that events are lost.
2. Check the `WEBHOOK#body:<sha256>` dedupe records (see `docs/DATA_MODEL.md`) against Paystack's dashboard
   delivery log to find the gap. The key is a hash of the raw body rather than an event id because
   Paystack's payloads do not carry one; a retry redelivers the identical bytes and therefore the
   identical key.
3. Because processing is idempotent by design (`docs/PAYMENTS.md`), replaying missed events from Paystack's
   dashboard is safe — it will never double-apply an entitlement.
4. A delivery that failed part-way deletes its own marker and returns 5xx precisely so Paystack's
   retry re-attempts rather than being swallowed as a duplicate. If the founder was alerted that a
   marker could not be cleared, that specific event is stuck and does need a hand.
5. Root-cause the original failure (signature verification bug, timeout, downstream DynamoDB throttling)
   before considering the backlog resolved.

## Model failure (AI matching)

1. If Bedrock is erroring or returning unusable output, the safe default is: treat the AI layer as
   unavailable and fall back to the non-AI experience (plain search/list), never surface a broken or
   partially-hallucinated summary to a candidate/employer.
2. Because `aiMatching` is a feature flag (`docs/AI_SAFETY.md`), the fastest mitigation is disabling it,
   not patching a prompt under pressure.
3. Any incident here is cross-checked against `docs/AI_SAFETY.md`'s prohibited-output list before being
   closed — a "failure" that turned out to be a policy violation (e.g. a biased ranking) is a safety
   incident, not just an availability one, and is recorded as such.

## Domain/certificate expiry

1. `infrastructure/envs/{test,production}`'s `aws_cloudwatch_event_rule.acm_certificate_expiring` (Phase 7
   slice 7) fires daily starting 45 days before an ACM certificate expires — the alert email names the
   `CommonName` and `DaysToExpiry`.
2. Amazon-issued certificates (every certificate this project uses, `infrastructure/modules/acm-cert`)
   auto-renew via DNS validation as long as the validating CNAME record is still present at Vercel — check
   `docs/DNS_RUNBOOK.md`'s record table first; a still-firing alert close to expiry almost always means a DNS
   record was removed or changed, not that ACM itself failed.
3. If a record was removed/changed, restore it exactly per `docs/DNS_RUNBOOK.md` and re-check the
   certificate's `RenewalSummary` (`aws acm describe-certificate`) for `RenewalStatus: SUCCESS`.
4. A genuinely failed renewal this close to expiry is a founder-escalation event — a lapsed certificate
   breaks HTTPS for the whole environment.

## "I paid and nothing happened"

The single most likely support message once subscriptions are live, and the reason the billing
diagnostic exists.

1. Open `/admin/billing` and look the organisation up by employer id. Read the **findings** first;
   they are written as sentences precisely so this step is not detective work.
2. If a payment attempt sits at `initialized` or `pending`, Paystack never told us the outcome and
   is not going to: it webhooks successful transactions only. The hourly reconciliation job settles
   these, so check whether the last run has happened yet (CloudWatch logs for
   `zoryvex-<env>-billing-reconciliation`) rather than intervening.
3. If the attempt is `success` but the entitlement disagrees, the `subscription.create` webhook did
   not land. Check Paystack's dashboard delivery log for that transaction, and confirm the webhook
   URL is still set for that mode. Redeliver from the dashboard; processing is idempotent and
   cannot grant twice.
4. If the attempt does not exist at all and Paystack shows the payment, reconciliation will have
   already alerted with the reference. That means money arrived against a reference this system did
   not create, which is a dashboard-created transaction or a genuine gap. Resolve by hand and
   record it.
5. Never grant access by editing the entitlement directly without also recording why. The
   diagnostic compares the entitlement against what the subscription implies, and a hand-edit with
   no subscription behind it shows up permanently as drift.

## Subscription renewal failed

1. The alert names the employer, the invoice, and the bank's reason. Paystack does **not** retry:
   the next attempt is the next payment date, a month away.
2. Access continues for `PAYMENT_FAILURE_GRACE_DAYS` (seven) from the failure. The employer's own
   billing page already shows the reason, the deadline, and a button to Paystack's hosted
   card-update page. No action is needed from the founder for the common case.
3. If the grace window closes, access moves to `suspended` on its own, because access is derived
   rather than stored. Nothing has to be run.
4. Do not extend the window by editing data. If a specific customer deserves more time, say so to
   them and record the decision; a silently different rule for one account is a rule nobody can
   reason about later.

## Reconciliation reported a discrepancy

1. Every discrepancy names a reference and what was inconsistent about it. There are only four
   shapes: a payment recovered late (webhook delivery is broken), an amount or currency mismatch
   (nothing was granted, investigate before granting anything), a status Paystack has added since
   this code was written (do not guess what it means), or a successful Paystack payment with no
   record here.
2. A recovered payment is the one that always needs follow-up even though the customer is fine: it
   means a webhook did not arrive, and that will happen again. Check the webhook URL and the
   delivery log.
3. An unrecognised status is a code change, not an operational fix. Read Paystack's current
   documentation, add the status to `PAYMENT_STATUSES`, and decide deliberately whether it is
   terminal.

## Subscription cannot be cancelled

1. The diagnostic reports `hasCancellationToken: false`. Paystack requires the pair
   (`subscription_code`, `email_token`) to disable a subscription, and the token arrives only on
   `subscription.create`.
2. Recover it with `GET /subscription/:code` against the Paystack API, which returns `email_token`,
   and write it back onto the stored subscription. Never log or paste it anywhere else: it is the
   credential that cancels somebody's subscription.
3. Until then, cancel on the customer's behalf from the Paystack dashboard so they are not billed
   again while the record is repaired.

## Paystack dispute

1. `handlers/webhooks/paystack.ts` (Phase 7 slice 7) alerts and appends a `paystack_dispute_event` AuditEvent
   for every `charge.dispute.create`/`.remind`/`.resolve` event — it never auto-resolves anything; the
   dispute itself is worked entirely in the Paystack dashboard.
2. Open the dispute in the Paystack dashboard (Payments > Disputes) using the dispute id from the alert
   email, review the transaction and the reason given, and respond with evidence per Paystack's own dispute
   process before their deadline.
3. A `charge.dispute.resolve` event closes the loop — no application state needs manual correction either
   way, since the Kit order/entitlement flow was never touched by the dispute events themselves.
4. A pattern of repeated disputes from the same employer, or a dispute rate that looks abnormal, is a
   founder decision (possible fraud, chargeback abuse), not purely operational — escalate rather than
   silently absorbing it.

## Data incident

1. This path is intentionally **not automated** (CLAUDE.md/Prompt 7: "a documented founder-triggered path,
   not automated") — no code in this repository detects or classifies a data incident on its own; a human
   (the founder, or someone who reports it to the founder) is always the first signal.
2. Identify scope first: which entity type (candidate/employer), how many records, whether the exposure was
   read-only or a real leak/deletion, using `GET /admin/exceptions` (Phase 7 slice 7) and CloudWatch/
   CloudTrail as the evidence sources — never guess scope before checking.
3. If candidate/employer data was exposed, contain first (revoke the specific credential/session per
   "Compromised credential" below, or disable the affected route via a feature flag), then assess, then
   notify — in that order, never notify before containment is at least attempted.
4. Record the incident in this file's dated-entry log (see "Incident (general)" above) with what was exposed,
   to whom, root cause, and remediation — this record is what any future legal/privacy obligation
   (`docs/PRIVACY_AND_RETENTION.md`) would be built from; CLAUDE.md's Nigerian-obligations boundary still
   applies (no NDPC filing/notification is prepared or sent by this assistant without explicit separate
   founder authorization).

## Compromised credential

1. Rotate the specific credential first (Parameter Store SecureString value, GitHub PAT, MCP API key —
   whichever was exposed), using the same secure-entry pattern already established in
   `docs/MANUAL_ACTIONS.md`'s Phase 2 entries. Never leave a known-exposed credential live while
   investigating.
2. Check `docs/SOURCES.md`/`docs/MANUAL_ACTIONS.md` and CloudTrail/GitHub audit log for what the credential
   could have accessed, scoped by the least-privilege boundary that credential was issued with (see
   `docs/THREAT_MODEL.md` "overly broad Lambda execution role" — the same least-privilege principle bounds
   how bad this can be).
3. If the credential could have touched Paystack or AWS billing, that is escalated to the founder
   immediately, not resolved silently.

## Deploy (test), through the pipeline

Not an incident procedure — the one everything else here assumes has happened.

1. **What starts it.** A merge to `main`. `.github/workflows/ci.yml` runs `changed-paths`, `validate` and
   `e2e`; `deploy-test` runs only if all three genuinely succeeded and the change was not docs-only. It
   assumes `zoryvex-test-deploy` by OIDC — no AWS key exists for CI, and none can be added.
2. **What it does.** `node scripts/deploy.mjs --env test --confirm test --apply`: resolves the backend from
   the account it is authenticated as, plans, saves the exact plan artifact, refuses the plan if it would
   destroy a stateful resource or blank a live non-empty setting, applies _that saved plan_ rather than a
   fresh one, rebuilds and syncs `apps/web/out` to the site bucket, smoke-tests `/health`, reports
   feature-flag drift, and records the commit as last-known-good.
3. **What a healthy run looks like.** A plan summary with no destroys, `Smoke test passed`, and a site-sync
   line with a real upload count. The feature-flag report is expected to say `payments` and `contactUnlocks`
   are off live until that parameter is written by hand (`docs/MANUAL_ACTIONS.md`).
4. **How to check it landed**, rather than trusting the run:
   `curl -s -o /dev/null -w '%{http_code}' https://test-api.zoryvex.space/health` for 200, and
   `curl -s https://test.zoryvex.space | head` for the new build. Deliberately a GET, not `curl -sI`: the
   route is declared `GET /health`, so a HEAD request matches nothing and returns 404 on a perfectly
   healthy API. This said `-sI` until 2026-09-02 and would have reported a working deployment as broken,
   which is worse than having no check at all, because a check that cries wolf is one people learn to skip.

   HTML is served with `max-age=0, must-revalidate` and the distribution's default behaviour has a
   60-second TTL, so a change is visible within about a minute; there is no invalidation step and none is
   needed.

   To check a specific change rather than that _something_ deployed, do not grep the page HTML for it. Next
   does not list every chunk there, so absence proves nothing. Find which chunk holds the string in the
   local build (`grep -rl "<the string>" apps/web/out/_next/static/chunks/`), then fetch that same filename
   from the live site — the name is content-derived, so a match means the deployed bytes are the built
   bytes.

   **Why no invalidation is needed, and what would break it.** Two rules hold at once, and both must:
   `_next/static/**` is content-hashed, so a changed file is a changed filename and a year-long cache is
   safe; everything else revalidates. `scripts/sync-static-site.mjs`'s `cacheControlFor` sets the origin
   header, and `infrastructure/modules/static-site` keeps the distribution's own default TTL short. They
   protect different caches — CloudFront caps how long it holds an object, but passes the origin's
   `Cache-Control` through to the _viewer_, so a long `max-age` on HTML would sit in people's browsers
   whatever the distribution did, and no invalidation can reach a cache inside somebody else's laptop. Both
   halves are guarded: `terraform-policy-check.mjs` for the distribution, `sync-static-site-guard.test.mjs`
   for the origin header. If either guard is ever loosened, this deploy starts needing an invalidation step
   it does not have.

5. **If Actions was unavailable when the merge landed.** The run fails to start and nothing re-triggers it
   when the allowance resets. Re-run that failed run from the Actions tab — it replays the original push
   event exactly — or use the workflow's `Run workflow` button on `main`.
6. **If the apply fails.** Nothing is rolled back, because the apply is where it stopped; read the error and
   fix forward. If the _smoke test_ fails, application code is rolled back automatically to the last
   known-good commit and the original error is what to read, not the rollback's.

## Rollback

1. Every deploy this project ever does goes through `scripts/deploy.mjs` (test) or `scripts/release.mjs`
   (production, the one reviewed production entry point — see `.claude/hooks/pre-tool-use.ps1`), both real
   as of Phase 5: they show a plan, save the exact plan artifact under `.terraform-plans/`, require an exact
   environment-name confirmation (production additionally requires typing the literal word `PRODUCTION`),
   apply only the saved plan file (never a fresh plan), and run a smoke test against `/health` after
   applying. Application code is automatically rolled back to the last known-good commit
   (`scripts/rollback.mjs --app-code-only`) if that smoke test fails.
2. Terraform/infrastructure and data rollback is never automatic — `scripts/rollback.mjs` refuses to do
   anything beyond `--app-code-only`. A bad infrastructure change is rolled back via a new, reviewed
   plan/diff that reverts it, applied the same way as any other change (`scripts/deploy.mjs`/
   `scripts/release.mjs`) — never `terraform apply` of stale local state, and never `terraform destroy`
   (hard-blocked by `.claude/hooks/pre-tool-use.ps1`).
3. Application code rollback is a redeploy of the last known-good commit (`git log` on `main`,
   the SSM String parameter `/zoryvex/<env>/last-good-commit`), not a force-push or history rewrite.
4. `scripts/deploy.mjs` has been exercised against TEST for real, which an earlier version of this line
   denied: the 2026-08-26 CORS and Paystack-reference fixes were deployed through it. What has _not_ been
   exercised is a rollback — no smoke test has ever failed, so the auto-rollback path has never run
   outside its unit tests. Treat it as reviewed, not proven. The pure decision logic (confirmation gates,
   plan-summary parsing, dangerous-destroy detection, blanking detection) is unit tested in
   `scripts/lib/deploy-lib.test.mjs`.

## Data restore

1. DynamoDB point-in-time recovery is enabled on the core table (`infrastructure/modules/data`,
   `point_in_time_recovery.enabled = true`) — restore targets a specific timestamp, into a new table, which
   is then verified before any cutover, never restored directly over the live table.
2. S3 evidence bucket versioning is enabled (`infrastructure/modules/evidence-storage`) — an accidental
   overwrite/delete is recoverable from a prior object version within the versioning/lifecycle window.
3. Any restore that could affect real candidate/employer data requires founder approval first, per
   `CLAUDE.md`'s "no data destruction without a plan, a diff, a tested rollback, and explicit founder
   approval" — restores are a form of data change, not an exemption from that rule.

## Capture a rollback artifact before a Terraform apply

Run this before any apply that updates Lambda code. It is not optional caution: the api-route module
creates functions without `publish`, so AWS keeps only `$LATEST` and retains no previous version.
Verified against a live function on 2026-09-01, which reports `$LATEST` and nothing else. The moment
an apply updates a function, the code that was running is gone from AWS, and it is not reconstructible
from the repository either, because nothing records which commit built what is currently deployed.

Get the affected function names out of the saved plan, then capture them:

```
terraform show -json <plan> > plan.json
node -e "const p=require('./plan.json');console.log(p.resource_changes.filter(c=>c.type==='aws_lambda_function'&&c.change.actions.join()==='update').map(c=>c.change.before.function_name).join(' '))"
node scripts/capture-rollback-artifact.mjs --out <dir> <functionName>...
```

The script downloads each function's live deployment package and refuses to record one whose SHA-256
does not match the `CodeSha256` AWS reports for it. An unverified copy is a file, not a rollback.

Capture the rest of the pre-apply state alongside it:

- the exact Terraform state version, by version id, from the versioned state bucket
  (`zoryvex-terraform-state-<account>`, key `test/terraform.tfstate`)
- `aws cloudfront get-distribution-config` for the site distribution, if the plan touches it
- `aws iam get-role-policy` for every role policy the plan rewrites

### The 2026-09-01 billing apply

Artifact at `C:\Users\zerah\zoryvex-rollback\2026-09-01-billing-apply` (outside the repository, so it
is never committed; that is also its weakness, and it is the same weakness the authorizer's artifact
has). 12.7 MB. Contents: 45 hash-verified Lambda packages plus `manifest.json`, the pre-apply state
file at version `lBx18NM7MgzGQM6F2R5nqLBkughtTnGy` (last modified 2026-08-28), the CloudFront config
for distribution `E2ZEO82ZLVJKWW`, and 6 IAM role policies.

Every package was hash-checked twice by two separate code paths and every archive opened to confirm it
is a readable zip rather than a truncated download. What was **not** exercised is the restore itself:
running `aws lambda update-function-code` to prove it works would be a deployment, and deploying code
to prove a rollback works is the thing the rollback exists to protect against.

Note for that apply specifically: `/zoryvex/test/last-good-commit` does not exist, so
`scripts/rollback.mjs --app-code-only` has no anchor and cannot be used. A successful apply is what
creates it. Until then the captured artifact is the rollback.

Rollback order, lightest first. A new billing route misbehaving needs nothing undone, because nothing
depended on it. A misbehaving hourly job needs its schedule disabled. A caching problem needs the saved
distribution config restored, allowing 10-15 minutes to propagate each way. A single bad function needs
that one package restored. Restoring the state file is the last resort, never the first: a state file
that disagrees with reality causes worse problems than the one being fixed.

### The 2026-09-01 location deploy

Artifact at `C:/Users/zerah/zoryvex-rollback/2026-09-01-location-deploy`, 50 hash-verified
packages plus `manifest.json`. Unlike the billing apply, this one also had a working automatic
fallback: `/zoryvex/test/last-good-commit` exists now, so `scripts/rollback.mjs --app-code-only`
could redeploy the previous commit and rebuild the bundles deterministically. The captured
artifact is the faster path and the belt to that braces.

Worth knowing for any future code-only deploy: editing anything in `packages/contracts` changes
every Lambda's bundle, because it is bundled into all of them. A four-file change planned as
fifty function updates, which is correct rather than alarming, and it means a contracts change
is always a full redeploy.

One thing a plan cannot show in advance, met here: the two scheduler IAM policies derive from
the Lambda ARN being updated, so Terraform reports their new value as unknown. Read them back
after the apply rather than assuming. Both were byte-identical in substance, still
`InvokeOwnFunctionOnly` scoped to one function.
