# Running Zoryvex from absolute zero

Written for somebody who has never deployed a web application. No AWS
account, no Terraform, no command line. Every command says what it does
before you run it.

**Two labels appear throughout. They matter more than anything else here.**

> 🟢 **SAFE READ-ONLY** — looks at things. Changes nothing. Run freely.
>
> 🔴 **CHANGES INFRASTRUCTURE** — alters real resources or real money. Never
> run without deciding to.

---

# Phase 0 — Preparing the computer

This assumes Windows, because that is what this project is developed on.

## 0.1 Git

**What:** tracks every change to the code and is how work reaches GitHub.

**Get it:** <https://git-scm.com/download/win> — the installer includes Git
Bash, a Unix-style terminal this project's scripts expect.

**Verify:**
```bash
git --version
```
Expect `git version 2.x.x`.

**Common failure:** `'git' is not recognized`. The installer did not add Git
to PATH. Reinstall and choose "Git from the command line and also from
3rd-party software".

## 0.2 Node.js

**What:** runs JavaScript outside a browser. The entire build, test and
deploy tooling is Node.

**Which version:** check `package.json` `engines` first. Install the matching
LTS from <https://nodejs.org>.

**Verify:**
```bash
node --version
npm --version
```

**Common failure:** a wrong major version causes confusing build errors.
Install [nvm-windows](https://github.com/coreybutler/nvm-windows) if you need
to hold several versions.

## 0.3 AWS CLI

**What:** talks to Amazon Web Services from the terminal. Everything Zoryvex
runs on is AWS.

**Get it:** <https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html>

**Verify:**
```bash
aws --version
```

## 0.4 Terraform

**What:** describes infrastructure as files, so the servers are reproducible
rather than clicked together by hand.

**Get it:** <https://developer.hashicorp.com/terraform/install>

**Verify:**
```bash
terraform version
```

## 0.5 GitHub CLI (optional)

Used to read CI results without opening a browser.
<https://cli.github.com>

```bash
gh --version
```

## 0.6 A code editor

VS Code, <https://code.visualstudio.com>. Not required to deploy; required to
read anything.

---

# Phase 1 — Accounts

Only the accounts this repository actually uses.

## 1.1 GitHub

<https://github.com> → verify email → **enable two-factor authentication**.
The repository is the only copy of the production source outside AWS.

## 1.2 AWS

<https://aws.amazon.com> → create account → **a payment card is required**
even on free tier.

Then, immediately:

1. **Enable MFA on the root user.**
2. **Stop using the root user.** Create an IAM Identity Center user for
   day-to-day work.
3. Set a billing alarm.

> This project forbids IAM users, static access keys and root sessions.
> Access is IAM Identity Center for humans, GitHub OIDC for CI.

**Verify your sign-in works:**
```bash
aws sts get-caller-identity --profile <your-profile>
```
🟢 SAFE READ-ONLY. Expect a JSON object with an ARN. It should say
`assumed-role/AWSReservedSSO_...`, not `user/...`.

## 1.3 Paystack

<https://paystack.com>. Nigerian payment provider. Business verification
(KYC) is done privately by the founder and is never handled here.

You need, from the dashboard under **Developers**:
- Live secret key
- Live public key
- Live webhook URL set to `https://api.zoryvex.space/webhooks/paystack`

## 1.4 Domain registrar

The domain is registered and DNS-hosted at the registrar. Terraform outputs
the DNS rows it wants; it never manages the registrar directly.

## 1.5 Email

Amazon SES, inside the same AWS account. No separate signup.

---

# Phase 2 — AWS services, and why each exists

| Service | Why Zoryvex uses it | What breaks without it |
| --- | --- | --- |
| **S3** | Stores the built website and candidate evidence files | Nothing serves; nothing uploads |
| **CloudFront** | CDN in front of S3, terminates HTTPS, adds security headers | Site unreachable; bucket stays private so there is no fallback |
| **API Gateway (HTTP API)** | The single public entry to every backend route | Every API call fails |
| **Lambda** | Runs one function per route. No always-on server | The whole API |
| **DynamoDB** | One table per environment, all application state | Everything |
| **SES** | Sign-in codes and candidate notices | Nobody can sign in |
| **Parameter Store** | Secrets (Paystack key, auth pepper) and feature flags | Payments and auth |
| **CloudWatch** | Logs, metrics, 26 production alarms | You stop finding out about failures |
| **ACM** | TLS certificates | HTTPS |
| **EventBridge Scheduler** | Hourly billing reconciliation | Payments stop self-healing |
| **IAM** | Least-privilege roles per function | Security |

**Region:** `eu-west-1` for everything, except CloudFront certificates which
**must** live in `us-east-1` — an AWS requirement, not a choice.

---

# Phase 3 — Terraform

## What it is

You describe what should exist. Terraform compares that to what does exist
and shows you the difference. You approve, then it acts.

## State

Terraform records what it created in a **state file**, kept in S3, encrypted
and versioned, with native S3 locking so two people cannot apply at once.

> **The state file is as sensitive as a password.** Never commit it, never
> email it, never put it anywhere public.

## The two commands that matter

```bash
terraform plan
```
🟢 **SAFE READ-ONLY.** Shows what *would* change. Run this as often as you
like.

```bash
terraform apply
```
🔴 **CHANGES INFRASTRUCTURE.**

```bash
terraform destroy
```
🔴🔴🔴 **DELETES EVERYTHING IT MANAGES.**
> **DO NOT RUN IN PRODUCTION WITHOUT AUTHORIZATION.** There is no undo. The
> database goes with it.

## How to read a plan

```
Plan: 2 to add, 8 to change, 0 to destroy.
```

- **add** — new resources
- **change** — existing resources modified
- **destroy** — **stop and read every line.** In an ordinary deploy this
  should be **0**.

## Drift

Drift is when reality and the files disagree, usually because somebody
changed something in the AWS console.

```bash
cd infrastructure/envs/production
terraform plan -detailed-exitcode -lock=false
```
🟢 SAFE READ-ONLY. Exit `0` means no drift. Exit `2` means changes pending.

---

# Phase 4 — GitHub and CI/CD

One workflow: `.github/workflows/ci.yml`. It runs on pull requests, on push
to `main`, and manually.

```
changed-paths → validate → e2e → deploy-test
```

| Job | Does |
| --- | --- |
| `changed-paths` | Detects a docs-only change and skips the rest |
| `validate` | Format, lint, typecheck, unit tests, OpenAPI parity, secret scan, Terraform validate, licences, dependency audit |
| `e2e` | Playwright browser tests, desktop and mobile |
| `deploy-test` | Deploys **test** only |

> **There is no production deploy job.** Pushing to `main` cannot reach
> production. That is deliberate.

CI authenticates to AWS with **GitHub OIDC**, assuming a role. There are no
AWS keys in the workflow.

---

# Phase 5 — Deploying

## 5.1 Before you deploy — the checklist

🟢 All read-only.

```bash
git status                 # must be clean
git log --oneline -1       # know what you are shipping
npm run validate:all       # the full gate
npm run secrets:scan       # nothing secret is tracked
```

Then confirm what is live now, so you can compare afterwards:

```bash
curl -s https://api.zoryvex.space/health
```

Record the `version` it prints. That is your rollback target.

## 5.2 Test environment

```bash
node scripts/deploy.mjs --env test --confirm test
```
🟢 Plans only. Read the summary.

```bash
node scripts/deploy.mjs --env test --confirm test --apply
```
🔴 CHANGES TEST INFRASTRUCTURE.

## 5.3 Production

`deploy.mjs` **refuses** production under any flag. The only path is:

```bash
node scripts/release.mjs --confirm-env production --confirm-release PRODUCTION
```
🟢 **Plans only.** Saves a plan artifact. Read it.

```bash
node scripts/release.mjs --confirm-env production --confirm-release PRODUCTION --apply
```
🔴🔴 **CHANGES PRODUCTION.** Applies *exactly* the saved plan.

### What the script does for you

1. Builds the Lambda bundles
2. Reads the API URL from Terraform output — **refuses to build** if it is
   missing or not https
3. Builds the site against that URL
4. **Asserts the built pages are not the demo build** before uploading
5. Syncs to S3
6. Smoke-tests that the deployed build reports the commit just deployed

That fourth step exists because it has failed for real: on 2026-09-11 a
production release uploaded the local-fake demo to `zoryvex.space`. Every
page returned 200 and nobody could sign in.

---

# Phase 6 — After deployment

Run all of these. 🟢 All read-only.

```bash
curl -s https://api.zoryvex.space/health
```
Expect `"status":"ok"` and the **new** commit.

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://zoryvex.space/
curl -s -o /dev/null -w "%{http_code}\n" https://zoryvex.space/pricing
```
Expect `200`.

**Authorization still enforced:**
```bash
curl -s -o /dev/null -w "%{http_code}\n" https://api.zoryvex.space/candidates/me
```
Expect `401`.

**Webhook still refuses forgery:**
```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST \
  https://api.zoryvex.space/webhooks/paystack \
  -H 'Content-Type: application/json' -d '{"event":"charge.success"}'
```
Expect `401`.

**Secrets untouched:**
```bash
aws ssm get-parameter --name "/zoryvex/production/feature-flags" \
  --profile <profile> --region eu-west-1 --query "Parameter.Value" --output text
```
Expect `payments:true`, `contactUnlocks:true`.

**No drift:**
```bash
cd infrastructure/envs/production && terraform plan -detailed-exitcode -lock=false
```
Expect exit `0`.

**The frontend is real, not the demo:**
```bash
curl -s https://zoryvex.space/employer/sign-in | grep -c "secure, one-time sign-in link"
```
Expect `1`. If it is `0`, the demo build shipped — **roll back**.

---

# Phase 7 — Known gotchas

| Symptom | Cause | Fix |
| --- | --- | --- |
| `no such host` on AWS during deploy | DNS failing, common on mobile hotspots with NAT64 | Change network. Do **not** retry mid-apply |
| `terraform init` hangs | Network died during a backend read | Kill it, check for a stale lock, re-run |
| Pages 200 but nobody can sign in | Demo build shipped | Roll back, rebuild with the API URL |
| Git Bash turns `/zoryvex/...` into a Windows path | MSYS path conversion | Use PowerShell for AWS CLI calls with leading-slash names |
| A candidate notice never arrives | The route lacks SES grant or `APP_ORIGIN` | Failures are non-fatal by design; check the audit trail, not the logs |
