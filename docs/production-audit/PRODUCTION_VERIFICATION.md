# Production verification

Evidence gathered against live production on **2026-09-14**, commit
`f633bde`, with no change made to the running system.

Every command in this document is read-only. Anything I could not establish
is written as **UNVERIFIED** rather than inferred.

---

## How to read this

| Mark | Meaning |
| --- | --- |
| **VERIFIED** | I ran the check against live production and saw the result recorded here |
| **UNVERIFIED** | I could not establish it without changing production or spending real money |
| **CODE-READ** | Traced through the implementation; not exercised live |

A claim with no mark does not exist in this document. That is deliberate.

---

## 1. What is actually running

```bash
curl -s https://api.zoryvex.space/health
```

```json
{"status":"ok","timestamp":"2026-09-14T15:28:45.343Z",
 "version":"f633bde44eb27106ec0e55f10d4953d8125b5139","environment":"production"}
```

**VERIFIED.** The deployed commit matches local `HEAD` on `main`, and the
working tree is clean apart from the documentation added in this pass.

```bash
git log --oneline -1     # f633bde Require a candidate be reachable, and make interest a paid action
git status -sb           # ## main...origin/main  (only new docs untracked)
```

---

## 2. The real build is live, not the demo

This is the single highest-consequence deployment check in the project,
because the demo build returns `200` on every page and calls no API at all.

```bash
curl -s https://zoryvex.space/employer/sign-in | grep -c "secure, one-time sign-in link"
```
→ `1`. **VERIFIED.**

The API base URL is compiled into a JavaScript chunk, not into the page HTML:

```bash
for c in $(curl -s https://zoryvex.space/employer/sign-in \
    | grep -oE '/_next/static/chunks/[a-zA-Z0-9._-]+\.js' | sort -u); do
  curl -s "https://zoryvex.space$c" | grep -q "api.zoryvex.space" && echo "baked in: $c" && break
done
```
→ `baked in: /_next/static/chunks/3fa5danzmnfmq.js`. **VERIFIED.**

> Grepping the **HTML** for the API URL returns nothing even on a correct
> build. A check written that way reports a false emergency. Corrected in
> `docs/deployment/TROUBLESHOOTING.md` after producing exactly that false
> negative during this audit.

---

## 3. Authorization boundary — every route, no session

All 41 authenticated routes, enumerated from the production Terraform rather
than from memory, called with no session cookie.

**18 read routes → `401`:**

`GET /auth/session` · `/billing` · `/candidates/me` · `/candidates/me/evidence`
· `/candidates/me/export` · `/candidates/me/matches` · `/candidates/me/graded-task`
· `/roles` · `/roles/{id}` · `/roles/{id}/kit` · `/roles/{id}/kit-preview`
· `/roles/{id}/kit-status` · `/roles/{id}/matches`
· `/roles/{id}/matches/{c}/contact` · `/roles/{id}/matches/{c}/evidence`
· `/evidence/files/{f}/download` · `/admin/billing` · `/admin/exceptions`

**23 write routes → `401`:**

`POST /billing/cancel` · `/billing/card-update-link` · `/billing/subscription`
· `/candidates/me/delete` · `/candidates/me/evidence`
· `/candidates/me/evidence/{e}/verify` · `…/verify/begin`
· `/candidates/me/matches/{r}/interest` · `/evidence/upload-requests` · `/roles`
· `/roles/{r}/kit-orders` · `/roles/{r}/kit/regenerate`
· `/roles/{r}/matches/recompute` · `/roles/{r}/matches/{c}/explain`
· `/roles/{r}/matches/{c}/interest` · `/roles/{r}/matches/{c}/unlock-contact`
· `/auth/webauthn/register/options` · `/auth/webauthn/step-up/options`
· `PATCH /candidates/me` · `/candidates/me/consent`
· `/candidates/me/evidence/{e}` · `/roles/{r}`
· `DELETE /candidates/me/evidence/{e}`

**Result: 41 of 41 returned `401`. Zero exceptions. VERIFIED.**

Two details worth recording:

- `/admin/billing` and `/admin/exceptions` are inside the same boundary. There
  is no separate admin surface reachable without a session.
- The contact route — the most sensitive read in the product — is `401` at the
  edge, before any entitlement logic runs.

