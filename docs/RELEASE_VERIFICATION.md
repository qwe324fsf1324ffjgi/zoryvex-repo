# Release verification — deployment 1 of 2

Date: 2026-09-04. Environment audited: TEST (`test.zoryvex.space`, `test-api.zoryvex.space`).

Two CI/CD deployments remain before commercial phase final. This records what was checked against the
running system rather than against the source that was supposed to produce it, what was fixed, and —
most importantly — what is still not proven.

Nothing here is marked verified on the strength of a passing build. Where the evidence is a live probe,
the probe is named.

## How this was verified

Every row below was checked against the deployed TEST environment or against live AWS, not against the
repository. A green CI run says the code is good; it cannot say the thing serving traffic is.

| Area                    | Method                                                                                                                 | Result                                                                                                                              |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| API route surface       | API Gateway `get-routes` vs Terraform vs handler files                                                                 | 51 declared = 51 live, 0 orphans, 0 missing                                                                                         |
| Lambda surface          | `lambda list-functions` vs `build-lambda.mjs` HANDLERS                                                                 | 56 deployed = 56 handlers                                                                                                           |
| Web route surface       | Every `page.tsx` path fetched over CloudFront                                                                          | 37/37 serve 200                                                                                                                     |
| Unknown path            | Fetched a path that does not exist                                                                                     | 404, not a 200 catch-all                                                                                                            |
| Security headers        | Response headers on the live origin                                                                                    | CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy all present                                       |
| HSTS                    | Terraform `enable_hsts`                                                                                                | Off in test **by design**; production declares the variable, to be flipped in its own reviewed change after a real HTTPS smoke test |
| Real API wiring         | Grepped the deployed JS bundle for the API origin                                                                      | Baked in — the "static export reverted to local fakes" failure is genuinely fixed                                                   |
| Authentication          | 8 protected endpoints called with no session                                                                           | All 401                                                                                                                             |
| Authorization / IDOR    | Every tenant-scoped handler read; searched for tenant ids taken from the request                                       | None found — tenant id always comes from the session, and a mismatch returns `NotFound` so resources cannot be enumerated           |
| Unauthenticated surface | Live routes with `AuthorizationType: NONE`                                                                             | Exactly 9, each token- or signature-gated by design                                                                                 |
| Webhook forgery         | Posted a `charge.success` with no signature, then a wrong one                                                          | Both 401                                                                                                                            |
| Webhook idempotency     | Code read: conditional put keyed on SHA-256 of the signed bytes, with forget-on-failure so Paystack retries still work | Correct                                                                                                                             |
| Payment plan config     | All 6 configured plan codes reconciled against the live Paystack API                                                   | Every amount matches CLAUDE.md exactly                                                                                              |
| Orphan plans            | 3 plans carrying superseded founding prices exist in Paystack                                                          | Unreachable: selection is strictly by code from the SSM registry, never by name                                                     |
| Rate limiting           | Stage throttle + per-email/IP counters in auth                                                                         | 25 rps / 50 burst; auth returns 429                                                                                                 |
| Alarms                  | `describe-alarms`                                                                                                      | 26 alarms, all OK — DLQs, queue age, Lambda errors, API 5xx, SES reputation, DynamoDB throttles                                     |
| Data durability         | `describe-table` + `describe-continuous-backups` + Terraform                                                           | Production declares PITR and deletion protection `true`; test `false` deliberately                                                  |
| Feature flags           | `check-feature-flags.mjs` against live SSM                                                                             | Live state matches what Terraform declares                                                                                          |
| Test suite              | `npm run validate:all` (25 gates) and `npm run e2e`                                                                    | 1916 unit/contract tests; Playwright 251 passed, 3 skipped, 0 failed                                                                |

## What was actually wrong, and what changed

### 1. A deploy could not prove it had deployed anything

`smokeTest` asserted only that `/health` returned 2xx. The **previous** build answers 2xx just as
happily, so a deploy that silently changed nothing passed the smoke test identically to one that
worked. This repository has shipped that exact failure before, and with two deployments left a silent
no-op would consume one with no signal that anything was wrong.

Fixed by giving the running code an identity:

- `scripts/build-lambda.mjs` substitutes the commit into the bundle at build time, so the value
  describes the code itself rather than configuration that could drift from it.
