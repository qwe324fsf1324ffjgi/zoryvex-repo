# Zoryvex — production operations

The single entry point for running the live system. If you are new to this
repository, read this page top to bottom once; after that, use it as an index.

**Live:** https://zoryvex.space · **API:** https://api.zoryvex.space
**Region:** eu-west-1 · **Deployed commit:** check `/health`, never assume

---

## What Zoryvex is, in one paragraph

Employers cannot tell who can actually do the work. Candidates who can do it
cannot prove it. Zoryvex checks a small number of claims against sources the
candidate does not control — a certification confirmed with the body that
issued it, and control of a public repository proven by a one-time code
published in a public gist — and shows employers only what was checked.
Candidates are free. Employers pay.

What Zoryvex deliberately does **not** do: accept an uploaded file as proof,
accept a colleague's word as proof, or let an AI make a hiring decision. Those
were removed on purpose. A file is the candidate's; a colleague is someone they
chose; and a model that decides is a model nobody can appeal.

---

## First five minutes

```bash
curl -s https://api.zoryvex.space/health
```

Everything else is a detail. This tells you what is actually running.

```bash
curl -s -o /dev/null -w "site %{http_code}\n" https://zoryvex.space/
curl -s -o /dev/null -w "api  %{http_code}\n" https://api.zoryvex.space/candidates/me
```

Expect `200` then `401`. A `200` on the second line would be an emergency.

```bash
curl -s https://zoryvex.space/employer/sign-in | grep -c "secure, one-time sign-in link"
```

Expect `1`. `0` means the **demo build** is live: every page returns `200`,
nobody can sign in, and nothing calls the API. That has happened before.

---

## The shape of the system

| Piece | What it is |
| --- | --- |
| Frontend | Next.js static export in a **private** S3 bucket, served through CloudFront with OAC |
| API | API Gateway HTTP API in front of **55 Lambdas**, one per route |
| Auth | Lambda authorizer on 44 of 51 routes; opaque server-side sessions, `__Host-` cookie. **No Cognito, ever** (ADR 0001) |
| Data | One DynamoDB table, on-demand, 3 GSIs, PITR on |
| Evidence | Private versioned S3 |
| Secrets & flags | SSM Parameter Store; flags read on **every** invocation, never cached |
| Email | SES |
| Payments | Paystack, HMAC-SHA512 webhook, hourly reconciliation |
| Everything above | Terraform. Nothing is clicked into existence |

Diagrams: [`diagrams/README.md`](diagrams/README.md).

---

## Where things are

```
apps/web                 the application
apps/web-safe-shell      neutral status build
services/api             55 handlers + domain services
packages/contracts       zod schemas — the shared truth
packages/config          feature flags, pricing
packages/local-adapters  fakes used by tests
infrastructure/envs      bootstrap · foundation · test · test-secrets · production
scripts/                 release · rollback · emergency-cost-lockdown
```

Two rules that explain most of the layout:

1. **Entitlement is derived in exactly one place.**
   `grantsMarketplaceAccess(deriveAccess(subscription, now))`. If you need to
   know whether somebody has paid, call that. Do not re-derive it.
2. **The browser never decides anything that matters.** Access follows from a
   verified webhook or from reconciliation, never from a client callback.

---

## Deploying

There is **no automatic production deploy.** A push to `main` deploys to
**test** and stops there. Production is a deliberate act.

```bash
node scripts/release.mjs --confirm-env production --confirm-release PRODUCTION
```
Plans only. **Read the plan.** Confirm the destroy count is `0`.

```bash
node scripts/release.mjs --confirm-env production --confirm-release PRODUCTION --apply
```
Changes production.

The release script refuses to build the site if the API URL is missing or not
`https`, and refuses to upload if a demo marker appears in the built pages.
Both guards exist because both failures happened.

Full procedure: [`docs/deployment/POST_DEPLOYMENT_MANUAL.md`](docs/deployment/POST_DEPLOYMENT_MANUAL.md)