### Public routes behave as public routes

| Route | Result | Reading |
| --- | --- | --- |
| `GET /health` | `200` | Intentionally open |
| `GET /public/proof/{unknown}` | `404` | No existence disclosure |
| `GET /public/proof/{unknown}/badge.svg` | `404` | Same |
| `POST /auth/request-code` (no Origin) | `403` | CSRF/Origin check fires **before** validation |
| `POST /webhooks/paystack` (unsigned) | `401` | Signature required, nothing written |

**VERIFIED.** The `403` on `request-code` is correct behaviour, not a fault: a
cross-origin request is rejected before the body is even parsed.

---

## 4. Cross-origin policy

```bash
curl -sI -X OPTIONS https://api.zoryvex.space/candidates/me \
  -H "Origin: https://evil.example" -H "Access-Control-Request-Method: GET"
```
→ `204` with **no** `access-control-*` headers at all. A browser treats the
absence of a grant as a refusal, so the request never leaves the sandbox.

```bash
curl -sI -X OPTIONS https://api.zoryvex.space/candidates/me \
  -H "Origin: https://zoryvex.space" -H "Access-Control-Request-Method: GET"
```
```
access-control-allow-origin: https://zoryvex.space
access-control-allow-methods: DELETE,GET,OPTIONS,PATCH,POST
access-control-allow-headers: authorization,content-type,idempotency-key,x-zoryvex-csrf
access-control-allow-credentials: true
access-control-max-age: 300
```

**VERIFIED.** The origin is named exactly. There is no wildcard, which matters
because `allow-credentials: true` with a wildcard origin is the classic
session-theft configuration.

---

## 5. Transport and browser hardening

```bash
curl -sI https://zoryvex.space/
```

| Header | Value |
| --- | --- |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` |
| `Content-Security-Policy` | `default-src 'self'; script-src 'self' 'unsafe-inline'; …` |
| `X-Frame-Options` | `DENY` |
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=(), interest-cohort=()` |

**VERIFIED**, all six present.

**Certificate:** issued by Amazon RSA 2048 M01, valid to **2027-03-26**.
ACM renews automatically. **VERIFIED.**

**One honest note on the CSP:** `script-src` includes `'unsafe-inline'`. That
is a real weakening of the policy, and it is there because the Next.js static
export emits inline bootstrap script. It is recorded here rather than
presented as a clean pass. It is not a defect introduced carelessly, but it is
not nothing either. See `FUTURE_IMPLEMENTATION_RECOMMENDATIONS.md`.

---

## 6. Compute limits

Enumerated every `zoryvex-production-*` Lambda and read its reserved
concurrency. Result recorded in §11 below.

Reserved concurrency on every function is what stops a runaway loop or a
traffic spike from consuming the account's entire concurrency pool and
becoming an unbounded bill.

---

## 7. What I did **not** verify, and why

This is the most important section in the document.

### 7.1 A successful payment — UNVERIFIED

**No payment has ever succeeded in production.** Eleven live attempts, zero
successes. From Paystack's own gateway data:

- 8 attempts never reached a card (`log.attempts = 0` — the page was closed)
- 3 attempts show `provider auth: Test Bank visa credit` — **Paystack test
  cards presented to the live account**, which the live account correctly
  refuses (`Transaction Error` at 3DS for the Kit, `Denied by Fraud System.`
  for subscriptions)

**This is not a product defect.** Every one of the eleven is explained by the
instrument used or by abandonment. But it does mean the entire success
path — `charge.success` → entitlement → delivery — has never executed against
production.

What *is* verified in production:

- The webhook URL is configured at Paystack — **VERIFIED**
- A forged signature is rejected `401` with nothing written — **VERIFIED**
- A correctly live-signed event returns `200 handled:false` — **VERIFIED**
- A replay of that event returns `duplicate:true`, and the dedupe row exists
  at `WEBHOOK#body:<sha256>` / `EVENT` — **VERIFIED**

So the front door is proven. The room behind it is not.

**Only one thing closes this:** one real purchase with a real card. There is
no safe substitute, and I will not fabricate one.

### 7.2 Rollback — UNVERIFIED

