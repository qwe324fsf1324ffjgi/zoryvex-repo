# Troubleshooting

Symptom first, because that is what you have when something breaks.

Every diagnostic here is 🟢 **SAFE READ-ONLY** unless marked otherwise.

---

## Start here, always

Four commands. Run them before forming any theory.

```bash
curl -s https://api.zoryvex.space/health
curl -s -o /dev/null -w "site %{http_code}\n" https://zoryvex.space/
git log --oneline -1
git status --short
```

The first tells you what is *actually* running. The others tell you what you
*think* is running. Most confusion is the gap between them.

---

## "The site loads but nobody can sign in"

**Almost certainly the demo build shipped.**

The frontend is a static export. `isRealApiConfigured()` is literally
`Boolean(process.env.NEXT_PUBLIC_API_BASE_URL)`. Built without it, every page
runs on browser-local fakes, returns 200 everywhere, and calls no API at all.

**Confirm:**
```bash
curl -s https://zoryvex.space/employer/sign-in | grep -c "secure, one-time sign-in link"
```
`1` = real build. `0` = demo build is live.

The API base URL is compiled into a JavaScript chunk, **not** into the page
HTML, so grepping the HTML for it always returns nothing and proves nothing.
Check the chunks the page actually loads:

```bash
for c in $(curl -s https://zoryvex.space/employer/sign-in | grep -oE '/_next/static/chunks/[a-zA-Z0-9._-]+\.js' | sort -u); do
  curl -s "https://zoryvex.space$c" | grep -q "api.zoryvex.space" && echo "baked in: $c" && break
done
```
No output = the API URL was never baked in.

**Fix:** roll back, then rebuild through `scripts/release.mjs`, which reads
the URL from Terraform output and refuses to build without it.

**History:** this is not hypothetical. On 2026-09-11 a production release
uploaded the demo to `zoryvex.space`. The guard exists because of it.

---

## "The deploy said it worked but nothing changed"

```bash
curl -s https://api.zoryvex.space/health
```

If `version` is not the commit you deployed, it did not deploy.

> This repository's own memory records deploys silently no-opping. **Never
> conclude success from an exit code.** Check the running system.

Check the site synced too — the deploy log prints `Site sync: N uploaded`.
Zero uploaded on a real change means the sync targeted the wrong bucket.

---

## AWS commands fail with `no such host`

DNS, not credentials.

```bash
nslookup sts.eu-west-1.amazonaws.com
```

Timeouts mean your resolver is not answering. Verified cause on this machine:
a mobile hotspot that answers ICMP but not DNS, on an IPv6-only NAT64 network.

**Test whether it is only the resolver:**
```bash
powershell -Command "Resolve-DnsName sts.eu-west-1.amazonaws.com -Server 1.1.1.1"
```
An answer here plus a timeout above means the link is fine and the resolver is
broken.

**Fix:** switch network, or set the adapter's DNS to a working resolver.

> **Never retry a production apply on a flaky link.** Two attempts have
> already died at `terraform init`. Failing *before* any change is harmless;
> failing *mid-apply* leaves production partially applied.

---

## `ParameterNotFound` for a parameter that exists

Git Bash rewrote your path.

Git Bash converts `/zoryvex/production/feature-flags` into a Windows path
before the AWS CLI sees it.

**Use PowerShell for any AWS call with a leading-slash name:**
```powershell
aws ssm get-parameter --name "/zoryvex/production/feature-flags" --profile <p> --region eu-west-1
```

This has produced a false "the parameter does not exist" finding more than
once during audits.

---

## `terraform init` hangs

Check whether it is working or wedged:

```powershell
Get-ChildItem infrastructure/envs/production/.terraform -Recurse -File |
  Sort-Object LastWriteTime -Desc | Select-Object -First 1 LastWriteTime
```

If the newest file is old and the process is alive, it is stuck — almost
always on a backend read during a network drop.

**Before killing it, check for a stranded lock:**
```bash
aws s3 ls s3://zoryvex-terraform-state-<account>/production/ --profile <p>
```
A `.tflock` object means another apply holds the lock. Only clear it if you
are certain nothing is running.

Then kill, verify DNS, and re-run.

---