- `/health` reports that commit plus its environment.
- `smokeTest` now compares it against the commit being deployed, retrying briefly because Lambda can
  serve a warm container running the old code for a moment after an update.

Verified by building and invoking the real bundle, not by reading the change: it returned the actual
HEAD commit and `environment: test`.

### 2. Verification depended on a person clicking through the site

Everything in the table above was first done by hand. That does not survive contact with a second
deployment, and it is exactly what should not be relied on.

`scripts/verify-deployment.mjs` (`npm run verify:deployed`) now performs 12 of those checks over HTTP
against a deployed environment, and CI runs it after every deploy with `--expect-version` set to the
commit being deployed. Its route list is derived from the filesystem, so a new page cannot be added and
left unverified. Backed by 18 unit tests covering the rules themselves.

One of the twelve is worth naming, because it guards the change made later the same day: the pricing
page must show every price the code declares. The static export bakes prices into HTML at build time,
so a build that missed a price change serves the old numbers while every test passes against the new
ones — a price change nobody can see is a price change that did not happen. What it establishes is
deliberately stated narrowly in the code: it catches a wholesale miss, not a price attached to the
wrong tier, and one price can match coincidentally, because the page also states the founding saving
in naira.

Run against the live deployment today: **9 of 11 passed.** The two failures were the new version and
environment fields, which the currently-deployed build predates — the check correctly detecting that
TEST is not yet running this commit.

### 3. A pass mark of zero would have passed every submission

`passMark` is declared as `0` in each task literal and set afterwards by a loop. That loop iterated a
second, hand-maintained list of the same 32 task constants. The two lists agreed, so there was **no
live defect** — but nothing made them agree. A task added to `GRADED_TASKS` and forgotten in the other
list keeps `passMark: 0`, and zero passes everything, including an empty submission. On a platform
whose product is proof, that does not surface as an error: it issues verified evidence to somebody who
demonstrated nothing.

The loop now iterates `GRADED_TASKS` itself, so the second list is gone rather than checked. Three
tests assert the property directly, including that every one of the 32 tasks rejects an empty
submission.

### 4. A registry outage could block a deploy, and read as a security failure

CI's Validate job failed on this branch with `npm error audit endpoint returned an error` after a
five-minute registry timeout. Nothing was wrong with the repository, which audits clean.

`npm audit` exits non-zero both for a real advisory and for its own endpoint being unreachable, and
the bare command could not tell those apart. `scripts/dependency-audit.mjs` now classifies them:
findings still fail the build, a transport failure is retried three times, and if it never succeeds
it is reported as UNMEASURED rather than passing quietly or failing loudly. Findings are checked
before transport markers, so a genuine advisory alongside a network warning still blocks — a noisy
log line must never become a way to ship a vulnerable dependency.

### 5. The safe-shell price guard misfired on a hexadecimal constant

The guard that keeps prices out of the neutral status build matched `10000000` inside React's
scheduler constant `0x10000000`. Its existing boundary only excluded a price sitting inside a longer
run of _decimal_ digits; `x` is not a digit, so a hex literal slipped through with a non-digit on
each side.

This surfaced the moment standard Partner became NGN 10,000,000 and would have blocked every build
from then on. The pattern now also refuses a match preceded by `0x`, with tests for both directions:
the hex constant no longer matches, and a real `NGN 10,000,000/month` still does.

### 6. Nothing compared the price shown against the price billed

`initializeTransaction` sends the amount from `SUBSCRIPTION_PRICES_NGN` **and** a plan code from
Parameter Store, and Paystack bills the amount on the Plan. Three sources, updated by three different
mechanisms, and a disagreement throws nowhere: the site shows one number, the attempt record stores
that same number, and the customer is charged another.

This is not hypothetical — it is the state this very change passed through, because a Plan's amount
is immutable and a price rise has to create new Plans and repoint the parameter separately.
`npm run plans:check` now reconciles all three and names the direction of any gap. Its comparison
logic is unit-tested, so it is covered by `validate:all` even though the live check needs credentials
CI does not have.

### 7. The data export left out what was said about the candidate

Two gaps of the same shape, found by asking what the platform records about a person and comparing
it against what that person can see.