`scripts/rollback.mjs` says so in its own header: *reviewed, never yet
exercised against a real deployment*. The target it reads is provably correct.
The mechanism has never run. The first use will be during an incident.

### 7.3 Email delivery to a real inbox — UNVERIFIED

SES either accepted a message or it did not. Whether it landed in a real
person's inbox, and out of spam, is not something I can observe.

### 7.4 GitHub verification at volume — UNVERIFIED

Unauthenticated GitHub is **60 requests/hour per egress IP** (measured). One
verification spends three calls, so roughly 20 verifications an hour across
the whole platform. The GitHub token parameter is **empty in both
environments**, so every call today is unauthenticated. This is not biting at
current volume and becomes a wall the moment candidates arrive.

### 7.5 Disaster recovery — UNVERIFIED

Point-in-time recovery is enabled. A restore has never been performed. PITR
restores to a *new* table, so a real recovery is a cutover, not a button.

### 7.6 Anything requiring a real signed-in session

Entitlement gating, contact unlock, interest notification and the paid/unpaid
split in evidence are all verified by tests and by mutation testing, and are
**CODE-READ** in production. Verifying them live would mean creating and
manipulating real accounts in the production database, which the standing
instruction for this pass forbids.

---

## 8. Findings from this pass

Nothing was changed in the application. These are recorded, not fixed.

| # | Finding | Severity | Status |
| --- | --- | --- | --- |
| 1 | Payment success path never executed in production | **High** | Documented; needs one real purchase |
| 2 | Rollback never exercised | **High** | Documented |
| 3 | GitHub token empty in both environments | Medium | Documented |
| 4 | `verificationReminders: true` with no deployed function or schedule | Medium | Documented; inert today, would email real candidates the moment such a function deployed |
| 5 | No re-check when a verified repository is later made private | Medium | Documented; a proof can outlive its truth |
| 6 | CSP `script-src` allows `'unsafe-inline'` | Medium | Documented |
| 7 | No registration kill-switch (sign-in and sign-up are one flow) | Low | Documented in the takedown manual |
| 8 | Terraform drift is not detected automatically | Low | Documented |
| 9 | A troubleshooting check I wrote grepped the HTML for the API URL and produced a false negative | Low | **Corrected in the doc during this pass** |

Finding 9 is included because a verification procedure that produces false
alarms is itself a defect, and it was mine.

---

## 9. What I changed

Documentation only. No application code, no UI, no routes, no API, no schema,
no Lambda, no Terraform, no DNS, no environment variable, no feature flag, no
production data. Nothing committed, nothing pushed, nothing deployed.

The one correction made was to a document written earlier in this same pass
(§2), not to the product.

---

## 10. Reproducing this

Every check above, in one block. All read-only.

```bash
curl -s https://api.zoryvex.space/health
curl -s https://zoryvex.space/employer/sign-in | grep -c "secure, one-time sign-in link"
curl -sI https://zoryvex.space/ | grep -iE "strict-transport|content-security|x-frame|nosniff|referrer|permissions"
curl -sI -X OPTIONS https://api.zoryvex.space/candidates/me \
  -H "Origin: https://evil.example" -H "Access-Control-Request-Method: GET" | grep -ic access-control
for r in /candidates/me /billing /roles /admin/billing; do
  printf "%-18s %s\n" "$r" "$(curl -s -o /dev/null -w '%{http_code}' https://api.zoryvex.space$r)"
done
```

Expected: the deployed commit, `1`, six headers, `0`, and `401` four times.

---

## 11. Reserved concurrency result

```powershell
$fns = aws lambda list-functions --profile <p> --region eu-west-1 `
  --query "Functions[?starts_with(FunctionName,'zoryvex-production-')].FunctionName" --output json | ConvertFrom-Json
foreach ($f in $fns) {
  $c = aws lambda get-function-concurrency --function-name $f --profile <p> --region eu-west-1 --output json | ConvertFrom-Json
  if ($null -eq $c.ReservedConcurrentExecutions) { Write-Output "UNRESERVED: $f" }
}
```

```
production lambdas: 55
unreserved count: 0
```

**55 of 55 production Lambdas carry reserved concurrency. Zero unreserved.
VERIFIED.**

This is the cost ceiling. Without it, one runaway loop consumes the account
concurrency pool and the bill follows.

