# ZORYVEX_BUILD_STATE.md

Persistent resume document for the full-product audit/hardening pass. Read this file first on
any resume, then check `git status`, `git log --oneline -15`, and re-run `npm run validate:all`
before continuing — do not trust this file's claims over what those actually show.

## Where things actually stand (2026-08-31)

**Read this section, not the ones below it, for current state.** Everything after "What this audit
pass is" is a dated record of past sessions and is correct as history. It was also, until this
edit, the first thing a resume read, and every current-state number in it had been wrong for five
days. That is the same drift this project keeps finding in its own descriptions, in the one
document whose entire job is to describe the present.

- **Branch, not main.** Work is on `phase7/slice10-reserved-concurrency-slo`, pushed, open as PR
  #74 and deliberately unmerged. `main` is at `4dea79c`. The sections below describing commits on
  `origin/main` were true when written and are not now.
- **GitHub Actions is still gated**, resetting around 2026-09-01. Runs are created and fail in
  2-4 seconds with zero steps executed; that is a billing block, not a defect, and the evidence
  for that reading is in the section below, which still holds.
- **A deploy has happened since.** The claim below that "nothing has deployed since `432d523`" is
  out of date: a founder-authorized local `terraform apply` on 2026-08-28 deployed the eight
  previously-undeployed TEST functions (56 added, 2 changed, 0 destroyed), verified independently
  afterwards. See `docs/DEPLOYMENT_STATUS.md`.
- **Current local gate**, re-run before every commit: `npm run validate:all` green across 23
  steps, 1,174 tests in 92 files, and the full Playwright suite at 215 passed / 0 failed. The
  older 502/66 and 191/191 figures below are that gate's earlier size, not a regression. Treat
  every number on this line as a reading taken at a commit rather than a property of the repo:
  it has already gone stale twice in a day, once within an hour of being written.
- **`validate:all` is no longer missing CI steps.** The section below notes it "was missing
  several real CI steps"; it now runs all of them, and
  `scripts/lib/validate-parity.test.mjs` fails if the two lists ever drift apart again.
- **Builds:** 35 routes in `apps/web`, 2 in `apps/web-safe-shell`, first-load JS 178.9 KB gzipped
  against a 250 KB budget.
- **Pending deploy, measured rather than assumed:** 2 to add, 50 to change, 0 to destroy, with no
  dangerous destroy and no blanking regressions under the guards in `scripts/lib/deploy-lib.mjs`.
  The two additions are the account-level Lambda error and throttle alarms; the 50 changes are
  Lambda bundles plus the CloudFront cache behaviours, the CI deploy-role policy and the
  feature-flags parameter description. Re-measure before trusting this line: it was written at
  `801833d` and any commit touching `services/api` or `packages/*` moves the change count.
- **One founder action is outstanding** before TEST behaves correctly: `payments` and
  `contactUnlocks` are `false` in the live feature-flag document and `true` in Terraform, and
  `ignore_changes = [value]` means no apply will move them. See `docs/MANUAL_ACTIONS.md`.

## Historical: constraint as recorded 2026-08-26 (corrected late in that session)

**GitHub Actions is still fully exhausted: 2,000/2,000 included minutes used, resets ~2026-09-01.
No payment method on file.** The founder explicitly authorized pushing anyway, so every commit from
this audit pass is on `origin/main` (currently `5404b85`, `origin/main` == local HEAD, 0/0
divergence).

**IMPORTANT CORRECTION to what earlier revisions of this file said.** Earlier this session, checking
`bc62c3c` and `e53e85c` returned zero check-runs, and this file recorded that "GitHub did not
trigger any workflow at all." That is no longer what happens, and the current behavior looks far
more alarming than it is: **GitHub now creates a workflow run for each push and fails it within 2-4
seconds.** `gh run list` therefore shows a wall of red `failure` runs. Every one of those failures
is a billing block, not a code defect. The evidence, checked directly rather than assumed:

- Failing jobs execute **zero steps** (`steps: []` from the jobs API).
- They complete in **2-4 seconds** (e.g. `started_at` 22:35:40 → `completed_at` 22:35:42). The last
  genuinely-executed `Validate` run, back when budget existed, took **2m 6s**.
- **`runner_name` is empty** — no machine was ever assigned, so no repository code could have run,
  let alone failed.
- The `Detect doc-only changes` job fails too, and that job has not been modified at all this
  session, so no change of mine can explain it.
- Ruled out the one alternative that _would_ have been our fault: a malformed workflow. Parsed
  `.github/workflows/ci.yml` with `js-yaml` — parses cleanly, all 4 jobs present with correct step
  counts (validate 24, changed-paths 2, deploy-test 7). The only diff to that file since the last
  successful run is a valid 3-line step addition.

Do not read those red runs as "the build is broken." Nothing in CI has actually executed since
`8617e2c` (08:16), which passed.

Consequence for how to read everything below: pushes are real and confirmed, but **CI has still
never validated this diff, and nothing has been re-deployed or re-verified live since `432d523`.**
Standing in for CI, the full local gate is green and is re-run before every commit: format, lint (0
warnings), typecheck ×7 workspaces, 502/502 Vitest across 66 files, OpenAPI, secret scan, Terraform
policy (71 files), real-mode-awareness check, 0 dependency vulnerabilities, production build of all
35 routes, static-export assertion, plus `terraform fmt`/`validate` clean on all three envs and the
full Playwright suite (191 passed / 3 pre-existing skips, desktop + mobile). That is real evidence
of local correctness, not a substitute for CI or live verification.

