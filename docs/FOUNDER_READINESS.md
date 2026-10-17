# Founder Readiness — Durable Setup Ledger

This is the single source of truth for which durable, one-time founder-level objects already exist. Every preserved numbered prompt must check this ledger (and re-verify live, since this file can go stale) before creating anything. **Existence here is a reason to reuse, never a reason to skip live verification, and never a reason to recreate.**

Status legend: **PROVEN** (verified live, evidence recorded) · **PENDING** (known to have existed, not verifiable this session) · **CONTRADICTED** (live state disagrees with what was expected — stop and raise one HUMAN ACTION REQUIRED) · **NOT STARTED**.

| Durable object | Status | Last verified | Evidence | Do NOT |
|---|---|---|---|---|
| GitHub repo `zoryvex-platform` (personal, private) | PROVEN | 2026-08-15 | `gh repo view` — private, owner = authenticated personal account, matches local git identity `Zerah` | `gh repo create` |
| Git remote `origin` wiring | PROVEN | 2026-08-15 | `git remote -v` matches the repo above | Re-adding/overwriting `origin` |
| Claude access via Pro subscription (browser login) | ASSUMED PROVEN (session-level) | 2026-08-15 | This session is running under Claude Code, not `ANTHROPIC_API_KEY` | Setting `ANTHROPIC_API_KEY` or switching to Console billing |
| AWS IAM Identity Center instance + founder user + permission set + account assignment | PROVEN | 2026-08-15 (Phase 1) | Founder ran `aws sso login --profile zoryvex-admin`; safe pass/fail probe then returned **PASS**. SSO region confirmed `eu-west-1` (matches CLI application region). Assigned permission set confirmed `AdministratorAccess`. No account ID, ARN, or credential value printed or stored. | Creating a new Identity Center instance, founder user, permission set, or account assignment |
| AWS budget / cost anomaly monitor | PROVEN | 2026-08-15 (Phase 1) | Founder confirmed via console: budget `zoryvex-monthly-cost` (USD 30, graduated thresholds) and cost anomaly monitor `Default-Services-Monitor` (active email subscription) already exist; Free Tier and CloudWatch billing alerts already on. Nothing recreated. | Recreating a budget/anomaly monitor "just in case" |
| Domain `zoryvex.space` registration (Vercel) | PROVEN | 2026-08-15 (Phase 1) | Founder confirmed: registrant email verified, renewal payment method on file, auto-renew on, Vercel nameservers intact, renewal date 2027-07-28. | Any DNS record change, any Vercel project creation |
| Paystack business account (Abba's Solutions, NGN settlement) | PROVEN | 2026-08-15 (Phase 1) | Founder confirmed via dashboard: Live, Starter Business, payouts enabled, trading name already "Abba's Solutions" (recorded here as "Abbas Solution" until 2026-09-01, when the founder read the dashboard and corrected it), NGN settlement, fees absorbed, MFA on, no isolation conflict, no key exposure. | Creating a new Paystack business, plan, or checkout URL; reopening KYC without contradiction; upgrading past Starter without CAC |
| Project folder at `C:\Users\zerah\Documents\zoryvex` | PROVEN | 2026-08-15 | Folder exists, contains only `.git` (plus this doc set as of this commit) | Recreating/relocating the project folder |

## One HUMAN ACTION carried forward (not raised as a gate this turn)

To upgrade the AWS Identity Center row from PENDING to PROVEN or CONTRADICTED, the founder needs to run, in their own terminal, a browser-based SSO login (no secret entry, nothing typed or read by the assistant):

```
aws sso login --profile zoryvex-admin
```

Afterward, re-verification must use only the silenced pass/fail probe — never a raw `get-caller-identity` call that could print an account ID or ARN:

```
aws sts get-caller-identity --profile zoryvex-admin >/dev/null 2>&1 && echo "AWS STS: PASS" || echo "AWS STS: FAIL"
```

Once that returns PASS, a future session should separately inspect the Identity Center instance/permission set/account assignment read-only (still without printing account identifiers) before any preserved prompt is allowed to touch AWS.

## How the preserved numbered prompts should use this file

1. Read this ledger first.
2. For any row marked PROVEN, still re-verify live (this file can be stale) before reusing — never trust the row alone as proof.
3. For any row marked PENDING or NOT CHECKED, perform the live read-only check appropriate to that system before deciding PROVEN vs CONTRADICTED. Any AWS identity check must use the silenced pass/fail form above — never a form that could print an account ID or ARN.
4. Only if a check comes back CONTRADICTED (the object is missing, misconfigured, or disagrees with the fixed identity in [[V48_BINDING]]) may the prompt propose creating/fixing it — and only after raising exactly one HUMAN ACTION REQUIRED and getting explicit founder approval.
