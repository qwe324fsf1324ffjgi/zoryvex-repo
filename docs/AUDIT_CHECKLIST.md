# AUDIT_CHECKLIST.md

Working tracker for the full-product audit. This exists so any session (including a future
one resuming cold) can see exactly what has been checked, what was found, and what is left —
without re-deriving it or taking a previous session's word for it.

**How to use this file:** before starting a slice, read the "Next up" list at the bottom.
After finishing a slice, move it into the table with a real verdict. Never mark something
checked that was not actually opened and read. A verdict of "clean" means it was inspected
and genuinely needed no change — not that it was skipped.

## Verdict key

- **clean** — inspected, met the bar, no change needed
- **fixed** — a real defect was found and corrected (commit noted)
- **partial** — inspected, one or more items deliberately deferred (reason noted)

## Frontend pages (32 routes + 2 root handlers)

### Public marketing (13/13 complete)

| Page                      | Verdict | Note                                                          |
| ------------------------- | ------- | ------------------------------------------------------------- |
| `/`                       | clean   | Concrete headline, specific CTAs, cards used only where real  |
| `/for-talent`             | clean   | Claim/context/actions/outcome grid is real title+body pairing |
| `/for-employers`          | fixed   | `cfb5167` — 6 label-only cards → plain list                   |
| `/pricing`                | fixed   | `26cd6f6` badge repetition; `5404b85` tier value clarity      |
| `/how-verification-works` | clean   | Per-card badges genuinely differ (the 3 states)               |
| `/trust-safety`           | clean   | No cards; enumerable rules correctly a list                   |
| `/founder`                | clean   | Responsive image, explicit dims, neutral alt text             |
| `/contact`                | clean   | Honest external-link copy, correct `rel`                      |
| `/status`                 | clean   | Build-aware; makes no uptime claim                            |
| `/privacy`                | clean   | Specific, no boilerplate                                      |
| `/terms`                  | clean   | Specific, no boilerplate                                      |
| `/cookies`                | clean   | Branches real-mode vs demo honestly                           |
| `/accessibility`          | clean   | States what is actually tested                                |

### Auth (4/4 complete)

| Page                 | Verdict | Note                                                      |
| -------------------- | ------- | --------------------------------------------------------- |
| `/sign-in` (chooser) | clean   | Real 2-way fork; admin correctly omitted (not self-serve) |
| `/candidate/sign-in` | clean   | Shared `SignInForm`                                       |
| `/employer/sign-in`  | clean   | Shared `SignInForm`                                       |
| `/admin/sign-in`     | clean   | Shared `SignInForm`, admin stays local-fake by design     |
| `/auth/callback`     | clean   | Fragment cleared before any server sees it; per-mode copy |

### Candidate app (6/6 complete)

| Page                         | Verdict | Note                                                       |
| ---------------------------- | ------- | ---------------------------------------------------------- |
| `/candidate/onboarding`      | clean   | Proper load-fail + retry already present                   |
| `/candidate/profile`         | fixed   | `089063c` — evidence delete had NO confirmation            |
| `/candidate/profile/preview` | clean   | Honest discovery-status warning                            |
| `/candidate/evidence/new`    | clean   | Specific validation errors; honest real-mode upload gap    |
| `/candidate/evidence/edit`   | fixed   | Load-failure masking, no loading state, wrong 409 advice   |
| `/candidate/account`         | clean   | Delete already confirmed; export/delete honest about async |

### Employer app (6/6 complete)

| Page                      | Verdict | Note                                                           |
| ------------------------- | ------- | -------------------------------------------------------------- |
| `/employer` (roles list)  | fixed   | `27889e6` — failure showed "No roles yet" (a lie) + no loading |
| `/employer/role`          | fixed   | `70168e1` — failure showed "no access" (a lie) + no loading    |
| `/employer/roles/new`     | clean   | Real validation list; handles step-3-without-role              |
| `/employer/role/checkout` | clean   | Transparent about the local simulation                         |
| `/employer/billing`       | fixed   | `5404b85` — tiers didn't say what they buy                     |
| `/employer/onboarding`    | clean   | Real mode redirects rather than faking success                 |

### Admin (2/2 complete)