When the budget actually resets, the next push runs CI for real for the first time. Watch that run
to completion, then independently re-verify live the specific things this pass changed rather than
trusting a green checkmark.

## What this audit pass is

The founder issued a sweeping 47-section directive (full text in the conversation, not
duplicated here) asking for a systematic, evidence-based audit of the entire product —
frontend, backend, infra, security, UX, monetization, competitive positioning — with a
"push-readiness gate" before the next deploy. Clarified up front: **no new "Recruiter" role** —
the directive's four roles map onto this system's actual three (`candidate`, `employer`,
`founder_admin`); "Recruiters" means employer-side users of the existing employer account.

**Key constraint discovered early**: real-mode, signed-in behavior cannot be tested via a local
dev server against the live API — API Gateway's CORS is locked to `https://test.zoryvex.space`
only (correct, deliberate security posture), so `localhost` calls are blocked structurally, and
session cookies are scoped to that origin anyway (`__Host-` prefix). This means every fix in this
pass falls into one of two honest buckets:

- **Frontend-only, typecheck/build/lint verified**: real, but "Independently verified live" still
  requires the next deploy.
- **Backend logic, Vitest-verified with mocked dependencies + `terraform validate`**: same caveat.

Never claim "verified live" for anything in this pass unless it was actually checked against a
real deployed environment (none of it has been, since nothing has deployed since `432d523`).

## Findings and fixes this pass (all committed locally, not pushed)

### Commit `65fe219` — real-mode audit findings

1. **`/employer` (roles list) was 100% local-fake, live on the real deployed site.** Reachable
   from every employer page's main nav. A real employer with real roles saw "No roles yet" —
   this is the exact defect independently observed live earlier the same session (before this
   audit pass began) when the founder tried to find a role they'd just created. Fixed: wired to
   `realRoles.listRoles()` + `realMatches.listMatches()` per role. Kit-status badge omitted in
   real mode (no GET status endpoint exists yet for Kit orders — same honest-gap pattern as the
   role detail page).
2. **`/employer/billing`'s "Subscribe" button was a genuine fabricated-success risk.** Clicking
   it on the live site instantly marked a founding-tier plan (real prices, NGN 79,000–599,000/mo)
   as active — zero payment, zero backend call, no visual distinction from a real purchase. No
   real subscription backend exists (deliberately — `docs/COMMERCIAL_RUNBOOK.md`'s "no recurring
   marketplace push before 5 real opted-in matches" gate). Fixed: real mode now shows an honest
   "not open yet, contact us" notice instead of the fake flow.
3. **`/employer/onboarding` had the same fake-success problem** (team invites "succeeded" with a
   toast, sent nothing real). Unreachable from any current in-app link (orphaned since the
   sign-in fix redirects straight to `/employer/roles/new`), but directly URL-reachable. Fixed:
   real mode redirects to `/employer`. Caught and fixed a **Rules-of-Hooks violation** introduced
   while wiring this (an early `return null` landed before a later `useEffect`) — lint caught it
   immediately; useEffect order is now unconditional, return is last.
4. **The "unlock contact" feature was half-built — the actual core defect of this pass.**
   `unlockContact` (POST) correctly flips `contactUnlocked` and logs an audit event, with real
   ownership/consent/allowance checks (this part was already solid). But **no route anywhere ever
   returned the candidate's actual contact info afterward** — `MatchCard.tsx` (which does reveal
   `candidate.email`) is local-fake-only and never renders in real mode at all; the real-mode
   match list just showed a static row with no unlock affordance. Fixed:
   - New domain function `getUnlockedContactInfo` in `contact-unlock-service.ts` — strictly gated
     on `match.contactUnlocked === true`, same ownership pattern as `unlockContact`.
   - New handler `services/api/handlers/matches/get-contact.ts`.
   - New route `GET /roles/{roleId}/matches/{candidateId}/contact`, registered in
     `build-lambda.mjs`, Terraform mirrored in `test` (applies via CI) and `production`
     (source-only, per this repo's convention).
   - New real-api client `matches.getContact()`.
   - Real-mode UI in `role/page.tsx`: "Unlock contact" button → on success, fetches and displays
     the email; a match already unlocked from a prior session shows "Show contact" instead.
   - **Found and fixed a separate, real, pre-existing bug while wiring this**: the frontend's
     `unlockContact` client function declared a return type (`{allowed, reason}`) copy-pasted
     from an internal, never-serialized repository type — the real API actually returns
     `{match, alreadyUnlocked}` on success and throws `RealApiError` on every failure path. This
     was never caught because the real contact-unlock flow had never been exercised end-to-end
     before (no UI ever called it in real mode). Fixed the type to match reality.
5. **Verified clean (no fix needed)**: `authorizer.ts`'s fail-closed session/CSRF checks;
   `evidence-download-service.ts`'s IDOR protection (candidateId always server-derived, identical
   404 for wrong-owner vs nonexistent); `contact-unlock-service.ts`'s pre-existing consent/
   ownership/allowance checks; `Match` schema never carries contact fields, so no accidental
   leakage before unlock via the matches-list response; repo-wide sweep for TODO/FIXME/
   placeholder/console.log/swallowed-catch/disabled-tests — all clean, genuinely disciplined
   codebase already.

### Commit `e4bd338` — admin dashboard fix

