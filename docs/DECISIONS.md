# Decisions Log

Chronological. Each entry: date, decision, why, what it forecloses.

## 2026-09-10 — Production GuardDuty ownership, and HSTS on from the first apply

**Decision.** Two calls taken at the pre-deployment gate, after planning production
for the first time.

Production creates its own GuardDuty malware-protection IAM role rather than sharing
the test environment's, and reads the account's existing detector through a data
source rather than taking it as an input. And `enable_hsts` now defaults to true, so
the header ships from the first production apply instead of a later one.

**Why.** The gate planned production for the first time and it could not run at all.
Two defects would each have failed the apply on their own: every Lambda package path
was a required variable with no default (50 of 50, against test's 0 of 56, with the
example file listing two of them), and the evidence-storage module called
`length()` on a variable production declares as null, which aborts the plan before
the precondition beside it can print the sentence explaining what to set.

Behind those sat a real question. `terraform.tfvars.example` said to take the
GuardDuty detector and role from the bootstrap environment's output. Bootstrap
creates the Terraform state bucket and outputs `state_bucket_name` alone, so those
outputs do not exist. The only detector and role in the account belong to the test
environment. Pointing production at them would have meant production's malware
scanning stopped the day test was torn down, which is not a dependency a paid
product should carry.

An IAM role is per-name, so production having its own costs nothing and removes that
coupling. A detector is genuinely one per account per region, so production cannot
have its own — and `infrastructure/envs/test`'s own comment already prescribed the
answer: a later environment "must reference this same detector via a data source,
never create a second one in the same account+region". Reading it also means there
is no value for anybody to look up or paste wrong on the single production apply,
and it cannot drift.

HSTS was a different kind of problem. The old default of false was correct
reasoning — the header is close to irreversible for the length of its max-age, so it
should not precede working HTTPS — but the instruction to "flip it true afterwards,
in its own reviewed change" assumed a spare deploy, and the answer to when it would
be turned on was drifting towards never. It is safe on because it is not a promise
made in advance: the header only ships from a distribution already answering over
HTTPS, every behaviour is redirect-to-https, and a certificate is validated before an
alias is attached. A browser receiving it has just completed a successful HTTPS
request to the host that sent it.

**What it forecloses.** `preload` stays false and is deliberately not part of this
decision. Submission to the browser preload list is the part a later apply genuinely
cannot take back, and it should follow HSTS running cleanly on the real domain rather
than accompany its first appearance.

Production is now route-complete apart from the three peer endpoints ADR 0006
retires, which it correctly never gains. The public proof page and its badge were
added in the same pass: production had the consent route that mints a
`publicProofId` without the routes that serve one, so a candidate could have opted
in, been handed a link, and had it 404 for everyone who opened it.

Production plans 434 to add, 0 to change, 0 to destroy, from four inputs that are all
derivable. Test still plans +0 ~58 -0.

**Still true, and not changed here.** Production reserves Lambda concurrency nowhere,
where test reserves 5 per function. That difference is pre-existing; it was noticed
when a first draft of the new routes copied test's line and referenced a variable
production does not declare. Matching production's own convention was the smaller
change, and the difference is recorded rather than quietly resolved.

## 2026-09-09 — File uploads and colleague confirmations removed; every plan visible on the billing page

**Decision.** Three founder instructions, taken together in one branch.

Uploading a file to a claim is removed. The attachment choice is now a link or nothing. Asking a
colleague to confirm a claim is removed: the request flow, the page the colleague landed on, and the
places the confirmation was displayed to the candidate, to an employer, and on a public proof page.
Separately, the employer billing page now shows every plan at all times, and a subscription that has
been cancelled can be restarted on any plan.

**Why.** The two removals are one decision, and it sharpens what the product is rather than trimming
it. Zoryvex sells the difference between what somebody says and what a source they do not control
confirms. A file a candidate uploads fails that test: they chose it and could have made it, and no
amount of virus-scanning changes what it is evidence of. A colleague's confirmation fails it for the
same reason one step removed: the candidate picks who to ask. Neither could ever move a claim to
verified, so both sat on the evidence page as routes that looked like progress and were not. What is
left is the two checks Zoryvex runs itself against somebody else's record: a certification confirmed
with the body that issued it, and control of a public repository proven by a one-time code in a public
gist.

The billing change is a defect rather than a decision. The plans section rendered only when
`!hasSubscription || subscriptionStatus === 'cancelled'`. An employer part-way through a paid month
saw no plans at all, and more seriously, cancelling did not bring them back: cancelling moves a
subscription to `non-renewing` and leaves access running to the end of the period already paid for,
and `non-renewing` is not `cancelled`. So the plans stayed hidden for the rest of the month while the
cancel dialog promised, in as many words, "You can subscribe again later". They could not.

**What it forecloses.** No candidate can attach a document to a claim, and there is no route for
somebody with no certification and no public repository to become verified. That is deliberate and it
is a real cost: it narrows supply to people who have one of those two things. The alternative was
keeping two routes that produced something an employer had to take on trust, on a page whose entire
claim is that they do not have to.

`peer_verified` stays in the evidence strength ladder. Records already carrying it earned it under the
rules that applied at the time, and deleting the level would rewrite their history to tidy up an enum.
Nothing new can attain it.

The upload/scan/download pipeline and the three peer endpoints remain in the codebase and are
unreachable from any screen. Their S3 bucket, GuardDuty malware protection and API routes are a
Terraform destroy, which needs founder approval, so they are recorded as outstanding rather than
removed quietly. This is the same treatment ADR 0005 gave the graded-task catalogue.

On the billing side, showing every plan does not mean every plan can be bought at every moment.
Paystack has no proration and no way to move a running subscription to a different plan, and
`subscription-service` refuses a second subscription while one is `active` or `attention`. So a live
subscriber sees all three tiers, with their own marked, and is told what switching actually involves:
cancel, keep what is paid for until the period ends, then start the new one. The page now says that
rather than offering a button that would return 409.

## 2026-09-09 — Subscription floor raised to NGN 800,000, and the ladder compressed to fit Paystack

**Decision.** Founding Scout 300,000 to 800,000, Team 800,000 to 1,400,000, Partner 1,800,000 to
2,400,000. Standard Scout 500,000 to 1,200,000, Team 1,400,000 to 2,000,000. Standard Partner stays at
4,000,000. The Proof Hiring Kit stays at 95,000.

**Why.** Founder instruction, verbatim: "lowest price even for founder should be 800000". That is one
number and it could not be applied on its own, because founding Team was already 800,000 and two tiers
at one price is not a ladder.

**Why compressed rather than scaled.** The floor is the founder's to set; the ceiling is not.
Paystack's Starter Business lifetime collection limit is NGN 8,000,000 account-wide, so 4,000,000 is
the most any single charge can be and still leave room for its own renewal. Scaling the old ladder to
a 800,000 floor would have put standard Partner near 10,700,000, above the entire account limit. That
is not a hypothetical: standard Partner was briefly 10,000,000 on 2026-09-04 and had to be reversed
the same day because the tier could not take a first payment at all. The six numbers are what fits
between a floor the founder set and a ceiling Paystack sets.

**What was checked rather than assumed.**

- Every tier still takes a payment and a renewal. The headroom table in `docs/PRODUCT_SPEC.md` was
  recomputed with `scripts/lib/paystack-fees.mjs` rather than by hand, and `npm run fees:check` passes:
  the smallest row is standard Partner at 2 charges and nothing sits at 1.
- The two sets still interleave: 800,000 < 1,200,000 < 1,400,000 < 2,000,000 < 2,400,000 < 4,000,000,
  so a founding Team buyer still pays more than a standard Scout buyer and every step up is real.
- Founding discounts are 33% Scout, 30% Team, 40% Partner. Tighter than the previous spread, which had
  Partner at about a half against two fifths elsewhere. Three discounts within ten points read as one
  ladder rather than three unrelated offers.

**What it forecloses.** Nothing above 4,000,000 on any tier while the business is a Paystack Starter
Business. Lifting that needs a Registered Business (CAC), which is `NOT AUTHORIZED BY FOUNDER`. It also
ends the "Partner is a different shape" framing for good: founding steps are 1.75x and 1.71x, standard
1.67x and 2x, so the tiers are a ladder and copy should not claim otherwise in either direction.

**Outstanding, and it is a human action.** Paystack Plan objects cannot be edited, so the five plans
whose amounts changed must be recreated and the plan-code parameter repointed.
`npm run plans:check` currently reports those five as mismatched and refuses to pass, which is the
guard working: until the plans are recreated, a buyer would be charged less than the page showed them.
The Kit is unaffected because its price did not move.

## 2026-09-06 — Founder's evidence and matching review, acted on in one branch

Decision: nine changes, from a founder email of 2026-09-05 reviewing evidence, verification, matching,
contact and sign-in. Each is recorded here because each closes something that was either broken in
production or quietly contradicted what the product claims.

**Graded tasks retired as a verification method.** See ADR 0005 for the finding, what is kept, and the
cost. Applied retrospectively: `isVerified` refuses the method, so evidence verified before the decision
stops counting too. Supersedes ADR 0004's sequencing.

**Certification verification widened past AWS, and a cross-issuer hole closed.** Google Cloud, the Linux
Foundation (Kubernetes) and HashiCorp added. The allow-list was two independent sets — issuer names and
badge names — which was harmless with one issuer and unsafe with several: a badge issued by Google Cloud
but named "AWS Certified Solutions Architect" would have satisfied both. Now scoped issuer-to-badge.
Every string read from live Open Badges records, not from certification pages: a Terraform certification's
page says HashiCorp while the credential names IBM Professional Certification, so matching the page would
have rejected every genuine one. Microsoft is absent and cannot be added — it left Credly in 2024.

**A claim's kind now decides how it is checked.** `source` and `verificationMethod` were unrelated
choices, so a claim filed as a repository could be verified by a certification badge. The existing test
fixtures had the same defect, which is how pervasive it was. `VERIFICATION_METHOD_FOR_SOURCE` is the
single answer, enforced server-side before the attempt counter.

**Peer-confirmation email fixed.** The route named a SES configuration set in its environment and was
granted only the sending identity, so every "ask someone to confirm this" returned AccessDenied, surfaced
as "Unexpected error". Same class as PR #40. A policy check now fails CI for the general case.

**Session lifetimes raised for self-serve roles**, 30 minutes idle / 12 hours absolute to 30 days / 90
days. `founder_admin` deliberately unchanged. Both expiries still enforced server-side, so ADR 0001 holds.

**Contact channels, profile photos, and view notifications added.** Phone and LinkedIn ride the existing
contact-unlock gate rather than a new route. Photos reuse the upload pipeline and reach no employer-facing
shape at all, because a photograph beside a ranked list is how demographic bias enters screening. A
candidate is told, at most once a day per employer, when an employer opens their proof.

**Two interaction defects fixed**, both found by driving the running application: no `:active` rule
existed anywhere, and hover is media-gated, so a tap on a touch screen produced no feedback at all; and
the mobile menu stayed open across navigation because SiteNav lives in the layout and its `<details>`
was never remounted.

Why: the founder's instruction was to make every verification make sense and to remove what could not be
made to. Most of these were things the product already claimed and did not do.

Forecloses: graded tasks cannot return as a verification route without a compile error and an ADR.
A new SES sender cannot ship without its configuration-set grant. A new issuer cannot vouch for another
issuer's credential. A contact channel or photo added to the candidate record does not reach an employer
by default — it has to be added to a gate deliberately.

## 2026-08-18 — Bootstrap scoped down to the state bucket only (Phase 6 founder review)

Decision: `infrastructure/envs/bootstrap` creates only the Terraform state S3 bucket (4 resources). The
GuardDuty detector + malware-protection IAM role moved into `infrastructure/envs/test` (the environment that
actually applies first and consumes them); the GitHub OIDC provider + CI deploy roles were removed from this
phase's scope entirely (Prompt 6 never asks for CI-driven deployment — every apply this phase runs from the
founder's own AWS CLI session); SES domain identity/DKIM/MAIL FROM moved into a new `infrastructure/envs/
foundation` environment, applied separately per Prompt 6's explicit two-stage instruction.
Why: the founder asked me to justify each piece of the original (Phase 5) bootstrap plan before approving
an apply, and the honest answer was that Phase 5's "account-level singletons all belong in bootstrap"
reasoning didn't match Prompt 6's actual described stages. Also caught in the same review: an erroneous
`aws_guardduty_detector_feature("S3_DATA_EVENTS")` resource (GuardDuty S3 Protection — a separate, real,
usage-billed feature, not a prerequisite for Malware Protection for S3 as Phase 5 assumed) was deleted
entirely, not just moved.
Forecloses: a future phase provisioning production must reference the already-existing GuardDuty detector
via a data source, never create a second one in the same account/region (that apply would conflict). CI-
driven deployment via the `ci-deploy-role`/OIDC modules remains unused until a future phase explicitly asks
for it.

## 2026-08-18 — `aws_cloudwatch_metric_alarm` for CloudFront metrics: real provider limitation, deferred

Decision: no CloudWatch alarm exists for CloudFront's error rate in either environment. Three real, isolated
`terraform apply` attempts — bare `provider = aws.us_east_1`; the same plus an explicit resource-level
`region = "us-east-1"` argument; and a standalone single-resource module with `aws.us_east_1` as its only
"aws" provider requirement — all failed with the identical AWS-side error ("Invalid region eu-west-1
specified. Only us-east-1 is supported"), even though every attempt's `terraform plan` correctly showed
`region = "us-east-1"` beforehand. Cross-referenced against `hashicorp/terraform-provider-aws#28971`
("Add region support for aws_cloudwatch_metric_alarm"), which shows this resource's cross-region/provider
handling has a documented history of gaps.
Why: this is a genuine, reproduced provider limitation, not a config mistake on this project's part — every
other alarm in `infrastructure/modules/observability` (22 of them) applies and works correctly; only the one
CloudFront-specific alarm, which structurally requires a different region than the rest of the environment,
is affected. Continuing to retry Terraform-side mitigations without new information would not have found a
different result a fourth time.
Forecloses: nothing permanently. Revisit by either (a) re-testing once a newer `hashicorp/aws` provider
version is available, or (b) a deliberate, tracked exception: create the alarm via `aws cloudwatch
put-metric-alarm --region us-east-1` outside Terraform, then `terraform import` it into
`infrastructure/modules/cloudfront-alarm`'s state so it stays under IaC management going forward. Neither
was done this phase — see `docs/RISK_REGISTER.md` for the open tracking entry.

## 2026-08-15 — v4.8 binding accepted as controlling over older Cognito references

Decision: [[adr/0001-no-cognito-passwordless-email-auth]] (no Amazon Cognito, ever, for application auth) controls over the "Prompt 0" preserved-manual text, which still lists Cognito under "FIXED ARCHITECTURE."
Why: the v4.8 binding text is explicit that it "replaces every older line that asks for a Cognito user pool..." — this is exactly that case, anticipated by the binding itself.
Forecloses: no future phase may reintroduce Cognito by citing the older Prompt 0 wording as authoritative. See [[docs/RISK_REGISTER]] and [[docs/COST_GUARDRAILS]] for the tracking entries.

## 2026-08-15 — Phase 0 work stays on the existing feature branch

Decision: Phase 0 files are created on `chore/v4.8-binding` (already checked out, already holds the binding-turn commit), not a new branch, and not `main`.
Why: smallest reversible change; avoids an unnecessary branch proliferation for what is still pre-code, pre-deploy documentation work; `main` stays untouched/unborn until the founder decides to merge.
Forecloses: nothing — a later phase can still branch from here or merge to `main` when the founder chooses; this is not a merge, just a continuation of the same working branch.

## 2026-08-15 — Docker not installed/used despite being present

Decision: Docker 29.2.1 is present on the machine but is explicitly not required by Phase 0's tool classification and is not to be installed or used for this guide.
Why: Prompt 0 rule B states Docker "is not required and must not be installed for this guide." It was already present before this session (not installed by the assistant), so no action was taken either way.
Forecloses: no phase should add a Docker-based workflow (e.g., local Lambda containers) without a fresh, explicit founder decision overriding this rule.

## 2026-08-18 — Prompt 5's Cognito text superseded by ADR 0001, exactly as Prompt 0's was

Decision: Prompt 5's "AUTH AND SECURITY" section (Cognito User Pool, JWT authorizer) does not control;
[[adr/0001-no-cognito-passwordless-email-auth]] does. `infrastructure/modules/auth` builds a Lambda REQUEST
authorizer instead — no `aws_cognito_*` resource exists anywhere in `infrastructure/`.
Why: identical situation to the 2026-08-15 entry above — a preserved prompt names Cognito, the v4.8 binding
already anticipated exactly this recurrence ("replaces every older line that asks for a Cognito user
pool..."), and CLAUDE.md's own text repeats the override explicitly ("This overrides any older
preserved-prompt text that still names Cognito").
Forecloses: no future phase may reintroduce Cognito by citing Prompt 5's (or any other prompt's) wording as
authoritative. `scripts/terraform-policy-check.mjs` enforces this as a CI gate, not just a written rule. See
[[docs/RISK_REGISTER]].

## 2026-08-18 — CloudFront flat-rate $0 plan not selected; pay-as-you-go with no WAF at launch instead

Decision: `infrastructure/modules/static-site` uses CloudFront's standard pay-as-you-go billing. No AWS WAF
web ACL is created.
Why: live-verified 2026-08-18 that the current `hashicorp/aws` Terraform provider has no way to select
CloudFront's flat-rate plan (open GitHub issue #45450, unmerged), and that plan's Free tier doesn't actually
bundle WAF either way — so neither condition Prompt 5 set for preferring it holds. A real WAFv2 web ACL is a
genuine recurring cost ($5/mo + $1/rule + $0.60/M requests), not bundled on the selected path, so it is not
created reflexively. Full reasoning: [[adr/0003-cloudfront-pay-as-you-go-no-waf-at-launch]].
Forecloses: a future phase revisiting the flat-rate plan must re-verify Terraform support first, not assume
issue #45450 has been resolved. Adding WAF later must be its own reviewed, budgeted change, triggered by
observed abuse (tracked in [[docs/RISK_REGISTER]]), not a default.

## 2026-08-18 — GuardDuty Malware Protection for S3 chosen over a custom Lambda scanner

Decision: evidence-bucket malware scanning uses GuardDuty Malware Protection for S3
(`infrastructure/modules/evidence-storage`'s `aws_guardduty_malware_protection_plan`), not a bounded custom
Lambda scanner.
Why: Prompt 5's own preference order picks GuardDuty "if its current configuration has no unacceptable
fixed idle charge" — live-verified 2026-08-18 that it has none (every billed dimension is usage-based; see
[[docs/SOURCES]]). A custom scanner would mean maintaining a malware-signature engine ourselves, a strictly
worse position for a solo non-technical founder than a fully-managed AWS-native option with no idle cost.
Forecloses: nothing permanently — if GuardDuty's pricing model changes to include a fixed charge, this
should be revisited against the same preference order, not silently kept out of inertia.

## 2026-08-18 — `terraform test`/`mock_provider` tried, then reverted in favor of `terraform validate` only

