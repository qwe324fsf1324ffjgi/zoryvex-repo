# Rolling back

What to do when a deploy made things worse.

**Read this first:** rollback is not one action. Application code, frontend,
infrastructure and data roll back in different ways, and one of them does not
roll back at all.

---

## The honest caveat

`scripts/rollback.mjs` carries this in its own header:

> *"Real implementation (reviewed, never yet exercised against a real
> deployment)."*

The mechanism is simple and its target is provably correct, but **it has not
been run in anger.** Treat the first use as an operation to watch, not a
button to trust.

---

## What rolls back, and what does not

| Layer | Rolls back? | How |
| --- | --- | --- |
| Lambda code | **Yes** | Redeploy the last-good commit |
| Frontend | **Yes** | Rebuild and re-sync from that commit |
| Infrastructure | **Deliberately not automatic** | A new reviewed plan |
| Feature flags | **Yes** | One parameter write |
| **Database** | **No** | See below |
| **Payments taken** | **No** | Refunds, not rollback |

### The database does not roll back

DynamoDB has no undo. A deploy that wrote bad rows leaves them there after
you roll the code back.

Point-in-time recovery restores to a **new table**, which means a full
cutover, not a quick fix. Treat data damage as a separate, slower incident
from a bad deploy.

### Money does not roll back

A charge that succeeded is real. If a bug charged somebody, the fix is a
refund through Paystack, recorded as `success → reversed` — the one
non-terminal transition the payment state machine allows.

---

## 1. First: is a rollback the right move?

Ask in this order:

1. **Is anyone being harmed right now?** If it is only cosmetic, fix forward.
2. **Is money moving incorrectly?** Set `payments: false` immediately — that
   is faster than any rollback.
3. **Is it the code, or the config?** A wrong feature flag or a missing
   environment variable is not fixed by rolling back code.

🟢 Check what is actually live:
```bash
curl -s https://api.zoryvex.space/health
```

🟢 Check the rollback target:
```bash
aws ssm get-parameter --name "/zoryvex/production/last-good-commit" \
  --profile <profile> --region eu-west-1 --query "Parameter.Value" --output text
```

> Use PowerShell for that command on Windows. Git Bash rewrites
> `/zoryvex/...` into a Windows path and you get a misleading
> `ParameterNotFound`.

`last-good-commit` is written by a **successful** deploy, so after a bad
deploy it points at the last one that passed its smoke test.

---

## 2. Fastest mitigations, in order of speed

### 2.1 Feature flags — seconds, no deploy

```bash
aws ssm put-parameter --name "/zoryvex/production/feature-flags" \
  --type String --overwrite \
  --value '{"aiMatching":false,"contactUnlocks":false,"payments":false,"publicDiscovery":false,"verificationReminders":false}' \
  --profile <profile> --region eu-west-1
```
🔴 CHANGES LIVE BEHAVIOUR.

Flags are read on every invocation and never cached. This is the fastest stop
available and it needs no build.

> Always write the **complete** five-key document. A partial write deletes
> the keys it omits.

### 2.2 Application rollback — minutes

```bash
node scripts/rollback.mjs --env production --confirm production
```
🔴 CHANGES PRODUCTION.

Redeploys the commit in `last-good-commit`. Application code only —
infrastructure is untouched by design.

### 2.3 Infrastructure rollback — deliberately manual

There is no automatic infrastructure revert, and that is a decision, not a
gap. Blindly reverting live infrastructure state is how a bad deploy becomes
an outage.

The supported path is a **new reviewed plan**:

```bash
git revert <bad-commit>          # or check out the previous good tree
node scripts/release.mjs --confirm-env production --confirm-release PRODUCTION
```
🟢 Plans only. **Read it.** Check the destroy count is `0`.

```bash
node scripts/release.mjs --confirm-env production --confirm-release PRODUCTION --apply
```
🔴🔴 CHANGES PRODUCTION.

---

## 3. Frontend-only rollback

The site is static files in S3 behind CloudFront. Rolling back the frontend
means rebuilding from the good commit and re-syncing — which is what
`rollback.mjs` does.

> **Do not hand-edit files in the bucket.** The next deploy overwrites them
> and you will have lost track of what is actually live.

**Cache:** CloudFront may serve the old build for a while. If you need it
gone immediately, create an invalidation. That costs money per path, so
invalidate `/*` only when it genuinely matters.

---

## 4. After any rollback — verify, do not assume

🟢 All read-only.

```bash
curl -s https://api.zoryvex.space/health
```
The version must be the **rollback target**, not the bad commit.

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://zoryvex.space/
curl -s -o /dev/null -w "%{http_code}\n" https://api.zoryvex.space/candidates/me
```
Expect `200` then `401`.

```bash
curl -s https://zoryvex.space/employer/sign-in | grep -c "secure, one-time sign-in link"
```
Expect `1`. `0` means the demo build is live.

```bash
cd infrastructure/envs/production && terraform plan -detailed-exitcode -lock=false
```
Expect exit `0`.

> This repository's own memory says deploys here have **silently no-opped
> before**. Never conclude a rollback worked because the command exited `0`.
> Check the running system.

---

## 5. If the rollback itself fails

**Stop. Do not run it a third time.** Repeating a failing deploy is how a
partial apply happens.

Check, in order:

1. **DNS** — `nslookup sts.eu-west-1.amazonaws.com`. Failures here have
   caused two aborted applies on a mobile hotspot.
2. **A stranded state lock** — look for a `.tflock` object beside the state
   file in S3.
3. **Credentials** — `aws sts get-caller-identity`.
4. **Partial apply** — read the Terraform output. It says what it completed.

If infrastructure is half-applied, the recovery is a fresh `plan` on a stable
connection, read carefully, then applied. Not a retry of the same command.

---

## 6. What to write down afterwards

Every rollback should leave a record in `docs/DECISIONS.md`:

- What was deployed, and when
- What went wrong, and how it was noticed
- What was rolled back, and what was not
- Whether data or payments were affected
- What would have caught it earlier

The last line is the only one that prevents a repeat.
