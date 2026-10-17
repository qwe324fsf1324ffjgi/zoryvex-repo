# Role analysis

Which roles the Zoryvex work actually qualifies for, and which it does not.

**Written from what this repository demonstrably contains**, verified on
2026-09-14. Nothing here is inferred from ambition.

---

## What the work objectively is

| Fact | Value | Where it is checkable |
| --- | --- | --- |
| Development span | 2026-08-15 to 2026-09-14 (one month, intensive) | `git log` |
| Commits | 303 | `git log --oneline` |
| TypeScript/TSX source files | 538 | repository |
| Test files | 163 | repository |
| Terraform files | 74 across 14 reusable modules | `infrastructure/` |
| Lambda functions in production | 55, each with reserved concurrency | AWS, verified |
| API routes | 51, of which 44 behind an authorizer | Terraform |
| Architecture decision records | 6 | `docs/adr/` |
| Live production system | https://zoryvex.space | public |

**This is a complete, live, revenue-capable AWS serverless platform built and
operated by one person in a month.** That sentence is defensible. Everything
in this folder is built on it.

---

## The honest framing problem

The founder is **non-technical by self-description** and directed this build
rather than hand-writing it. That has to be handled correctly, and there are
exactly two honest positions:

### Position A: technical founder / product owner

Claim: *directed the architecture, made every engineering trade-off decision,
and operates the live system.* True. Defensible under questioning. The
decision records exist and are signed by those decisions.

### Position B: hands-on engineer

Claim: *wrote this code.* **Do not make this claim.** It will not survive a
technical interview, and for someone whose company sells verification, being
caught overstating a credential is not a recoverable embarrassment.

**Every document in this folder takes Position A.** If you want Position B,
the route is to genuinely acquire the skills, and the verification methods
this product uses are the way to prove it.

---

## Roles this genuinely qualifies for

### 1. Technical Product Manager, developer tools or platform · strongest fit

**Why:** you specified, sequenced and shipped a real developer-facing product
with hard technical constraints, and can explain every trade-off from primary
knowledge. Most TPM candidates describe influencing a roadmap. You can show a
running system and the reasoning behind each decision in writing.

**Evidence to lead with:** ADR 0005 (retiring graded tasks because a language
model could pass them, accepting a weaker product on paper for a truer one),
ADR 0001 (rejecting Cognito), the pricing-ladder compression decision under a
hard external payment-provider constraint.

**Risk:** one month of history. Answer it directly rather than obscuring the
dates.

### 2. Founding Product Manager or Product Engineer at a startup · strong fit

**Why:** the whole range is evidenced. Product decisions, commercial
decisions, infrastructure, privacy, incident response. Small companies hire
for range.

**Evidence to lead with:** the payment diagnosis. Eleven live failures, zero
successes, and the correct conclusion that there was no product defect: eight
abandonments and three Paystack *test* cards presented to a *live* account.
Resisting the instinct to "fix" a working system is a senior trait and it is
rare.

### 3. Solutions Architect or Pre-Sales Engineer, AWS · good fit

**Why:** you can whiteboard a real serverless architecture and defend the cost
decisions, because you made them against a real bill. No ECS, no RDS, no NAT
Gateway, no provisioned concurrency. Each an explicit recorded choice.

**Route in:** an AWS certification would make this materially stronger, and it
is verifiable by exactly the method your own product uses.

### 4. Technical Program Manager, platform or infrastructure · moderate fit

**Why:** the deployment discipline is the artefact. Two-confirmation
production releases, a demo-build guard that refuses to upload, a smoke test
that compares the deployed commit, `last-good-commit` rollback targets. Each
guard traces to a specific incident.

**Evidence to lead with:** the demo build that reached production on
2026-09-11, and the guard written afterwards. Incidents you caused and then
made impossible are stronger evidence than incidents you avoided.

### 5. Developer Advocate or technical content · moderate fit

**Why:** the documentation in this repository is the writing sample.
`FAILURE_MATRIX.md` marks every row VERIFIED, CODE-READ or NOT VERIFIED. Most
companies' internal docs do not do that.

---

## Roles this does not qualify for

Stated plainly so nobody wastes a month applying.

| Role | Why not |
| --- | --- |
| Senior or Staff Software Engineer | Requires writing production code under interview conditions. Position B |
| SRE / Production Engineer | Requires debugging live incidents hands-on at depth |
| Security Engineer | Security decisions here are good and were directed, not independently authored |
| Data or ML Engineer | The AI path is built and deliberately switched off. No ML work to speak of |
| Engineering Manager | Requires having managed people. There is no team |

---

## The three stories that carry every interview

Memorise these. They do more work than the CV.

### 1. The graded-task retirement: judgment

> We had a verification method: a published brief marked against a published
> rubric. I realised a language model could solve it from the brief alone. So
> the mark said nothing about the person, while ranking *above* a
> certification that was genuinely bound to their name.
>
> We removed it. The product got weaker on paper and truer in fact. For a
> company selling verification, a verification method that doesn't verify is
> worse than having one fewer.

**Demonstrates:** first-principles reasoning, and shipping against your own
interest.

### 2. The payment investigation: rigour

> Eleven live payment attempts, zero successes. The instinct is that the
> integration is broken.
>
> I went to the provider's gateway data. Eight never reached a card at all,
> `log.attempts = 0`. The other three showed "Test Bank visa credit", which is
> a Paystack *test* card presented to a *live* account, and the live account
> correctly refused it.
>
> There was no defect. The correct action was to change nothing. What I did
> ship was a verification: forged webhook rejected 401, correctly signed
> accepted, replay deduplicated, and the dedupe row confirmed in the table.

**Demonstrates:** diagnosis from evidence, and the discipline not to act.

### 3. The demo build in production: ownership

> A production release shipped the demo build. Every page returned 200 and
> nobody could sign in, because the frontend is a static export and the API
> URL is a build-time variable. Without it the app silently runs on local
> fakes.
>
> My error. The fix was two guards: the release script now refuses to build
> without an https API URL read from Terraform output, and refuses to upload
> if a demo marker appears in the built pages.
>
> Then I found the second-order problem. My own troubleshooting doc told you
> to grep the HTML for the API URL. It is compiled into a JavaScript chunk, so
> that check returns nothing on a *correct* build. A verification procedure
> that produces false alarms is itself a defect.

**Demonstrates:** owning a failure, fixing the class rather than the instance,
and auditing your own fix.

---

## What would move the strongest fit up a tier

1. **An AWS certification.** Verifiable with the issuer, which is the exact
   argument the product makes. Highest return per hour of anything on this
   list.
2. **One real paying customer.** It converts the portfolio from "built a
   system" to "operates a business", and it closes the single largest
   unverified gap in the product.
3. **Publish the decision records.** The ADRs are better than most public
   engineering writing and cost nothing to release.

---

## What must be supplied before these documents can be sent

I do not have the founder's employment history, education, certifications, or
contact details. Every résumé in this folder carries `[PLACEHOLDER]` markers
for those.

**Do not send any of these documents until every placeholder is replaced with
something true.** A résumé from a verification company that contains an
unverified line is the worst possible first impression, and it is the exact
failure mode the product exists to prevent.