**Who received their contact details.** The account page offers to "download everything Zoryvex
holds about you", and the export returned candidate, evidence and file metadata only. It omitted
which employers had paid to receive the candidate's contact details — the most privacy-sensitive
record here. In real mode the account page could not show it either; it said the activity "isn't
viewable here yet". The demo showed it, which is how the gap stayed invisible. A real candidate had
no way to find out at all, beyond the one email sent at the moment of the unlock.

**What employers read about their attempts.** Employers have been shown every graded-task attempt
behind a candidate's evidence — the number, whether it passed, which checks were outstanding, and
whether any attempt tripped a disqualifying check. The employer view surfaces the disqualifying one
deliberately. The candidate could see none of it. The single fact most likely to count against them
was visible to everyone except them.

Both are now in the export, the attempts in the same shape the employer view uses so the two cannot
drift into telling different stories. The unlock rows name the role but not the employer, matching
what the notification email already told the candidate and disclosing nothing further. No unlock
timestamp, because a Match carries none and dating it from the match would report the wrong moment.

The first fix had an IAM consequence the guard caught rather than production did: the export now
queries GSI1, and without a grant every export would have answered `AccessDeniedException`. Same
defect class as the subscription outage, found by `check-gsi-grants.mjs` before it could happen.

### 8. Every free-text field a person types was unbounded

Twenty-one request fields had a minimum length and no maximum. The codebase already bounded the
fields somebody had thought about - a badge URL at 2048, a task id at 128, an HCL submission at
64KB, a peer statement at 600 - which is what made the gap easy to miss: it looked like a codebase
that bounded its input.

Evidence carries four free-text fields on one DynamoDB row, and a row cannot exceed 400KB, so a long
enough submission failed the write after the candidate had written the whole thing. `mustHaveWork`
was worse than a large row: matching scores every requirement against every piece of a candidate's
evidence, so an unbounded list is unbounded work per candidate.

The limits live in `packages/contracts` and are used by both the API schemas and the form fields,
because a limit the API enforces and the form does not is a wall somebody hits only after writing the
whole thing. They bound input only; the schemas that read rows back are untouched, or a validation
change becomes data loss.

### 9. The test site was crawlable, and a shared link rendered as a bare URL

There was no `robots.txt` at all. TEST serves the entire product on a public hostname, so nothing
stopped a crawler indexing a pre-launch environment. `robots.ts` now fails closed: every deployment
refuses crawlers unless explicitly told it is the one to index. A `noindex` meta tag mirrors it,
because `robots.txt` asks a crawler not to fetch a page while the meta tag tells one that already has
it not to index - they fail in different directions.

There was also no `openGraph` or `twitter` metadata anywhere, so a link to this product unfurled as a
bare URL in Slack, LinkedIn, WhatsApp and iMessage. The growth model is a sharing loop on each side,
which makes that card the first thing most people ever see. No share image yet: it has to be a real
raster file at a real size, and a wrong one is worse than none.

Both paths verified by building them. `verify-deployment.mjs` now checks the served `robots.txt`,
since this is a property of what is deployed rather than of what was built.

### 10. A read per item for a list that is always empty

Found by reviewing my own change rather than by a failure. The new export asked for graded-task
attempts against every evidence item, including badges and repository checks, which can never have
any. `match-evidence-service` already avoids exactly this on the employer side and says so in a
comment. Corrected, with a test that asserts which evidence ids were queried.

### 11. Four more, found by checking claims against behaviour

**"Unauthorized" was the whole error message.** Every 4xx kept the server's own wording, which is
right for the errors the application writes and wrong for the two API Gateway writes itself. Somebody
whose session expired mid-form got a single status word. 401 and 403 now carry a next step, matched
on the exact generic string so the application's own specific messages survive.

**Seventeen pages had no main landmark.** The skip link is in the root layout and its target lived
inside the layouts behind the auth guard, so on a protected page it pointed at nothing while the
session was checked, and at nothing at all for somebody signed out - who also got a blank page during
the redirect. The first fix was wrong in an instructive way: `role="status"` on a `<main>` replaces
its implicit landmark role, producing a status region and no landmark. The live region is now nested.

**Twenty pages shared the title "Zoryvex".** Signed-in pages are client components, and Next.js
allows `metadata` only in a server one, so nothing they could do would have set a title. Each now has
a sibling server layout carrying its own, matching its visible heading.

**Every shared link unfurled as the homepage.** No page but one had its own description, and the root
layout stated `openGraph.title`, which stops Next.js falling back to the page's. A candidate sharing
their proof page got the homepage sentence.