Decision: CI runs `terraform validate` for all three environments (real, passing); it does not run
`terraform test` with `mock_provider`.
Why: actually tried it first (three `.tftest.hcl` files, `mock_provider "aws" {}`), and CI failed — a
blanket AWS mock also mocks locally-computed data sources like `aws_iam_policy_document` and
`tls_certificate`, which this repository's Terraform depends on for every IAM role and the GitHub OIDC
thumbprint. Fixing it properly means an `override_data` block per `aws_iam_policy_document` address (there
are several, across `infrastructure/modules/{auth,api-route,ci-deploy-role}` and bootstrap's own), which
would need updating every time a module gains or changes a policy document — a maintenance burden judged
not worth it for what `terraform validate` (structural/type checking, already comprehensive for this
config's actual failure modes) doesn't already catch. Full reasoning and the exact CI error text:
[[docs/SOURCES]].
Forecloses: nothing — a future phase could still add narrowly-scoped `mock_provider`/`override_data` tests
for a specific module in isolation (not a whole environment root) if the wiring risk in that module
specifically warrants it.

## 2026-08-18 — Two-module split: `api-gateway` (the API) vs. `api-route` (one Lambda + route each)

Decision: the API Gateway HTTP API, its stage/CORS/authorizer/custom-domain, live in
`infrastructure/modules/api-gateway`; each individual Lambda + integration + route is a separate
`infrastructure/modules/api-route` call against that same API.
Why: an earlier single-module draft (`infrastructure/modules/api`, since deleted) created one whole
`aws_apigatewayv2_api` per Lambda — correct for Phase 3's single `GET /health` handler, but structurally
wrong the moment a second route (e.g. an authorized one) needs to share the same API, CORS config, and
custom domain. Caught and fixed during this same phase, before merge, rather than shipped and discovered
later.
Forecloses: nothing — a future backend-implementation phase adds more `api-route` module calls against the
same `api-gateway` output, never a second `aws_apigatewayv2_api`.

## 2026-08-19 — Prompt 7's auth section names a Cognito group; same conflict, same resolution

Decision: Prompt 7's "AUTHORIZATION MODEL" section says founder-admin auth uses "a separate Cognito group
and MFA-ready flow." Per CLAUDE.md's explicit override rule, ADR 0001 ("No Amazon Cognito, ever") controls —
this is the third occurrence of the identical conflict shape (Prompt 0, Prompt 5, now Prompt 7). Resolved the
same way both times before: founder-admin is a `role: 'founder_admin'` on a pre-provisioned `Account` item
(`infrastructure` unchanged — still the Lambda REQUEST authorizer + DynamoDB, never Cognito), and the
"MFA-ready flow" requirement is met with WebAuthn/passkey step-up (`services/api/src/domain/webauthn-service.ts`,
`@simplewebauthn/server`), which ADR 0001's own "Founder/admin step-up" section already specified.
Why: the rule already resolved this twice; no new founder question needed.
Forecloses: nothing new — `scripts/terraform-policy-check.mjs` continues to fail CI if "Cognito" appears in
any `.tf` file outside a comment, unchanged.

## 2026-08-19 — Auth-token pepper generated by a script, not Terraform's `random` provider

Decision: `infrastructure/envs/test|production/main.tf`'s `aws_ssm_parameter.auth_token_pepper` is created
with a placeholder value (same shape as the Paystack secret parameter) and replaced by
`scripts/generate-auth-token-pepper.mjs` immediately after apply, instead of generating the value in
Terraform via `hashicorp/random`'s `random_id` resource.
Why: adding the `random` provider required a fresh `terraform init` provider-registry fetch, which failed
twice identically in this sandbox (`Failed to query available provider packages ... hashicorp/random was
not found`) — the same `registry.terraform.io` connectivity limitation documented repeatedly since Phase 0/3
for this environment's plain CLI. Per the repeated-failure rule, stopped after two identical failures and
found a different approach rather than retrying a third time: this value has no external/founder owner
either way (unlike Paystack's), so a script-generated replacement right after apply is no less secure than
a Terraform-generated one, and avoids a new provider dependency entirely. The script is idempotent (checks
the parameter's `Version` via metadata only, never decrypts) so re-running it after the placeholder has
already been replaced is a safe no-op, not a silent rotation.
Forecloses: nothing — a future phase with confirmed provider-registry connectivity could still add the
`random` provider for this or other values if a real reason to prefer it over a script emerges.

## 2026-08-19 — `contactUnlockConsent` added to `CandidateSchema` as `.optional()`, not `.default()`

Decision: the new candidate-side contact-unlock consent flag
(`packages/contracts/src/domain.ts`) is typed `z.boolean().optional()` — no default, no required-in-TS-type
field — and treated as "not consented" whenever absent, rather than following `discoveryOptIn`'s existing
required-boolean shape.
Why: `discoveryOptIn` predates this phase and every object literal typed as `Candidate` across
`packages/local-adapters`' fixtures already sets it; adding a second *required* boolean would force editing
every one of those fixture files just to keep them compiling, for a field slice 5's own scope doesn't
otherwise touch (mirrors the same reasoning already applied to `version` in the evidence-pipeline slice).
`.optional()` with an explicit "absent means false" interpretation gets the same safe-by-default privacy
posture without that blast radius.
Forecloses: nothing — `apps/web`'s onboarding UI can still set it explicitly once slice 8 wires the real API
client; until then every existing local-adapter fixture keeps compiling unchanged.

## 2026-08-19 — Moved Kit template logic out of `apps/web` into a new shared package

Decision: `generateProofGapPreview`/`generateKitDeliverables` (Phase 4, originally `apps/web/src/lib/`) moved
into a new `packages/kit-templates`, with a new `renderKitHtmlDocument` added alongside them; `apps/web`'s
three call sites now import from `@zoryvex/kit-templates` instead.
Why: Prompt 7 requires "deterministic generation must always work and must remain the source of required
sections" for both the free client-side preview and the real, paid, server-generated Kit
(`services/api/src/domain/kit-service.ts`) — that guarantee only holds if both consumers call the *same*
code, not two independently-maintained copies that could silently drift (the same reasoning already applied
to `MAX_EVIDENCE_FILE_BYTES`/`ALLOWED_EVIDENCE_MIME_TYPES` in the evidence-pipeline slice). `apps/web` isn't
otherwise touched until the API-client slice; this is a narrow, mechanical relocation of pure functions with
zero other coupling, not early "slice 8" work.
Forecloses: nothing — `apps/web`'s free-preview UI keeps working exactly as before, unchanged behavior,
different import path only.

## 2026-08-19 — Hand-rolled JPEG/PNG metadata stripping instead of `sharp` in the evidence-scan worker

Decision: `services/api/src/lib/strip-jpeg-metadata.ts`/`strip-png-metadata.ts` parse JPEG segment markers /
PNG chunk headers directly (pure JS, no dependency) rather than using `sharp` (already a dependency
elsewhere in this repo, for the one-off local `scripts/process-founder-photo.mjs` asset-prep script).
Why: `sharp` ships a native, per-platform prebuilt binary — the dependency already installed on this Windows
dev machine (`@img/sharp-win32-x64`) would not run in Lambda's Linux runtime; using it correctly there needs
either forcing the `linux-x64` optional dependency into the deployment zip or a Lambda layer, both of which
this sandboxed environment cannot build-and-invoke end-to-end to actually prove correct. A hand-rolled
parser, scoped to exactly the four allowed evidence MIME types, is fully covered by unit tests
(`tests/strip-jpeg-metadata.test.ts`, `tests/strip-png-metadata.test.ts`) constructing synthetic byte
fixtures with a known metadata segment/chunk and asserting it is gone afterward — no native binary, no
platform-mismatch risk, consistent with this project's existing preference for dependency-free scripts
(`scan-secrets.mjs`, `terraform-policy-check.mjs`, `check-licenses.mjs`).
Forecloses: nothing — `sharp` remains available if a future need (e.g. real image resizing, not just
metadata stripping) makes the native-binary tradeoff worth it; that would be its own reviewed Lambda-bundle
change, not a silent scope creep of this one.

## 2026-08-19 — Amazon Nova Micro (`eu.amazon.nova-micro-v1:0`) as the Bedrock model for the gated explain path

Decision: `infrastructure/envs/{test,production}`'s `bedrock_model_id` variable defaults to
`eu.amazon.nova-micro-v1:0`, invoked via `services/api/src/repositories/bedrock-repository.ts`.
Why: Prompt 7 asks to "select the lowest-cost accessible on-demand model" and "record model ID/version/price
source." Verified live (WebFetch, `aws.amazon.com/bedrock/pricing/`, 2026-08-19): Amazon Nova Micro is the
cheapest on-demand text-generation foundation model on Bedrock ($0.035-0.04/1M input tokens, $0.14/1M output
tokens, model ID `amazon.nova-micro-v1:0`). This API runs in `eu-west-1` (CLAUDE.md architecture), so the
`eu.*` cross-Region inference profile ID is used rather than the bare model ID — confirmed via AWS's own
inference-profile documentation that a cross-Region call requires this profile-prefixed ID, and separately
confirmed that IAM must grant `bedrock:InvokeModel` on **both** the inference-profile ARN (region- and
account-scoped) **and** the underlying foundation-model ARN (`arn:aws:bedrock:*::foundation-model/<id>`, no
account ID, region wildcarded since the profile's destination Regions span more than one EU Region) — both
grants are wired in `infrastructure/modules/api-route`'s new `bedrock_invoke_arns` variable. The Invoke-API
request/response JSON shape (`schemaVersion: messages-v1`, `output.message.content[0].text`,
`usage.{inputTokens,outputTokens}`) was likewise verified live rather than guessed, same research discipline
already applied to the GuardDuty/Paystack schemas in earlier slices.
Forecloses: nothing — this is a deploy-time-configurable Terraform variable, not hardcoded in application
code; switching models later (e.g. once a real evaluation set exists and picks a different winner) is a
one-line variable change, no code change. `aiMatching` stays `false` regardless, so this model is never
actually invoked with real traffic this phase.

## 2026-08-19 — `/zoryvex/<env>/feature-flags` is a plain SSM String parameter, not SecureString

Decision: `aws_ssm_parameter.feature_flags` (both envs) uses `type = "String"`, unlike the auth-token-pepper
and Paystack-secret-key parameters it sits next to.
Why: `scripts/emergency-cost-lockdown.mjs` already named this exact path as its proposed convention back in
Phase 6, before any code read it — this slice is the first real reader/writer. The value
(`packages/config`'s `FeatureFlagsSchema`, JSON-encoded booleans) contains nothing secret, so `SecureString`'s
KMS-decrypt overhead and IAM `kms:Decrypt` grant would add cost/complexity with no security benefit.
`lifecycle.ignore_changes = [value]` is still applied (mirroring the two SecureString placeholders) for a
different reason than "protect a founder-entered secret": this is exactly the parameter an incident-response
lockdown overwrites out of band, and a later `terraform apply` must never silently revert that back to the
checked-in default while an incident is still being investigated.
Forecloses: nothing — `scripts/terraform-policy-check.mjs`'s SecureString-must-ignore_changes rule doesn't
apply here (it isn't a SecureString), but the same protective lifecycle block was added anyway since the
underlying reason (don't let apply revert an out-of-band operational write) still holds.

## 2026-08-19 — Completed WebAuthn step-up state tracking, rather than leaving it session-role-only

Decision: `finishStepUp` (`services/api/src/domain/webauthn-service.ts`) now writes a `stepUpVerifiedAt`
timestamp onto the caller's own session item, and every sensitive admin handler calls a new
`requireFounderStepUp` (`src/http/session-context.ts`) that requires both `role = founder_admin` and a
`stepUpVerifiedAt` within the last 15 minutes — not just "this session belongs to the founder."
Why: slice 1 built the WebAuthn ceremony itself and a comment in `webauthn-step-up-verify.ts` said "callers
combine this with session rotation... in the specific admin-action handler that requires step-up," but no
such handler existed yet, so nothing ever actually consumed the ceremony's result — a real, if
narrow, gap between "the crypto works" and "the crypto is load-bearing." Slice 7's `GET /admin/exceptions` is
the first real admin action, and shipping it without wiring this through would have meant `founder_admin`
alone (a role a session either has or doesn't, with no time-bounded elevation) was the actual access control —
contradicting ADR 0001's own "MFA-ready flow" framing. A 15-minute window (not "for the rest of the 12-hour
session") keeps the elevation narrow, matching how step-up/reauthentication windows are conventionally scoped
elsewhere.
Forecloses: nothing — the window length is a plain constant, easy to revisit once real admin usage exists to
tune it against.

## 2026-08-19 — Paystack dispute events alert and audit, never touch payment/entitlement state

Decision: `charge.dispute.create`/`.remind`/`.resolve` (verified live against Paystack's docs) are handled in
`processPaystackWebhook` as a dedicated branch that only appends an AuditEvent and publishes to the SNS
alerts topic — it never calls `updateKitOrderStatus`/`updateEntitlement`, unlike the existing
`charge.success`/`charge.failed` branch.
Why: Prompt 7's mandatory-alert list names "dispute" as something a human must be notified of, but resolving
a dispute is inherently a human/Paystack-dashboard action (arguing evidence, accepting a chargeback) — there
is no safe automated resolution to apply, and guessing one would risk silently mutating entitlement state on
a payment that's actively contested. The exact `data` field shape for a dispute payload was **not** verified
against a real field-by-field structure the way `charge.success`'s was (Paystack's own docs point to a
separate Dispute-resource reference without inline field names) — recorded honestly in
`docs/RISK_REGISTER.md`, not guessed; the alert message only ever includes the event type and the (verified,
present-on-every-Paystack-resource) `data.id`, nothing more specific.
Forecloses: nothing — a future phase can add real dispute-resolution automation once a concrete,
founder-approved policy exists for what "safe to auto-resolve" even means here.

## 2026-08-19 — Two AWS EventBridge event shapes verified live before implementing against them

Decision: ACM's `"ACM Certificate Approaching Expiration"` event (`source: aws.acm`, `detail:
{DaysToExpiry, CommonName}`) is used as-is in `infrastructure/envs/{test,production}`'s new
`aws_cloudwatch_event_rule`, fetched/searched live against `docs.aws.amazon.com/eventbridge/latest/ref/
events-ref-acm.html` and AWS's own quoted example event JSON — same research discipline already applied to
GuardDuty/Paystack/Bedrock schemas in earlier slices, not assumed from the plausible-sounding names alone.
Why: an event-pattern typo (wrong `source`/`detail-type` string) would silently mean the rule never matches
anything, ever — a decorative alarm that looks configured but never fires, the exact "Phase 4 decorative
allowance meter" failure mode this project's own `observability` module header already warns against for
unverified custom metrics.
Forecloses: nothing — this is a pure verification record, no design tradeoff involved.

## 2026-08-19 — Split Phase 7 slice 8 into two parts after discovering a real backend gap

Decision: the branch originally opened for slice 8 ("apps/web real API client") instead ships session-read +
Role/Candidate-profile/Evidence-claim CRUD HTTP endpoints — "slice 8, part 1." The actual fetch-based
adapters, environment-driven composition root, and `apps/web` call-site wiring move to a follow-up PR
("slice 8, part 2").
Why: a research pass across `packages/local-adapters`' full interface surface against every real
`services/api` endpoint (after slices 1-7) found that of roughly 45 interface methods, only ~12 had any real
backend, and — critically — **Role/Candidate-profile/Evidence-claim creation and editing had zero HTTP
surface anywhere**, even though slice-2's repository functions for all three were built and tested from the
start. Without them, "wire the real API client" would have nothing real to point onboarding or role-creation
at — the single most central product actions (a candidate adding evidence, an employer creating a role) —
making a same-slice attempt at both the missing backend AND the full adapter/UI layer either rushed or
dishonest about what actually works. Every other originally-planned slice 8 capability (auth's magic-link
shape mismatch vs the local fake's code-entry model, FileAdapter's presigned-upload shape, AIAdapter's
3-endpoint real flow vs a single local method, QueueAdapter/EmailAdapter staying permanently local-only,
PaymentsAdapter's missing subscription-checkout surface) is recorded for part 2 to address directly, not
silently dropped.
Forecloses: nothing — this is a sequencing decision, not a scope cut. Every method identified as genuinely
out of reach this phase (subscription checkout, AI summarize-only, file list/delete) is still tracked in
`docs/RISK_REGISTER.md`, to be picked up explicitly rather than discovered again by surprise.

## 2026-08-19 — Slice 8 part 2 ships a tested real API client library plus one additive page, not a full `packages/local-adapters` interface conversion

Decision: `apps/web/src/lib/real-api/` is a new, independent, fully async, fetch-based client covering every
capability that now has a real backend (auth session/sign-in/out, roles, candidate profile, evidence claims
and files, Kit, privacy, matches, admin exceptions) — genuinely tested (mocked-`fetch` Vitest coverage per
module). It is wired into exactly one new page, `apps/web/app/admin/(app)/exceptions`, additive alongside the
existing local-fake-driven admin dashboard. `packages/local-adapters`' seven interfaces, their `Local*Adapter`
implementations, and the ~20 existing call sites across `apps/web` are **unchanged**.
Why: a closer read of `packages/local-adapters/src/interfaces/*.ts` while starting this slice found the
mismatches were deeper than the part-1 research already flagged — `AuthAdapter`'s own `AccountRole` type is a
three-value local enum (`candidate | employer | admin`) that doesn't even match the real four-role
`AccountRole` in `packages/contracts` (`employer_member`/`employer_admin`/`founder_admin` split), and every
interface method is synchronous by design. Converting all seven interfaces to match the real shapes, making
every method async, and rewriting ~20 call sites (each needing a real loading/error-state story, not just an
`await`) is a large, interface-redesign-grade change that touches the entire existing Playwright-tested
surface — not something to push through mechanically in the same pass as building the client itself. Building
and testing the client as its own module first, proving it actually works end-to-end against a real
capability (the new exceptions page), is the lower-risk sequencing: the hard, valuable, backend-facing work
ships now, fully tested; the UI-layer interface conversion becomes its own reviewable change once this
client is proven solid, not bundled sight-unseen into the same PR.
A real bug this sequencing caught before it shipped: the client's first draft required a captured CSRF token
before *any* mutating call, which would have made `POST /auth/request-code`/`/auth/consume-code` — the two
calls that establish a session and its CSRF token in the first place — permanently unusable. Fixed to attach
the CSRF header only when a token has been captured, letting the real authorizer (which never applies CSRF
checking to those two unauthenticated routes) be the actual source of truth, caught by
`tests/real-api-auth.test.ts` before merge, not discovered live.
Forecloses: nothing — every method the client exposes is available for a future page to adopt incrementally;
the local-adapters interface conversion remains explicitly open in `docs/RISK_REGISTER.md`, not silently
treated as done. **The deployed test site keeps running entirely on local-fake data after this slice** —
`NEXT_PUBLIC_API_BASE_URL` is a build-time env var never set in the current build pipeline, so nothing about
the live `test.zoryvex.space` build changes until a future slice deliberately sets it.

## 2026-08-15 — Two external doc-verification fetches failed and were not retried a third time

Decision: Terraform S3-backend-locking docs and the Windows 11 lifecycle page both failed with `ETIMEOUT`. Recorded as PENDING in [[docs/SOURCES]] rather than asserted as verified, and not retried per the repeated-failure rule.
Why: rule 18 — two failures of a materially identical approach (external WebFetch) stop automatic retry.
Forecloses: nothing permanently; a future phase may retry once network conditions are known to differ, or ask the founder to confirm manually before anything depends on those specific facts (Terraform state locking behavior, OS support window).

## 2026-08-23 — Every status claim carries an explicit evidence bucket, and a PR's own description never counts as a pass

Decision: `docs/DEPLOYMENT_STATUS.md` and `.zoryvex/state.json` now tag every Phase 7 status with exactly one
of six buckets — **Implemented** (code/infra exists, not deployed or exercised), **Deployed to TEST** (live in
AWS, not exercised), **Independently verified live** (a real acceptance test passed, evidence cited),
**Attempted, failed** (a real run happened and failed, evidence cited), **Unconfirmed — evidence missing** (a
claim exists with nothing independent behind it), and **Not yet tested**. `.zoryvex/state.schema.json`
constrains a check's `status` field to `PASS`/`WARN`/`BLOCKED`/`PENDING`, so the bucket is stated in words
inside each `detail` string and is authoritative over the enum value. That enum is a **workflow-tracking**
field, not an acceptance-evidence field: a row marked `PASS` whose detail reads *Implemented* has passed no
real test, and the two must never be conflated. Every Phase 7 slice row whose only evidence is a merge plus
a green CI run is now labelled *Implemented* explicitly, rather than being left bucket-less next to a `PASS`
and quietly reading as proven. This was a documentation-only pass: no
code, infrastructure, AWS, Terraform, or Paystack change accompanied it.

Why: a read-only audit against live evidence found the status documents drifting in the one direction that
actually costs money and trust — toward implying gates had passed when they had not. Three concrete cases
forced this. First, the deletion and matching gates were recorded as "not yet run" when the truth was worse:
both had been run, both had failed on a real `AccessDenied`, and neither had been retested after the fix.
Second, the EICAR fail-closed result was recorded as passing on the strength of a PR body written by the same
agent session that claimed to have run it — no CI log can even exist for it, because the verifier is wired
into no workflow. Third, the file still carried a `/auth/callback` 404 and a CSP finding that two merged PRs
had already fixed, so the same document was simultaneously too pessimistic about closed items and too
optimistic about open ones. The common root cause is that "merged", "green CI", and "the PR says it works"
were all being allowed to read as "passed". CLAUDE.md already forbids claiming completion from a build alone;
this makes that rule mechanically visible on every single row instead of relying on a reader's memory.

Forecloses: nothing technical. It does mean a future session cannot quietly promote a row to
**Independently verified live** without citing the specific evidence in the same edit — and that an empty or
zero-result run (for example a match recompute that returns no candidates because none are opted in) must be
recorded as a failure to prove the gate, never as a pass.

## 2026-08-23 — TEST feature flags restored to their source-controlled defaults after ~4 days of drift

Decision: one bounded, founder-authorized `aws ssm put-parameter` restored `/zoryvex/test/feature-flags` to
the complete four-key source-controlled document, `{"aiMatching":false,"contactUnlocks":false,
"payments":false,"publicDiscovery":false}` — version 3 → 4 at 2026-08-23T13:39:24+01:00. TEST only. No
Terraform apply, no deployment, no Lambda restart, nothing production, nothing Paystack.

Why: a read-only audit of `docs/COST_MODEL.md`'s "Bedrock off by default" claim found the live parameter
holding `{"aiMatching":true,"contactUnlocks":true}` — a two-key document contradicting the four-key one that
`packages/config`'s `FeatureFlagsSchema` and `infrastructure/envs/test/main.tf` both define, with two flags
set opposite to source. `aws ssm get-parameter-history` dates the flip precisely: v1 at
2026-08-18T23:35:20+01:00 wrote the all-false two-key document that
`scripts/emergency-cost-lockdown.mjs` writes during a lockdown; v2 at 2026-08-18T23:36:09+01:00 — 49
seconds later — flipped both to `true`; v3 at 2026-08-20T12:00:32+01:00 rewrote the same true values. So
`aiMatching` was on for roughly four days, violating the standing rule that it stays off until the AI
evaluation gate passes.

On attribution, the record stops where the evidence stops: all three writes were made under the founder's
SSO `AdministratorAccess` assumed role, and AWS parameter history **cannot** distinguish a human typing a
command from an authorized local agent acting under that same assumed role. This entry therefore does not
claim who acted. The most probable reconstruction, explicitly not proven, is that the Phase 6 lockdown
rehearsal wrote the all-false document and the follow-up "set them back" step — which the script
deliberately does not perform itself, printing an instruction instead — set them to `true` rather than to
the source default `false`.

No harm resulted, and that is verifiable rather than assumed: the only code path reading `aiMatching` is
`bedrock-explain-service.ts:185`, and its Lambda's log group holds 0 bytes and 0 log streams, so the Bedrock
path was never invoked once — no model call, no spend, no AI output ever reached a human. `contactUnlocks`
is read by no `services/api` code at all. Production was never in scope: no `/zoryvex/production/*`
parameter exists in the account.

Forecloses: nothing. It does surface a real gap worth a later decision — the lockdown script writes a
partial two-key document and leaves restoration to a human instruction, which is exactly how a partial,
wrong-valued document came to sit in place of the four-key one for four days. Making the script write and
restore the complete document, or making the drift visible automatically, is a follow-up worth considering,
not something changed here.

## 2026-08-25 — CLAUDE.md's "three launch tracks only" superseded by the founder's MLOps role-taxonomy amendment; `LaunchTrackSchema` gains a fourth value, `mlops`

Decision: CLAUDE.md's Fixed Product section names "three launch tracks only (AWS cloud, DevOps/platform,
cloud-security/DevSecOps)" and says not to change the fixed product without a founder decision. The founder's
binding MLOps role-taxonomy amendment (2026-08-25, delivered mid-turn in chat, same standing as every other
binding instruction) is exactly that founder decision — same shape as the Cognito conflict above, where an
explicit newer founder instruction supersedes older preserved/fixed text, except here CLAUDE.md's own text is
not edited directly; this entry is the resolution record, matching how the Cognito conflicts were resolved
without rewriting CLAUDE.md itself.

Design chosen, not the amendment's literal four-title list: `mlops` is **one** new `LaunchTrackSchema` value
(`packages/contracts/src/domain.ts`), not four separate tracks for MLOps Engineering / ML Platform
Engineering / ML Infrastructure Engineering / AI Platform Engineering. Reasoning: `LaunchTrack` is a
structural partition — GSI1's `TRACK#<launchTrack>` discovery key (`docs/DATA_MODEL.md` access pattern #7)
and the denominator the 5-real-match marketplace gate counts against per saved role. Four near-identical
structural tracks would fragment a small emerging candidate pool across four tiny buckets, making the
5-match gate materially harder to reach — directly working against the amendment's own stated commercial
mechanics. The amendment's own wording supports one track: "treat related titles as **discoverable aliases**
while preserving their distinctions" describes a search/label layer, not four partitions. The four titles
(plus more) live instead in a new canonical, versioned taxonomy module,
`packages/contracts/src/mlops-taxonomy.ts` (`MLOPS_ROLE_TITLE_ALIASES`), alongside the amendment's 20-item
MLOps capability vocabulary (`MLOPS_CAPABILITY_AREAS`, stable ids so relabeling never breaks a stored
evidence-tag reference) and explicit non-membership guidance (`MLOPS_NON_ALIAS_TITLES` — a data scientist,
generic AI engineer, or generic cloud engineer is not automatically MLOps, per the amendment's own caution).
`aws_ml_genai_ops` and `llmops_genai_ops` are flagged
(`MLOPS_CAPABILITY_AREAS_REQUIRING_SPECIFIC_EVIDENCE`) as never implied by a broader MLOps claim, matching
the amendment's "do not assume it from generic MLOps experience" instruction for those two areas specifically.

Verified additive and backward-compatible before merging: `npm run typecheck` clean across every workspace
(the one strict `Record<LaunchTrack, string>` in the codebase, `LAUNCH_TRACK_LABELS`, forced the compiler to
catch every place needing a new entry — there was exactly one, in the same file); `npm test` green at 481/481
with no other test asserting an exact track count. Existing candidate/role/match records are untouched — this
is a new selectable enum value, not a migration.

Why: the founder's amendment is itself the required decision CLAUDE.md's own rule asks for; the one-track/
alias-layer design is a technical judgment call within that decision, made to protect the marketplace gate's
integrity rather than fragment it, and recorded here so it isn't silently reversed by a future session reading
only the amendment's literal four-title list without this reasoning.
Forecloses: adding `ml_platform_engineering`, `ml_infrastructure_engineering`, or `ai_platform_engineering` as
separate `LaunchTrackSchema` values without a fresh founder decision explicitly overriding this reasoning —
the taxonomy module is where new alias titles or capability areas belong instead.

## 2026-08-25 — Phase 8 Paystack test-mode slice: verify independently before granting, never trust the webhook body alone

Decision: implemented the founder's Paystack-scope amendment's eight-point minimal integration
(`services/api/src/lib/paystack-client.ts` initialize/verify, wired into `kit-service.ts`'s `requestKitOrder`
and `paystack-webhook-service.ts`'s `processPaystackWebhook`, full detail in `docs/PAYMENTS.md`'s new
"Implementation status" section). Two design choices worth recording:

1. **Verification is a second, independent server-to-server call, not a body-field check.** The webhook
   already had `payload.data.status === 'success'` and a reference-format check; this was insufficient
   against the amendment's explicit "verify the expected transaction reference, currency, amount, customer,
   product, and environment" requirement, and against Paystack's own documented recommendation. The fix
   calls `GET /transaction/verify/:reference` and compares status/reference/currency/amount to the stored
   order before granting anything — the webhook body is now only ever used to decide *whether to check*, not
   *whether to grant*.
2. **A verify-call failure (Paystack unreachable) does not throw out of the handler.** `recordWebhookEventOnce`
   runs early, uniformly, for every event type (unchanged) — if verify were allowed to throw and cause a 5xx,
   Paystack would retry the same event id, hit the idempotency check, and silently no-op forever, permanently
   stranding a real payment in "pending" with no path to ever being confirmed. Caught instead: audited
   (`paystack_verify_unreachable`), alerted to the founder, order left pending, no entitlement granted. This
   trades "self-heals from a transient Paystack outage automatically" for "never risks a subtle idempotency/
   retry interaction bug in money-adjacent code" — the right tradeoff per the amendment's own priority order
   (protect payments/data-integrity first).

Scope boundary, not an oversight: `apps/web/app/employer/(app)/role/page.tsx`'s Kit-status display stays
local-fake-only (it already was, before this change) — wiring a real-time status view isn't one of the
amendment's eight points, and this session is operating under a strict ~10-additional-GitHub-Actions-run
budget (1900/2000 minutes already used, resets in 7 days), so scope was held deliberately tight. The
entitlement is still correctly granted server-side; only this one confirmation view is stale post-purchase
until a follow-up slice.

Why: matches the amendment's explicit instruction ("implement exactly the authoritative eight-point
amendment scope... without inventing additional payment scope") and its priority order (security/data-
integrity/payments first, smallest reliable integration, never overbuild).
Forecloses: nothing new. The role-page status-display gap and a `GET /roles/{roleId}/kit-orders` status-read
endpoint (which would close it cheaply, reusing the already-existing `getKitOrderForRole` repository
function) are recorded as an open, low-risk follow-up rather than silently dropped.

## 2026-08-25 — Employer sign-in wired to the real backend, closing a gap discovered while trying to test matching live

Decision: while walking the founder through the human-only Phase 7 matching gate (a real employer session),
discovered `SignInForm.tsx` had `useReal = intendedRole === 'candidate' && isRealApiConfigured()` — employer
sign-in had never been wired to the real backend at all, a pre-existing, already-commented, deliberate scope
boundary from earlier work ("Only the candidate flow is wired... until that work happens"), not a regression.
This meant no employer could ever get a real session through the UI, which blocks matching and the Kit gate
regardless of any email-check.

Fix, scoped to exactly what's needed to unblock the gate, nothing more: `SignInForm.tsx`'s `useReal` now
includes `employer` (mapping the component's `'employer'` prop to the backend's `'employer_admin'` role
literal — `founder_admin` stays local-fake, since it uses a separate pre-provisioned-account + WebAuthn
step-up path, not this self-serve form). `/auth/callback` now offers an employer a "Create a role" link
instead of the generic "not wired yet" message. `/employer/roles/new` now calls the real `POST /roles` via
the already-existing (never previously used) `realRoles.createRole` client function. `/employer/role` gained
a real-mode branch: fetches the real role + real matches, and adds a "Recompute matches" button calling the
already-existing `realMatches.recomputeMatches`. No backend code changed at all — `useSession()`,
`realAuth.requestSignIn`, `/auth/callback`'s consume step, and every real-api client function used here
already supported any role; only the frontend UI gate and two page wirings were missing.

Deliberately NOT wired, to keep this the smallest fix that unblocks the gate rather than a full employer
real-mode rebuild: the employer dashboard/role-list page, Kit purchase status display on the role page
(already a known, documented gap from the Phase 8 Paystack slice), candidate-detail lookup on match cards
(shows a truncated candidate id instead, matching the existing local-fake page's own pre-gate-open
precedent), and contact-unlock allowance display.

Why: the founder explicitly asked to unblock matching live-verification; this was the actual blocker once
the human email-check step itself turned out to be necessary-but-insufficient. Scoped tightly given the
founder's explicit GitHub Actions run-budget constraint this session.
Forecloses: nothing. The employer dashboard, Kit-status display, and full match-card real-mode wiring
remain open, low-risk, already-documented follow-ups.

## 2026-08-26 — Kit checkout CORS gap found and fixed (missing idempotency-key header)

What: the founder's first real attempt at the Kit gate — a live TEST-mode Paystack checkout, using the
real employer session and role from the matching-gate walkthrough — failed at the "Continue to Paystack"
button with a generic "Couldn't start checkout with Paystack" toast. CloudWatch showed zero new invocations
of zoryvex-test-kit-create-order (last invocation still 2026-08-21), proving the request never reached the
backend at all — the same silent-preflight signature already documented once in this file for PR #57's
missing x-zoryvex-csrf header. Root cause confirmed against the live deployed API Gateway (not just
Terraform source, via `aws apigatewayv2 get-api --query CorsConfiguration`): AllowHeaders was exactly
`authorization, content-type, x-zoryvex-csrf`, missing `idempotency-key` — the one custom header
`apps/web/src/lib/real-api/kit.ts`'s `createOrder` sends and `services/api/handlers/kit/create-order.ts`
requires. Grepped every real-api client file first to confirm this header is used nowhere else, so the
gap is isolated to the Kit route alone, not a broader pattern.

Fix: added `idempotency-key` to `infrastructure/modules/api-gateway/variables.tf`'s `cors_allow_headers`
default (now `["content-type", "authorization", "x-zoryvex-csrf", "idempotency-key"]`), mirrored to both
test (applies via CI) and production (source-only, not applied) since both envs instantiate the same
module with no override. Validated before push: `terraform fmt -check` clean, `terraform validate` Success
for both envs, `terraform-policy-check.mjs` clean (71 files), `scan-secrets.mjs` clean, full
`npm run validate:all` green (production build of all 33 routes included). Independently verified before
declaring this the cause, not guessed: read the module's own `cors_allow_headers` variable description,
which already documents the identical failure mode for the CSRF-header case, then checked the live
deployed CORS config directly rather than trusting Terraform source alone.

Why: this is the last of Phase 7 slice 11's own acceptance gates (the Proof Hiring Kit order/webhook/
generation flow), and it had never been exercised against live TEST before — Phase 8's own check row
already recorded this honestly ("NOT yet independently verified live"). Not deferred: the founder had
already completed the harder prerequisite (a real employer session + role) and the fix is small, additive,
and isolated.
Forecloses: nothing. Kit checkout must still be re-attempted and its resulting KitOrder/webhook/entitlement
independently verified via DynamoDB/CloudWatch before the gate is called passed.

## 2026-08-26 — Kit checkout's second real defect: Paystack reference format (colon separator rejected)

What: even after the CORS fix above deployed, the founder's real checkout attempt still failed — 13
separate pending KitOrder items were created (one per click; each got a fresh idempotency key, so no
dedupe collision), all stuck at `pending`, none advancing. CloudWatch showed every kit-create-order
invocation completing cleanly (START/END/REPORT, no ERROR) because `services/api/src/adapter/http.ts`
maps a typed `AppError` straight to a JSON response without `console.error` — so a handled Paystack
rejection is invisible in Lambda logs by design, not a missing-logging bug.

Root-caused, not guessed: rather than redeploy blind or guess again, replicated the exact same
`POST https://api.paystack.co/transaction/initialize` call the Lambda makes, from this session directly,
using the already-verified TEST secret key (decrypted into a shell variable, never printed, unset
immediately after — same discipline as the earlier test-mode-prefix check). Real response: HTTP 400,
`"message": "Invalid character in transaction reference"`, `"code": "invalid_character_in_reference"`,
meta note that only alphanumeric plus `-,.,=` are allowed. `kit-service.ts`'s `requestKitOrder` built the
reference as `` `${roleId}:${kitOrderId}` `` — colon is not in Paystack's allowed set, so every single
initialize call was destined to fail from the moment Phase 8 shipped; nothing about the CORS fix could
have surfaced this, since the request never reached Paystack before that fix landed.

Fix: changed the separator from `:` to `.` in both `kit-service.ts` (reference construction) and
`paystack-webhook-service.ts`'s `parseReference` (the webhook-side split). `.` was chosen over `-` because
`-` is already present inside both UUID components — using it would make a naive first-delimiter split
ambiguous — while a UUID never contains a period. Updated the one `docs/DATA_MODEL.md` mention and the
test fixtures in `kit-service.test.ts`/`paystack-webhook-service.test.ts` that hardcoded the old colon
format (checked the `ROLE_ID`/`KIT_ORDER_ID` test constants contain no period themselves, so no fixture
became ambiguous). Verified: the 27 kit-service/paystack-webhook-service tests still pass, full
`npm run validate:all` green (production build of all 33 routes included), `scan-secrets.mjs` clean.

Why: this is the second and (as far as diagnosed) final blocker on Phase 7's last acceptance gate. Pushing
it spends a third workflow run past the founder's explicit "assume ≤2 remaining" instruction — surfaced to
the founder directly rather than pushed through silently, and explicitly authorized ("Push it now") before
this commit.
Forecloses: nothing. The 13 stray pending KitOrder items left behind by the failed attempts are harmless
test debris (same category as the already-documented 145+ unreconciled TEST records) and are not cleaned
up here — cleanup stays selective, per existing guidance. Kit checkout must still be re-attempted after
this deploys and its resulting KitOrder/webhook/entitlement independently verified before the gate passes.

## 2026-08-26 — Kit checkout's third real defect: Paystack test-mode webhook URL misconfigured, and gate closed

What: even after both code fixes above deployed, the founder's real checkout attempt (07:50:41Z) still
showed no deliverables. Independently verified with Paystack directly (read-only `transaction/verify`
call, same disciplined pattern as the earlier diagnosis — secret key decrypted into a shell variable,
never printed) that the payment had genuinely succeeded on Paystack's side: `status: "success"`,
`domain: "test"`, NGN 29,000, paid at 2026-08-26T07:50:54Z, corroborated independently by the founder's
own Paystack receipt email. So the failure was not a payment problem. Checked `/aws/lambda/zoryvex-test-
webhooks-paystack`'s log streams: zero invocations since 2026-08-21 — Paystack never called our webhook
at all for this transaction. Root cause, found by asking the founder to check the Paystack Dashboard
(Settings -> API Keys & Webhooks, Test Mode): the **Test Webhook URL field was set to `https://Zerah.com`**
(an unrelated placeholder from earlier account setup), never our real endpoint. This is why every prior
Kit-checkout attempt across this entire session — Phase 8's implementation, and both earlier diagnosed
defects — could never have worked end-to-end regardless of code correctness: the account-level webhook
destination was simply wrong, a piece of state that lives only in the Paystack dashboard, invisible to
`terraform plan`, `scan-secrets.mjs`, or any test in this repository. This is exactly the item recorded
back in Phase 1/6 as "Paystack non-secret dashboard verification... raised... when a later phase actually
needs that state" (docs/MANUAL_ACTIONS.md) — that phase is now.

Fix: founder corrected the Test Webhook URL to `https://test-api.zoryvex.space/webhooks/paystack` and
saved. No code or infrastructure change needed — this was purely account configuration, outside this
repository entirely. Verified end to end with one more real TEST checkout: `KITORDER#aa2340a5-289d-439d-
b4f5-08793494c5ca` transitioned `pending` -> `succeeded`; the webhook Lambda logged one clean invocation
(`RequestId 093c78f7-47a0-4af7-a088-274ea6dc0faa`, 1983.87ms — consistent with the independent server-to-
server verify call Phase 8 added, not a bare webhook-body trust); `KITARTIFACT#00001` was generated
(4,710 characters of real HTML, `generatedAt: 2026-08-26T08:08:47.680Z`, ~15 seconds after the order
succeeded).

Why: this closes Phase 7 slice 11's final acceptance gate. The 16 earlier pending KitOrder items (13 from
the CORS-blocked attempts, 3 from the colon-reference attempts) and this transaction's own now-superseded
retries are left as harmless test debris, same as the rest of this session's accumulated TEST records.
Forecloses: Phase 7 slice 11 (deploy + verify + wrap-up) is now fully independently verified live across
every one of its gates: auth, evidence pipeline, EICAR, export, deletion, matching, and Kit. Phase 7 as a
whole remains ACTIVE, not PASSED — slice 10 (load/quota) is still genuinely PARTIAL for reasons unrelated
to this work (no reserved concurrency configured to demonstrate, no documented SLO, and the Lambda
concurrency quota-increase case must not be polled without separate founder authorization) — this is not
downgraded or glossed over by slice 11's completion.

## 2026-08-27 — Standard subscription prices fixed, so the marketplace does not close at 25 customers

What: the three founding tiers were capped at the first 25 organizations and nothing existed after that
cap. Founding pricing was not a launch discount sitting in front of a list price — it was the entire
offer. The twenty-sixth organization to arrive wanting to hire had nothing at all it could buy, and the
pricing page told it so.

Decision (founder-approved 2026-08-27): standard monthly prices are fixed at Scout NGN 119,000, Team NGN
345,000, Partner NGN 899,000. They are available to everyone, always, with no waiting list. The three
founding prices (79,000 / 229,000 / 599,000) are unchanged and remain capped at 25 organizations.

Why these numbers: roughly one and a half times founding, which puts the founding discount near a third
off and lets it be stated in a single sentence a buyer can check. Recorded here because CLAUDE.md's
"Fixed product" section previously fixed only the founding prices and was silent on what followed; it now
carries both sets, and both are pinned by exact-value tests in apps/web/tests/pricing.test.ts.

Why a price and not features: the early-adopter benefit is a permanently lower price, held for the life
of the subscription. Feature-gating founders would mean building and maintaining two versions of the same
marketplace, and would make the standard tier read as a punishment for arriving late. A test asserts both
price points carry the identical contact-unlock allowance, so "same product, different price" stays true
rather than being a claim in copy.

Deliberately not done: a live "only N founding places left" counter. With no paying customers it would be
either unverifiable or manufactured urgency, and a product whose whole proposition is not having to take
claims on trust cannot afford either. The honest statement is the cap and what happens after it, which is
what both pages now say.

Forecloses: the pricing page can no longer describe an offer that runs out. Any future change to a
standard price is a founder decision recorded here, the same as a founding price.

## 2026-08-27 — Launch tracks reconciled at four, and MLOps has no graded task yet

What: CLAUDE.md's "Fixed product" section said "three launch tracks only" while
LaunchTrackSchema has shipped four since Phase 7, the fourth being `mlops`. Every
environment, every fixture, and the live TEST table have carried four the whole time. The
governing document and the running system disagreed, and the document was the one that was
wrong.

Decision: the record now says four. Reconciling to three would mean deleting a track that
already exists in live data, which is a destructive change to fix a documentation error.
Market research this session also supports keeping it: AI and ML platform work is repeatedly
named alongside cloud security as a top skills gap, and the track costs nothing to carry.

Consequence at the time: `mlops` had no graded practical task, because none of the rubrics
written that day discriminated well for that work, and a weak rubric is worse than none since
it puts Zoryvex's name on a result that means nothing.

Closed the same day: `task_model_serving_v1` now covers the track, built around the two things
that separate somebody who has run a model in production from somebody who has deployed one
— a container image pinned to a digest or explicit tag, and data capture switched on so drift
is detectable at all. All four tracks now have a task. The null path in taskForTrack stays,
because the rule that produced it has not changed and a future track ships without a task
until one is worth publishing.

Forecloses: the four-track list is now the record. Adding or removing a track is a founder
decision recorded here, the same as a price.

## 2026-08-28 — The Playwright worker pool is sized by memory, not by cores

What: the candidate-journey test failed on emulated mobile roughly one run in three, always
at the same place — `check()` on the discovery opt-in giving up after 30s "waiting for element
to be visible, enabled and stable". Two fixes were written for it and both were wrong. The
first assumed a React hydration race was discarding the sign-in email, and added a fill-and-
verify helper across 35 call sites. The second assumed the control was still being pushed down
the page by the evidence list loading above it on a narrow viewport, and added a settle wait.
Neither changed the failure rate; the second ran while failures went up.

The measurement that settled it: five back-to-back runs at Playwright's default worker count
failed every time, and five identical back-to-back runs at `--workers=1` passed every time.
Nothing on the page was moving. Playwright calls an element stable once its box is unchanged
across two consecutive animation frames, and a machine running two Chromium instances with
under 2GB spare cannot reliably deliver two such frames. A starved compositor and a genuinely
animating element are indistinguishable from inside the check.

Decision: set `workers` from free memory, budgeting ~1.5GB each and never exceeding the
core-count default. Playwright's default is one worker per two cores, which counts cores and
ignores memory, and memory is the binding constraint here — every worker is a whole browser,
and the `mobile` project's device-emulated context composites more than the desktop one does.
A machine with room still runs in parallel; a 4-core/8GB box drops to a worker it can feed.

This costs nothing here, which is the part worth remembering. The full suite runs in 9.2
minutes on one worker against 12.4 on two, so the contention was already more expensive than
the parallelism was buying. The second worker was paying for a slower suite and a false
failure at the same time.

Consequence: both earlier fixes were reverted rather than left in. Each carried a comment
asserting a cause this measurement disproves, and a confident wrong explanation in the tree is
worse than no comment. Neither was masking a real defect: the product is not broken for a
person on a slow phone, who does not need the layout to hold still for 30 seconds.

Forecloses: a green suite on this machine now means green. The failure was never masked with a
local retry, and `retries` stays 0 outside CI so a real regression still fails the run. CI keeps
its single retry for runner variability that cannot be measured from here.

## 2026-08-28 — Some rubric checks disqualify rather than cost a mark

What: the graded tasks pass on most checks rather than all of them, because
demanding perfection fails somebody who plainly knows the work and pushes the rubric toward
the trivia that wrecks technical interviews. Writing the cloud-security secrets task exposed
where that reasoning stops. A submission that moves a database password into Secrets Manager
by typing the password into the Terraform met four of five checks, and four is the pass mark.
It passed, while doing the exact thing the task exists to prevent, and it would have carried
a Zoryvex verification saying so.

Decision: a check may be marked disqualifying, and failing it fails the attempt whatever the
score. This is the identity gate's reasoning applied to a check rather than to authorship: the
allowed miss exists for things a candidate left out, and does not extend to things a candidate
put in. Used on one check today, the hardcoded credential. It is not a way to make an ordinary
check count double, and a check only qualifies where the failure is categorical rather than
partial.

Consequence: the failure message had to change with it. A disqualified submission can sit at
or above the pass mark, and reporting "4 of 5 requirements met, and 4 are needed" beside a
failure is a rejection with no legible cause, which the AI safety rules forbid outright. The
response now names the check that ended it, says why it matters, and tells the candidate to
rotate the value if what they pasted was ever real, because it has been written down and
rotating it is the only thing that undoes that. The attempt stays retryable: pasting a
credential is a mistake to correct, not fraud.

Forecloses: nothing about the pass margin itself, which stays at one miss for every other
check on every task. Adding a second disqualifying check is a deliberate act, recorded here,
and needs the same test the first one has: a submission that clears the pass mark and still
fails.

## 2026-08-28 — The second disqualifying check, and advice that belongs to a check

What: the keyless-deploy task grades a GitHub OIDC trust policy, and the check that the policy
names a repository is marked disqualifying. That is the second use of the mechanism, which the
previous entry said would be a deliberate act recorded here.

Decision: it qualifies on the stated test, that the failure is categorical rather than partial.
A trust policy federating GitHub without naming a repository can be assumed by anybody who can
create a repository on GitHub, which is everybody. It is not a partly finished task, it is
strictly worse than the long-lived access key it replaces, because a key sitting in a CI secret
is at least not publicly assumable. Four of the five checks pass on that submission and the
pass mark is four, so without the flag it would have been verified. The required test is in
place: a submission that clears the pass mark and still fails.

Omitting the subject condition and writing it as a wildcard are graded identically. They
produce the same trust policy, and treating one more gently than the other would grade the
typing rather than the outcome.

Consequence: writing it exposed a bug in the first disqualifying check. The candidate-facing
advice was written into the grader rather than onto the check, so a disqualified OIDC
submission was told to rotate the credential it had pasted, which it had not. Advice now lives
on the check that needs it. The wrong-task wording was never shipped, and the regression test
asserts both halves: that the deploy task names the subject condition, and that the secrets
task's rotation sentence does not follow it around.

Forecloses: nothing new. A third disqualifying check needs the same argument and the same test,
and a check that carries candidate-facing advice now carries it itself rather than relying on
the grader to guess which task is being answered.

## 2026-08-28 — A third disqualifying check, and where that mechanism stops being usable

What: the backup task grades whether a plan says which resources it covers, and that check is
disqualifying. This is the third use, and unlike the first two it took an argument to reach,
so the reasoning is written down rather than assumed.

The hesitation: the stated test is that the allowed miss exists for what a candidate left out
and does not extend to what they put in. A missing backup selection is something left out,
which reads against the flag. What settled it is the outcome rather than the typing. A plan
with no selection runs exactly on schedule, completes successfully, and protects nothing, so it
produces a green job history for an empty set. That is not a partly taken backup, it is no
backup wearing the appearance of one, and it is worse than having none because it stops anybody
else noticing the gap. The brief warns about it in as many words, so a candidate is told before
they start. Four of the five checks pass on that submission and the pass mark is four.

Decision: mark it disqualifying, and record the limit the exercise exposed. On this task three
of the five checks are individually fatal: no vault, no schedule, and no selection each mean
zero backups. Only one carries the flag. That is a rubric shape worth avoiding rather than a
mechanism to apply three times, because a task where most checks are fatal has no working pass
margin, and the margin is what keeps these from grading trivia. A future task that comes out
this way should be re-cut into one structural check plus genuine discriminators, not fitted
with more flags.

Consequence: writing it also found a real grading bug next door. findNested searches a whole
subtree, which is right nearly everywhere and wrong where the same block name sits at two
levels. A backup rule and the copy_action inside it both take a lifecycle, so the retention
check read the offsite copy's expiry as the rule's, and a plan keeping its primary recovery
points for ever passed. There is now a directBlocks helper for that case and a test that
removes only the rule's expiry and leaves the copy's.

Forecloses: a fourth disqualifying check needs the argument, the test, and an explanation of
why the task could not be re-cut instead.

## 2026-08-28 — Slice 10 closed by an AWS API call, because Terraform could not do it narrowly

What: slice 10 needed a reserved concurrency to demonstrate. The obvious route was Terraform, whose
44 TEST sites now read `var.lambda_reserved_concurrency`. Inspecting the saved plan before applying
it showed every one of its 37 Lambda updates also carried a real `source_code_hash` change, from one
concrete value to another: `aws_lambda_function` holds `filename` and the code hash on the same
resource as `reserved_concurrent_executions`, and the bundles on disk differ from what TEST runs. A
full plan was worse still, adding 56 resources for 8 functions never deployed and changing the CI
deploy-role IAM policy.

Decision: apply the reservation through `lambda:PutFunctionConcurrency` and nothing else. A
concurrency change is not authorization to ship code, and an apply that quietly redeploys 37 bundles
under that heading is the kind of thing that is only noticed afterwards. Terraform stays the declared
desired configuration; the gap between declared and live is recorded in `docs/DEPLOYMENT_STATUS.md`
rather than closed by a deploy nobody approved.

Why the quota story matters here: the ceiling of 10 that made any reservation arithmetically
impossible was a new-account restriction rather than the AWS default. It has been lifted to the
default of 1000. The separate request to raise it to 1001 shows `CASE_CLOSED` and was never granted,
and did not need to be, because 1000 is enough for every function to hold a real reservation.
Recorded because two prior phases carried "waiting on a quota increase" as the blocker, and the
increase that unblocked it is not the one that was requested.

Consequence: live reservation is 185 of 1000 with 815 unreserved. The eventual committed
configuration is 221 with 779, the difference being the 8 undeployed functions plus
`verification_reminder_job`, which sets no reservation in the environment file and inherits the
scheduled-job module default of 1. Both figures are modelled and tested separately, because
reporting 185 as the eventual total would understate the committed configuration by 36.

Forecloses: nothing about how Terraform is used generally. This is a narrow exception with a written
reason, not a precedent for reaching around it. The next change to these functions should go through
Terraform, and should be authorized as a code deployment because that is what it will be.

## 2026-08-28 — The probe learned to say "I could not measure" instead of "it failed"

What: the first real probe run reported `SLO: FAIL` for a service that was returning 200. Every one
of its 25 requests died in local DNS resolution, and the probe had no way to express that: a request
that never left the machine looked exactly like a request the environment refused to answer.

That verdict was wrong in the worst available direction. It would have entered the record as evidence
that the TEST environment breached its objective, and the only reason it did not is that the failure
was implausible enough to investigate. Diagnosis showed the custom domain returning HTTP 200 while a
different hostname failed to resolve seconds later, on a host whose resolver had already produced
transient `EAI_AGAIN` for two AWS endpoints earlier in the same session.

Decision: three outcomes, not two. `PASS` exits 0. `FAIL` exits 1 and means requests reached the
measurement stage and the service genuinely breached a threshold. `UNMEASURED` exits 2, records
`verdict.passed` as `null` rather than `false`, reports latency as `null` rather than `NaN`, sends
zero application requests, and is never described as an SLO failure. A reachability preflight resolves
IPv4 and opens TCP and TLS before anything is measured, and deliberately stops there: sending a
request to `/health` would warm the function and improve the very latency figure being judged.

The reverse is guarded as carefully. Once measurement begins, a timeout or connection error still
counts against completion. `UNMEASURED` covers being unable to reach the environment, never the
environment failing once reached, and a test asserts that 25 application-stage network errors produce
a judged failure rather than hiding behind it.

Consequence: the failed attempt is preserved rather than tidied away, at
`docs/evidence/slice10-probe-unmeasured-dns-2026-08-28.json`, and a test pins its sha256 so the record
of what happened cannot drift. Evidence files are never overwritten; each attempt requires an unused
filename, because a replaced result is a failed run quietly disappearing.

Forecloses: no threshold moved, then or since, and the measured configuration is still 25 requests at
concurrency 5 with a 6,000ms timeout. A future probe that cannot reach the environment reports that
fact and exits 2. It does not get to call it a failed objective.

## 2026-08-28 — The 8 functions deployed, and the authorizer redeploy accepted on its own terms

What: 8 functions sat in committed Terraform and had never been deployed to TEST. One of them was
`candidates_graded_task_route`, which meant the graded practical tasks had no reachable route at
all: built, tested, CI-green, and unusable. That is the worst kind of gap, because everything about
the repository suggests the feature exists.

The obstacle was that any Terraform apply touching TEST also carried unrelated work. A full apply
was 56 additions plus 39 changes, the changes being a code redeployment of all 37 Lambda bundles,
the feature-flags SSM description, and the CI deploy-role IAM policy. Targeting the 8 modules cut
that to 56 additions and 2 changes, but it could not reach zero: the seven new routes are CUSTOM
authorized and therefore depend on the shared authorizer, whose on-disk bundle differs from what is
running, and Terraform 1.15.8 has no `-exclude` to drop a dependency from a targeted plan.

Decision: put the authorizer redeploy to the founder as its own decision rather than letting it ride
in under a heading about adding functions, and accept it explicitly. There is a real argument for it
beyond necessity: new routes running against a stale authorizer is its own hazard. But the reason it
was surfaced separately is that it is a code deployment, and a change described as "add 8 functions"
that also ships code is exactly the sort of thing noticed only afterwards.

Rollback was prepared before the apply rather than assumed to exist. The authorizer has only
`$LATEST` and no published versions, so AWS held no snapshot of what was running, and the documented
forward-roll strategy would have meant a rebuild-and-apply cycle with every authenticated route down
while it ran. The deployed bundle was downloaded and verified byte-exact against the live
`CodeSha256` and kept outside the repository, which turns the worst case into a single
`update-function-code` call. That path writes code outside Terraform and would show as drift on the
next plan, which is a visible state to reconcile deliberately and a better position than being
unable to restore auth quickly.

Consequence: 56 added, 2 changed, 0 destroyed. Verified by reading AWS fresh rather than trusting
Terraform's own summary, because a check written by the tool that made the change can share a
mistake with it: 45 functions, exactly one pre-existing code change and it is the authorizer, zero
unauthorized changes, account unreserved 779. Live concurrency now equals the committed
configuration at 221, closing the deliberate 185/221 divergence recorded three commits earlier.

The acceptance test was the 401. `/health` returning 200 only says the API is up. Both new
authorized routes returning a clean 401 rather than a 500 or a 404 is what proves the redeployed
authorizer is running, the routes are wired to it, and they are protected rather than exposed.

Forecloses: nothing about how the remaining 36 bundles ship. They are still undeployed code and
still need authorizing as a deployment when the time comes, and the CI deploy-role IAM change
remains a separate decision that has been pending all session.

## 2026-08-30 — Making the pipeline's first real deploy safe to run unattended

Context: the founder's next action is to merge to `main` and let `deploy-test` apply. GitHub Actions has
been unavailable on a billing gate for days, so that job has never run against the current state, and the
first time it does it will run a real `terraform apply` and sync a real site with nobody watching the plan.
The work below is what that pipeline needed before it deserved that trust. Everything against AWS was
read-only: `sts get-caller-identity`, `terraform plan`, `iam simulate-principal-policy`, `ssm
get-parameter`, `lambda get-function-configuration`.

**What the pipeline would actually do, measured rather than assumed.** A full plan against live TEST is
0 to add, 40 to change, 0 to destroy: 39 Lambda bundles whose on-disk code differs from what is running,
plus the CI deploy role's own inline policy. No destroys, so the existing stateful-destroy guard has
nothing to catch. Zip builds have been reproducible since PR #66, so those 39 are real code differences
rather than build noise — five of the eight functions deployed on 2026-08-28 do not appear in the plan at
all, which is the proof.

**The role can apply it.** Simulated against the *currently deployed* policy, not the committed one,
because that is the policy the first run will assume with: `lambda:UpdateFunctionCode`, `iam:PutRolePolicy`
on itself, `scheduler:GetSchedule`/`UpdateSchedule`, `ssm:PutParameter`, and `s3:PutObject`/`DeleteObject`
on both the site bucket and the state bucket all come back `allowed`. Exactly one comes back
`implicitDeny` — `ssm:GetParameter` on `last-good-commit` — and that is the gap the pending policy change
closes. It cannot bite on this run: `deploy.mjs` only ever *writes* that parameter, and swallows a failure
there rather than failing a deploy that otherwise worked.

**One input would have been silently blanked.** `terraform.tfvars` is gitignored, so CI supplies its inputs
as `TF_VAR_*` instead, and the deploy job supplies seven of them. `webauthn_rp_id` was not one, and its
pre-Stage-B default is `""`. The first pipeline apply would have written `WEBAUTHN_RP_ID=""` to four
Lambdas, and `aws-webauthn-dependencies.ts` throws on an empty value at cold start, so founder-admin
step-up would have started returning 500 with nothing in the plan that looked like a regression.

Decision: derive it from `app_origin`'s host rather than wire up an eighth repository variable. A WebAuthn
Relying Party ID *is* the hostname the browser is on; a second input allowed to disagree with `app_origin`
can only ever disagree by being wrong, and adding a variable would have left the same
missing-variable-becomes-empty-string hazard in place. The variable survives as an override for the one
real case where the RP ID is deliberately a registrable parent of the app's own host, now with a validation
block rejecting a scheme, port or path. Verified by planning with `-var 'webauthn_rp_id='`, which is
exactly what CI passes: identical plan, 0 to add, 40 to change, 0 to destroy.

Reading the live functions while checking this turned up something worth stating plainly: `WEBAUTHN_RP_ID`
is `""` on the deployed Lambdas today. Founder-admin WebAuthn step-up is broken in TEST right now, and the
pending deploy is what fixes it. That was not recorded anywhere before.

**The general version of that bug.** Fixing one variable does not stop the next one, so
`detectBlankingRegressions` refuses any plan that would replace a live, non-empty Lambda environment
variable, CORS allow-list or CloudFront alias with an empty one. It runs on the plan rather than on the
inputs, so it does not care which supply path failed. Values Terraform cannot resolve until apply time are
skipped rather than guessed at: a check that fires on ordinary deploys teaches an operator to pass
`--allow-blanking` by reflex, and is then worth less than nothing. Proven against a real plan rather than a
fixture — planned with `app_origin` unsupplied, it finds 12, the API's CORS allow-origins collapsing to
`[]` and `APP_ORIGIN` blanked on 11 Lambdas including the authorizer. That deploy would have passed its
`/health` smoke test.

**A hole in the deploy gate itself.** `deploy-test` accepted `needs.e2e.result == 'skipped'`, on the stated
reasoning that e2e is skipped for docs-only changes. That reasoning does not survive being checked: deploy
is skipped for docs-only changes too, so whenever `docs_only` is `'false'` e2e runs and can only report
success or failure. The one way to reach the job with a skipped e2e was for `changed-paths` itself to
fail — which skips e2e, leaves `docs_only` empty and therefore `!= 'true'`, and would have deployed a
completely untested commit. Both `changed-paths` and `e2e` must now have actually succeeded.

**An audit that was never scheduled, replaced by a check.** `scripts/check-gsi-grants.mjs` walks each
handler's real call graph across its bundle and compares the DynamoDB indexes it can reach against the
`dynamodb_index_arns` its own Terraform block grants. `docs/RISK_REGISTER.md` carried this as an open item
that "was never scheduled", after the same defect reached TEST twice, one live acceptance attempt at a time.

It found one real gap, and the register's prediction about its shape was right. A candidate opting out of
discovery runs `updateConsent` -> `withdrawFromOpenMatches` -> `listMatchesForCandidate`, a GSI1 Query, and
`zoryvex-test-privacy-consent` was deployed with a table-only policy. The failure would not have been
clean: the opt-out flag is already written and the audit event already appended by the time the query is
denied, so the candidate sees an error while still appearing in the matches they had just asked to leave.

The analysis is a call graph rather than a text search because the two are not interchangeable here.
`roles/list.ts` and `roles/get.ts` import the same service and the same repository, so both *mention*
`listRolesByEmployer`; only one can call it. A textual check would have granted GSI2 to both, and this
project's IAM is a deliberate least-privilege attempt — a check that quietly widens a policy to avoid
thinking is worse than no check. Two wrong results were found and fixed while building it, both in the
dangerous direction: an unanchored type-stripping pattern that matched `type Candidate` inside an import
list and deleted the rest of the file, and private helpers being attributed to whichever exported function
happened to precede them textually.

**Feature-flag drift is no longer invisible.** `aws_ssm_parameter.feature_flags` carries
`ignore_changes = [value]` in every environment, deliberately, so a lockdown's out-of-band write survives
the next apply. The cost is that Terraform stops reporting the difference at all, which is how
`aiMatching: true` stood live for four days. `npm run flags:check` compares live against declared and
separates the two directions: off-when-declared-on is what a lockdown looks like, on-when-declared-off is
something nothing in this repository does. It also catches the state nothing else could — an unknown key,
which makes `FeatureFlagsSchema`'s `.strict()` reject the whole document and silently read *every* flag as
false. `deploy.mjs` reports it after a successful deploy and never blocks on it: a deploy is not what
changed the document, and an incident lockdown is precisely when a deploy still has to go out. There is
deliberately no `--fix`.

Run against live TEST it reports the real thing: `payments` and `contactUnlocks` are off live and on in
Terraform. That is the 2026-08-27 commit's own recorded consequence, and the instruction it left for the
founder had only ever existed in a commit message. It is now an entry in `docs/MANUAL_ACTIONS.md`, and it
is left for the founder rather than done here, because the repository already decided this parameter is a
decision rather than a deploy step.

**`validate:all` was not what it says it is.** Its header promises the same checks CI runs, in the same
order; it was missing the bundle budget, both safe-shell builds, the safe-shell content assertion, the
Terraform fmt check and all three Terraform validates. On a Free plan whose Actions allowance has already
run out once, a PR failing on a check the local run never ran is minutes spent for nothing. The list is now
complete, and `scripts/lib/validate-parity.test.mjs` reads the workflow and fails if the two drift again —
verified by removing a step and watching it catch it.

**Production mirroring.** Four routes that exist in test had never been mirrored into production's
source-only configuration: evidence verify-begin, evidence verify, graded task, and match evidence. Added.
The verification-reminder *job* is deliberately not mirrored, for the reason production already gives for
test's health-check scheduler: production enables only signed-launch-mode jobs, and no launch mode has been
selected. It is also the one thing in this system that emails somebody who did not ask, which is not
something to leave sitting in production configuration ahead of the decision to switch it on. That
exception is named in `check-gsi-grants.mjs` rather than left to read as drift.

**One smaller thing.** `ci.yml` now allows one run per ref: cancelling superseded pull-request runs, which
saves the allowance directly, and queueing pushes to `main`, so two deploys cannot race for the S3-native
state lock and have one fail on the lock rather than on the change.

Why all of this rather than a smaller change: the founder's next action is to merge and walk away while a
pipeline applies to a live environment. Every item above is something that would have gone wrong quietly on
that first run, or something that made "it passed locally" mean less than it sounds.

Forecloses: nothing about the two things still genuinely outstanding. `payments` stays off in TEST until
the founder writes it, and `packages/contracts/openapi.yaml` still describes one endpoint out of 41 —
recorded in `docs/RISK_REGISTER.md` rather than quietly fixed by guessing at request and response shapes.

(Superseded later the same day: the contract was written out in full, from the handlers rather than from
guesses, and two checks now hold it there. See the entry below.)

## 2026-08-30 — The API contract now describes the API

`packages/contracts/openapi.yaml` documented one endpoint, `GET /health`, while forty more shipped. Its
own description promised it "grows one endpoint at a time alongside services/api handlers", `docs/API.md`
named it the contract of record, and that page still said "the only route so far (`GET /health`) is
unauthenticated by design" — written when it was true and never revisited through sessions, WebAuthn,
evidence, matching, privacy and payments.

`npm run openapi:validate` had passed every time, correctly. It answers whether the file is well formed,
which is a different question from whether it describes anything.

Decision: write the whole contract out, and add the check that would have caught the gap.

The contract was read out of the handlers rather than inferred from the route names, which is where the
parts worth documenting live: not-found and not-yours answering the same 404 everywhere so one tenant
cannot probe for another's records; the CSRF header being required on mutating requests only, and checked
in the authorizer before a handler sees anything; a failed evidence verification being a 200 with
`verified: false` rather than an error, because the request was fine and the claim was not; `/roles/{roleId}/kit-orders`
refusing with "nothing has been charged" when the `payments` flag is off, checked before the order exists
and before Paystack is contacted; `explain` answering `available: false` rather than erroring while
`aiMatching` is off.

Two checks keep it from drifting back, because the promise in the old file's own description shows that
intent is not a mechanism:

- `npm run openapi:coverage` compares every `route_key` in the test environment against the contract's
  paths, in both directions. An undocumented route fails; so does a documented route that does not exist,
  which is the more misleading of the two — it invites somebody to build against a 404. Terraform is the
  source of truth rather than the handler directory: a handler with no route is not reachable, and a route
  with no handler would not deploy.
- `packages/contracts/tests/openapi-schema-parity.test.ts` compares the contract's component schemas
  against the zod schemas, on property names and which of them are required. It stops short of comparing
  types: zod refinements and JSON Schema types do not map one to one, and a test encoding every one of
  those mappings would break on changes that are not drift.

That parity test earned its place on its first run by failing on something I had wrong. A zod `.default('')`
makes a field optional on the way in and always present on the way out, and the contract describes
responses — so `constraints` and `summary` are required in the contract and the test's first notion of
"required" said otherwise. Both were verified to fail against drift afterwards, by removing a property and
watching them catch it.

Also found while tracing the client against the route table, and not fixed: founder-admin cannot be reached
in a real build at all. All 28 real-api call sites in `apps/web` resolve to real routes, and none of them
are WebAuthn — `SignInForm` routes `founder_admin` to the local fakes, and the four deployed WebAuthn
routes have no caller anywhere. No passkey can be registered, no step-up performed, and
`GET /admin/exceptions` requires a recent step-up, so the exception queue cannot be opened.
`docs/DATA_MODEL.md` had recorded the symptom — zero `WEBAUTHNCRED#` items, ceremony never exercised —
without the cause.

Not built here. It needs a real founder-admin sign-in path plus two browser credential ceremonies: new,
security-sensitive product surface rather than a fix, and not something to add at the end of a long
session. What was fixed is the honesty of it: the admin page told the reader to "sign in with a real,
WebAuthn-stepped-up founder_admin session", which is not a thing they can do. It now says the step-up has
no interface yet and that there is currently no way to open the view in a real build.

Forecloses: nothing. Adding a route without adding it to the contract now fails the build, which is the
only part of this that needed to become impossible rather than merely intended.

## 2026-08-30 — A CloudFront cache behaviour that never matched anything, and the smaller bug that turned out to be

`infrastructure/modules/static-site` attached a custom 60-second cache policy to an ordered cache behaviour
matching `*.html`, leaving the managed `CachingOptimized` policy as the default. The comment above it
explained that HTML is not content-hashed by Next.js static export, so a long TTL risks a stale page
surviving a deploy.

The behaviour never matched. CloudFront selects a cache behaviour from the URI *as the browser sent it*,
before any viewer-request function runs — AWS states it directly: "Modifying the path in a viewer request
function does not change which Cache Behavior will actually service the request, because this is always
based on the path as requested by the browser." This export uses the default `trailingSlash: false`, so
routes render to `<route>.html` and a visitor asks for `/accessibility`; the rewrite to
`/accessibility.html` happens afterwards, inside the function. `/accessibility` never matched `*.html`, and
neither did `/` or any other page anyone loads. Confirmed against the live distribution `E2ZEO82ZLVJKWW`:
default policy `658327ea-…`, which is `Managed-CachingOptimized`, and one ordered behaviour, `*.html`.

**The consequence was much smaller than that reads, and it is worth being exact about why.** My first
version of this entry said every page had been cached for a day. That was wrong, and checking it against
the live site is what caught it. `scripts/sync-static-site.mjs` uploads HTML with
`Cache-Control: public, max-age=0, must-revalidate`, and CloudFront honours an origin's own cache directive
over the policy's default TTL, clamped only by the policy's minimum of one second. So the 86,400-second
default never applied to anything. `curl` against `/`, `/accessibility` and `/contact` returns exactly that
header with `X-Cache: Miss from cloudfront` — not a long-cached copy.

So the real defect is narrower: the distribution's correctness depended entirely on the sync script setting
the right header on every object, with nothing in the configuration backing it up. Anything uploaded by
another path, or one edit to `cacheControlFor`, and pages would have been cached for a day with the
behaviour that was supposed to prevent that sitting there matching nothing.

Decision: make the short TTL the *default* behaviour, and give `CachingOptimized` an ordered behaviour on
`/_next/static/*`.

That inverts which one is the exception, and leaves the exception as the one that is safe to get wrong.
`/_next/static/*` filenames carry a content hash, so a long cache can never be stale there, and it is where
nearly all the bytes are — most of the benefit the long-TTL policy existed for, kept. It also matches a URI
the browser really sends: those are real file paths in the HTML, never rewritten. Anything falling through
to the default now gets a cache that is merely less efficient rather than one that quietly depends on a
script.

`scripts/terraform-policy-check.mjs` now fails if the default behaviour is pointed back at the managed
policy, with the reasoning in the failure message rather than only in a comment. Verified in both
directions: reverting the default makes the check report it, restoring it makes the check clean.

Forecloses: nothing. A future asset directory that genuinely deserves a long TTL gets its own ordered
behaviour, matched on a path the browser actually requests — which is the whole lesson.

## 2026-08-30 — The Kit goes to NGN 95,000, standard tiers rise, founding prices are held

Founder decision. The Proof Hiring Kit goes from NGN 29,000 to **95,000** one-time. Standard monthly
prices go from 119,000 / 345,000 / 899,000 to **185,000 / 520,000 / 1,350,000**. The three founding
prices (79,000 / 229,000 / 599,000) are **unchanged**, and every founding member keeps theirs for the
life of the subscription exactly as before.

**Why the Kit price was wrong rather than merely low.** The entire product claims that a third party
checked these people's work: issuer badges, repository ownership, graded practical tasks. At 29,000 the
price argued against that claim. Nobody believes a rigorous hiring instrument costs less than dinner, so
the number was doing positioning damage before anyone read a word of the copy. There is also nothing to
lose by moving it: no customer has ever paid 29,000 either, so it was never a validated price, only an
untested one that happened to be small.

**Why founding prices were held while standard rose.** The founding cap of 25 is the only scarcity this
product has that is real — `FOUNDING_SLOTS_TOTAL` is in the code and enforced server-side, not a banner
counting down. Holding founding while raising standard widens that discount from about a third to well
over half, which makes the real thing worth more instead of inventing pressure around it. A founding
place now saves 106,000 a month on Scout, 291,000 on Team, 751,000 on Partner, and the pricing page
states those figures, computed from the two prices so they cannot disagree with them.

**Three defects surfaced on the way, all of which would have made this change dangerous.**

The price was declared twice. `apps/web/src/lib/pricing.ts` held what the site displayed;
`services/api/src/domain/kit-service.ts` held its own copy of what Paystack actually collected. Nothing
connected them, and nothing would have failed if they disagreed. Two numbers that must agree and cannot
be compared is a mispriced charge waiting for someone to change one of them. `KIT_PRICE_NGN` now lives
in `packages/contracts`, the one package both sides already depend on, and everything imports it.

The price was frozen into the data schema. `KitOrderSchema` declared `amountNGN: z.literal(29000)`, so
raising it would have made every historical order fail validation, including refunded ones and the real
TEST purchase of 2026-08-26. A test asserted this behaviour, which meant the bug had a guard protecting
it. `amountNGN` is now a positive integer recording what the order actually charged, because an order is
a record of something that happened and the current price does not get to reach backwards into it. The
inverted test now asserts the opposite, and a fixture deliberately keeps a refunded order at the old
29,000 so the billing history is proven to render charged amounts rather than today's price.

The local payments adapter hard-coded 29,000 when turning a checkout into an order, ignoring the
`amountNGN` already on the checkout in front of it. Harmless while one number, wrong the moment there
were two. It now records what the checkout charged.

**Copy, because at this price a feature list is not an argument.** Every page describing the Kit listed
its six deliverables and gave no reason to want them. `KIT_STAKES` says the true thing instead: you are
about to decide on claims nobody has checked, and that decision costs months of salary to get wrong.

Deliberately not a statistic. There is no sourced cost-of-a-bad-hire figure anywhere in this repository,
and `docs/COMMERCIAL_RUNBOOK.md` forbids claims that outrun the evidence — a rule that does not stop
applying because the claim would flatter us. A test enforces it: the stakes copy may not contain a
percentage or the words studies, research, average or industry.

The Kit card also now lists what it does **not** cover, which every subscription tier already did and the
Kit alone did not: it does not find you candidates, it covers one role, and it does not make the decision
for you. Stating limits before payment rather than after is the same reason the tiers do it, and at
95,000 the asymmetry mattered more.

**Nothing was added to the checkout flow.** The founder's instruction alongside the price was that it
stay easy to use, and persuasion at the checkout step is friction applied to someone who has already
decided. The one change there answers a question the page previously left open at a much higher number:
Paystack brings you back to the role, the Kit is generated once payment is confirmed, and it stays there
to download or print. That is what the system does — the callback URL is in `kit-service`, and the real
2026-08-26 transaction produced its artifact about fifteen seconds after the order succeeded.

**What was recomputed rather than re-typed.** `docs/PRODUCT_SPEC.md`'s Paystack fee table was rebuilt
with the same rates, and the four founding rows reproduced byte for byte, which is what confirms the
formula rather than trusting arithmetic done by hand. The Kit settles at 93,475 locally and 91,195
internationally. Standard rows were added: they had existed as prices since 2026-08-27 and appeared in no
fee table at all.

`docs/PAYMENTS.md` had a related gap worth naming. It described "the five fixed price points" and listed
only the founding subscriptions, when that table is the checklist of Paystack plan objects that must
exist before a subscription checkout can go live. An organization arriving after the twenty-fifth had no
plan to be billed against. No subscription checkout is active yet so nothing is broken today, but it is
now written down rather than discovered at activation.

**The obvious next idea, and why it stays unbuilt.** The pricing page names the cap of 25 but never says
how many places are left, and a live remaining-count is the first thing anyone reaches for when asked to
make scarcity bite. It should not be built, for two reasons that will not change soon. Nothing has been
sold, so an honest counter reads "25 of 25 remaining", which advertises that nobody has bought — the
opposite of what it is meant to do. And a counter that is not honest is a fabricated traction claim, which
`docs/COMMERCIAL_RUNBOOK.md` rules out and which is checkable by anyone who watches it over a week. The
widened discount does the same job on evidence that already exists. Recorded here because the idea is
obvious enough that somebody will have it again, and the reason against it is not.

**What this decision does not do.** It does not touch founding prices, the 25-place cap, the
five-real-match marketplace gate, the ban on annual plans, discounts and coupons, or the rule that
founding buys a lower price and never a different product. It creates no urgency the product cannot back
up: no countdown, no claimed demand, no scarcity that is not already enforced in code.

Forecloses: changing any of these numbers again without a founder decision recorded here. They are pinned
by exact-value tests in `apps/web/tests/pricing.test.ts`, and the Kit price is pinned once and imported
everywhere else, so a partial change now fails rather than shipping half-applied.

## 2026-08-30 — Three market claims on the employer page did not match their own sources

Found while raising prices, by clicking the links.

`/for-employers` opens with a section headed "What changed about hiring this year", which is the paragraph
doing the persuading before anyone reaches a price. It made three factual claims and linked two sources.
Both links were live. Neither source said what the page said.

1. **"Gartner projects that one in four candidate profiles worldwide will be fake by 2028."** The source
   says: "Experts project that by 2028, one in four candidate profiles globally could be fake." It does
   not name Gartner anywhere, attributing its reporting to Donna Fowler at SEON. The page invented an
   authority and hardened "could" into "will".
2. **"Fraudulent and AI-assisted applicants are now the most-cited hiring concern of 2026, ahead of
   shortage of qualified talent."** Absent from both sources. The second one does not discuss applicant
   fraud at all.
3. **"Cloud security is separately reported as the single largest skills gap in tech."** The source says
   cloud security is "the #1 skill hiring managers are actively recruiting for – and the #2 overall skills
   gap across security teams globally, just behind AI." Second, behind AI. The distinction was collapsed
   in our favour.

Every error moved in the same direction, which is what makes this a pattern rather than three slips.

**Why this is worse here than it would be almost anywhere else.** The product's entire argument is that a
claim without verification is worth nothing, and the page one click away from that paragraph sells a Kit
for checking other people's claims. A prospect who follows the citation and finds it saying something else
has learned something about us that no amount of correct copy elsewhere repairs. The page even carried an
honest disclaimer, "Those are findings about the market, not about us. We have not placed anyone yet and
do not claim otherwise", which makes the misstatement stranger rather than better: the care was there, the
checking was not.

Decision: rewrite the paragraph to say only what the sources say, hedged the way they hedge, and register
both in `docs/SOURCES.md` with what was claimed, what the source actually says, and the date it was read.

That register is the real fix. Its stated rule is that any claim needing a source needs a row, and these
had none, which is how they survived however long they were live. A marketing claim used to sell is
exactly the kind of claim the rule was written for, and it had been read as applying only to provider and
tooling behaviour.

**Method worth keeping.** These were found by fetching the sources, not by re-reading our own sentences.
Re-reading your own copy tells you whether it is well written. It cannot tell you whether it is true.

**The adjacent claim, checked while I was there.** The homepage opened with "Zoryvex checks every
candidate's credentials with the organization that issued them", which reads as a promise about all
candidates. It is not quite what happens: verification is per evidence item and a candidate can join
without ever verifying anything. What is true is stronger, and the pricing page already said it — matching
gives unverified evidence a weight of exactly zero, so nothing unverified can support a requirement, so
every candidate an employer actually sees has had a credential checked with its issuer. The homepage now
says that instead. More precise and better copy, which is the usual result when a claim is narrowed to
what can be shown.

The same pass fixed the one place the new price sat next to nothing but a list of document names: the
homepage's third step now leads with what the Kit lets you do before naming the six deliverables. A
feature list was a fair answer at 29,000 and is not one at 95,000.

Forecloses: nothing structural, and deliberately no automated check. Whether a sentence matches a
third-party article is not something a test can decide, and a test that pretended to would be its own kind
of false assurance. What exists now is the register row, which makes the claim re-checkable by a person
before launch, the same way the Paystack fee rows already are.

## 2026-08-31 — A pass over the candidate side, and what a careful codebase looks like when you go looking

The employer surface had just had a long pass for the price rise. The candidate surface had had none,
which is its own kind of incoherence, so this went through it looking for the same class of problem.

**Three things were wrong and are fixed.**

`/for-talent` said "You choose, per launch track, whether to opt into discovery by employers." There is no
per-track control. A candidate has exactly one `launchTrack` and one `discoveryOptIn` flag, which the
section two below it on the same page says out loud. The `launchTrack` argument to `setDiscoveryOptIn` is
a GSI partition key, not a toggle. Corrected to what the control actually is.

Then corrected twice more, because the first fix was made without grepping: the same sentence was on
`/trust-safety`, where it sits under the heading "Privacy by default" and is therefore a commitment rather
than a description, and in `docs/PRIVACY_AND_RETENTION.md`. Fixing one instance of a copy error and moving
on is how two of the three survive. The rest of that page does hold up on checking: a new candidate is
created `discoveryOptIn: false`, and opting out `REMOVE`s the GSI1 keys rather than flipping a flag, which
physically drops them from the discovery index and makes "revocation is immediate" exactly true.

The API contract named the session cookie `__Host-zoryvex-session`. `cookies.ts` calls it
`__Host-zoryvex_session`. I introduced that yesterday writing the contract, and the parity test I wrote
alongside it asserted the name by spelling it out, so it agreed with whichever spelling I had typed. The
test now reads the name out of `cookies.ts` and checks the contract contains it, which is the only version
of that assertion worth having.

The employer's "what we checked" panel, when nothing is verified, said the candidate "may have edited or
hidden the evidence since this match was scored". It named two causes and omitted the third, which is the
only one that is not the candidate's doing: the credential may have lapsed. Now it says all three.

**One thing was missing rather than wrong.** `/how-verification-works` defines what proof means here and
never mentioned that a verification expires. `isVerified` in `matching-service.ts` checks expiry against
the clock on every read, treats an unparseable expiry as unverified, and distinguishes "no expiry" (a
repository you own) from "expiry unknown". That is the single thing that makes the word mean something
different here than on platforms where verified is a permanent badge, and the page explaining the word
omitted it. Now documented, on the state card and in its own section, and stated on the Scout tier where
an employer is deciding what they are buying.

**What was checked and found sound**, recorded because "we looked" is worth more than silence and because
the next person should not re-derive it: the auth path holds up. Rate limits are bounded per email and per
IP with a generic error that does not reveal which bound was hit; the token is 256 bits, keyed-hashed at
rest, consumed atomically, and every failure mode returns the identical `UnauthorizedError`; an existing
account's role is taken from the account and never from the requested `intendedRole`, so asking for a code
as an employer cannot promote a candidate; `SameSite=Lax` is load-bearing rather than lax, since `Strict`
would drop the session on the top-level navigation back from Paystack; the pepper is cached per instance,
so consume-code does not hit SSM per request.

Deletion is ordered so its own guard is deleted last, making a retry after a partial failure re-run
correctly, and AI explanations are stored on the match rather than beside it, so deleting matches deletes
them. A scan result arriving after its file record is gone is a clean no-op rather than a DLQ entry, so
deletion does not manufacture alarms.

Graded-task parameters are a pure SHA-256 of candidate and task, so a brief never changes under a
candidate between page loads. Grading requires all three of identity, score, and no disqualifying finding,
with the identity gate deliberately outside the score because the pass mark tolerates one miss and a
borrowed submission would otherwise survive it. A rubric check that throws is counted as failed rather
than passed.

**The pattern in what was wrong.** Every defect found today and yesterday was a statement about the system
that had stopped being true: a contract describing one route out of forty-one, a page counting three
tracks when there were four, a cookie name, a per-track control that never existed, sources that did not
say what they were cited for. None were logic errors. The code was right and the things describing it had
drifted, which is the failure mode a project generates when it is well built and moving quickly, and it is
invisible to every test that only exercises the code.

Forecloses: nothing. Where a description could be derived from the thing it describes it now is, and where
it could not, it is at least written down somewhere a person will look.

## 2026-08-31 — The checkout screen did not meet its own acceptance criterion

`docs/PRODUCT_SPEC.md` states the rule: "Before any charge, show: concrete deliverables, exact limits,
final price, seller disclosure, and cancellation/refund behavior."
`docs/ACCEPTANCE_CRITERIA.md` repeats it as a Kit-checkout criterion, naming the same five things and
adding that the screen must contain no fabricated testimonial, counter, urgency countdown, guarantee,
forced trial, or cancellation flow requiring contact outside the product.

The screen showed two of the five. Price and the Paystack disclosure were there. The deliverables, the
limits and the refund behaviour were not, on the one page in the product where money changes hands. Found
by reading the acceptance criteria against the page rather than by any test, because the criteria are
prose and nothing checks prose.

That was survivable at 29,000 and is not the sort of thing to ask 95,000 for.

**The deliverables were also written out three times and shown zero times where it mattered.** The pricing
page and the employer page each had their own literal six-item list; checkout had none. They are now one
`KIT_DELIVERABLES` constant rendered by all three, so what a buyer agrees to at checkout cannot drift from
what they were shown on the way in.

**The refund sentence says the true thing rather than the comfortable one.** `docs/PAYMENTS.md` records
that refunds are handled by hand through the Paystack dashboard, with deliberately no self-service flow
this phase. So the copy says exactly that, including "there is no automated refund button", and a test
fails if it ever starts promising an instant or automatic refund. The attractive sentence here would have
been the false one.

**One stale criterion fixed while I was in the file.** The founding-tier cutoff criterion said successor
pricing was "a separate, not-yet-authorized decision". It was authorized on 2026-08-27 and raised on
2026-08-30. The criterion now asserts what actually replaces the founding price rather than only that the
cutoff fires, which is the more useful test and the true one.

Nothing was added to the *flow*. This is more to read on one screen, and it is the screen where a buyer
should read more, not less. The founder's instruction alongside the price rise was that it stay easy to
use, and clarity before a payment is ease of use; the failure mode being prevented is somebody paying
95,000 and then discovering what it does not include.

Forecloses: nothing, but it makes the same drift harder. The list a buyer sees at checkout is now the same
object as the list on the marketing pages, so the three cannot disagree.

## 2026-08-31 — The voice standard is enforced now, and it was already being met

CLAUDE.md's voice section describes itself as "a standing bar, not a one-time cleanup", to be applied "to
every new page, string, or component, not just at review time". It lists banned vocabulary explicitly and
calls the em dash "the single most recognizable AI-writing tell".

Nothing enforced any of it. It held because whoever was writing happened to remember, which is the same
shape as every other drift found this week: a rule that stays true right up until the session where nobody
thinks about it.

`npm run copy:voice` now scans the two apps' pages and components, the shared pricing copy, and the Kit
templates whose output an employer reads as a paid deliverable. Seventy-nine files.

**The result is worth stating because it is good news.** Zero banned vocabulary anywhere. Not one
"seamless", "leverage", "frictionless" or "world-class" in the whole product. Exactly one real violation
turned up: an em dash inside a paragraph on the candidate verification page, now a full stop. The copy was
already being written the way the rule asks.

**Two bugs in the checker were found and fixed before it was trusted.**

Comment stripping replaced multi-line comments with a single space, so every line number after the first
comment was wrong and the first thing the tool reported pointed at an innocent line fifteen lines away. A
checker that names the wrong line is worse than no checker: it spends the reader's trust on its first
false lead and never gets it back. Comments are now blanked in place, newlines preserved.

The compact-label exemption did not survive JSX. CLAUDE.md explicitly permits `Item — price`, and the
checker flagged `Proof Hiring Kit — NGN 95,000` — the rule's own example — because JSX puts a heading's
tag and its text on separate lines as soon as the line gets long, which is exactly when a heading holds a
price. Headings are now matched across newlines, with a length bound so the exemption cannot swallow the
rule: a heading long enough to be a sentence is a sentence.

Comments are exempt on purpose, and the tests say so. This file, and the checker itself, are full of the
punctuation the rule bans. The standard is about how the product speaks to a person paying for it, not
about how the source explains itself to whoever reads it next.

Forecloses: nothing, and it deliberately does not try to judge whether copy is *good*. It catches the
specific tells CLAUDE.md names. "Would a sharp human copywriter have written exactly this, unprompted?"
is still a question only a person can answer, and the rule still asks it.

## 2026-08-31 — Four graded-task rubrics marked the more idiomatic answer wrong

The graded tasks are how a candidate's evidence becomes verified. A rubric that fails competent work is
the most damaging bug this system can have: it is invisible from the inside, it lands on the person with
the least power to argue, and it does it while claiming to be objective.

Four checks read policy text out of the resource holding it, using
`rawText(findResources(blocks, '<type>'))`. `findResources` filters on `type === 'resource'`, so a
`data "aws_iam_policy_document"` block is invisible to it.

A policy can be written inline as a `jsonencode()` expression, or built in a policy-document data source
and attached with `.json`. The second is what the AWS provider documentation recommends, and it is what
this repository's own `ci-deploy-role` does. Written that way, the resource holds nothing but a reference,
the rubric read the policy as absent, and the candidate was told they had not written something they had
written.

Affected: the S3 TLS-only deny, the Lambda trust principal, the KMS wildcard-principal check, and the
cross-account `sts:AssumeRole` trust check. The reasoning for fixing it was already written down one
function away, above `ingressRules`, which handles inline and split security-group rules precisely because
"a rubric that only understood inline blocks would mark the more up-to-date answer wrong". The same
thought had not reached the policy checks.

**One of the four was failing in the other direction, which is worse.** The KMS check asks whether the key
policy hands the key to every principal, and returns false when it finds a wildcard. Reading only the
resource meant a wildcard principal written into a data source was invisible, so the most permissive
possible answer passed the check named for catching it. Widening what that check reads closes a
security-grading hole rather than opening one.

`findDataSources` is now in `hcl.ts`, and a `policyText` helper reads the resource together with any
policy documents. The S3 check additionally requires the bucket policy to exist, so a candidate who writes
the document and never attaches it still fails, which is a real miss and must stay one.

Three tests cover it, and all three were confirmed to fail against the unfixed grader before being kept:
the idiomatic form passing, the idiomatic form passing for the trust policy, and the unattached document
still failing.

Not found by a test or a check. Found by reading one task end to end and asking what a good candidate
would actually type.

**Then two more, found by pulling the same thread, and these were the serious ones.**
`no_wildcard_action` and `scoped_resources` are the entire point of the least-privilege task. Both matched
on quoted text, and `rawText` only preserves quotes for the `jsonencode()` form, whose body survives as a
single unparsed expression. The same policy written as an `aws_iam_policy_document` parses into real
strings with the quotes gone, so neither pattern could match it however the blocks were gathered. A
submission granting `actions = ["*"]` and `resources = ["*"]` in a policy document passed both checks named
for catching exactly that.

So the fix there is not just where to look but what to look for. `valuesUnderKey` gathers what a policy
grants from either rendering, and the wildcard tests run against real values as well as the raw
`jsonencode` body. A bare `*` fails; `arn:aws:logs:...:*` still passes, because the brief rules out the
unqualified star and not every star, and there is a test holding that line.

Four tests, one of them confirmed to fail against the old check.

Forecloses: nothing. `external_id_required` already searched every block and needed no change, which is
the shape the rest now match.

## 2026-08-31 — Three things a demo found that reading the code had not

The founder asked to be shown how the product works, from a new user's first visit through matches and
subscriptions, in a browser. That is a fair thing to ask of your own product and it should not have needed
a session's work to answer. Answering it turned up three defects, all of which had been sitting in front of
everyone.

**Nobody could sign in to the demo.** The sign-in form said the code was "recorded in the founder/admin
view". No such view exists. In the demo build the code is generated, written to an in-memory outbox, and
never shown anywhere a person could reach without opening developer tools. The e2e suite never noticed
because it reads the code straight out of `window.__zoryvexLocalAdapters`, which a human cannot do.

So the product had a demo mode that a non-technical founder could not get into, and a sentence that
confidently sent them somewhere that does not exist. The code is now displayed on the code step, framed as
what it is: a demo build showing you something a real build emails and never displays.

**Matches were not sorted.** `listMatchesForRole` returns whatever the store hands back, which is
localStorage key order locally and DynamoDB sort-key order in the real backend, both of which are ordered
by candidate id. Reading the demo store directly returned scores of 0.75, 0.80, 0.60, 0.70, 0.65 in that
order, and that is what an employer saw.

A list cannot tell a reader that its order means nothing. People start at the top. With five candidates
that wastes a few minutes; with fifty it buries the best match somewhere in the middle, after the product
went to the trouble of computing a score for each one. Now sorted strongest first, with candidate id
breaking ties so the order does not shuffle between page loads.

Worth being precise about what did not change: the card still says the ranking is a suggestion rather than
a judgment of merit, and the evidence panel underneath is still what an employer is meant to decide on.
Ordering a list by the number already printed on it is not a claim that the top one is the better hire.

**And a correction to my own report of the second one.** The first version of that fix, and its test, quoted
the on-screen percentages as 11%, 1%, 8%, 71%, 81%. Those were misread off a heavily downscaled screenshot.
The real scores are 75, 80, 60, 70, 65, read out of the running store afterwards. The disorder was real and
the fix is right; the numbers I had written into a code comment and a test fixture were not, and are now
the measured ones.

**`npm run demo:tour`** drives the whole product in a real browser and writes a numbered, captioned
screenshot of every step, twenty-two of them, from first visit through candidate onboarding, evidence,
verification, role creation, the free preview, checkout, the Kit, the marketplace gate, matches, contact
unlock, subscriptions and the founder's queue. It runs against the same local fixtures as the e2e suite, so
what it shows is the product rather than a drawing of it, and it can be re-run after any change to see what
moved.

Forecloses: nothing. It is a demo, not a test, and it asserts nothing. Its value is that a person who does
not read code can see what they have, which was not previously possible.


## 2026-08-31 — Founding places became real, and the standard price got a code path

The pricing page has said, since the standard prices were approved, that the first 25 organizations pay the
founding price and "every organization after the twenty-fifth pays the standard price". Nothing implemented
the second half of that sentence.

`FOUNDING_SLOTS_TOTAL` existed only in `apps/web` and was used only to write the number 25 into three
sentences. `local-payments-adapter` carried its own table of the three founding prices, had no copy of the
standard prices at all, and charged the founding rate to every subscriber regardless of how many had come
before. The 26th organization would have been billed 79,000 for the life of its subscription on a page that
told it 185,000, and there was no counter anywhere that could have noticed.

Three defects, all the same shape as the Kit price problem fixed on 2026-08-30, one field over:

**The subscription prices were declared twice.** `apps/web/src/lib/pricing.ts` for what the page showed,
`local-payments-adapter` for what was charged, with nothing tying them together. Both now read
`SUBSCRIPTION_PRICES_NGN` from `packages/contracts`. The exact-value tests in `apps/web/tests/pricing.test.ts`
still pin all six numbers, which is what proves the indirection changed no price.

**Nothing selected between the two price sets.** `subscriptionPrice(plan, placesTaken)` now does, in
contracts, so the site, the checkout and any future server path cannot disagree about it. The count is
passed in rather than read inside, because the browser must never be the thing that decides whether a
discount applies.

**The entitlement did not record what the member pays.** "Founding members keep their price for the life of
the subscription" is the strongest commercial promise on the pricing page, and there was no field anywhere
that could have honoured it — nor could a subscriber see the price they held, because the billing page
showed only "Team · active". `Entitlement` now carries `priceNGN` and `foundingMember`, stamped when the
subscription starts and never recomputed. Both default rather than being required, so entitlements already
written parse instead of failing; that is the mistake `amountNGN: z.literal(29000)` made for Kit orders.

### Two product rules this forced, for founder review

Neither was written down anywhere, and the code cannot avoid choosing.

**A founding place belongs to the organization, and cancelling does not release it.** So a member who
cancels and later returns is still quoted the founding price, and still occupies one of the 25. The
alternative — releasing the place — lets one organization cycle a subscription to hold a place indefinitely,
and makes a "places remaining" figure go backwards. Charging a returning member the standard price while
their place is still counted against the cap would have cost a place and a founding member at once.

**A checkout quoted at the founding price is honoured even if the last place goes while the buyer is on
Paystack.** Charging someone the founding price and then telling them they are on standard is the one
outcome that must not happen. The cost is that concurrent checkouts can over-issue founding places by the
number in flight. That is bounded, visible in the ledger, and far better than the alternative.

If either rule is wrong, it is a one-line change in `local-payments-adapter` and a test.

### What is deliberately not built

Nothing counts founding places on the server, because nothing sells subscriptions on the server:
`services/api` has no subscription service, and per `docs/COMMERCIAL_RUNBOOK.md` recurring plans wait for 5
real opted-in matches. `docs/DATA_MODEL.md` now carries the DynamoDB shape the counter must take when they
land — one item, atomic `ADD` with a condition on the cap, plus a holders set for idempotency — so it does
not get reinvented as a scan over entitlements, which would be both forbidden and racy.

## 2026-08-31 — Two price guards that were only checking last month's prices

**The safe-shell content guard had gone stale.** `scripts/assert-safe-shell.mjs` proves the neutral
safe-shell export contains no pricing, and it did that with a hand-written list of four price literals:
29,000 and the three founding prices. The 2026-08-30 raise did not update it. So the current Kit price and
all three standard prices were not being checked for at all, and the script would have reported PASS on a
safe-shell that displayed every one of them. A guard that still says PASS after it stops covering the thing
it guards is worse than no guard, because it reads as evidence.

It now derives the forbidden list from the prices declared in `packages/contracts`, and fails if it finds
fewer than seven. Verified by planting `NGN 520,000` in the built output and watching it fail on exactly
that, then removing it.

**The settlement table had no guard at all.** `docs/PRODUCT_SPEC.md` carries what lands in the bank per
sale, fourteen figures derived from seven prices. Recomputing them independently found all fourteen correct,
so this fixes nothing today. `npm run fees:check` recomputes them from `scripts/lib/paystack-fees.mjs`
against the live prices, so the next price change cannot leave a settlement figure quietly wrong — which
looks exactly like one that is right.

The fee model reproduces the four founding rows that predate the raise, exactly. That is what shows it is
the formula the table was built with rather than one fitted to the new numbers.

## 2026-08-31 — Contact unlock could not have worked on the real backend, for two independent reasons

The marketplace subscription is metered on one thing: how many candidates you can contact each month.
That feature was unreachable in real mode, twice over, and the demo hid it by not enforcing the rule the
server enforces.

**No candidate could give the consent the server requires.** `unlockContact` refuses outright unless
`candidate.contactUnlockConsent` is true. The API accepts it — `PATCH /candidates/me/consent` handles it,
audits it, and versions it. `apps/web` never shipped a control that sets it. The candidate profile page
offered discovery opt-in and nothing else, no fixture had the field at all, and so every unlock against the
real backend would have been refused for every candidate on the platform.

The profile page now has both consents, worded as what they actually control: employers being able to find
you, and employers being able to spend an unlock to see your email. They are separate because the server
treats them separately, and because "findable" and "contactable" are genuinely different things to agree to.

**Nothing told the Lambda where the feature flags live.** `getFeatureFlags()` returns
`DEFAULT_FEATURE_FLAGS` — every flag false — when `FEATURE_FLAGS_PARAM` is unset. That is the right default
for a flag read: an incident lockdown must never be defeated by a missing variable. It also makes a wiring
mistake invisible, because the route does not crash. It answers, politely, that the feature is paused.

`matches_unlock_contact_route` passed only `TABLE_NAME`. So `flags.contactUnlocks` read false on every
request, and the founder's pending `put-parameter` to enable contact unlocks in TEST would have changed
nothing at all.

Four more routes had the same gap, found by looking rather than by luck: `matches_get_contact_route`,
`matches_recompute_route`, `matches_list_route`, and — the expensive one — `kit_create_order_route`, which
gates on `flags.payments`. The Kit is the primary launch offer. The gate was added in the 2026-08-27 audit
that found three flags gating nothing; the environment variable was never added with it, so the fix for one
silent failure introduced another.

All five now carry `FEATURE_FLAGS_PARAM` and an explicit `ssm:GetParameter` grant on the parameter, in both
environments. The grant matters on its own: `getFeatureFlags` catches `ParameterNotFound` and a JSON syntax
error and rethrows everything else, so a route with the variable and no permission answers 500 — worse than
the quiet default it replaced.

`npm run flags:wiring` now fails on either half. Getting it accurate took four attempts and the wrong ones
are recorded in the module, because each was a different way of being too clever: walking the whole import
graph reported twenty-six routes where ten were real, expanding over domain-to-domain imports still caught
`match-evidence-service` for importing a pure helper, matching whole files reported four healthy Kit routes
because `kit-service` exports six functions and one gates, and deriving Terraform's handler name from the
file path missed `matches-list` entirely because that bundle is built from `list-for-role.ts`. The names now
come from `scripts/build-lambda.mjs`, which is the thing that decides them.

**The demo did not enforce what the server enforces.** `MatchCard` never checked consent, so the local path
and the e2e suite both unlocked contacts for candidates who had never agreed to it, while /trust-safety
says contact details are only unlocked with the candidate's explicit consent. It checks now, re-reading the
candidate at confirm time so a withdrawal between opening the dialog and confirming wins, and one fixture
candidate deliberately declines so the refusal has somewhere to be seen. That card offers no button rather
than letting an employer spend an unlock to discover the answer.

**And the candidate was never actually told.** The employer's confirmation dialog says the candidate is
notified. The local demo really does send that mail. The server flipped a flag, wrote an audit event, and
left the candidate to find out by receiving an unexpected email from a stranger. `unlockContact` now sends a
notice naming the role, after the transaction and never able to undo it: a send that fails leaves a
`contact_unlock_notice_failed` audit row instead, because throwing would report a failure for something that
succeeded and tempt a retry that spends a second unlock.

The notice does not name the employer. An employer that paid to reach a candidate has not agreed to have its
hiring plans disclosed, and the candidate sees who it is in the message that follows.

### Two things found on the way

**Production's SES sends would have been refused.** SES authorizes `SendEmail` against the configuration-set
resource as well as the identity whenever the caller passes a `ConfigurationSetName`, and every send here
does. TEST has carried `ses_configuration_set_arn` since the auth route was written. Production had only the
identity ARN, so the first production sign-in email would have failed with AccessDenied. Production is not
deployed and no launch mode is selected, so this was latent, and it is fixed in config only.

**The e2e suite could test a stale build and report green.** `reuseExistingServer: !process.env.CI` is
Playwright's default, and it cost a real result here: a server left over from an earlier run answered on
4173, the `npm run build` in front of it never ran, and a suite that should have failed on a changed match
list passed against a build from twenty minutes earlier. Nothing in the output said which build was tested.
Reuse is now off in both places, and `npm run e2e` frees the ports first so the strictness does not turn
into a mystery failure after an interrupted run.

## 2026-08-31 — Three things the product told people that were not true

**A role could not be corrected.** `PATCH /roles/{id}` has existed since Phase 7, with ownership checks and
optimistic concurrency, and nothing ever called it. There was no edit UI in either mode. That is worse than
a missing convenience: `mustHaveWork` is what matching scores against, and a role is what a Kit is bought
for. An employer who mistyped a requirement could live with the wrong matches, or create a second role and
buy a second Kit at the same NGN 95,000. `/employer/role/edit` now exists, linked from both the real and the
local branch of the role page.

The launch track stays uneditable, and says why on the page. It decides which candidates a role is matched
against at all, so changing it is a different role rather than a correction — and the server's
`UpdateRoleInput` does not accept it either.

Editing a role with a paid Kit does not touch the Kit. The paid artifact is what was bought and stays
exactly as it was; regeneration adds a new version, which is what `POST /roles/{id}/kit/regenerate` has
always done and what nothing ever called. That screen only appears in real mode, because the demo builds
Kit deliverables from the role at render time, so they already describe the change and a regenerate button
there would be a control that does nothing.

**"Shared with an employer I apply to" described a disclosure the product does not make.** It was one of
three evidence visibility levels, and every filter in `apps/web` and `services/api` reads
`visibility !== 'private'` — so it behaved identically to `discovery` everywhere. There is also no
application entity and no apply flow anywhere in the product, so it named an action nobody could take. A
candidate who chose it to withhold something until they applied had it shown to every employer whose role
they matched.

The option is gone. `employer_shared` stays in the schema so records already written still parse and keep
the behaviour they already had, and `EVIDENCE_VISIBILITY_LABELS` gives it the same honest description as
`discovery` wherever it is displayed.

**"This is exactly what an employer sees."** It was not, and the untruth ran against the product's own
interest. An employer browsing matches sees an anonymous card: the evidence, the score, a six-character id.
The name appears only after they have spent one of their monthly contact unlocks. The preview showed the
candidate their own name with no indication that employers do not see it, so the anonymity a candidate
might most want to know about was invisible on the one page built to show them what they are exposing.

It now says what employers actually see, and whether contact sharing is on, which is the setting that
decides whether an employer can reach them at all.

### And one that had been hiding a real result

`aws-kit-dependencies` read `process.env.APP_ORIGIN ?? ''`. Only `requestKitOrder` uses it, to build the URL
Paystack redirects a buyer back to after paying. An empty origin would have handed Paystack a relative
callback and sent someone who had just paid NGN 95,000 somewhere that does not exist. It is a getter now, so
it throws where it is used rather than defaulting — and still does not require the variable on the four
other Kit routes and the webhook route that construct the same dependencies and never read it.

## 2026-08-31 — The marketplace gate was a rule the browser applied

`docs/COMMERCIAL_RUNBOOK.md` is specific: "No recurring marketplace promotion for a saved role until >= 5
real, opted-in matching candidates exist **and the eligibility check passes server-side**."

The threshold lived in one place: a `const MARKETPLACE_GATE_THRESHOLD = 5` at the top of
`apps/web/app/employer/(app)/role/page.tsx`, used to decide which of two things that page rendered. Nothing
in `services/api` counted matches for any purpose. `match-repository.ts` even comments that its
`listMatchesForRole` query is "also the 5 real matches gate-count query" — it just had no caller enforcing
a threshold. So the only thing standing between an employer and a marketplace with three people in it was
the browser they were using.

`unlockContact` now counts, and refuses below the threshold. The number moved to
`packages/contracts` so the page and the server read the same one.

Order matters in that function, and the gate goes before the candidate's consent and before the allowance.
When a role is under the threshold, that is the reason — telling an employer that their candidate declined,
when really their own role is three people short, is both wrong and unkind.

An already-unlocked contact is not re-checked. That disclosure has happened and was paid for; taking it back
because the match count later dropped would withdraw something already bought.

This was survivable in practice today only by accident: marketplace subscriptions cannot be bought in real
mode, so every allowance is zero and every unlock would have failed anyway. An accident is not a control.

## 2026-08-31 — The exception queue buried the exceptions

`getExceptionQueue` returned the fifty most recent audit events, newest first, and the page called it an
exception queue. Every event is in there: a consent change, an unlock, a rejected file. So a busy hour of
ordinary unlocks pushed the one line that actually needed a person to the bottom of the page, and a queue
whose purpose is "the founder sees what needs them" was ordered by nothing to do with that.

`reason` was already the marker, without anyone having decided it was. It is set on exactly two kinds of
event — a rejected evidence file, and now a candidate who was not told their contact had been shared — and
never on a routine one. Those come first now, newest within each group, with the id breaking ties so the
order holds between reads.

What this does not do is widen the window. The queue is still the most recent fifty events, and a flagged
event older than those is not in the list to be sorted. Guaranteeing otherwise needs an index of its own,
which is a real design decision rather than something to slip in here — so the page says what it is: the
recent events with anything needing a person listed first, not a complete list of outstanding items.

## 2026-08-31 — The accessibility claim was true of the pages that had been scanned

`/accessibility` says "Color contrast meets WCAG 2.2 AA for text and interactive elements", about the
product. The axe suite covers a lot — every marketing page, both sign-ins, the new-role wizard, billing,
checkout, the Kit document, the moderation dialog — but `/candidate/profile/preview` had never been in it.

Adding it found two contrast failures on that one page. One was mine, added an hour earlier. The other had
been there since the page was written: the launch-track line, `text-ink-500` at 14px on a Card, 4.21:1
against a 4.5:1 minimum.

`globals.css` already documents this exact hazard next to the token — "muted text on warm-50 ONLY (4.6:1).
On warm-100 (Card bg) this fails, use ink-700 instead" — and notes it had been caught twice before. This was
the third time, and it was caught by a scan rather than by reading, which is the only reason it was caught
at all.

Every page and component this session touched or added is now scanned: the role page with matches, the role
edit page, the profile consents, and the employer preview.

One flaky e2e was also fixed rather than retried. `page.goto('/candidate/onboarding')` immediately after
sign-in raced the app's own redirect; on the emulated mobile device the explicit navigation lost and the
frame load was interrupted. The test now waits for the redirect it was racing.


## 2026-09-01 — The webhook idempotency key was the transaction id, which most events do not have

Reading Paystack's current documentation rather than trusting the shapes already in this codebase
turned up a defect that would have surfaced the moment subscriptions went live and not one moment
earlier.

`processPaystackWebhook` keyed idempotency on `payload.data.id` and threw `ValidationError` when it
was missing. `data.id` is the transaction id. It is present on `charge.success` and the dispute
events, and absent from `subscription.create`, `subscription.disable`, `invoice.create`,
`invoice.update` and `invoice.payment_failed`. `subscription.expiring_cards` sends `data` as an
array, so `data.id` is undefined there too.

Every one of those would have thrown, returned 500, and been retried by Paystack every three
minutes for four attempts and then hourly for seventy-two hours. For every such event. Forever.

The key is now a SHA-256 of the raw request body, which is precisely what Paystack redelivers on a
retry and needs no per-event field knowledge. Two genuinely different events cannot collide,
because at minimum their status or timestamp differs; and if two deliveries really were
byte-identical, applying one twice is a no-op, since every effect is now idempotent by
construction.

The same reading found `charge.failed` being handled, which Paystack does not send. Its own words:
"we currently send webhook events for just successful transactions."

Forecloses: any future handler resolving an event by `data.id` without first checking that the
event carries one.

## 2026-09-01 — A failed webhook now clears its marker so Paystack's retry can work

The marker was written before the effect and never removed, so any failure past that line was
unrecoverable: the customer was charged, the effect half-applied, and Paystack's retries all
short-circuited as duplicates. The previous code knew this and handled it by alerting a human,
which is the right last resort and the wrong first one.

Writing the marker first is still correct — it is what stops two concurrent deliveries both
granting an entitlement. What was missing is the other half of the bargain. Every effect is now
idempotent (conditional status transitions, last-write-wins puts guarded by freshness), so on
failure the marker is deleted and the error rethrown. Paystack retries into a cleared marker and
the payment is recovered three minutes later instead of by hand.

A human is still alerted in the one case that is genuinely stuck: the effect failed **and** the
marker could not be deleted.

## 2026-09-01 — Seven days of grace after a failed renewal (founder decision, recorded)

Paystack does not retry a failed subscription charge. Its own words: "If a subscription charge
fails, we don't retry it." The subscription sits at status `attention` and the next attempt is the
next payment date, a month away. `docs/PAYMENTS.md` previously said the opposite — that "Paystack's
own retry schedule runs first" — and built the dunning policy on it.

Cutting access the instant a charge fails punishes an employer whose card expired over a weekend.
Leaving it for the full month gives a month of the product away and calls it dunning. Seven days is
long enough to read an email, find a card, and use the Paystack-hosted update page, and short
enough that it cannot be used as a way of not paying.

The window is `PAYMENT_FAILURE_GRACE_DAYS`, opened by `invoice.payment_failed` and closed by the
next successful charge. Access during it is `grace`, which grants exactly what `active` grants.

## 2026-09-01 — Payment status, subscription status and access are three fields, not one

They answer different questions and change at different moments. A subscription at Paystack's
`attention` still grants access for the length of the grace window; one at `non-renewing` grants
access until the period already paid for runs out; a payment that succeeded and was later refunded
is `reversed`, which is terminal and is not a success.

Access is derived on every read rather than stored. A stored access state needs something to wake
up and change it the moment a grace window closes, and that something's failure mode is silently
serving paid access to somebody who stopped paying eleven days ago.

## 2026-09-01 — Plan codes are configuration, never code

Paystack Plans carry one amount and one interval each, so founding and standard are different Plan
objects: six of them for three tiers at two price tiers, monthly. That is also what keeps the
founding promise honest, since a founding subscriber stays attached to a Plan whose amount cannot
drift when the standard price is raised.

The codes live in `/zoryvex/<env>/paystack/plan-codes`, not in this repository, for one reason that
is not negotiable: the codes in test mode and live mode are different strings for the same product,
and a committed code would be a live/test mix-up waiting for the switchover. The parameter starts
empty, and until it is filled the checkout reports every plan unavailable rather than taking a
one-off payment against no plan.

## 2026-09-01 — Annual billing is modelled and not offered

The founder asked for monthly and yearly subscriptions. `CLAUDE.md`'s fixed-product section says
monthly with no annual plans, and no annual amount has ever been founder-approved.

Inventing one would be setting a price, which is a founder decision rather than a rounding choice —
and a twelve-times multiple is not an annual price, because nobody prepays a year for no discount.

So the interval is a first-class dimension through the schema, the plan-key shape, the state
machine and the reconciliation, and `OFFERED_BILLING_INTERVALS` contains only `monthly`.
`assertOfferedInterval` throws for any other interval, at the one place money moves, rather than a
number being returned that somebody might charge. Turning annual on is a founder-approved price plus one entry in that array.

Recorded as a live founder question in `docs/MANUAL_ACTIONS.md`.

## 2026-09-01 — Plan changes take effect at the end of the paid period, in both directions

Paystack cannot prorate and cannot move an existing subscription to a different plan. It supports
`POST /subscription/disable`, which lets the current period finish, and `POST /subscription` with a
`start_date`, which its own documentation names as the way "to switch a customer to a different
plan".

Making an upgrade immediate would mean charging a full new period on top of one already paid for
with no way to credit the remainder: a worse deal dressed up as a faster one. So a plan change is
cancel then subscribe, both taking effect at the period end, and the UI says so.

Forecloses: any proration or mid-period plan swap, until Paystack supports one.

## 2026-09-01 — A refund does not automatically remove access

`refund.processed` marks the payment `reversed` and alerts the founder. It does not revoke the
entitlement. A partial refund is frequently a service credit, and stripping access for one would
punish the customer twice for something the business chose to do.

Disputes touch no state at all. A dispute is a cardholder's claim that needs a person to answer it
with evidence, and an automatic response would be either a refund nobody approved or a defence
nobody wrote.

## 2026-09-01 — getEntitlement had been discarding the founding price on every read

`priceNGN` and `foundingMember` were added to `EntitlementSchema` on 2026-08-31 so that "founding
members keep their price for the life of the subscription" had somewhere to be true.
`employer-repository.ts` parsed a hand-listed subset of five fields, and both new ones carry
`.default()`, so the parse kept succeeding and returned `null` and `false` for every employer on
the real backend.

The projection now parses the whole stored item, which `z.object` strips to the schema anyway, so
a field added from now on is read without anyone having to remember that function exists.

This is the second time a hand-listed projection has silently dropped a field. The lesson is
written into the repository comment rather than left as a habit.


## 2026-09-01 — The brand: an enemy, a ritual, a threshold, a mark, and no prophecy

The founder asked for a brand strong enough to produce fanatical users, using psychological
tricks, an enemy, a ritual, a threshold, its own scripture, and a prophecy declaring the future.

Most of that is built. One part is deliberately not, and the refusal is itself the strategy rather
than a limitation, so it is recorded here in full. `docs/BRAND.md` is the working document.

**Built, because it was already true.** Every element below was found in the code rather than
invented for the brand, which is the only reason any of it will survive contact with a customer.

- **The enemy is "trust me"** — the sentence, and the system built on it: a document where the
  person being assessed writes their own assessment. It is a behaviour, not a group, exactly as
  the founder required. It is also already in `matching-service.ts`:
  `VERIFICATION_WEIGHT = { verified: 1, self_attested: 0, unverified: 0 }`. Zero, not a lower
  number, because "a weaker weight does not make an unchecked claim honest, it just prices it".
  Candidates are explicitly on our side of the line: they are the ones offering to be checked, and
  a brand that made them the villain would be both wrong and commercially suicidal.
- **The ritual is four lines and a check** — claim, context, actions, outcome, then submit it.
  Those are the exact fields of `EvidenceSchema`. The form had always asked for them; nothing had
  ever said this was a discipline with a name, or that the third line is the hard one and the one
  that decides whether a check can confirm anything.
- **The threshold is real and was invisible.** `recomputeMatchesForRole` writes no match at all
  for a candidate with no verified evidence — not a match scored zero, no match. So somebody with
  an account, a full profile and nothing checked was invisible to every employer and had no way to
  know it, and would reasonably conclude the product was empty rather than that they were outside
  it. `ThresholdPanel` now names which of the three real conditions is missing: a live proof, the
  discovery opt-in, or that proof not being private.
- **The mark dates itself.** Verification badges conventionally imply permanence, which is a lie
  about how credentials work. `ProofMark` says when the check ran and when it stops being true,
  and renders a lapsed proof as lapsed rather than hiding it. It mirrors `isVerified` rather than
  reading the stored flag, because an item verified in 2026 against a credential that expired in
  2027 stays stored as `verified` forever and the server stops counting it the day it lapses.
- **The words are claim and proof, not evidence.** "Evidence" flattens the distinction the whole
  product rests on: an unchecked item and a checked one are both evidence, and they score 0 and 1.
  Both replacements are native — `claim` is already the schema's own field name, `proof` is
  already in the product's name.

**Not built: the psychological tricks, and the prophecy.**

Manufactured belief is a dark pattern with better copy, which `docs/COMMERCIAL_RUNBOOK.md` already
forbids outright. It is also specifically self-defeating here: the one thing this product sells is
that it does not ask anyone to take a claim on faith, so a brand built by manufacturing faith would
be the first counter-example to its own pitch, and the first employer to notice would be right.

The prophecy fails on the same logic, which is why refusing it is stronger than writing one. A
brand whose single claim is "don't take a claim on trust" cannot make an unverifiable statement
about the future without refuting itself in the same breath. `CLAUDE.md` says the same thing
operationally: never let a copy pass introduce a claim that outruns reality, and
`PHASE 10 COMMERCIAL GO` requires every gate independently evidenced because "ambition is not a
legal PASS".

What replaces it is a claim with a test attached: "Check it. We will show you exactly what we
checked, who we checked it with, and when it stops being true." That is the harder promise to
keep, and therefore worth more than a prediction.

**The logo stays typographic**, and that is a decision rather than an omission: the symbol that
matters here is the one candidates earn, and a company logo beside the proof mark on every screen
would compete with the only mark that carries meaning. The app icon already exists
(`apps/web/app/icon.svg`, a Z in three straight square-capped strokes) and the proof mark is built
from the same geometry. An ornamental logo would be a founder decision; adding one because a brand
section looked empty would be exactly the generic detail this work exists to remove.

## 2026-09-01 — Six defects a real user would have hit, found by walking every route

Reading the app end to end as a first-time user, rather than running the suite, found six things
the tests did not because none of them is a logic error. Every one is a statement the product made
about itself that had stopped being true, which is the same shape as every finding in the
2026-08-31 pass.

- **Signing out as an employer did not sign you out.** `EmployerNav` cleared local storage and
  stopped, so on the real backend the httpOnly session cookie and its server record both survived:
  the next visit, or anyone else on a shared machine, was still authenticated. `CandidateNav` had
  always called the real endpoint. `AdminNav` had the same gap, and both admin pages behind it read
  the real backend.
- **The real role page served matches unsorted.** The local path sorts by score, with a comment
  explaining that neither store returns an order that means anything. The path that charges people
  for a ranked shortlist was the one serving it unranked.
- **It also offered an unlock it could not honour.** No mention of the five-match marketplace gate,
  so an employer under the threshold got a button, a click, and a 403 explaining a rule the page
  had never shown them.
- **One failing request emptied the whole roles list.** `Promise.all` across every role meant one
  blip on one role's match count replaced all of them with a 500 page.
- **The Kit checkout rendered blank while loading**, and blamed Paystack for refusals that were
  nothing to do with Paystack. Generalised into `messageFor`: a 4xx keeps the server's own
  sentence, a 5xx uses the caller's fallback, because a 4xx is a statement about this request and a
  5xx is a statement about a bad moment.
- **The data export could silently fail.** It clicked a detached anchor, which has never reliably
  worked in Firefox, and revoked the object URL synchronously, which can cancel the download the
  click just started. The Kit download on the role page already got the second half right, with a
  comment saying why. This is the one place a candidate exercises a legal right.


## 2026-09-01 — Each environment now declares which kind of Paystack key it will accept

Dashboard screenshots confirmed two facts that had not been recorded anywhere: the Paystack account
is live-approved, and the TEST-mode webhook URL is already pointed at
`https://test-api.zoryvex.space/webhooks/paystack`.

The first one changes the risk profile. A working `sk_live_` key now exists and can be pasted
anywhere a key is asked for, and the most expensive mistake available in this system is that key
ending up in `/zoryvex/test/paystack/secret-key`. Every automated test, every demo walkthrough and
every hourly reconciliation run would then move real money, and nothing anywhere would notice: the
environment is decided entirely by which key is configured, with no code branch on environment. That
is the right design, and it is exactly why it needs a second opinion.

Each environment now declares the prefix its key must have — `PAYSTACK_KEY_PREFIX`, `sk_test_` in
test and `sk_live_` in production, set on every route that reads the key.
`getPaystackSecretKey` refuses a key that does not match, so the wrong key stops every payment in
that environment rather than making a real one. Refusing is the correct failure direction: it is
recoverable with one parameter write, and a real charge on a test card is not. The error names the
prefixes and never the key.

Absent means unchecked, so an environment that has not opted in behaves exactly as before. A guard
that broke every unconfigured environment on the day it shipped would be reverted rather than fixed.


## 2026-09-01 — The spec's hard gate on marketplace checkout was never implemented

`docs/PRODUCT_SPEC.md` has said since it was written: "Monthly marketplace checkout stays
**disabled** until the saved role has at least five real, current, discovery-opted matching
profiles. This is a hard gate, not a soft nudge — do not surface a paid marketplace CTA before the
threshold is met."

Only half of it existed. `unlockContact` refused below the threshold, and
`startSubscriptionCheckout` never looked at a match count at all. So an organization could be sold a
marketplace subscription while every role it owned was below the line, and then discover it could
not spend a single unlock anywhere. That is the exact outcome the rule exists to prevent, and it is
a refund rather than a sale.

Three pages described the gate and none of them described what happened. They said checkout was
disabled per role, which a per-organization subscription cannot be — which is probably why the rule
was never implemented: as literally worded it does not typecheck against the product.

The faithful reading is the intent rather than the plumbing: **do not sell access nobody can use.**
So a subscription checkout now requires at least one role at or above the threshold, and contact
details continue to open per role on the roles that have them. One eligible role is enough to
subscribe, because one is enough to use.

Both halves are enforced server-side and the spec now says the organization-level version out loud,
so the sentence and the code finally agree.

It costs money on purpose. Selling access to a marketplace with three people in it would be easy,
and this is what makes it impossible — which is the same reasoning already recorded for the unlock
gate on 2026-08-31.


## 2026-09-01 — Standard subscription prices raised again, founding held again

Founder decision, taken today: standard Scout 185,000 to **250,000**, standard Team 520,000 to
**700,000**, standard Partner 1,350,000 to **5,000,000**. Founding stays at 79,000 / 229,000 /
599,000 and the Kit stays at 95,000. Monthly only, as before.

Three things are worth recording beyond the numbers.

**The timing was the cheap part.** A Paystack Plan's amount is fixed on the object once created.
No plan objects existed yet and nobody had subscribed, so this was a text edit. The same change
after a customer is attached to a Plan is six new Plan objects and a migration, and it was about to
stop being free: the founder was one command away from creating the six test plans when this came
up.

**Raising standard alone is the whole point.** Founding is a price held for the life of the
subscription, and the only real scarcity this product has is that there are twenty-five places.
Holding founding through a third consecutive raise widens the discount from about a third
(2026-08-27), to over half (2026-08-30), to roughly two thirds on Scout and Team and almost nine
tenths on Partner. Raising both would have moved the number a founding member locks in for life,
which is the strongest promise on the pricing page.

**Two consequences the copy has to respect.** Standard Partner is now 7x standard Team, where
standard Team is 2.8x standard Scout, so Partner reads as an enterprise step rather than the next
rung of a ladder; nothing may describe the three tiers as evenly spaced. And the two price sets now
interleave: founding Team (229,000) is cheaper than standard Scout (250,000), and founding Partner
(599,000) is cheaper than standard Team (700,000). Both were flagged to the founder before the
change and both are deliberate.

The change touched one source of truth (`packages/contracts/src/domain.ts`) and every guard that
pins it caught the rest: the exact-value tests in contracts, apps/web, and the plan catalog; the
live-price extractor that feeds the safe-shell guard; and `npm run fees:check`, which recomputed
all nine settlement figures and refused the table until the rows were regenerated from
`scripts/lib/paystack-fees.mjs` rather than edited by hand. That refusal is the guard working: the
prices in the table had been updated and the fee columns had not, which is precisely the drift it
was written for.

## 2026-09-01 — What NGN 5,000,000 does to the Paystack collection limit

Found while finishing the price raise, not before it: the raise was checked against the fee table and
the plan catalogue, and not against Paystack's own ceiling on this business.

Paystack's lifetime collection limit for a Nigerian Starter Business is NGN 8,000,000. Re-verified
today against support.paystack.com/en/articles/2128898, which is the current article; a legacy
support2 page still states NGN 2,000,000 and is stale. The figure in docs/PRODUCT_SPEC.md was right
and is now re-dated.

Standard Partner is NGN 5,000,000. One charge fits. The second does not. Concretely: an organization
subscribes, pays 5,000,000, gets access, and thirty days later Paystack declines the renewal because
the business has hit its ceiling. Paystack does not retry a failed subscription charge and does not
send a webhook for one, so nothing arrives to tell us. The organization keeps access it is no longer
paying for until a human notices.

Two things follow, and only the first is mine to do.

The count is now derived rather than remembered. `chargesBeforeLimit` lives in
`scripts/lib/paystack-fees.mjs` next to the fee arithmetic, `docs/PRODUCT_SPEC.md` carries a row per
SKU, and `npm run fees:check` recomputes every row and fails on a stale or missing one. This was
tested by planting a wrong count and a deleted row and watching both fail. The reason to compute it
is that it is exactly the kind of number that goes wrong quietly: raising standard Partner took its
row from 5 to 1 and nothing anywhere would have said so.

The second is the founder's. Removing the ceiling means upgrading to a Paystack Registered Business,
which requires CAC registration. That is `NOT AUTHORIZED BY FOUNDER` under the legal boundary in
CLAUDE.md and is not something I will prepare, schedule, or show a click-path for. Until it happens,
standard Partner is a tier that can be listed and quoted but not billed twice, and a signed standard
Partner subscriber would be a refund rather than revenue.

This does not change the price. The founder set 5,000,000 knowing it was an enterprise step, and the
constraint is on the provider account rather than on the number. It changes what may be sold on the
current account, which is a different decision and is recorded as open in docs/RISK_REGISTER.md.

## 2026-09-01 — The business name on every payment surface was wrong for seventeen days

The founder read the Paystack dashboard while switching it out of live mode and saw that the account
is **Abba's Solutions**. Every paid surface in this product said **Abbas Solution**. Founder decision,
taken immediately: the dashboard is right, the site is wrong, fix the site.

This was not a typo in the copy. `docs/MANUAL_ACTIONS.md` records the Phase 1 Paystack survey on
2026-08-15 concluding that the trading name "already displays as 'Abbas Solution' (no rename needed)".
The dashboard has always read "Abba's Solutions". The survey misread it, wrote the misreading down as
a verified observation, and everything downstream copied the record instead of the dashboard: the
exact-wording rule in CLAUDE.md, the acceptance criterion, `docs/PRODUCT_SPEC.md`, the OpenAPI
description, `.zoryvex/state.json`, `docs/V48_BINDING.md`, `docs/FOUNDER_READINESS.md`, and the
constant six pages render from.

The uncomfortable part is that a guard already pinned this string. `openapi-schema-parity.test.ts`
asserts the disclosure appears in the OpenAPI document, and it passed every run for seventeen days,
because it compared our wrong string to our own wrong file. A parity guard proves the repository
agrees with itself. It cannot prove the repository agrees with the world outside it, and this value
only exists to match something outside it: what the customer will see on a bank statement. Only a
person looking at the dashboard could catch this, and that is what happened.

What changed. `PAYSTACK_BUSINESS_NAME` now lives on its own in `apps/web/src/lib/pricing.ts` and the
disclosure is built from it, because the footer needs the name inside a different sentence ("Payments,
when enabled...") and that is why a second hand-written copy existed there. The trust-and-safety page
had a third. Both now read the constant. `apps/web/tests/paystack-disclosure.test.ts` fails if the
name is written out by hand anywhere else under `app/` or `src/`, proved by planting one in the
contact page and watching it name the file.

The historical records were corrected rather than rewritten: each now carries the right name and a
dated note that it was misread, not renamed, because how the error spread is the useful part. One
instance is deliberately left alone. `docs/COMMERCIAL_RUNBOOK.md` opens by saying it is recorded
verbatim from the founder's preserved manual, and editing a verbatim record to make it agree with a
later correction would make it worthless as a record.

Nothing was charged under either name. No Paystack plan, subscription, or transaction exists, in test
or in live, so there is no customer who saw the wrong name and no reconciliation to redo.

## 2026-09-01 — Billing is deployed to TEST, and the deploy script could not finish on Windows

Founder approved the apply after reading the plan, the diff, and the rollback. Applied: 45 created,
55 changed, 0 destroyed, exactly as planned.

The Terraform apply succeeded on the first run. The deploy did not. It died immediately afterwards on
`spawnSync npm ENOENT`, between the apply and the site sync, which is the worst place for a deploy to
stop: the infrastructure had changed, the site had not, the smoke test never ran, and the last-good
commit was never recorded. The automatic rollback then failed too, correctly and for the reason
already written down before the apply: `/zoryvex/test/last-good-commit` did not exist, so there was
nothing to roll back to.

The cause is Windows. `npm` is a `.cmd` shim rather than an executable, so `execFileSync('npm', ...)`
raises ENOENT and the message names npm, which reads as "npm is not installed" rather than "this needs
a shell". The first fix mapped the name to `npm.cmd` and produced `EINVAL` instead, because Node
refuses to execute `.cmd` and `.bat` files without a shell, deliberately, since the 2024 hardening for
argument injection. Two failures at the same step is where CLAUDE.md says to stop guessing, so the
third attempt was not a guess: all four combinations were run in isolation first, and only
`npm.cmd` with `shell: true` works.

That answer carries its own trap, which Node warns about: with a shell, arguments are concatenated
rather than escaped. `spawnPlanFor` therefore refuses any argument containing a space or a shell
metacharacter rather than trying to quote it, on the grounds that a Windows quoting routine exercised
once a month would be wrong the first time it mattered. Everything except npm and npx is a real
executable and takes no shell on any platform, which is exactly why the failure arrived so late:
every aws and terraform call before the build ran fine.

Worth naming plainly: this bug was reachable only after a real apply. Nothing in validate:all, the
unit tests, or the end-to-end suite runs `scripts/deploy.mjs`, and the script's own header claimed it
had been run end-to-end against real AWS. It had, before the site-build step existed.

Verified after the third run rather than assumed: plan summary `+0 ~0 -0`, which is the proof the
first apply had landed everything; site sync 248 uploaded, 56 deleted, 265 total; `/health` 200; all
five new billing routes live and returning 401 to unauthenticated requests, so they fail closed
behind the authorizer; the live pricing page carrying 250,000 / 700,000 / 5,000,000 with no trace of
the old figures, and the corrected business name; pages now served `max-age=0, must-revalidate`
instead of the old 24-hour default. `/zoryvex/test/last-good-commit` now exists, so the automatic
rollback has an anchor for the first time.

## 2026-09-01 — Location filters matches, and what that had to mean

Founder decision, answering the fork left open since the first message of the day: location
**filters** matches rather than merely informing the employer.

Before this, `Role.constraints` was free text hinted "Location, timezone overlap, start date" that no
code could read. The seeded roles say "Remote, Nigeria-based" and "Remote, overlapping 4 hours with
WAT", and both filtered precisely nobody. Candidates had no location field at all, so there was
nothing to filter against either.

Two dimensions, because two things actually constrain remote hiring: where an employer is able to
employ and pay someone, and how far apart the working days are. A candidate states a country and a
working UTC offset; a role states an allow-list of countries and a maximum timezone distance from its
own offset. City is deliberately absent. These are remote cloud roles, and a city collects more
personal data than any decision here needs.

Four choices are worth recording because each of them could reasonably have gone the other way.

**An allow-list, never a deny-list.** An employer says where they can employ someone; they are never
offered a field for where they will not. The two are identical arithmetic and very different
questions, and only one of them stays about payroll.

**Location is stated, never inferred.** Nothing reads it from an IP address, a phone prefix, or a
name. The browser's own offset is offered as a starting suggestion in the form and is never stored
unless the person chooses it. An inferred location is what turns a payroll filter into a proxy for
nationality, which CLAUDE.md rules out.

**A candidate who has not stated a location is never excluded.** Location arrived today and every
candidate who signed up before it has none. Dropping them would be a silent rejection caused by a
schema change, invisible to the employer and the candidate alike. The cost is that the filter does
little until people fill it in, which is the right trade and a temporary one.

**The filter reports what it costs.** A recompute now returns how many candidates met the role's
requirements and were removed only by its location, and the employer is told the number. A shortlist
that quietly got shorter is indistinguishable from a platform with nobody on it, and a filter nobody
can see the cost of is a filter nobody can decide about.

One case needed care. An unlocked match is the employer's record that they paid for that person's
contact details. When a role's requirements change afterwards so the candidate no longer fits,
deleting the match would destroy a purchase and hiding it would hide something already bought. It
stays, with its real score, and its rationale says plainly why it no longer meets the requirement.

### The limitation, stated rather than buried

A stored UTC offset is not a timezone. A candidate in a region observing daylight saving is
described by an offset that is correct for part of the year and an hour out for the rest, so a
candidate sitting exactly on a role's tolerance can fall outside it seasonally. Storing an IANA zone
(`Africa/Lagos`) and resolving the offset at match time would be correct and was not done: it makes a
pure function time-dependent for an error of one hour, in a product whose candidates are mostly in
regions that do not observe DST at all. The field is labelled as the candidate's usual working hours
rather than presented as a computed truth. Recorded in docs/RISK_REGISTER.md so the next person meets
it as a known limit instead of a surprise.

## 2026-09-01 — "Parity" was platform-relative, and the earlier close was premature

Correcting something recorded earlier the same day. The risk register's longest-standing row said
Lambda bundles on disk differed from what was deployed. I closed it after a local plan reported
`+0 ~0 -0` and a byte-identical `CodeSha256` comparison, and wrote that the repository and AWS were
in exact parity.

Both measurements were true and neither meant what I said it meant. They were taken on the same
machine that built the bundles. The first CI deploy, on the same commit, planned `+0 ~53 -0`: 51
Lambda functions differing on `source_code_hash` alone, plus the two scheduler policies that are
always unknown at plan time. Rebuilding on this workstation immediately afterwards and planning
again produced the same 53 in the other direction.

So the zip builds are deterministic on one platform and not across two. A Windows-built bundle and a
Linux-built bundle of identical source do not hash the same, and a local deploy and a CI deploy each
undo the other, redeploying all 51 functions to no behavioural effect.

Nothing is broken by this. The code is identical in behaviour either way, nothing is at risk, and
both deploys succeed. What it costs is the signal: a plan showing 53 changes is supposed to mean
something changed, and until now it meant nothing more than which machine ran it.

The rule from here is the one Phase 7 slice 9 already wrote down and this is the evidence for:
**TEST is deployed by CI, not from a workstation.** Every deployed bundle is then Linux-built and
the difference has nowhere to appear. A local `terraform apply` is now the thing that reintroduces
the drift rather than the thing that closes it, which inverts how today was operating.

Fixing it at source is possible and deliberately not done: the zip builder would need to normalise
file modes and entry order so the output is byte-identical on any platform. That is worth doing if
workstation deploys ever become necessary again. While CI is the only deployer it buys nothing, and
the smaller change is the rule.

Two things stay true from the earlier entry and are worth keeping. The 45 Lambda code updates in the
billing apply were real and did need shipping. And AWS retains no previous version of any function,
so a rollback artifact still has to be captured before an apply.

## 2026-09-02 — The evidence hierarchy is ordered by resistance to faking, not by the brief's order

Founder decision, taken after the conflict was put to them with its consequence.

The verification brief listed eight levels ending CLAIMED → ... → PEER VERIFIED → CONTINUOUSLY
VERIFIED, with peer verification near the top. That reading is defensible: as a progression of kinds
of knowing, "somebody who worked with them confirmed it" is a deeper thing than a certificate.

It was harmless while the order was only a label. It stopped being a label when ranking began using
it: a match now sorts by the strongest level behind it, so a level's position decides who an employer
sees first.

Under the brief's order, a peer attestation would have outranked a machine-verified outcome. The
single most collusion-prone signal in the product would have sat above the hardest one to fake, and a
candidate with one willing colleague would have sorted above a candidate whose configuration a
machine actually checked. That inverts the brief's own stated preference — machine-verified outcome
over opinion, observed action over self-report, corroborated work over claim — so the two halves of
the brief disagreed with each other once ranking made the order load-bearing.

The order is now: claimed, peer verified, knowledge assessed, skill demonstrated, process observed,
outcome verified, work corroborated, continuously verified. Resistance to faking, which is what
`packages/contracts/src/evidence-strength.ts` always said its ordering was.

Peer verification is not demoted out of scepticism about colleagues. It is attributable testimony
from somebody who proved control of an address at the organisation the work was done at, which is
worth considerably more than nothing. It is below the machine checks because a colleague can be
mistaken, or a friend, and no amount of sincerity turns testimony into a check.

Two consequences worth keeping in view. A test asserts peer verification can never outrank a
machine-verified outcome, so this cannot drift back by accident. And reordering these levels is now a
founder decision with an entry here, the same as a price, because it moves who gets seen.

## 2026-09-02 — Five founding places, and a marketplace that opens at one match

Two founder decisions on the same day, both changing what the product sells and to whom.

**Founding places drop from 25 to 5.** Nobody holds a founding place yet, so no existing customer's
price moves and no promise already made to a buyer is broken. The scarcity is now real rather than
nominal: at 25 places against zero subscribers, "limited" was a word rather than a fact. Every
surface derives the number from `FOUNDING_SLOTS_TOTAL`, which is why this was a one-line change
plus the copy that had hardcoded "25" and "twenty-fifth" in three places — those are now derived
too, so the next change cannot leave a stale sentence behind.

**The marketplace gate drops from 5 matches to 1, and gains a disclosure.** The old rule refused a
subscription until one of the employer's roles matched five discovery-opted candidates. The
reasoning in `docs/COMMERCIAL_RUNBOOK.md` was sound and is not abandoned: selling access nobody can
use is a refund with extra steps, and worse, a reason not to come back.

What changed is who decides. An employer looking at a marketplace of one, *and knowing it is one*,
is capable of judging whether the Kit and the verification are worth the subscription on their own.
Refusing that sale was protecting them from a decision they are entitled to make. So the count now
travels on the quote and is stated on the billing page before payment, and the three marketing
surfaces that described the old five-match rule say what is actually true instead.

The floor is one rather than zero deliberately. A marketplace with a single candidate is a thin
product an informed buyer may still want. A marketplace with nobody in it is not a product at all,
and no disclosure makes selling it defensible.

This is a lower bar for revenue, so it is worth naming the risk plainly: the gate existed to stop
early refunds, and lowering it trades some of that protection for reach. The disclosure is the
whole mitigation. If the disclosure is ever removed or softened, the constant should go back to 5 —
the code comment on `MARKETPLACE_GATE_MIN_MATCHES` says so, so a future reader finds the condition
attached to the number rather than only here.

**Contact unlock moved with it**, from the same constant. An employer allowed to buy on a single
match must be able to reach that match, or they have bought nothing.

**A defect this surfaced.** Reporting the real count made `quoteSubscription` read the employer's
roles, which is a GSI2 query, which `billing-overview` reaches. `scripts/check-gsi-grants.mjs`
caught the missing IAM grant before it shipped — the same class of failure that had already broken
subscription checkout in TEST that morning, found this time by the guard rather than by a founder
clicking a button.

## 2026-09-02 — Founding prices raised for the first time

Scout 79,000 to 150,000, Team 229,000 to 400,000, Partner 599,000 to 900,000, monthly. Founder
decision. Standard prices are untouched.

Founding had never moved before. The two standard raises on 2026-08-30 and 2026-09-01 deliberately
held it, which widened the discount to roughly two thirds and nine tenths. This narrows it back to
about two fifths on Scout and Team and four fifths on Partner. Nobody holds a founding place, so no
existing subscriber's price changes.

**Checked against the Paystack ceiling before implementing, because that is the constraint that
decides whether a price is safe here.** A Starter Business stops collecting at NGN 8,000,000
lifetime, and `scripts/lib/paystack-fees.mjs` recomputes how many charges of each SKU fit inside it.
Scout 53, Team 20, Partner 8, all comfortably above one, so every founding subscription can take its
own renewals. Standard Partner still fits only once; that risk is unchanged and stays open in
docs/RISK_REGISTER.md.

**The ceiling is account-wide, not per subscription, and that is the part worth understanding.**
NGN 8,000,000 is the total this account may ever collect before Paystack stops it. Raising prices
therefore does not raise the ceiling: it reaches the same ceiling faster, with fewer customers. Five
founding subscribers at the old prices would have taken roughly six months of collection to get
there; at these prices it is closer to three. That is not an argument against the raise. Fewer
customers for the same collected total is better unit economics and less support load, and revenue
arrives sooner. But it does mean the CAC registration question, currently `NOT AUTHORIZED BY
FOUNDER`, becomes live sooner rather than later, and pretending otherwise would be the kind of
convenient silence this file exists to prevent.

**Two tests were reframed rather than re-pinned.** Both asserted the founding discount exceeded
half, which described the moment after the standard raises rather than a rule worth holding, and
both would need rewriting on every future price change. They now assert the relationship that
actually matters: founding must be strictly below standard on every tier, because "founding buys a
lower price, never extra features" is the promise, and a founding price that met standard would make
it false.

**Operational consequence, not yet done.** Paystack plan amounts are fixed at creation and cannot be
edited. The three founding plan objects in TEST still carry 79,000 / 229,000 / 599,000, so they
would charge the old prices. New plan objects are required and
`/zoryvex/test/paystack/plan-codes` must be repointed at them before any founding checkout is run
against these prices.

## 2026-09-03 — ADR 0004 accepted: non-AWS tasks now, track rename later

Founder accepted [[docs/adr/0004-multi-cloud-tracks-relabel-before-rename]]. The four launch tracks
are unchanged and the `aws_cloud` identifier and its "AWS cloud" label both stay for now.

What the acceptance settles:

**Non-AWS graded tasks are permitted inside the existing tracks.** They are selected by capability,
not by provider, so an Azure or GCP task testing `least_privilege_access` is offered to every track
that needs that capability without a new track existing. The Azure and GCP prototypes stay and are
the first two of the set rather than a pair of orphans.

**The ordering is binding, and it is the point of the ADR.** Write non-AWS tasks until the track is
honestly multi-cloud, then change the label, and rename the identifier only if something forces it.
Relabelling `aws_cloud` to "Cloud platform" while 25 of its 27 tasks are AWS-specific would put a
claim on the product that the content does not support, which is the rule in CLAUDE.md's voice
section and the same failure as the "nothing is recorded" copy fixed the day before.

**The identifier rename is explicitly deprioritised, not deferred vaguely.** The raw value never
reaches a user: it appears in no visible text and no URL, only ever rendered through
`LAUNCH_TRACK_LABELS`. Renaming it is a breaking OpenAPI enum change across 103 files that buys
nothing a user can see. It is internal hygiene and can happen at any time afterwards.

Not decided here: whether Zoryvex should pursue Azure and GCP talent at all, which is a question
about where demand is. The ADR establishes only that if the answer is yes, the cost is task
authorship rather than architecture.

## 2026-09-04 — Every subscription price doubled

Founder instruction: make the subscriptions considerably more expensive. Founding goes from
150,000 / 400,000 / 900,000 to **300,000 / 800,000 / 1,800,000**, and standard from
250,000 / 700,000 / 5,000,000 to **500,000 / 1,400,000 / 10,000,000**. Monthly, NGN.

Doubling was chosen over any other multiple because it is the only way to raise everything without
rewriting the model that sits around the numbers. Three properties CLAUDE.md fixes survive untouched:
the founding discount stays at roughly two fifths on Scout and Team and four fifths on Partner;
Partner keeps the deliberately different enterprise shape recorded on 2026-08-30; and the two sets
still interleave the same way, founding Scout (300,000) below standard Scout (500,000) below founding
Team (800,000). Every earlier raise moved one set and changed all three.

This is the third raise and the first to move both sets at once. It is still free to make: nobody has
subscribed, so no price is being changed under an existing customer, and founding members would in
any case keep theirs for the life of the subscription.

### What it cost operationally

A Paystack Plan's amount is immutable, so six new Plan objects were created and
`/zoryvex/test/paystack/plan-codes` repointed at them (version 5). Nine superseded Plans now sit in
the TEST account and cannot be deleted; they are unreachable because a plan is only ever selected by
code from that parameter, never by name. Verified by reading `GET /plan` back and comparing every
amount against `SUBSCRIPTION_PRICES_NGN`.

`scripts/lib/plan-catalog.mjs` now puts the amount in the plan name. Without that, a raise deadlocks:
the creation script matches an existing Plan by name and refuses to reuse one whose amount disagrees,
so the name is held by a Plan charging the old price and the script can neither reuse nor replace it.
That is what forced three plan names to be edited by hand during the 2026-09-02 raise, and why the six
plans were inconsistently named until today. A price change now produces a genuinely new name, and an
unchanged price still matches and is reused.

### What it forecloses, and the thing worth knowing

Standard Partner at NGN 10,000,000 exceeds Paystack's NGN 8,000,000 lifetime collection limit for a
Starter Business **in a single charge**. The 2026-09-01 entry recorded that at 5,000,000 exactly one
charge fitted and the first renewal would fail; at 10,000,000 the count is zero, so the tier cannot
take a first payment at all. It changes from a tier that breaks at renewal to one that cannot be sold.

This does not change the price, for the same reason it did not last time: the founder set it knowing
Partner is an enterprise step, and the constraint is on the provider account rather than on the
number. Removing the ceiling means a Registered Business, which requires CAC registration and remains
`NOT AUTHORIZED BY FOUNDER`. Until then standard Partner may be listed and quoted but must not be
sold, and the same ceiling now binds harder on every tier: the account can only ever collect
8,000,000 in total, which at these prices is about twenty-six months of one founding Scout or four of
one founding Partner.

## 2026-09-04 — Standard Partner corrected to a price Paystack can take

Founder instruction, hours after the doubling: make the 10,000,000 a suitable price, but keep it
high. Standard Partner goes to **NGN 4,000,000**.

The doubling had made the tier unsellable rather than expensive. Paystack's lifetime collection limit
for a Nigerian Starter Business is NGN 8,000,000 account-wide, so a single 10,000,000 charge was
larger than everything the business is allowed to ever collect. It could not take a first payment.

4,000,000 is not a round-number compromise. It is the highest price at which a renewal still fits:
`chargesBeforeLimit` returns 2 there and 1 at anything from 4,000,001 to 8,000,000. One charge is the
5,000,000 failure mode again - sold once, dead at the first renewal - so anything above 4,000,000
reintroduces the problem this change exists to remove.

### What it changes beyond the number

The founding discount on Partner drops from about four fifths to about a half. That is more coherent
than what it replaced: Scout is two fifths and Team is two fifths, so Partner at one half now sits
with them instead of far outside.

The ladder loses the shape recorded on 2026-08-30. Scout to Team is 2.8x and Team to Partner is
2.86x, so at standard prices the three tiers are now close to evenly spaced. The standing copy rule
was that Partner is deliberately a different shape and must never be described as evenly spaced;
that rule is retired, and CLAUDE.md now says copy should make no claim about spacing either way.
Retiring it is the honest move - the claim it protected is no longer true.

### What it does not fix

Two charges is two months, and the ceiling is shared with every Kit sale and every other
subscription. A Partner subscription still ends against it well inside a year, and standard Partner
can realistically be sold once, to one organization. The constraint is the Starter Business account,
not the price, and lifting it means a Registered Business - CAC registration, `NOT AUTHORIZED BY
FOUNDER`, and not something this project prepares.

A sixth Plan was created at 4,000,000 (`PLN_giox6f3csm0ny11`) and verified against the live API. The
10,000,000 Plan was created earlier the same day and never pointed at; a Plan's amount is immutable
and Paystack offers no delete, so it joins the superseded set. Because plan names now carry their
amount, the creation script reused the five unchanged Plans and created only this one - the first
time that fix paid for itself.


## 2026-09-10 - Four defects found by reasoning across systems, not by reading one file

Each of these was invisible to every existing test, because each lived in the gap between two
things that were individually correct.

### A late webhook could cancel a subscription somebody had just paid for

Paystack keeps every subscription an organization has ever had; this system stores one per
employer, plus a `SUBPTR#<code>` pointer per subscription code that is never deleted. Cancelling
marks a subscription non-renewing and lets it run to the end of the period already paid for, so an
employer who cancels and then takes a different plan has two live at Paystack. Weeks later, on the
old plan's next payment date, `subscription.disable` arrives naming the old code, the pointer
resolves it to the same employer, and the handler wrote `cancelled` over the subscription they had
just bought, then set the entitlement to canceled. The same gap existed on `subscription.not_renew`,
`invoice.payment_failed` and `invoice.update`.

Nobody would have connected the two events. The employer's evidence would have been a billing page
saying cancelled next to a card statement saying charged.

Fixed at the write rather than in each caller: `updateBillingSubscription` takes an optional
`expectedSubscriptionCode` and puts it in the `ConditionExpression`, the same shape
`updatePaymentAttempt`'s `expectedStatus` already used. A refused write is the correct outcome for
an event about a superseded subscription, not an error. Five tests fail without it.

The test fake had to be corrected first: it keyed subscriptions by code with no pointer table, so it
could hold two subscriptions for one employer and could not express the bug at all.

### The employer's page re-sorted the shortlist and threw away the server's ranking

`byStrongestMatch` was changed to rank by how well a candidate answers what the role asked for -
its countries and its working hours - so somebody outside either stays in the list with an
explanation but below the people who can actually be hired. The employer's role page then re-sorted
the same array in the browser by score and evidence strength alone, and that sort ran last. The
server's rule reached nobody.

Both sorts were correct on their own terms, both were tested, and neither test could see the other.
A ranking rule is a product decision, so it now has one definition in
`packages/contracts/src/match-ranking.ts` that both import, and a test asserts no second comparator
exists anywhere in the web app.

### Every real subscriber was told they had "0 / 0 contact unlocks used this period"

The allowance badge on the role page was filled in only on the local demo path, from the local
store. The real path never set either number, so every paying employer saw zeroes on the page they
pay to use. The count could not be computed in the browser in any case: it lives in a period-keyed
ledger only the server reads.

`BillingOverview` now carries `contactUnlockAllowance` and `contactUnlocksUsedThisPeriod`, read from
that ledger. Zero allowance is a real answer, so the badge says a subscription is needed rather than
printing a used-count against nothing.

### A production release would have applied the infrastructure and uploaded no website

`scripts/deploy.mjs` synced `apps/web/out` to S3 only when `env === 'test'`, on the reasoning that
the script never targets production. It does: `scripts/release.mjs` is a thin wrapper that calls
`runDeploy({ env: 'production' })` precisely so production cannot drift into a second code path. A
production release would have created the distribution, served an empty bucket, and reported
success - with one production deployment available, and a release whose site never synced already in
this repository's history (2026-08-22).

The sync now runs for whichever environment was applied, and the bucket name comes from a new
`site_bucket_name` Terraform output rather than a pattern, because production's is a variable with
no pattern to derive. An empty output raises rather than silently skipping.

### Adding a card could buy a month for the price of the card check

Paystack's own card-update page takes a small amount to confirm a new card works and refunds it
immediately. That arrives here as `charge.success` carrying Paystack's own reference, which is the
branch every renewal comes through, because the branch is defined by the reference not being one
this system wrote. It cleared the grace window, set the subscription back to `active` and restored
the entitlement, with no check on the amount at all.

So an employer whose renewal had failed could hold a full month of paid access by adding a card. A
charge created by hand in the Paystack dashboard against the same customer did the same thing.

A renewal is now only a charge for the price the subscription actually holds, compared against the
stamped `priceNGN` rather than a price table so a founding member's lower price still matches.
Anything else is logged and left alone: the money is real and visible in the dashboard, but it does
not buy a month. A charge for at least half the price still alerts, because at that size the
alternative reading is that somebody paid for a month they will not receive, and that has to reach
a person. A card confirmation is a few naira and never trips it. The audit event moved below the check, so `subscription_renewal_charged` now means
a renewal was charged. Three tests fail without these two checks, and the existing renewal tests
pass unchanged.

### Also confirmed correct, and left alone

Founding places are idempotent per employer (a string set with a `NOT contains` condition), so
resubscribing cannot burn a second one of the five. Marketplace access is derived live from the
subscription on every read rather than from a stored flag, so a grace window that closes with no
webhook - which is every grace window, since Paystack does not retry - cannot leave paid access
open. The contact-unlock ledger is calendar-month keyed, so it resets with no scheduled job. The
reconciliation service writes no subscription state and the diagnostic is read-only.

## 2026-09-11 — Transparent compensation, stated intent, and who each sentence is written for

### An empty pay box had no value of its own

The pay fields held a `CompensationRange`, which has no representation for an empty box, so the
component filled the missing end with 0 and treated "no number came out of this edit" as "this
edit did not mention a number". Two things followed. Clearing both boxes and saving left the
published range exactly where it was, under a hint promising the opposite, verified by reading the
stored record rather than the screen. And a range with one end typed could be saved as pay of zero,
which on a role is a claim about money and on a candidate is a claim about what they will accept.

The form now holds a `CompensationDraft` with both ends separately optional, and
`compensationFromDraft` in the contracts package decides what a draft means: a range, nothing, or a
reason it cannot be saved yet. The field and the three pages that use it all ask that one function,
so the message beside the box and the refusal on save cannot disagree.

### The same explanation was shown to both sides

`fitReason` is written for the employer's shortlist: "they work in", "their proof". The candidate's
own list of roles rendered it unchanged, so a person read a paragraph about themselves in the third
person. Worse, the pay sentence named the figure the candidate had entered as their minimum, and
the profile field that collects it says it is never shown to an employer as a demand.

Matches now carry both sentences, built from one set of facts in one place so the two sides cannot
be told different things. The employer's says the role pays below what the candidate needs and
never names the figure; the candidate's names their own. Withholding it from the employer's screen
was not enough, because the shortlist endpoint serializes the whole match: `forEmployerEyes` strips
the candidate's sentence at the boundary, and a test asserts the figure appears nowhere in the
serialized response.

### Repository mappers, the fifth time

Five hand-written mappers have now dropped a field each. `repository-mapper-completeness.test.ts`
reads the repository sources, compares each mapper's field list against its schema, and separates
create paths from read paths so a legitimately absent field is not reported. Deliberate omissions
are declared in `INTENTIONAL_PROJECTIONS` with the reason, exactly, so widening one is a visible
edit rather than a tidy-up: the founder console's candidate list withholds contact channels,
location and intent, and a second check fails if a declared projection starts returning what it
says it withholds.

## 2026-09-11 — Two defects found by driving the deployed test API, not by reading it

### The authorizer's CSRF and Origin checks were not running

`identity_sources` is the session cookie and nothing else, and
`authorizer_result_ttl_in_seconds` was 30. API Gateway caches an authorizer
decision against the identity source, so the Origin header and the
session-bound CSRF token — the two halves of the defence ADR 0001 requires —
appeared in no cache key and a cached decision let both through.

Measured against the deployed test environment. Cold, a PATCH with no CSRF
header was refused 403 and a PATCH from another origin was refused 403. Warm,
18 of 18 requests that should have been refused were accepted: no CSRF token
after a GET, no CSRF token after an authorized write, and a wrong Origin after
an authorized write, six rounds each. A signed-in browser is always inside
that window, so the check was inert for practically every real request.

Two other controls stood between that and an attack. The session cookie is
`SameSite=Lax`, so a cross-site mutating request does not carry it, and API
Gateway's CORS allow-list fails the preflight for an unknown origin. Both were
designed as complements to this check and neither was written to be the last
line, so this is reported as a real defect rather than a theoretical one.

The TTL is now 0. Adding the CSRF header to `identity_sources` is not the fix:
API Gateway refuses any request that omits a declared identity source, which
would reject every GET. The cost is one Lambda invocation and one DynamoDB
GetItem per request rather than per thirty seconds.

### The published contract described a body no handler accepts

`openapi-schema-parity.test.ts` compares named component schemas and has caught
real drift, but request bodies are written inline in the operation, so nothing
compared them to anything. Five had drifted: `PATCH /candidates/me` documented
five properties and accepted ten, omitting the contact channels, location and
the whole of intent; `POST /roles` and `PATCH /roles/{roleId}` omitted the
location requirement and intent; `POST /candidates/me/evidence` omitted
`fileId`; `PATCH /candidates/me/consent` omitted `publicProof`. Every one of
those blocks carries `additionalProperties: false`, so the contract did not
merely fail to mention the fields, it said they would be rejected — while the
API stored them. A client written from the contract could not state a pay range
and would have been right to think the feature did not exist.

`openapi-request-body-parity.test.ts` now compares each handler's zod body
schema against the documented properties in both directions, and fails if a
handler that reads a JSON body is not in its map at all, so the list cannot
fall behind quietly.

## 2026-09-12 — What the first genuine authenticated end-to-end run found

### The Paystack test secret key has been dead since the live key was rotated

Paystack answers 401 "Invalid key" to the test key stored at
`/zoryvex/test/paystack/secret-key`; the live key at the production parameter
authenticates normally. The parameter timestamps give the cause: the test key
was last written 2026-08-18 and the live key 2026-09-11 at 12:14, which is the
rotation after the live key appeared in a screenshot. Paystack's "Generate new
secret key" rotates the account's secret key rather than only the live one, so
the test key changed at Paystack and Parameter Store kept the old value.

Test-mode payments are broken in both directions and the second direction is
what hid it. Outgoing calls are rejected, which is visible. Incoming webhooks
signed by Paystack with the current key would fail our signature check, which
is not — and the webhook tests written here passed anyway, because they signed
with the same stale key the Lambda holds. A test that shares the defect with
the thing it tests reports success.

`set-paystack-live-key.mjs` now takes `--env test` rather than growing a second
copy of a script that handles a secret, with the prefix checks swapped so a
live key cannot be stored where a test checkout would spend it. Storing the
current test key is a founder action: the key is typed at a hidden prompt and
never reaches this transcript.

### Production is four commits behind, and two of the gaps are live defects

`api.zoryvex.space/health` reports commit `7bb3872`. Read out of that exact
commit rather than inferred: `itemToCandidate` names twelve fields and none of
`phone`, `linkedinUrl`, `websiteUrl` or `intent`, while
`getUnlockedContactInfo` destructures `phone, linkedinUrl, websiteUrl` off the
object that mapper returns. So an employer who pays to unlock a candidate's
contact in production today receives an email address and a display name, and
never the phone number or either link, even when the candidate saved them. No
error is raised anywhere, because the three spreads are conditional and the
values are simply undefined.

The production authorizer also still reports a 30 second result TTL, so the
CSRF and Origin checks are being skipped there under the same conditions
measured in test.

Both are fixed in the pending production plan (+21 ~54 -0, zero destroys, the
only changing Lambda attribute being `source_code_hash`). The plan is saved and
deliberately unapplied.

## 2026-09-12 — Payment audit against the live account and the deployed API

Read-only against the live Paystack account with the live key: six plans, all
NGN, all monthly, all mapped to distinct codes, and all six amounts agreeing
across `packages/contracts`, `/zoryvex/production/paystack/plan-codes` and
Paystack itself. No plan code is shared between test and production. Zero live
transactions, zero subscriptions, zero customers, zero refunds — independently
confirmed from the production table, which holds no billing item of any kind.
Nobody has paid yet, so the defects below have harmed no one; the live payment
path has also never been exercised by anybody.

### Production had no payment recovery at all

`billing_reconciliation_job` was `enabled = false`, beside a comment saying it
is the one piece of production automation that MUST be switched on at go-live.
Production went live on live keys on 2026-09-11; `go-live-payments.mjs` flips
feature flags and this is Terraform, so nothing carried it across.

Three things recover a payment whose webhook never arrived: reconciliation
verifying open attempts with Paystack after thirty minutes, ageing out only
what Paystack itself still calls unfinished; and a 48-hour sweep for Paystack
successes with no local row. All of it was off. Meanwhile the billing page
tells a buyer whose confirmation is slow that "we check again automatically
every hour and your access will start without you doing anything" — true in
test, false in production. Now enabled, with a test that reads the Terraform
so it fails in CI rather than after an apply, and that ties the schedule to
the sentence the page shows.

### The browser defeated the server's idempotency

Both checkout handlers require an `Idempotency-Key` and the repository writes
the key item and the attempt in one transaction, so a repeated key returns the
first attempt. Both call sites passed `crypto.randomUUID()` inline at click
time, so every click sent a different key and the server saw different
requests. Measured against the deployed API: three clicks on Subscribe sent
three POSTs. The button did render disabled, which changed nothing — `disabled`
comes from React state and all three handlers ran before the re-render.

Fixed with a synchronous ref latch and one key per plan held across retries,
which is what makes a retry resume rather than duplicate: Paystack returns a
fresh authorization URL for the same reference and a reference can only be paid
once.

### A quote field never reached the page that renders it

`GET /billing` builds its quotes by hand. `marketplaceCandidates` was computed,
typed, and documented as belonging in front of the buyer before they pay, and
left out of that list, so the billing page rendered "Your strongest role
currently matches undefined candidates" on all three plan cards. Nothing threw:
the value is only read inside a template string. Sixth field lost to a
hand-written subset, and the first in a handler rather than a repository, which
is why the repository guard did not see it.

### Fifteen guards, each proven by breaking it

`scripts/mutate-payment-guards.mjs` removes each guard protecting money or
access and checks the suite goes red. Five were untested when first run: the
currency check, the independent verification of transaction status, the
conditional status transition, the already-granted short circuit, and the
thirty-minute reconciliation window. Two of those were redundant with each
other, so neither could be caught by a single mutation, and the fifth was a
test asserting a constant against itself — `RECONCILE_AFTER_MINUTES * 60 * 1000`
compared to a cutoff derived from the same constant, which held for any value
including zero. All fifteen now fail when broken.

### A known limitation, with its compensating control

The dedupe marker is written before the event is processed, which is what stops
two concurrent deliveries both granting an entitlement, and the handler clears
it on a thrown error so Paystack's retry re-applies. A hard Lambda timeout is
the one case that escapes: the marker stands, the work never finished, and the
retry is answered as a duplicate. Measured webhook latency is 228ms to 2s
against a 10s timeout, so this is unlikely rather than impossible. It is
covered by reconciliation, which is now on in production, and that coverage is
the reason for leaving the ordering as it is: reversing it would trade a rare
timeout gap for a common double-apply risk.

## 2026-09-12 — Two payment defects found by paying, and one test-mode ceiling

### A retried checkout could not be paid

Paystack initializes a reference once and answers "Duplicate Transaction
Reference" to a second call, contradicting a comment beside the call that
assumed a retry was safe. So the retry the Idempotency-Key header exists to
make safe was the one request guaranteed to fail, and a buyer who double
clicked saw a 502 over a click that had worked. Both services now store where
the buyer was sent and return that, and the loser of a concurrent race waits
for the winner rather than racing it to the provider — a 409 saying the
checkout is still opening, never a 502.

### A declined card left the buyer permanently unable to buy

The fix above, combined with one idempotency key per plan, sent a buyer whose
card declined back to the same dead reference forever. A reference carries its
outcome: failed stays failed, observed as one reference with three attempts,
all "Insufficient Funds", with Success deliberately chosen on the last two. A
repeated key now resumes an open checkout, refuses a second when the previous
succeeded, and mints a fresh reference when the previous is dead — bounded to
four rounds. `success` is excluded from the dead set on purpose, and a mutation
proves that widening it breaks the double-charge test.

### A paid Kit could be settled and never delivered

Observed with a real NGN 95,000 test payment. The order settled, then
`updateEntitlement` threw, and the retry began with `if (order.status ===
'succeeded') return false`. A succeeded order does not mean the grant
happened. Settlement and delivery are now separate: the conditional transition
still makes settlement exactly-once, delivery is idempotent and re-runnable,
and the short circuit asks whether the Kit exists. Proven by repairing a
genuinely stranded payment — one webhook retry turned a paid customer with
nothing into KITARTIFACT#00001 and an active entitlement.

### Subscriptions cannot be paid in test mode at these prices

Paystack's test card declines above roughly NGN 500,000: charged directly at
95,000, 300,000 and 500,000 it succeeds, at 800,000 it fails. The cheapest
subscription is 800,000, so no subscription payment can complete in test. The
obvious workaround — point the test plan at a cheap one — is correctly refused
by the plan-price guard, which compares the quote against the live Paystack
plan before opening a checkout.

What is proven instead is the half we own: the deployed webhook endpoint
accepts correctly signed subscription events, refuses unsigned ones, treats a
byte-identical redelivery as a duplicate, ignores an event for a subscription
this product does not hold, and grants no marketplace access from any of them.
Paystack's own side of a live subscription — activation, renewal, cancellation
and refund against a real card — remains unproven, and is reported as such
rather than inferred from the Kit working.

## 2026-09-13 — The footer told buyers payments might not be enabled

Production has been taking live keys since 2026-09-11. The site footer, on
every page including the one where an employer pays, read:

> Payments, **when enabled**, are securely processed by Paystack under our
> business name, Abba's Solutions.

CLAUDE.md fixes that sentence without the hedge, and `PAYSTACK_DISCLOSURE` in
`apps/web/src/lib/pricing.ts` has held the exact wording all along. Seven of
the eight paid surfaces render it. The footer did not: it imported
`PAYSTACK_BUSINESS_NAME` on its own and wrote its own sentence around it.

The hedge was honest when it was written. Payments were genuinely off, and a
footer claiming otherwise would have been the worse error. It stopped being
true on 2026-09-11 and nothing connected the two, because the sentence was
prose in a component and the switchover was a feature flag and a key.

Nobody was misled into losing money — the direction of the error is toward
under-claiming, and there have been zero live transactions. What it cost is
the thing the disclosure exists to buy: an employer reading the pricing page,
about to spend NGN 95,000, was told on the same screen that payments may not
be on.

### The existing guard could not have caught it

`apps/web/tests/paystack-disclosure.test.ts` already pinned the business name
and already failed if any file outside the declaration wrote that name by
hand. It passed for twelve days. The footer imported the name exactly as the
guard demanded and rewrote the sentence carrying it, which the guard never
looked at.

So the name was never the whole risk, and that is the general shape: a guard
that pins one token inside a sentence licenses every other word in it. The
test now pins the sentence too, by requiring "securely processed by Paystack"
to appear in exactly one file. Proved by mutation — restoring the hedged
footer fails the new assertion and names the file, while the three older
assertions stay green, which is the demonstration that they were blind to it.

The historical entry above (2026-09-01) still says the footer needs the name
"inside a different sentence". That was the reason a second copy existed and
it is no longer true; it is left as written, because how the second copy came
to exist is the useful part of that record.