**`/admin` (dashboard homepage) fixed.** Was showing fake candidate/employer/role/match counts,
fake Kit revenue, and fake subscription MRR in real mode — genuinely risky since the founder is
the one person who might actually trust this page for real decisions. Checked first whether a
real backend exists for this: it doesn't (`admin-service.ts` only has `getExceptionQueue` — no
aggregate-stats endpoint, and DynamoDB has no cheap native count/sum, so building one is real,
separate work). A dedicated real page for the actual exception queue already existed
(`/admin/exceptions`, well-implemented, found during this check) — so the fix was an honest
notice pointing there instead of either showing fake numbers or a large speculative backend
build. Added the `GET /roles/{roleId}/matches/{candidateId}/contact` entry to
`docs/DATA_MODEL.md`'s access-pattern documentation for consistency (found the OpenAPI spec at
`packages/contracts/openapi.yaml` only documents `/health` — a large, pre-existing, repo-wide gap
unrelated to this pass, not backfilled here). `npm run validate:all` green.

### Commit `a21fcb5` — Kit purchase status + deliverables view

Closed the Kit-status gap noted below as deferred. Added `GET /roles/{roleId}/kit-status`
(`getKitOrderStatus`, reuses the existing access pattern #23 query verbatim — no new index),
wired into both the roles list badge and the role detail page. Went further than just a status
badge: added a real "View Kit deliverables" button on the role detail page that fetches the
actual purchased HTML document (`realKit.getDownloadHtml`) and opens it in a new tab via a blob
URL — a "Purchased" label with no way to reach the document would have been almost as broken as
no status at all. 17/17 kit-service tests green (3 new), full `services/api` suite 332/332, full
`validate:all` green, both Terraform envs validate, local-fake regression-tested live (no change,
as expected — the local-fake branch wasn't touched).

### Commit `41e4284` — systemic nav touch-target fix + DATA_MODEL.md formatting

Found while actually clicking through the app in a real browser (not just code review): every nav
link across `SiteNav.tsx`, `CandidateNav.tsx`, `EmployerNav.tsx`, `AdminNav.tsx`, `SiteFooter.tsx`
shared the identical unpadded class, giving each a ~19px WCAG-AA-violating touch target — fixed
consistently across all five (`inline-block py-2`), verified by measurement (36px after). Also
caught and fixed a real process gap of my own: commit `a21fcb5` shipped `docs/DATA_MODEL.md`
without running it through prettier first — `validate:all`'s format-check step caught it
immediately on the next run. Full `validate:all` green after both fixes.

### Commit `3ebfdd8` — permanent regression check for the whole bug class this pass found

Stepped back and asked why none of the four real defects this pass found (fake roles list, fake
billing success, fake team invites, fake admin stats) were ever caught automatically. Root cause:
`playwright.config.ts`'s `webServer` commands never set `NEXT_PUBLIC_API_BASE_URL`, so the e2e
suite structurally only ever builds and tests local-fake mode — real mode has zero automated
coverage, full stop. Building real e2e coverage needs a live or mocked backend reachable from CI,
a larger, separate undertaking (not attempted here — noted as a real, still-open gap below).

What IS cheaply buildable: every one of those four bugs shared one exact, mechanical signature —
an app page importing `getLocalAdapters` with no `isRealApiConfigured()` check anywhere in the
file. Added `scripts/real-mode-awareness-check.mjs` (same dependency-free style as
`scan-secrets.mjs`/`terraform-policy-check.mjs`): scans every `page.tsx` under the
candidate/employer/admin `(app)` route groups and fails if one uses local-fake data with zero
real-mode branch. Self-tested against a throwaway fixture with a deliberate violation (caught it,
fixture removed) before wiring in. Registered as `npm run real-mode:check`, added to
`scripts/validate.mjs`'s step list and `.github/workflows/ci.yml`'s Validate job (verified: YAML
still parses, and the current codebase passes it — zero violations remain after this pass's other
fixes). This can't verify a real-mode branch is _correct_, only that one exists at all — but it
makes the exact failure class this whole pass was largely spent finding and fixing structurally
impossible to reintroduce silently. Full `validate:all` green with the new step included.

### Commit `1383cee` and `b0cb1b8` — docs-only: competitor research, testing-round writeups

No code changes — see the dedicated "Competitor / market research" section below, and the
interactive-testing checklist entries above (admin moderation action, Subscribe, Unlock contact
all clicked to completion; tablet breakpoint checked).

### Commit `c5e744f` — pagination bug found and fixed via an API-reliability sweep

Went looking for the class of bug that §10 of the directive calls out (timeout/retry/idempotency/
pagination) rather than waiting to stumble onto it. Found: every single `QueryCommand` call in
`services/api/src/repositories/*.ts` (11 files) issued exactly one page and returned whatever
DynamoDB sent back — correct only while the queried partition stays under DynamoDB's ~1MB
per-query cap, silently truncated beyond that with no error. Most of these are safely bounded by
one owner's own item count (a candidate's evidence, an employer's roles) and don't need fixing.
Three are not: `listDiscoveryOptedCandidates` (scales with a launch track's platform-wide opted-in
population — the real one, since past the cap `recomputeMatchesForRole` would silently and
permanently stop scoring some real, eligible candidates against real roles, with zero error
surfaced anywhere) and the two admin `listAllCandidates`/`listAllEmployers` functions (would
silently under-report the admin console's own counts). `listRecentAuditEvents` was checked and
confirmed NOT a bug — it already uses an explicit `Limit` by design (recent-N semantics, not "all").

Fixed by adding one shared `queryAllPages` helper to `dynamo-client.ts` (follows
`LastEvaluatedKey` until exhausted) and switching the three real call sites to it — no schema
change, no new index, same query shape, just complete instead of single-page. Added a real
regression test (`aws-sdk-client-mock` resolving three separate mocked pages, asserting the
result is the union of all three AND that `ExclusiveStartKey` was correctly threaded through each
call) — not just a compile check. Verified: full `services/api` suite 333/333 (1 new), full
workspace suite 499/499, full `validate:all` green (one transient sandbox DNS failure on the
dependency-audit step, confirmed unrelated by retrying it alone).

### More interactive testing (no code changes): fresh signup, contact page, account page

Signed up a genuinely fresh employer account (`fresh.employer.test@example.com`, never used
before this session) through the real sign-in flow — confirmed the dynamic-account-creation path
correctly lands on an honest "No roles yet" empty state, not a seeded fixture's data. Checked the
marketing `/contact` page: no form exists at all, just two external links (WhatsApp, LinkedIn),
both correctly `target="_blank" rel="noopener noreferrer"` — nothing to fix, and the absence of a
fake "send a message" form-to-nowhere is itself the right call. Checked `/candidate/account`: the
"Add an authenticator app (coming soon)" button is genuinely `disabled`, not just styled to look
that way (confirmed via `.disabled` property, not just visual inspection) — honest, not a dead
clickable. "Download my data" clicked without error. Deliberately did NOT click "Delete my
account" — destructive, and would have cost the seeded test fixtures for no new information.

### Commit `f644564` — completed the evidence-edit capability, backend and frontend

Found while doing the button/form walkthrough above: a candidate could Add or Delete evidence,
never edit it — the only recourse for a typo was delete-and-recreate, losing the item's history.
Investigated deeper before building anything, and found the real problem was more fundamental than
a missing UI: `updateEvidence` already existed and worked in the backend, and the real-api client
already had `updateEvidence()` sitting unused — but **nothing exposed an evidence item's
optimistic-concurrency `version` to any client after the create response**. `listEvidence()`
deliberately never carries it (version is a persistence-layer detail stripped from the general
`Evidence` contract, same pattern used everywhere else in this codebase). Without a version,
update's own required parameter could never be supplied by any real client that had left the page
an item was created on — the capability was effectively uncallable in practice despite existing
end to end. This is a materially different, more interesting finding than "just wire up an
existing capability," and worth being honest about: my first read of this gap was wrong.

Fixed the actual prerequisite: `getEvidenceWithVersion` (repository), `getOwnEvidence` (domain,
matches the same `{item, version}` shape `getCandidate`/`getRole` already use elsewhere), a new
`GET /candidates/me/evidence/{evidenceId}` route (mirrored test+production, registered in
`build-lambda.mjs`), and a real-api client function — before ever touching the frontend. Then built
`apps/web/app/candidate/(app)/evidence/edit/page.tsx` (query-param routing, matching this static-
export app's established pattern), wired to a new "Edit" link next to "Delete" on the profile page.
Only claim/context/actions/outcome/visibility/consent are editable, matching
`UpdateEvidenceInput`'s own scope — source and the attachment itself are create-time-only by
design, not touched here.

Verified: 3 new domain tests, full `services/api` suite 336/336, both Terraform envs validate, full
`validate:all` green (34 routes, up from 33). The full local-fake flow was driven live in a real
browser end to end, not just typechecked: opened the edit page, confirmed every field was
correctly pre-filled from the real stored item (verified via `.value`, since `get_page_text` doesn't
reliably surface textarea contents), changed the claim text, saved, and confirmed the profile page
showed the updated text. Real mode's actual save call can't be verified without a deploy, per this
session's established constraint — implemented and locally tested, not "verified live."

### Not fixed, deliberately deferred (documented, not silently dropped)

- **Real e2e coverage still doesn't exist.** The new `real-mode:check` script (above) prevents a
  page from shipping with _zero_ real-mode awareness, but it cannot verify a real-mode branch
  actually _works_ — that still needs either a live backend reachable from CI (costs real AWS
  money to keep a CI-dedicated environment running, or reuses the founder-controlled test
  environment with real credentials in CI secrets, a genuine security/cost tradeoff worth the
  founder's explicit decision, not mine to make unilaterally) or a mocked-fetch e2e project (buildable
  without new infra, but a non-trivial chunk of work — mocking every endpoint's response shape
  realistically). Recommend the founder decide the direction before either is built.
- **Logo/branding asset**: founder pasted a logo image (blue gradient "Z" mark + wordmark) in
  chat. No tool available can extract binary image bytes from a chat attachment into the repo —
  asked the founder to save it to `apps/web/public/logo-mark.png` themselves; not yet provided.
  Once available: wire into `SiteNav.tsx`, `EmployerNav.tsx`, `CandidateNav.tsx`, `AdminNav.tsx`,
  `SiteFooter.tsx` (all currently plain-text "Zoryvex" wordmarks), plus add a real favicon (none
  exists at all currently — genuine, if minor, polish gap). Flagged the palette tension: the
  logo's blue gradient conflicts with `globals.css`'s deliberate ink/warm/emerald palette (chosen
  specifically to avoid the generic AI-SaaS blue-gradient look) — plan is to use the mark as a
  logo/favicon only, not repaint the UI's accent color around it, unless the founder says
  otherwise.

## Audit checklist progress (directive's own §1 list, condensed)

Legend: ✅ done this pass · 🟡 partially done / spot-checked · ⬜ not yet started

- ✅ Repo/architecture orientation (already deeply known from the long prior session covering
  Phases 0–8 — not re-derived from scratch, verified freshly where it mattered)
- ✅ Every route inventoried (31 pages), classified real-mode-aware vs local-fake-only vs no-data
- 🟡 Every button/form: employer-side (roles list, role detail, billing, onboarding, Subscribe,
  Unlock contact), candidate-side (evidence-add form, discovery toggle), and admin-side
  (moderation Remove action) all now actually clicked/submitted to completion this pass, not just
  read. NOT yet done: marketing-page forms (contact page), candidate account-settings page,
  evidence edit/delete, Kit checkout's actual "Continue to Paystack" in local-fake mode.
- ✅ Auth/authorizer: read and reasoned through in full (fail-closed, real DynamoDB lookup, CSRF)
- ✅ Authorization/RBAC: full systematic pass over all 16 domain-service files complete. Findings:
  only the one contact-reveal gap (fixed, see above) plus the two UI fake-success issues (fixed).
  Everything else checked out clean — consistent ownership checks (`role.employerId !== employerId`
  → identical NotFoundError, never distinguishing "not found" from "not yours"), candidateId
  always session-derived never client-suppliable, evidence-scan-service.ts is fail-closed by
  construction (one narrow promotion path, every other branch rejects, idempotent against SQS
  at-least-once delivery), bedrock-explain-service.ts has real prompt-injection defenses (a
  mechanical evidence-ID allow-list filter, not just prompt instructions — the model's output is
  never trusted at face value), WebAuthn registration/step-up both properly gate on
  `founder_admin` at the handler layer before the ceremony even starts.
- ⬜ Every DB model/access pattern (already well-documented in `docs/DATA_MODEL.md` from prior
  phases; not re-audited fresh this pass)
- ⬜ Loading/error/empty states beyond what was touched
- 🟡 Responsive/mobile testing: ran a real local dev server (`.claude/launch.json` added,
  `web-dev` config), drove it through the Browser tool across two sessions. Mobile viewport
  (375×812): zero horizontal overflow on homepage/pricing/candidate-profile (an app page, not just
  marketing). Found and fixed two rounds of real WCAG AA touch-target violations (under the
  24×24px minimum): first the fictional-data banner's "Dismiss" control (20px → fixed to 24px via
  `min-h-6`); then, discovered while testing the candidate nav, a **systemic** issue — every nav
  link across `SiteNav.tsx`, `CandidateNav.tsx`, `EmployerNav.tsx`, `AdminNav.tsx`, and
  `SiteFooter.tsx` used the identical unpadded `text-sm font-medium` class with zero vertical
  padding (~19px tall). Fixed consistently across all five files (`inline-block py-2`), verified
  by measurement after the fix (36px). Everything else measuring small was either comfortably
  above 24px or genuinely inline prose text (WCAG's explicit exemption) or a native checkbox
  (exempted — label click-area convention). Zero console errors (beyond benign dev-server HMR
  websocket noise, irrelevant to production's static export) across every page tested. Tablet
  (768×1024) checked this round on the role detail page (the most complex layout — Kit
  deliverables table + match cards) plus pricing and founder — zero overflow on any. NOT yet done:
  desktop-only layout checks (very wide viewports, ultra-wide tables).
- 🟡 Interactive testing (local-fake mode only, per the CORS constraint above): signed in as a
  seeded candidate (`amara.demo@example.com`) and a seeded employer (`hiring.demo@example.com`) by
  reading the fake sign-in code directly out of localStorage (`packages/local-adapters`'
  `LocalAuthAdapter` stores it at `AUTH#CODE#<email>`, TTL 10 min, single-use — a legitimate way to
  drive the demo flow without a real inbox). Went beyond just reading state this round: **actually
  submitted** the full "Add evidence" form (all 4 required text fields, visibility dropdown,
  consent checkbox) and confirmed the new item appeared correctly on the profile page; toggled
  "Opt into employer discovery" and confirmed the DOM state change; ran the full 3-step "New role"
  wizard to completion (track selection → title/seniority/outcomes/must-have-work → free-preview
  generation) and confirmed the preview correctly named the two must-have-work gaps I'd entered,
  with no fabricated content. Confirmed navigating to an employer-only URL while signed in as a
  candidate correctly redirects to employer sign-in (session/role separation genuinely enforced
  client-side too, not just server-side). Employer roles list, role detail (Kit deliverables + 5
  match cards with correct "no allowance" messaging), and billing page all still render correctly
  and are unaffected by this pass's edits — regression-checked again after the Kit-status and
  touch-target commits. Zero console errors throughout. Closed every remaining item this round:
  signed in as `founder.demo@example.com` and drove the admin console for real — expanded a
  candidate's moderation panel and **clicked "Remove" on an evidence item to completion**, filled
  the required reason field, confirmed, and verified both the item disappeared from the UI and a
  correctly-detailed entry appeared in the audit log (`remove_evidence · evidence <id>, by admin,
Reason: <what I typed>`) — the audit-logging isn't decorative, it's real. Clicked "Subscribe" on
  the Scout tier to completion (plan flipped to "Scout · active", "Cancel subscription" appeared).
  Clicked "Unlock contact" to completion on a real match card: confirm dialog opened with the
  correct copy, confirming it incremented the allowance counter from "0 / 5" to "1 / 5" and
  revealed the real candidate email inline (`Contact unlocked · chioma.demo@example.com`). Zero
  console errors throughout. NOT yet done: a full onboarding-to-first-role journey for a genuinely
  new (non-seeded) employer account (all testing so far reused seeded fixtures).
- 🟡 API reliability sweep (timeout/retry/idempotency/pagination): pagination swept fully across
  all 11 repository files — found and fixed one real, serious correctness bug (see the dedicated
  section above). Timeout/retry already spot-checked earlier (Bedrock's bounded retry + timeout,
  Kit checkout's idempotency-key handling, contact-unlock's atomic transaction) — all solid. NOT
  yet done: a systematic pass over every handler's error-response shape and status codes, or load/
  concurrency testing beyond what's structurally guaranteed by DynamoDB's conditional writes.
- 🟡 Cost projection: `docs/COST_MODEL.md`'s existing 0/10k/50k/100k-user projections (from Phase 5) were not re-derived this pass. Tried to get an actual current AWS spend number to sanity-check
  against — **Cost Explorer and the `AWS/Billing` CloudWatch metric are both unreachable from this
  sandbox environment** (unlike S3/Lambda/DynamoDB, which work via the path-style-addressing fix
  found in an earlier session), a genuine tooling limitation, not something to fake a number
  around. Did verify this pass's one new resource (`matches-get-contact` Lambda) adds no new
  CloudWatch alarm (`infrastructure/modules/api-route` only provisions a retention-capped log
  group per instantiation, not an alarm) — negligible cost impact, consistent with the existing
  model's "near-zero at this scale" characterization. A real current-spend check needs either the
  founder checking the AWS Console/Billing page directly, or a session where those endpoints are
  reachable.
- 🟡 Competitor research / market positioning (§13–15 of the directive): first real, sourced pass
  done via web search (see the dedicated section below) — confirms the current positioning is
  sound, found no evidence a direct combined competitor exists. NOT yet done: pricing-model deep
  dive, a formal competitor feature-matrix, or research into the MLOps track specifically (only
  DevOps/cloud and cloud-security were searched this pass).
- ⬜ Full candidate/employer/admin journey walkthroughs via actual browser interaction (partial —
  see above; not yet a complete first-signup-to-paid-outcome walkthrough for either role)

## Fix from this round (commit `333afe4`)

**FictionalDataBanner.tsx**: two issues, both fixed together. (1) The "Dismiss" control's WCAG AA
touch-target violation above. (2) Its real-mode copy was stale — it said "employer and admin views
still show fictional demo data," which stopped being true the moment this pass's `65fe219` commit
wired roles/matching/checkout to real mode. Updated to "Candidate and employer sign-in, roles, and
matching are real; admin views still show fictional demo data" — accurate as of this pass.
`npm run validate:all` green after the fix (full production build of all 33 routes included).

## Competitor / market research (directive §13–15, §35 — first real pass)

Real, sourced findings via web search, not fabricated. Full citations in the search results this
session — summarized here, not re-quoted verbatim beyond short fragments (copyright discipline).

**The pain is real, current, and specific to Zoryvex's exact tracks:**

- DevOps/cloud: "94% of companies are struggling to find qualified DevOps talent" in 2026, and
  AI-generated resumes/credentials are now flooding job boards, making every claim on a resume
  suspect by default (multiple sources, e.g. Apranova's "AI Killed the Resume" piece).
- Cloud-security/DevSecOps: one sourced quote is unusually precise and directly validates
  Zoryvex's premise — "Half the resumes that come back for a 'DevSecOps engineer' posting belong
  to people who have never merged a line of pipeline code. They have run scanners and exported
  findings into a ticket queue." Same source also names hiring _speed_ as a second, distinct pain:
  slow multi-round loops lose strong candidates to faster competitors — directly what the Kit's
  structured interview guide + decision scorecard is built to fix (a fast, repeatable process, not
  a slow ad-hoc one).

**Competitive landscape has a real, exploitable gap:**

- Incumbent technical-assessment platforms (HackerRank, CodeSignal, TestGorilla, Karat) are all
  built around _live coding tests/challenges_ — a different mechanism entirely from Zoryvex's
  _evidence of real past work_. All are generic across every engineering role (not narrowly
  cloud/DevOps/security-focused), and all require an **employer subscription commitment up front**
  (HackerRank ~$199/mo or $1,990/yr; TestGorilla ~$142/mo) before the employer has even used the
  product once for a real role. That's real adoption friction for a small/mid-size company hiring
  rarely for a single cloud role — exactly the customer Zoryvex's one-time, no-subscription-
  required Kit (NGN 29,000, works with zero marketplace candidates) is already built for.
- "Proof of work" portfolio platforms (Fueler.io, Polywork) are the closer philosophical match —
  but both are generic across _all_ professions (writers, designers, freelancers of every kind),
  candidate-side-monetized (Polywork ~$9/mo premium), and function as a browsable portfolio, not a
  structured, employer-usable evaluation toolkit with a rubric/interview guide/decision scorecard.

**What this confirms, not speculates:** Zoryvex's actual differentiation — narrow cloud/DevOps/
security scope + evidence-over-live-test + one-time no-subscription-required employer pricing +
free-forever candidates + a real usable interview/evaluation toolkit, not just a portfolio to
browse — does not have a direct combined competitor in what this search surfaced. This is a
high-confidence finding (multiple independent sources converge on the same pain points and the
same competitor gaps), not speculation, and doesn't ask for any product change — it validates the
positioning already fixed in CLAUDE.md's "Fixed product" section as sound, not something to alter.

**One low-confidence, speculative idea, flagged as such and NOT acted on**: the DevSecOps pain
quote above ("ran scanners and exported findings into a ticket queue") suggests a possible future
evidence-checklist refinement specific to that track — asking for evidence of _fixing_ a finding,
not just _reporting_ one. Speculative, not validated by more than one source, and a product-scope
change belongs to the founder's explicit decision per CLAUDE.md — noted here for their awareness,
not implemented.

### Commit `4ad9055` — real, previously-masked flaky test found and fixed (2026-08-26, post-push)

The founder asked to make sure everything is genuinely perfect before the next real CI run (the
one that finally exercises this whole audit pass, once the budget resets) — so rather than trust
the local `validate:all` pass alone, ran the full Playwright suite locally too, plus every check
CI's `Validate` job runs that `scripts/validate.mjs` was silently missing (bundle-budget assertion,
the `apps/web-safe-shell` build + its two assertions, `terraform fmt` across all of
`infrastructure/` at once, and `terraform validate` for `bootstrap` specifically — all now
confirmed clean, matching `.github/workflows/ci.yml` line for line).

The full local Playwright run then found 2 real failures. Investigated rather than re-running past
them: one turned out to pass reliably in isolation (parallel-run resource contention, not a defect
— reran clean afterward). The other — `employer-journey.spec.ts`'s "billing: an active subscription
can be viewed and canceled" — failed 100% of the time alone, then only 3/5 under `--workers=1`,
confirming genuine intermittent flakiness, not a one-off. Root-caused rather than accepted:
`playwright.config.ts` sets `retries: 1` in CI, which was silently absorbing this failure on every
CI run that hit it — nobody watching a green checkmark would ever have seen it.

Diagnosed via the failing test's own captured accessibility snapshot: the sign-in flow correctly
reached the code-entry step, but "Enter the 6-digit code sent to **[empty]**" rendered with an
empty `<strong>` where the email should be. Root cause, confirmed empirically (not guessed):
Playwright's `fill()` + immediate `click()` on a freshly navigated static-export page can outrun
Next.js client-side hydration — the pre-hydration native `input` event never reaches React's
listeners, `email` state stays `''`, and hydration then reconciles the controlled input back to
that empty state, silently discarding what was typed. Verified by adding a settle wait and
re-running: 5/5 clean, repeatably, versus ~40-60% failure before.

The exact same goto-then-immediately-fill shape existed at 17 sign-in call sites across all 7
spec files that drive a sign-in form (`admin-app`, `candidate-app`, `employer-app` accessibility
specs; `admin-journey`, `candidate-journey`, `console-errors`, `employer-journey` e2e specs). Most
don't assert on the echoed email, so this was mostly invisible there — the account created would
just silently be a different "blank-email" fresh signup instead of the intended fixture/email,
which happens to still pass most assertions since a blank-email fresh account behaves like any
other fresh account for everything except an assertion that checks the email itself. Fixed all 17
mechanically and identically (a script, not 17 manual edits, to guarantee they're all the same
fix): one `waitForLoadState('networkidle')` right after each sign-in-page `goto`, before the first
interaction. Test-only change — no production/app code touched, since the risk to real users is
low (real typing takes far longer than hydration) and this is exactly the kind of sign-in-flow
code that shouldn't be touched speculatively without a proven, specific reason.

Verified: full Playwright suite (both `desktop` and `mobile` projects, e2e + accessibility) run
completely clean afterward — 191 passed, 3 skipped (pre-existing, legitimate, unrelated to this
fix), 0 failed, run after run. `npm run format:check` and `npm run lint --max-warnings 0` both
clean across the whole repo after the fix.

### Deploy-readiness audit (2026-08-26, no code change — everything checked out clean)

Founder asked to confirm the _only_ thing remaining is the deploy itself once the budget resets in
~6 days. Checked everything about the Deploy job specifically that hadn't been exercised yet
(Validate and e2e were already fully dry-run locally in the `4ad9055`/`e8bd1c9` pass above):

- `npm run build:lambda` (the Deploy job's first real step) — clean, 40 Lambda zips built, no
  errors.
- Re-audited the three new routes this pass added (`kit-status`, `matches-get-contact`,
  `candidates-evidence-get`) for the exact defect class this session already found and fixed twice
  before (a Lambda IAM role missing a `dynamodb_index_arns` grant for a GSI it actually queries).
  Traced each handler's real dependency chain down to the actual DynamoDB command issued —
  `getKitOrderStatus` → `getKitOrderForRole` (base-table `QueryCommand`, no `IndexName`) +
  `getRole` (`GetCommand`); `getUnlockedContactInfo` → `getRole`/`getMatch`/`getCandidate` (all
  `GetCommand`); `getOwnEvidence` → `getEvidenceWithVersion` (`GetCommand`). None of the three ever
  queries a GSI, so the current grant (base table ARN only, no index ARNs) on all three is
  correct — not a repeat of the earlier bug, verified against actual code, not assumed.
- Confirmed each new route's Terraform module block exists in both `infrastructure/envs/test/main.tf`
  and `infrastructure/envs/production/main.tf` (mirrored, matching repo convention), and that each
  `*_deployment_package_path` variable's default resolves to the exact zip filename
  `build:lambda` actually produces.
- Confirmed via `gh api .../actions/variables` and `.../actions/secrets` that every GitHub
  Variable/Secret the Deploy job's `env:` block reads (`APP_ORIGIN`, `APEX_DOMAIN`,
  `DOMAIN_ALIASES`, `CLOUDFRONT_ACM_CERTIFICATE_ARN`, `API_CUSTOM_DOMAIN_NAME`,
  `API_REGIONAL_ACM_CERTIFICATE_ARN`, `SES_CONFIGURATION_SET_NAME`, `ALERT_EMAIL`) still exists by
  name (values not read, don't need to be).
- Honest limitation, not fixed: local AWS SSO credentials are expired (`aws sts get-caller-identity`
  fails with `NoCredentials`), so a local dry-run `terraform plan` against the real test environment
  wasn't possible. This does NOT block the real deploy — CI authenticates independently via its own
  OIDC role (`zoryvex-test-deploy`), never through any local session — so this is a lost extra
  reassurance step, not a real gap. Re-authenticating would need the founder's own browser login and
  wasn't requested, since it isn't actually necessary for the deploy to succeed.
- `git status` confirmed clean after all of the above (the `build:lambda` run's zips land in the
  gitignored `services/api/dist/`, no stray tracked-file changes).

No defect found this round — this is itself the answer to "make sure everything is perfect."
Everything checkable without live AWS access or a real CI run has now been checked.

## Next actions, in priority order (2026-08-31)

1. **One founder-authorized `aws ssm put-parameter`** setting `payments` and `contactUnlocks` true
   in TEST's feature-flag document. Terraform cannot do it (`ignore_changes = [value]`), and until
   it happens a Kit purchase in TEST is refused with "nothing has been charged". Exact command and
   reasoning in `docs/MANUAL_ACTIONS.md`; `npm run flags:check` shows the current difference.
2. **Merge PR #74 and let the pipeline deploy**, once Actions budget returns. If the merge lands
   while Actions is still gated, re-run that failed push run from the Actions tab or use the
   workflow's `Run workflow` button; both paths are in `docs/RUNBOOKS.md`'s deploy section.
3. **Re-verify live after that deploy.** A green CI run is "Deployed to TEST", never
   "Independently verified live". The two things the deploy itself fixes and that should be
   checked first: `WEBAUTHN_RP_ID` is currently `""` on four Lambdas, and `privacy-consent` gains
   the GSI1 grant a discovery opt-out needs.
4. Founder-admin remains unreachable in a real build: `SignInForm` routes `founder_admin` to the
   local fakes and the four deployed WebAuthn routes have no caller, so `/admin/exceptions` cannot
   be opened. New security-sensitive surface, deliberately not started. Tracked in
   `docs/RISK_REGISTER.md`.
5. Still-open items from earlier passes that remain real: a systematic sweep of every handler's
   error-response shapes; deeper competitor research (only DevOps/cloud and cloud-security were
   searched); logo integration once the founder supplies the asset; and the undecided question of
   whether to build real-mode e2e coverage, which needs either a live CI backend and credentials
   or a mocked-fetch project.

The prior list's first item, clicking Kit checkout through in local-fake mode, is done and is now
covered by `tests/e2e/employer-journey.spec.ts` on both desktop and mobile, including the failed-
payment path.

## Push-readiness status (as recorded 2026-08-26 — see the top of this file for current state)

**PUSHED (2026-08-26), LOCALLY AS AIRTIGHT AS THIS ENVIRONMENT CAN MAKE IT, STILL NOT
CI-VALIDATED OR LIVE-VERIFIED.** The founder explicitly authorized pushing despite the exhausted
Actions budget, then separately asked to make sure everything is genuinely perfect before the next
real CI run. Both are now true as of `4ad9055`, on `origin/main` (confirmed 0/0 divergence from
local HEAD after each push). This is still genuinely different from "push-ready" in the full sense
the 47-section directive asks for — that remains a multi-session scope this file should keep
tracking honestly, not round up.

What IS true as of `4ad9055`: every single check `.github/workflows/ci.yml`'s `Validate` job runs
has been run locally and is clean — not just `npm run validate:all` (which itself was missing
several real CI steps, now confirmed separately): format, lint (0 warnings), typecheck ×7
workspaces, 502/502 Vitest across 66 files, OpenAPI, secrets, Terraform policy check across 71
files, the real-mode-awareness check, 0 dependency vulnerabilities, the bundle-budget assertion,
full production build + static-export assertion for both `apps/web` (34 routes) and
`apps/web-safe-shell`, the safe-shell forbidden-content assertion, `terraform fmt` across all of
`infrastructure/`, and `terraform validate` for `bootstrap`, `test`, AND `production`. Beyond that:
the full Playwright suite (`desktop` + `mobile`, e2e + accessibility, everything the `e2e` CI job
runs) was also run completely locally — not previously done this pass — and found and fixed one
real, previously-silently-masked flaky test (see the `4ad9055` entry above), ending at 191/191
passed, 0 failed, repeatably. A full RBAC/security sweep of all 16 backend domain services and a
full pagination sweep of all 11 repository files are both genuinely complete for this pass, not
partial. Real interactive browser-testing — not just code review — covered candidate, employer,
and admin roles across two sessions, with every major action actually clicked through to
completion in local-fake mode. A permanent regression check (`real-mode:check`) now runs as part
of the local gate specifically to prevent the main bug class this pass found from ever silently
reappearing.

What's NOT yet true, and matters most: **CI has still never run for any of this** (confirmed after
the first push: 0 check-runs, no workflow run created for `bc62c3c`/`e53e85c`, consistent with the
exhausted budget) and **nothing in these commits has been verified against a live deployment**,
since nothing has deployed since `432d523`. Running CI's exact steps locally is strong evidence but
is not literally the same thing as CI (different OS, a fresh `npm ci` install, GitHub's own
runners) — and is absolutely not the same as a live-deployed check. When budget returns: the very
next commit's push (even a trivial one) will finally trigger the real pipeline (Validate +
Playwright + Deploy — this is a real infra+backend+frontend diff, not docs-only) for this exact
diff for the first time. Once that run is green, independently re-verify the contact-unlock,
Kit-status, admin-notice, pagination-affected, and evidence-edit flows live, per this session's own
established evidence taxonomy — a green CI run alone is still "Implemented"/"Deployed to TEST,"
never "Independently verified live," until each is actually checked against the real deployed
environment.