Three of these are invisible in the running app - a title, a landmark, a share card - so all three are
now asserted against the built output by `npm run pages:check`, which reads what a browser will
actually receive rather than what the source implies. It found two pages the first pass missed.

### 12. Two specification rules the code had outgrown

`PRODUCT_SPEC` said marketplace checkout needs five matching profiles and called it a hard gate; the
founder lowered it to one on 2026-09-02 with a disclosure attached, and the code has enforced one
since. The document says "preserve exactly", so it was a standing instruction to undo a founder
decision. `COMMERCIAL_RUNBOOK` barred a "fourth role track" that shipped in Phase 7.

The five-match rule on marketplace _promotion_ is deliberately untouched. What may be advertised and
what an informed buyer may choose to buy are different questions, and both documents now say so.

## The price change, and one consequence worth reading

Every subscription price doubled on 2026-09-04 by founder decision: founding to 300,000 / 800,000 /
1,800,000, standard to 500,000 / 1,400,000 / 10,000,000. Doubling preserved the founding discount,
Partner's deliberately different enterprise shape, and the interleave between the two sets.

Six new Paystack TEST Plans were created and verified against the live API. `plan-catalog.mjs` now
puts the amount in each plan name, because the creation script matches by name and refuses a Plan
whose amount disagrees — without the amount in the name, every future raise deadlocks, which is what
forced three plans to be renamed by hand during the previous raise.

**Standard Partner was corrected to NGN 4,000,000 the same day**, on the founder's instruction to
make it a price Paystack can actually take. At 10,000,000 a single charge exceeded the entire
NGN 8,000,000 Starter Business lifetime limit, so the tier could not take a first payment at all.
4,000,000 is the highest price at which a renewal still fits - two charges against the ceiling rather
than one - and every figure above it reintroduces the 5,000,000 failure of selling once and dying at
the first renewal.

That improves the tier without solving it. Two charges is two months, and the ceiling is account-wide
and shared with every other sale, so standard Partner can realistically be sold once, to one
organization. Lifting it needs a Registered Business, which requires CAC registration and is
`NOT AUTHORIZED BY FOUNDER`.

Two knock-on effects worth stating: the founding discount on Partner drops from about four fifths to
about a half, which puts it alongside Scout's and Team's two fifths rather than far outside them; and
the three standard tiers are now close to evenly spaced (2.8x then 2.86x), so the standing copy rule
that Partner is a different shape has been retired rather than left to contradict the prices.

### One operational step this leaves open

`/zoryvex/test/paystack/plan-codes` is deliberately still pointing at the **old** Plans (version 6).
It was briefly repointed at the new ones and then reverted, because the deployed build still carries
the old prices: with the new codes in place, TEST would have displayed 150,000 while Paystack charged
300,000. Keeping the parameter aligned with what is actually deployed keeps the environment honest.

It must be repointed at the new Plans immediately after deployment 1 lands, at which point
`npm run plans:check test` should report all three sources agreeing. Until then that check reports
six disagreements, and that is the correct reading of the current state rather than a fault.

### 13. Everything held about a person, checked against every promise made about it

The method that found the most: take a promise the product makes, find every code path that could
break it, and check the guard is on all of them.

**Account deletion kept five categories of candidate data.** Evidence, files, matches, sessions,
account and profile went; graded-task attempts, verification counters and challenges, peer
attestations, the reminder slot and the public-proof pointer stayed. The docblock named only
AuditEvent and KitOrder as deliberate retentions, so these were not policy - they were partitions
nobody walked. Attempts are the worst of them: a record of how somebody performed, including which
checks they failed, kept after they asked to be forgotten. Peer attestations are the instructive one,
because they live on the EVIDENCE partition rather than the candidate's, so deleting the evidence row
left somebody else's statement about them behind. Everything hanging off an evidence item is now
removed before the item, and a test pins that ordering rather than only the coverage.

**One match response escaped the AI kill switch.** `matching-service` strips `aiExplanation` from
every match response while `aiMatching` is off, precisely because a stored value can outlive the flag
that produced it. The contact-unlock path returned a Match without that redaction in all three of its
exits. Unreachable today, since the flag has never been on, and reachability is not the standard to
hold a kill switch to.