| Page                | Verdict | Note                                                        |
| ------------------- | ------- | ----------------------------------------------------------- |
| `/admin`            | clean   | Honest real-mode notice instead of fabricated stats         |
| `/admin/exceptions` | clean   | The reference implementation of the load/fail/empty pattern |

### Root handlers (2/2 complete)

| Handler         | Verdict | Note                                                                |
| --------------- | ------- | ------------------------------------------------------------------- |
| `not-found.tsx` | fixed   | Did not exist — users got Next's bare unstyled default, no way back |
| `error.tsx`     | fixed   | Did not exist — an uncaught render error left a blank page          |

## Cross-cutting passes

| Pass                              | Verdict | Note                                                                    |
| --------------------------------- | ------- | ----------------------------------------------------------------------- |
| AI-generated-feel sweep           | fixed   | `e0e7b13` — 5 em dashes in live copy; no gradients/icon-spam found      |
| Em-dash / cliché vocabulary       | clean   | Zero cliché terms; remaining em dashes are the `Item — price` exemption |
| Brand identity                    | fixed   | `e6ed4da` — wordmark component + first real favicon                     |
| Destructive-action confirmation   | fixed   | Audited all destructive paths; evidence-delete was the only gap         |
| Load / fail / empty state pattern | fixed   | 3 pages masked failures as empty/no-access; all now distinguish         |
| Border-radius / shadow / card use | clean   | 3 radius values, 1 shadow, cards on 18/32 pages (not universal)         |
| Generic button labels             | clean   | Zero "Learn More" / "Get Started" / "Explore" anywhere                  |
| Icon overuse                      | clean   | No icon library installed at all                                        |
| Route integrity                   | clean   | Every internal href resolves to a real page                             |

## Backend (`services/api`)

| Area                            | Verdict | Note                                                                                                                  |
| ------------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------- |
| Swallowed errors                | clean   | Every `catch` is deliberate and handled (Bedrock degrades, webhook/JSON raise `ValidationError`)                      |
| Contact-unlock atomicity        | clean   | Single `TransactWriteCommand`; two concurrent unlocks cannot both pass the allowance condition                        |
| Contact-unlock allowance period | fixed   | `ad7d3f8` — ledger had no period key, silently making a **monthly** allowance a **lifetime** cap                      |
| Contact-unlock 403 messaging    | fixed   | Client guessed two causes with "or", neither currently true; now shows the server's own specific reason               |
| Error-response safety           | clean   | Only `AppError` messages reach the client; unexpected errors return a generic string, internals go to CloudWatch only |
| Kit webhook → entitlement       | clean   | Verifies server-to-server before granting; never trusts the webhook body                                              |
| RBAC / IDOR (16 services)       | clean   | Swept earlier in session; ownership always server-derived                                                             |
| DynamoDB pagination             | fixed   | Swept earlier; 3 platform-scale queries were single-page                                                              |
| Session idle expiry             | fixed   | `5ccbdb9` — "idle" was never extended, making it a 30-min **absolute** cap                                            |
| Deletion worker retry path      | fixed   | `7ca4486` — audit write failing after profile delete left the deletion unrecorded                                     |
| Kit HTML escaping (XSS)         | clean   | Verified safe; coverage extended from 1 field to all 4, plus `&` double-escape                                        |
| Rate limiting                   | clean   | Atomic `ADD`, correct window bucketing, TTL written on first write only                                               |
| Content-Disposition header      | clean   | Built from a server-generated UUID gated by an ownership lookup                                                       |
| Filename sanitization           | clean   | Path-stripped, control chars removed; storage keys never derived from it                                              |
| Domain-layer test coverage      | clean   | All 17 domain services have a dedicated test file                                                                     |
| Malware scan gate               | clean   | Fail-closed by construction; unrecognised results reject, quarantine has a 1-day lifecycle                            |
| Evidence download authorization | clean   | Serves `accepted/` only, only when `scanStatus === clean`                                                             |
| Presigned upload conditions     | clean   | `content-length-range` + exact `Content-Type` enforced by S3, key server-chosen                                       |
| Paystack webhook                | clean   | Signature checked first via `timingSafeEqual`; independent verify before any grant                                    |
| Retry safety                    | clean   | `retryWithBackoff` wraps GETs only — no mutation is ever retried                                                      |

## Open finding: autosave version race (analysed, deliberately NOT fixed)