> **Never conclude a deploy worked from its exit code.** This repository's own
> history includes deploys that silently no-opped. Check `/health`.

---

## When something is wrong

| Situation | Go to |
| --- | --- |
| A symptom you cannot explain | [`docs/deployment/TROUBLESHOOTING.md`](docs/deployment/TROUBLESHOOTING.md) |
| A deploy made it worse | [`docs/deployment/ROLLBACK_MANUAL.md`](docs/deployment/ROLLBACK_MANUAL.md) |
| Money moving incorrectly | Set `payments: false` — seconds, no deploy |
| Costs spiking | `node scripts/emergency-cost-lockdown.mjs` |
| Shutting something down | [`docs/deployment/PRODUCTION_TAKEDOWN_MANUAL.md`](docs/deployment/PRODUCTION_TAKEDOWN_MANUAL.md) |
| "What happens if X fails?" | [`docs/production-audit/FAILURE_MATRIX.md`](docs/production-audit/FAILURE_MATRIX.md) |

### The feature-flag trap

Flags live in one JSON document in Parameter Store. **A partial write deletes
the keys it omits.** That caused a four-day flag drift in August 2026. Always
write all five keys:

```bash
aws ssm put-parameter --name "/zoryvex/production/feature-flags" \
  --type String --overwrite \
  --value '{"aiMatching":false,"contactUnlocks":true,"payments":true,"publicDiscovery":false,"verificationReminders":true}' \
  --profile <profile> --region eu-west-1
```

> On Windows, run AWS commands with leading-slash parameter names in
> **PowerShell**. Git Bash rewrites `/zoryvex/...` into a Windows path and
> gives you a misleading `ParameterNotFound`.

---

## Things you are expected to know before you touch production

These are not style preferences. Each one is a recorded incident.

1. **The demo build can ship to production.** Guarded now; verify anyway.
2. **Deploys can silently no-op.** Verify against `/health`.
3. **A flaky connection mid-`terraform apply` is worse than a failed one.**
   Two applies have already died at `init` on a mobile hotspot. Failing before
   any change is harmless. Failing mid-apply is not.
4. **DynamoDB does not roll back.** PITR restores to a *new* table.
5. **Payments do not roll back.** A charge that succeeded is real; the remedy
   is a refund.
6. **Notification failures are silent by design.** They leave an audit row,
   not an error. Look in the audit trail, not the logs.
7. **A missing environment variable fails inside a non-fatal catch.** That is
   how a broken candidate notification lived in production unnoticed.

---

## Honest status

Verified against live production on 2026-09-14 — full evidence in
[`docs/production-audit/PRODUCTION_VERIFICATION.md`](docs/production-audit/PRODUCTION_VERIFICATION.md).

**Proven live:** 41/41 authenticated routes return `401` without a session;
CORS names the origin exactly and refuses others; all six security headers
present; certificate valid to 2027-03; 55/55 Lambdas have reserved
concurrency; the real build (not the demo) is serving; webhook signature
verification, rejection and replay-dedupe all work against the live account.

**Not proven, and said plainly:**

- **No payment has ever succeeded in production.** 11 attempts, 0 successes —
  8 abandoned before a card, 3 were Paystack *test* cards presented to the
  *live* account. No product defect was found, but the path from
  `charge.success` to entitlement to delivery has never executed here.
- **Rollback has never been exercised.** The script says so itself.
- **The GitHub token is empty**, so verification runs at 60 requests/hour per
  egress IP — roughly 20 verifications an hour, platform-wide.

---

## What must never happen

- No Cognito for application auth (ADR 0001)
- No `terraform apply` without a plan, a diff, a tested rollback and explicit
  approval
- No secret printed, logged or committed. No account IDs in output
- No `git reset --hard`, no force push, no history rewrite
- No Nigerian government or regulatory filing from here — every one is
  `NOT AUTHORIZED BY FOUNDER`
- Never claim something works from a passing build. Only from a passed
  acceptance test against the thing that is actually running