**A candidate could file unlimited evidence.** Matching scores every requirement against every piece,
so capping `mustHaveWork` at twenty while leaving this unbounded left the product unbounded. Worse,
verification allows five attempts per item against GitHub's shared sixty-an-hour limit, so one
account could have stopped verification working for everybody else. Capped at fifty.

**Three claims described an admin console that no longer exists** - the banner, and two sentences in
the console's own notice. All understated what was real rather than overstating it, which is why they
survived, and all are now what is there.

Verified in the same pass and left alone: founding members keep their price because `priceTierFor`
returns founding for anyone already holding a place and Paystack bills an immutable amount; no
billing or Kit handler has a candidate branch; cancellation calls Paystack before touching local
state; the AI prompt receives a structurally limited excerpt with no identity fields; the Kit has a
test forbidding a fabricated candidate; the public status page refuses to make an uptime claim.

### 14. Guards that covered less than their green tick implied

`pages:check` reads the build `validate:all` produces, which renders in local-fake mode while the
deployed build takes different branches. It happens not to matter for landmarks, because layouts
supply them, and the guard now says so rather than implying it checked both.

The OpenAPI parity test compared fourteen of the contract's forty-six schemas. Twenty-two more had a
zod source and were never wired in - eight objects through the existing comparison, and fourteen
enums through a new one, because an enum gaining a value in code but not in the contract is as
misleading as a renamed property. `mlops` was added to `LaunchTrack` as a fourth track and nothing
would have said if the contract had kept listing three. Thirty-six are now checked; all pass, so this
removed the room for drift rather than finding any. The remaining ten are plain TypeScript interfaces
with no runtime schema, and the test names them.

## What deployment 1 will actually do

Established by a read-only `terraform plan` against the live TEST state, at commit `ddf8822`, with
the same variables CI supplies. Worth doing before spending a scarce deployment rather than after.

**Plan summary: +0 ~59 -0.** Nothing created, and nothing destroyed.

| Change                       | Count | Why                                                                                                                                                                                |
| ---------------------------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `aws_lambda_function` update | 56    | Every bundle carries a new build sha, so every function's code hash changed. This is the deploy.                                                                                   |
| `aws_iam_role_policy` update | 1     | `privacy-export` gains GSI1, the grant the export needs and the guard caught. Verified: table plus GSI1, deny-by-default intact.                                                   |
| `aws_iam_role_policy` update | 2     | The two scheduler-invoke policies, whose documents are data sources Terraform cannot prove equal until apply. A perennial plan artifact rather than a change this work introduced. |

No stateful resource appears in the plan at all: no table, bucket, GuardDuty detector, SES identity
or certificate. `deploy.mjs` would have refused the plan outright if one did, and it did not have to.

The site build is separate from this plan and is synced during the apply.

## Not verified, and why

Stated plainly rather than left implied.

### An authenticated journey against the deployed environment

The e2e suite builds `apps/web` without `NEXT_PUBLIC_API_BASE_URL`, so its 251 tests exercise the UI
and workflow logic against local fakes. They do not exercise the deployed API. Each layer is covered
— the API by its own contract and integration tests, the client by `real-api-*` tests — but the chain
end to end, through a browser, against TEST, is not.

This cannot currently be automated, and the reason is a correct security decision rather than an
oversight: magic-link tokens are stored hashed, so the plaintext token is not recoverable from
DynamoDB. Driving a real sign-in requires reading a real inbox. Building that would mean new receiving
infrastructure for the sake of a test.

What was done instead: the entire unauthenticated deployed surface is now automatically verified, which
is the part that could be.

### Subscribe has still never been pressed

Every link in the chain is individually confirmed — the IAM grant read from live AWS, the marketplace
gate, the founding price, the plan code reconciled against live Paystack, the disclosure. The chain as
a whole remains a prediction. This is the single most valuable thing a person can do in TEST, and it
takes one click.

## Founder decisions still open

1. **What Partner buys.** The only plan-conditional behaviour in the API is the contact-unlock
   allowance (scout 5, team 15, partner 50). Partner costs six times Scout and buys nothing else.
2. **The unreachable preview UI** in the employer role page — dead while the marketplace gate is 1,
   needed if it ever rises. Marked with a comment rather than deleted.
3. **ADR 0004 step 1** — write non-AWS tasks until "Cloud platform" is an honest label for the
   `aws_cloud` track.