Real, reproducible by reasoning, low severity, self-recovering. Recorded rather than patched
because the fix touches data-persistence code that currently works, and a hasty change there
risks data loss — a worse outcome than the bug.

**What happens.** `useDebouncedAutosave` starts a save 800ms after typing stops, but nothing
prevents a second save starting while the first is still in flight. `saveFields` on the candidate
profile closes over `version` from React state, so if save #2 begins before save #1 resolves, it
sends the stale version and the server rejects it with a 409. The user sees "Something went wrong
saving your changes."

**Why it is not severe.** It needs a save slower than the 800ms debounce while the user keeps
typing. It self-recovers: save #1 eventually resolves, `setVersion` updates, and the next
keystroke saves cleanly. No data is lost — only the one rejected keystroke batch, which the next
save re-sends since it sends the whole field set.

**Why it is still worth fixing eventually.** The target market is Nigeria; sub-second API latency
is not a safe assumption, so this is not purely theoretical. And a spurious save-failure message
undermines trust in autosave precisely when the network is worst.

**The fix when someone does it.** Either serialise saves in the hook (do not schedule save N+1
until save N settles), or have `saveFields` read the current version from a ref rather than a
state closure. The ref approach is smaller; the serialising approach is more general. Either
needs a test that drives two overlapping saves and asserts no 409.

## Deploy scripts (`scripts/`)

The code CI itself runs, as opposed to the app it deploys. Never exercised end-to-end against a
real failure, which is why both findings below sat undetected.

| Area                            | Verdict | Note                                                                             |
| ------------------------------- | ------- | -------------------------------------------------------------------------------- |
| deploy → rollback recursion     | fixed   | `0f98e4a` — unbounded loop, a real `terraform apply` per cycle                   |
| Rollback masking the real error | fixed   | `0f98e4a` — rollback failure replaced the original deploy error                  |
| Empty-build site wipe           | fixed   | `0f98e4a` — an empty `out/` would delete every object in the bucket              |
| Production entry-point guard    | clean   | `deploy.mjs` refuses `--env production` under any flag                           |
| Destroy protection              | clean   | `hasDangerousDestroy` blocks stateful destroys without explicit approval         |
| Saved-plan discipline           | clean   | Applies the saved artifact, never a fresh plan                                   |
| AWS account pinning             | clean   | `assertExpectedAwsAccount` fails closed before backend resolution                |
| Production auto-rollback        | fixed   | `9843286` — dead path: rollback shells to deploy.mjs, which refuses production   |
| Rollback leaving a dirty tree   | fixed   | `9843286` — restore now in a `finally`; old code no longer left checked out      |
| Emergency kill switch           | fixed   | `6560058` — wrote 2 of 4 flags, deleting the rest (a recorded past incident)     |
| Rollback marker in CI           | fixed   | `0a3ff73` — marker lived in the build workspace, so CI rollback could never fire |
| `.terraform-plans/` not ignored | fixed   | `0a3ff73` — `git add -A` staged a deploy artifact into the repo                  |
| Webhook post-marker failure     | fixed   | `5816d1a` — a throw after the idempotency marker silently lost a paid order      |
| Evidence promotion race         | fixed   | `2d2ff25` — the loser deleted the winner's object; both keys are identical       |

## AI safety (services/api/src/domain/matching-service.ts, bedrock-explain-service.ts)

| Area                     | Verdict | Note                                                                                            |
| ------------------------ | ------- | ----------------------------------------------------------------------------------------------- |
| Prompt-injection defense | clean   | Allow-list filter drops any cited ID the model invents, independent of the prompt               |
| Model input minimization | clean   | Evidence excerpts only — no name, email, or contact field ever reaches the model                |
| Deterministic fallback   | clean   | Every failure path resolves to `null`; the deterministic rationale always serves                |
| `aiMatching` read gate   | fixed   | `c02a92f` — gated generation only; stored explanations kept serving after the kill switch fired |
| AI explanation grounding | fixed   | `c02a92f` — recompute carried it onto a changed evidence set; now dropped unless identical      |
| Throttling retry backoff | fixed   | `c02a92f` — retried a throttled Bedrock call with zero delay; now a 250ms pause                 |
| WebAuthn challenge TTL   | clean   | `consumeChallenge` checks expiry in code, not only via DynamoDB TTL                             |