## A candidate says they never got an email

**Look in the audit trail, not the logs.** Notices are non-fatal by design, so
a failure leaves a row rather than an error.

```powershell
aws dynamodb scan --table-name zoryvex-production-core --profile <p> --region eu-west-1 `
  --filter-expression "#a = :f" `
  --expression-attribute-names '{\"#a\":\"action\"}' `
  --expression-attribute-values '{\":f\":{\"S\":\"employer_interest_notice_failed\"}}'
```

**Then check the route can send at all:**
```powershell
aws lambda get-function-configuration --function-name zoryvex-production-matches-employer-interest `
  --profile <p> --region eu-west-1 --query "Environment.Variables"
```

It must include `APP_ORIGIN` and `REMINDER_FROM_ADDRESS`. Missing
`APP_ORIGIN` makes `requireEnv` throw *before* SES is reached, and the
non-fatal catch hides it completely.

**This exact failure was live in production.** `matches-evidence` carried
`TABLE_NAME` and nothing else, so the "an employer opened your proof" notice
could never send. A test now reads the Terraform to prevent recurrence.

---

## "GitHub verification keeps failing"

```bash
curl -s https://api.github.com/rate_limit -H "user-agent: zoryvex" | \
  python -c "import sys,json;c=json.load(sys.stdin)['resources']['core'];print(c['limit'],c['remaining'])"
```

Unauthenticated is **60/hour per IP**, measured. One verification spends
three, so roughly 20 verifications an hour platform-wide across a shared
Lambda egress address.

A 403/429 is surfaced as "GitHub unavailable", never as a failed check.

**Fix:** put a value in the GitHub token parameter. It is currently empty in
both environments, so every call is unauthenticated.

---

## A paying employer is told they have no subscription

Fixed on 2026-09-14, but if a variant reappears:

The allowance badge had three situations collapsed into two. `allowanceTotal`
starts at `0`, and zero meant both "no subscription" and "billing has not
answered yet". The billing call is deliberately non-blocking, so a slow or
failed call showed "needs a subscription" to a paying subscriber.

**Check what the server thinks:**
```bash
curl -s https://api.zoryvex.space/billing -H "Cookie: __Host-zoryvex_session=<session>"
```

If the server reports a real allowance and the badge disagrees, it is a
frontend state problem, not an entitlement one.

---

## Costs rising unexpectedly

```powershell
aws cloudwatch get-metric-statistics --namespace AWS/Lambda --metric-name Invocations `
  --start-time (Get-Date).AddDays(-7).ToString("o") --end-time (Get-Date).ToString("o") `
  --period 86400 --statistics Sum --profile <p> --region eu-west-1
```

**Immediate brake** 🔴:
```bash
node scripts/emergency-cost-lockdown.mjs
```
Writes feature flags off. Flags are read on every invocation, so it takes
effect immediately with no deploy.

> Restoring requires writing the **complete** five-key document. A partial
> write deletes the keys it omits — the recorded cause of a four-day flag
> drift in 2026-08.

---

## Checks are failing and you cannot see why

```bash
npm run validate:all
```

Known quirks:

- **Two `next build` processes collide** on Turbopack's lock. Never run
  `validate:all` twice at once.
- **`consent-toggle-inflight` can time out** under parallel load at its 5s
  limit. Passes 3/3 in isolation. Re-run before treating it as a regression.
- **Format check disagreeing with `--write`** usually means an odd JSX
  ternary. Restructure rather than fight it.

---

## Everything looks fine and something is still wrong

Check the things that fail silently:

```bash
cd infrastructure/envs/production && terraform plan -detailed-exitcode -lock=false
```
Exit `0` = no drift, `2` = pending changes.

```powershell
aws ssm get-parameter --name "/zoryvex/production/feature-flags" --profile <p> --region eu-west-1 --query "Parameter.Value" --output text
aws sns list-subscriptions-by-topic --topic-arn "arn:aws:sns:eu-west-1:<account>:zoryvex-production-alerts" --profile <p> --region eu-west-1
```

**An empty alert subscription list means no production alert reaches
anybody.** That was true from launch until 2026-09-14 and nothing surfaced
it, because the absence of alerts looks exactly like the absence of problems.