- **The CI rollback needs one founder-approved apply.** `0a3ff73` moved the last-known-good
  marker to the SSM parameter `/zoryvex/<env>/last-good-commit` and widened the deploy role's
  `ssm:GetParameter` statement to cover it. The code is in; the IAM change is not live until
  someone applies it. Until then a CI rollback still exits with "nothing to roll back to",
  now for a reason that is one `terraform apply` away rather than structural.

## Verification (added 2026-08-27)

| Area                          | Verdict | Note                                                                               |
| ----------------------------- | ------- | ---------------------------------------------------------------------------------- |
| Nothing could set `verified`  | fixed   | The proof-first premise was unimplemented; every claim was a self-report           |
| Partial credit for unverified | fixed   | Unverified scored 0.4, so unchecked claims could outrank real proof                |
| Verification laundering       | fixed   | Editing a verified claim now resets it and clears the proof fields                 |
| SSRF via candidate URLs       | clean   | Only ids are parsed out; issuer URLs are rebuilt from constants                    |
| Rate limit read as rejection  | fixed   | `retryable` splits "could not check" from "did not pass"; not audited as a failure |
| Nonce TTL                     | clean   | Expiry checked in code, not only via DynamoDB TTL                                  |
| Card text contrast            | fixed   | `text-ink-500` on the card ground is 4.21:1, under AA; caught by the a11y suite    |
| Verify page a11y              | clean   | Both proof routes and the not-found state scanned, desktop and mobile              |

## Known gaps (deliberately not built — recorded, not hidden)

- **No real-mode allowance display.** Local-fake shows "x / y unlocks used this period"; real
  mode shows nothing, because no endpoint returns the employer's entitlement. Building one is a
  new route + handler + Terraform + tests, not a wire-up. The unlock error is now honest about
  the reason, which is the proportionate fix; a proactive display needs that endpoint first.
- **Subscriptions are not purchasable in real mode**, by deliberate product decision
  (`docs/COMMERCIAL_RUNBOOK.md`: no recurring push before 5 real opted-in matches). Consequence
  worth knowing: the only real-mode entitlement writer is the Kit webhook, which grants
  `plan: 'kit'`, and `CONTACT_UNLOCK_ALLOWANCE.kit === 0`. So contact-unlock cannot currently
  succeed in real mode at all. That is intended today, but it means the unlock path is untested
  end-to-end against real infrastructure and will need a real run once subscriptions open.
- **Local-fake unlock counter is all-time, not per-period** — a fake `Match` carries no unlock
  timestamp to filter on. Documented in `entitlements.ts`; demo-only, no real-money impact.

## Messy / hostile data

Tested by injecting deliberately hostile values rather than trusting the tidy demo fixtures.

| Case                                       | Verdict | Note                                                           |
| ------------------------------------------ | ------- | -------------------------------------------------------------- |
| 200-char unbroken role title               | fixed   | `6af6fff` — blew role detail out to 4038px in a 634px viewport |
| 200-char unbroken evidence claim / name    | fixed   | Same class; candidate profile hit 2951px                       |
| Long text in flex rows (roles list, admin) | fixed   | `break-words` alone was insufficient — flex `min-width: auto`  |
| Long text in the profile `1fr` grid        | fixed   | `1fr` is `minmax(auto, 1fr)`; track computed to 2934.75px      |
| Async correctness (type-checked lint)      | fixed   | Backend completely clean; one misused promise in the frontend  |

## Tooling gap worth knowing

The repo's ESLint config uses tseslint `recommended`, **not** `recommendedTypeChecked`, so
`no-floating-promises` / `no-misused-promises` / `await-thenable` never run in normal lint. A
one-off probe with those rules enabled found the backend completely clean and one real frontend
hit. Worth considering as a permanent CI step, but it needs `parserOptions.project` wired up and
would slow lint down, so it was not added unilaterally.

## Next up

1. Re-verify live against the deployed TEST environment — blocked until CI can actually run
   (see `ZORYVEX_BUILD_STATE.md` for why the red CI runs are a billing block, not a defect).
2. Optional: promote the type-checked lint probe into CI (see the tooling gap above).

## Standing rule

Nothing in this file counts as "verified live." Everything here is source-inspected plus
locally tested. Live verification requires a real deploy, which has not happened since
`432d523`.
