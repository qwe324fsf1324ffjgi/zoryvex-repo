# Data Model

Single DynamoDB table (`infrastructure/modules/data`, on-demand billing). Every access pattern below maps
to either the base table key or one of three GSIs — none require a table scan or a post-query filter over
unbounded data.

## Entities and keys

| Entity                                           | PK                           | SK                                     | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------------ | ---------------------------- | -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Candidate profile                                | `CANDIDATE#<candidateId>`    | `PROFILE`                              |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Candidate evidence item                          | `CANDIDATE#<candidateId>`    | `EVIDENCE#<evidenceId>`                | See [[docs/PRIVACY_AND_RETENTION]] for lifecycle                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Employer profile                                 | `EMPLOYER#<employerId>`      | `PROFILE`                              |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Employer entitlement                             | `EMPLOYER#<employerId>`      | `ENTITLEMENT`                          | Current plan/subscription state, see [[docs/PAYMENTS]]                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Founding-place ledger (platform-wide)            | `PLATFORM`                   | `FOUNDING_PLACES`                      | One item, atomic `ADD count` with `ConditionExpression count < :cap`, plus a `holders` string set so a replayed webhook or a returning member cannot spend a second place. There are exactly 25 places (`FOUNDING_SLOTS_TOTAL`) and they decide which of two founder-fixed price sets an organization pays for the life of its subscription, so this must never be derived by counting entitlements — a scan would be both forbidden and racy                                                                                                                               |
| Role (saved by an employer)                      | `ROLE#<roleId>`              | `PROFILE`                              |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Role match (candidate matched to a role)         | `ROLE#<roleId>`              | `MATCH#<candidateId>`                  | Existence of this item is the unit the "5 real matches" gate counts                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Webhook dedupe record                            | `WEBHOOK#<paystackEventId>`  | `EVENT`                                | Conditional put (`attribute_not_exists(PK)`) enforces idempotency                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Account (auth identity)                          | `ACCOUNT#<email-lowercased>` | `PROFILE`                              | Auth identity, distinct from a Candidate/Employer domain profile — see [[docs/adr/0001-no-cognito-passwordless-email-auth]]                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Magic-link auth token                            | `AUTHTOKEN#<tokenHash>`      | `AUTHTOKEN`                            | HMAC-keyed hash of a 256-bit token, 10-minute TTL, consume-once via conditional update                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Session                                          | `SESSION#<sessionIdHash>`    | `SESSION`                              | HMAC-keyed hash of the opaque session id — implemented in Phase 7, see below                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Session index (per-account)                      | `ACCOUNT#<email-lowercased>` | `SESSION#<sessionIdHash>`              | Adjacency item enabling "list/revoke all sessions for this account" without a scan                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Auth rate-limit counter                          | `RATELIMIT#<kind>#<key>`     | `WINDOW#<windowStartEpoch>`            | Atomic `ADD` counter, short TTL — bounds per-email/per-IP magic-link request abuse                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Founder WebAuthn credential                      | `ACCOUNT#<email-lowercased>` | `WEBAUTHNCRED#<credentialId>`          | Public key + counter only, pre-provisioned founder_admin accounts only                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| WebAuthn ceremony challenge                      | `ACCOUNT#<email-lowercased>` | `WEBAUTHNCHALLENGE`                    | Short-lived (5 min TTL), single-use, deleted on successful verification                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Proof Hiring Kit order                           | `ROLE#<roleId>`              | `KITORDER#<kitOrderId>`                | A role has few order attempts (retries/failures); `getKitOrderForRole` queries and takes the `succeeded` one — see below                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Audit event                                      | `AUDIT#<auditEventId>`       | `AUDIT`                                | Individually addressable by ID; listed via GSI3 (below), never scanned                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Evidence file (upload lifecycle)                 | `CANDIDATE#<candidateId>`    | `EVIDENCEFILE#<fileId>`                | Decoupled from the Evidence claim item — `Evidence.fileId` (already optional in the schema) points here once `scanStatus = clean`                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Kit artifact (generated HTML, versioned)         | `ROLE#<roleId>`              | `KITARTIFACT#<version>`                | Zero-padded version in the SK for sort order; conditional create (`attribute_not_exists`) makes every version immutable by construction — see below                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Graded attempt (one submission, one item)        | `CANDIDATE#<candidateId>`    | `GRADEDATTEMPT#<evidenceId>#<at>#<id>` | The timestamp is inside the sort key so a `Query` returns attempts in the order they happened. The attempt _number_ is deliberately not stored — it is derived from that order on read, so two submissions landing together cannot both claim to be attempt 3. Bounded at five per evidence item by `MAX_VERIFICATION_ATTEMPTS_PER_EVIDENCE`, so the query needs no pagination. **The submission itself is never written**: it is the candidate's work, it can contain anything they pasted into it, and which rubric checks failed is the whole signal without the payload |
| Contact-unlock ledger (per employer, per period) | `EMPLOYER#<employerId>`      | `CONTACTUNLOCK_LEDGER#<YYYY-MM>`       | Atomic `ADD` counter, conditioned in the same transaction as the match flip — see "Privacy and contact-unlock domain" below. The period suffix is what makes the allowance genuinely monthly: each calendar month is a separate item that starts at zero, so no reset job exists or is needed                                                                                                                                                                                                                                                                               |

Every user-editable record (candidate profile, role, evidence item) additionally carries an internal
`version` attribute, incremented on each successful update — **not** part of the `packages/contracts` domain
schema (it is a persistence-layer optimistic-concurrency detail, stripped before the item is returned to any
caller), so local-adapters/apps/web never need to know about it. Updates pass the version they last read;
`infrastructure`-scoped repository functions issue a `ConditionExpression` requiring an exact match and throw
a `ConflictError` (409) otherwise, never a silent overwrite.

## Global secondary indexes

- **GSI1 — discovery by launch track, and a candidate's own matches**: `GSI1PK = TRACK#<launchTrack>`,
  `GSI1SK = CANDIDATE#<candidateId>` on a candidate profile item **only while that candidate is opted into
  discovery** for that track — written on opt-in, deleted on opt-out, so a discovery query is always a plain
  `Query`, never a scan-and-filter, and a candidate who never opted in cannot appear in results by
  construction. Also reused (different `GSI1PK` prefix) by **Role match** items:
  `GSI1PK = CANDIDATE#<candidateId>`, `GSI1SK = MATCH#<roleId>`, giving "list the roles I've been matched
  to" a plain `Query` without needing a separate index.
- **GSI2 — Paystack customer lookup, and employer-owned-item listing**: `GSI2PK = PAYSTACKCUSTOMER#<paystackCustomerCode>`,
  `GSI2SK = EMPLOYER#<employerId>` on the employer profile item once a Paystack customer exists, letting a
  webhook handler resolve "which employer does this event belong to" without scanning employers. The same
  index is reused (different `GSI2PK` prefix, so no collision — the established single-table pattern this
  document already uses for GSI3) by **Role** items (`GSI2PK = EMPLOYER#<employerId>`,
  `GSI2SK = ROLE#<roleId>`) and **Kit order** items (`GSI2PK = EMPLOYER#<employerId>`,
  `GSI2SK = KITORDER#<kitOrderId>`), giving "list this employer's roles/Kit orders" a plain `Query`.
- **GSI3 — admin entity enumeration, and audit-event listing**: `GSI3PK = ENTITY#<CANDIDATE|EMPLOYER>`,
  `GSI3SK = <entityId>` set on a candidate/employer profile item when it is first created, removed when a
  candidate deletes their account — the founder/admin console's "all candidates" / "all employers" views.
  Also reused by **Audit event** items (`GSI3PK = AUDITEVENT`, `GSI3SK = <createdAt>#<auditEventId>`,
  sortable by time), for the founder exception-queue's "list recent audit events" — thematically the same
  "admin enumeration" purpose as the rest of this index.

## Session item (implemented, Phase 7)

`SESSION#<sessionIdHash>` / `SK=SESSION` holds only an HMAC-keyed hash of the opaque session identifier
issued after magic-link exchange, never the raw value — see
`docs/adr/0001-no-cognito-passwordless-email-auth.md`. Phase 5 provisioned the infrastructure this depends
on (`infrastructure/modules/auth`'s REQUEST authorizer Lambda, scoped to `dynamodb:GetItem` on this table
and nothing else) ahead of the application code; Phase 7 is what actually writes/reads this item, the same
infra-before-app-code sequencing already used for `GET /health` in Phase 3. `idleExpiresAt`/
`absoluteExpiresAt` are checked in application code on every read — the item's `ttl` attribute is
cleanup-only, per ADR 0001 ("DynamoDB TTL is cleanup-only; a read path must independently reject an expired
record even before TTL deletion runs").

## Founder/admin auth

The `founder_admin` account role (`docs/THREAT_MODEL.md`'s "Founder/admin account takeover" row) is
pre-provisioned only — there is no self-serve sign-up path for it, unlike `candidate`/`employer_member`/
`employer_admin`. An unrecognized email presented at the admin sign-in step is rejected the same way an
incorrect code is, so it cannot be used to enumerate which email is the admin account. `founder_admin`
actions additionally require a WebAuthn/passkey step-up (ADR 0001) verified against the
`WEBAUTHNCRED#<credentialId>` item(s) on that account — registered once, out of band, never via self-serve
sign-up either.

**Step-up state — implemented in Phase 7 slice 7; live ceremony acceptance still unconfirmed.** "Completed"
below means the code path exists and is wired end to end, _not_ that a real step-up has ever been performed
against the TEST environment. As of 2026-08-23 the TEST table contains **zero `WEBAUTHNCRED#` items and zero
`WEBAUTHNCHALLENGE` items**, so no founder credential appears ever to have been provisioned and no ceremony
has ever run for real. Treat the WebAuthn step-up as _Implemented_, not as a passed acceptance gate, until a
credential is registered and a step-up is exercised live. The implementation itself: slice 1 built the
WebAuthn ceremony
(`handlers/auth/webauthn-step-up-verify.ts`) but never persisted its result anywhere a later request could
check — a real gap, surfaced now that a real sensitive admin action (`GET /admin/exceptions`, below) exists to
guard. A successful step-up now writes `stepUpVerifiedAt` onto the caller's own `SESSION#<sessionIdHash>`
item (`markSessionSteppedUp`, a plain conditional `UpdateItem` on the same key access pattern #16 already
reads); the authorizer includes it in the request context only when present; `requireFounderStepUp`
(`src/http/session-context.ts`) requires both `role = founder_admin` **and** a `stepUpVerifiedAt` within the
last 15 minutes — an aged-out or absent step-up is rejected identically, so privilege can never quietly
outlive a single ceremony for the rest of the 12-hour session.

## Operations and automation domain (Phase 7 slice 7)

`GET /admin/exceptions` (`src/domain/admin-service.ts`'s `getExceptionQueue`) is the founder's "exception
queue" (CLAUDE.md: "an exception queue, not a daily ops dashboard — never promise zero moderation/legal
work") — the most recent `AuditEvent`s (access pattern #27, built in slice 2 with exactly this endpoint
already named in its comment), not a curated allow-list of "exception" action types: every audit event this
codebase appends (`evidence_file_rejected`, `candidate_deleted`, `contact_unlock`, `kit_order_succeeded`,
`discovery_opt_in`/`_out`, `contact_unlock_consent_given`/`_revoked`, and now `paystack_dispute_event` below)
is already something a human is meant to be able to explain, so the honest minimal version of this feature is
to surface all of them, newest first, bounded — not a stub that only shows a hand-picked subset.

Mandatory operational alerts (CLAUDE.md/Prompt 7), by mechanism:

- **Security** (auth-denied spike), **spend anomaly** (AWS Budgets/Cost Anomaly Detection, Phase 1, outside
  Terraform), **webhook/DLQ backlog**, **deletion failure**: already wired in Phases 5-7 — see
  `infrastructure/modules/observability`'s `auth_failures_spike` alarm and every `infrastructure/modules/
messaging` queue's own `dlq_not_empty`/`oldest_message_age` alarms (the deletion queue's is the "deletion
  failure" alarm; there is no separate resource for it, same reasoning as `docs/DATA_MODEL.md`'s privacy
  section already states).
- **Complaint/bounce**: `infrastructure/modules/observability`'s `ses_bounce_rate`/`ses_complaint_rate`
  alarms, Phase 5.
- **Domain/cert problem** (new this slice): an `aws_cloudwatch_event_rule` on ACM's own `"ACM Certificate
Approaching Expiration"` event (`source: aws.acm`, verified live against AWS's EventBridge-ACM reference,
  2026-08-19 — see `docs/DECISIONS.md`) targets the environment's existing alerts SNS topic directly, no new
  Lambda. `infrastructure/modules/observability` gained an `allow_eventbridge_rule_arns` optional grant
  (same shape as `infrastructure/modules/messaging`'s identical variable) so only this one named rule may
  publish, not a blanket account-wide grant.
- **Dispute** (new this slice): `handlers/webhooks/paystack.ts` recognizes `charge.dispute.create`/`.remind`/
  `.resolve` (verified live against Paystack's docs) before the existing `charge.success`/`charge.failed`
  branch, appends a `paystack_dispute_event` AuditEvent, and publishes to the same alerts topic
  (`src/repositories/sns-repository.ts`, `sns:Publish` scoped to exactly that topic ARN via a new
  `sns_publish_arns` `api-route` module grant) — never touches KitOrder/entitlement state; a dispute is
  reviewed by a human in the Paystack dashboard, never auto-resolved by this codebase.
- **Data incident**: intentionally not automated (CLAUDE.md/Prompt 7: "a documented founder-triggered path,
  not automated") — see `docs/RUNBOOKS.md`'s "Data incident" entry.

**Scheduled health-check job** (test-only, new this slice): an `aws_scheduler_schedule` (EventBridge
Scheduler) invokes the existing `health` Lambda directly every 5 minutes — no new application code, since
`infrastructure/modules/observability`'s existing `lambda_errors["api"]` alarm already covers that same
function. Deliberately not mirrored into production: Prompt 7 is explicit that "production enables only
signed-launch-mode jobs," and no launch mode has been selected (`.zoryvex/state.json`).

Onboarding, Kit fulfillment, verification-state updates, and entitlement changes are not new automation this
slice — they were already proven synchronously (webhook-driven or handler-driven) in slices 1-6 with
synthetic test identities; this slice's job is the operational alerting/exception-visibility layer around
them, not a reimplementation.

## Access patterns (auth, Phase 7)

| #   | Pattern                                           | Satisfied by                                                                                                                                            |
| --- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 12  | Look up an account by email at sign-in            | `GetItem(PK=ACCOUNT#<email>, SK=PROFILE)`                                                                                                               |
| 13  | Create a magic-link token                         | `PutItem(PK=AUTHTOKEN#<hash>, SK=AUTHTOKEN)` (unconditional create — hash collision on 256 bits of randomness is not a realistic race to guard against) |
| 14  | Consume a magic-link token exactly once           | Conditional `UpdateItem(PK=AUTHTOKEN#<hash>, SK=AUTHTOKEN)` — `attribute_exists(PK) AND consumed = :false`                                              |
| 15  | Create a session (+ its per-account index entry)  | `TransactWriteItems`: `PutItem(SESSION#<hash>/SESSION)` + `PutItem(ACCOUNT#<email>/SESSION#<hash>)`                                                     |
| 16  | Read a session (authorizer, every request)        | `GetItem(PK=SESSION#<hash>, SK=SESSION)`                                                                                                                |
| 17  | Sign out (current session) / revoke all           | `DeleteItem` the one session item, or `Query(PK=ACCOUNT#<email>, SK begins_with SESSION#)` then delete each                                             |
| 18  | Bounded per-email/per-IP magic-link abuse control | `UpdateItem ADD count` on `PK=RATELIMIT#<kind>#<key>, SK=WINDOW#<windowStartEpoch>`, short TTL                                                          |
| 19  | Founder WebAuthn credential lookup at step-up     | `Query(PK=ACCOUNT#<email>, SK begins_with WEBAUTHNCRED#)`                                                                                               |
| 20  | WebAuthn ceremony challenge issue/consume         | `PutItem` / conditional `DeleteItem` on `PK=ACCOUNT#<email>, SK=WEBAUTHNCHALLENGE`                                                                      |

## Access patterns

| #   | Pattern                                                       | Satisfied by                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| --- | ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Get a candidate's profile                                     | `GetItem(PK=CANDIDATE#<id>, SK=PROFILE)`                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 2   | List a candidate's evidence items                             | `Query(PK=CANDIDATE#<id>, SK begins_with EVIDENCE#)`                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 3   | Get an employer's profile                                     | `GetItem(PK=EMPLOYER#<id>, SK=PROFILE)`                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 4   | Get an employer's current entitlement                         | `GetItem(PK=EMPLOYER#<id>, SK=ENTITLEMENT)`                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 4b  | Read/claim a founding place                                   | `GetItem(PK=PLATFORM, SK=FOUNDING_PLACES)` to price a checkout; conditional `UpdateItem ADD count :1 ADD holders :employerId` with `ConditionExpression not contains(holders, :employerId)` to claim one. A place belongs to the organization once claimed and is not released on cancellation, so a returning member is still quoted the founding price                                                                                                                                           |
| 5   | Get a role                                                    | `GetItem(PK=ROLE#<id>, SK=PROFILE)`                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 6   | Count/list real matches for a role (marketplace-gate check)   | `Query(PK=ROLE#<id>, SK begins_with MATCH#)`                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 7   | List discovery-opted candidates for a launch track            | `Query(GSI1, GSI1PK=TRACK#<track>)`, fully paginated via `queryAllPages` (added 2026-08-26 — the one access pattern here whose result size scales with platform-wide adoption rather than one owner's own items, so a single unpaginated page would have silently dropped real candidates from real matching past DynamoDB's ~1MB per-query cap; see `dynamo-client.ts`'s own comment)                                                                                                             |
| 8   | Resolve the employer behind a Paystack webhook event          | `Query(GSI2, GSI2PK=PAYSTACKCUSTOMER#<code>)`                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 9   | Idempotent webhook processing                                 | Conditional `PutItem(PK=WEBHOOK#<eventId>, SK=EVENT)` with `attribute_not_exists(PK)`                                                                                                                                                                                                                                                                                                                                                                                                              |
| 10  | Admin: list every candidate                                   | `Query(GSI3, GSI3PK=ENTITY#CANDIDATE)`, fully paginated via `queryAllPages` — same reasoning as #7                                                                                                                                                                                                                                                                                                                                                                                                 |
| 11  | Admin: list every employer                                    | `Query(GSI3, GSI3PK=ENTITY#EMPLOYER)`, fully paginated via `queryAllPages` — same reasoning as #7                                                                                                                                                                                                                                                                                                                                                                                                  |
| 21  | List an employer's saved roles                                | `Query(GSI2, GSI2PK=EMPLOYER#<employerId>, SK begins_with ROLE#)`                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 22  | List an employer's Kit orders (any status)                    | `Query(GSI2, GSI2PK=EMPLOYER#<employerId>, SK begins_with KITORDER#)`                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 23  | Get the (at most one) succeeded Kit order for a role          | `Query(PK=ROLE#<id>, SK begins_with KITORDER#)`, filtered client-side to `status = succeeded` — bounded result set (a handful of attempts per role at most), not the unbounded-scan case the no-scan rule guards against. As of 2026-08-26, also exposed directly via `GET /roles/{roleId}/kit-status` (`getKitOrderStatus`) — previously only used internally by other Kit domain functions; the real-mode roles list and role detail page had no way to show purchase status at all before this. |
| 24  | List the roles a candidate has been matched to                | `Query(GSI1, GSI1PK=CANDIDATE#<candidateId>, SK begins_with MATCH#)`                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 25  | Get a specific match                                          | `GetItem(PK=ROLE#<roleId>, SK=MATCH#<candidateId>)`                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 26  | Append an audit event                                         | `PutItem(PK=AUDIT#<id>, SK=AUDIT)`, unconditional (server-generated ID, append-only)                                                                                                                                                                                                                                                                                                                                                                                                               |
| 27  | Admin: list recent audit events                               | `Query(GSI3, GSI3PK=AUDITEVENT)`, newest-first via `ScanIndexForward=false`                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 28  | Create a pending evidence-file record                         | `PutItem(PK=CANDIDATE#<id>, SK=EVIDENCEFILE#<fileId>)`, unconditional (server-generated fileId)                                                                                                                                                                                                                                                                                                                                                                                                    |
| 29  | Get an evidence-file record (worker + download authorization) | `GetItem(PK=CANDIDATE#<id>, SK=EVIDENCEFILE#<fileId>)` — `fileId`/`candidateId` are parsed directly from the S3 object key (`quarantine/<candidateId>/<fileId>`), no reverse lookup index needed                                                                                                                                                                                                                                                                                                   |
| 30  | Mark an evidence file clean/rejected exactly once             | Conditional `UpdateItem` — `attribute_exists(PK) AND scanStatus = :pending`, idempotent against SQS at-least-once redelivery of the same GuardDuty scan-result event                                                                                                                                                                                                                                                                                                                               |
| 31  | Create a new (immutable) Kit artifact version                 | Conditional `PutItem(PK=ROLE#<id>, SK=KITARTIFACT#<version>)` — `attribute_not_exists(PK)`; there is no update path for an existing version, only ever a new higher-numbered one                                                                                                                                                                                                                                                                                                                   |
| 32  | Get the latest Kit artifact for a role                        | `Query(PK=ROLE#<id>, SK begins_with KITARTIFACT#, ScanIndexForward=false, Limit=1)`                                                                                                                                                                                                                                                                                                                                                                                                                |
| 33  | Atomically unlock a candidate's contact info for a match      | `TransactWriteItems`: conditional `UpdateItem` on `PK=ROLE#<id>, SK=MATCH#<candidateId>` (`contactUnlocked = :false → :true`) **and** conditional `UpdateItem ADD count` on `PK=EMPLOYER#<id>, SK=CONTACTUNLOCK_LEDGER#<YYYY-MM>` (`count < :allowance`) in one transaction — see below                                                                                                                                                                                                            |
| 34  | Delete every DynamoDB item a candidate's data touches         | Sequential deletes driven by already-indexed queries (#2, #29, #24) — evidence items, evidence-file records, matches, the Account item, the Candidate profile — never a scan                                                                                                                                                                                                                                                                                                                       |
| 35  | Store a role's freshly recomputed deterministic match score   | Unconditional `PutItem(PK=ROLE#<id>, SK=MATCH#<candidateId>)` — recompute always overwrites the system-generated fields (`matchScore`/`rationale`/`matchedEvidenceIds`/`scoringVersion`); human-set fields (`status`/`contactUnlocked`) are read first via #25 and copied forward, never reset — see below                                                                                                                                                                                         |

## Session read + basic entity CRUD (Phase 7 slice 8, part 1)

No new access patterns, no repository changes — every handler below calls a repository function
slice 2 (`services/api/src/repositories/{role,candidate,evidence}-repository.ts`) already built and
tested, exposed over HTTP for the first time. This is a newly-discovered gap, not a planned slice
(`docs/DECISIONS.md`): none of slices 1-7 ever exposed "who am I," "create/edit a role," or "create/edit an
evidence claim" over HTTP, even though matching (slice 6), the Kit (slice 4), and evidence files (slice 3) all
operate on Role/Evidence records that — until this slice — could only be created through a local-adapter
fixture or a Vitest fake, never for real.

- `GET /auth/session` — pure passthrough of the authorizer context (`requireSessionContext`), no repository
  call. A browser's httpOnly session cookie (ADR 0001) is invisible to its own JS by design, so this is the
  one real round trip "am I signed in, and as whom" has.
- `POST /roles`, `GET /roles/{roleId}`, `GET /roles`, `PATCH /roles/{roleId}` — access patterns #5 and #21,
  now writable. `src/domain/role-service.ts`'s ownership check (`role.employerId !== session.employerId` →
  `NotFoundError`, identical for "not found" and "not yours") is the only logic beyond the repository call.
- `GET /candidates/me`, `PATCH /candidates/me` — access pattern #1, now writable for a candidate's own
  record. `src/domain/candidate-profile-service.ts` deliberately excludes `discoveryOptIn`/
  `contactUnlockConsent` from its patch — those stay owned exclusively by the audited
  `PATCH /candidates/me/consent` (slice 5), never a second unaudited path to the same fields.
- `POST /candidates/me/evidence`, `GET /candidates/me/evidence`, `PATCH .../{evidenceId}`,
  `DELETE .../{evidenceId}` — access pattern #2, now writable for the _text claim_ (distinct from the
  file-upload pipeline, slice 3). `verificationState` is never client-settable —
  `src/domain/evidence-claim-service.ts` hardcodes every self-submitted claim to `unverified`;
  self-verification would defeat the proof-first premise (CLAUDE.md "Fixed product"). `GET .../{evidenceId}`
  (`getOwnEvidence`, added 2026-08-26) is the single-item counterpart the PATCH route always needed but
  never had — the list route never carried the item's optimistic-concurrency `version` (deliberately
  stripped from the general `Evidence` contract), so no client could actually call PATCH once it had left
  the page an item was created on. Same base-table `GetItem` as the delete route's own lookup, no new
  access pattern.

## Matching baseline + gated Bedrock explain domain (Phase 7 slice 6)

`services/api/src/domain/matching-service.ts`'s `scoreCandidateAgainstRole` is a pure, deterministic function:
keyword overlap between each of a Role's `mustHaveWork` entries and a candidate's non-private Evidence text,
weighted by `verificationState` (explicit weights — `verified=1`, `self_attested=0.7`, `unverified=0.4`, see
`MATCHING_BASELINE_VERSION` for the versioning Prompt 7 asks for). `POST /roles/{roleId}/matches/recompute`
(`recomputeMatchesForRole`) runs it for every candidate currently opted into discovery for the role's launch
track (access pattern #7) and stores the result via #35 — **preserving** any existing match's `status`,
`contactUnlocked`, `id`, `createdAt`, and `aiExplanation` across recompute (read first via #25), so a later
recompute can never silently undo an employer's review progress or a paid contact unlock. A candidate who has
since opted out of discovery is simply skipped, not deleted (same retention posture as KitOrder/AuditEvent).
`GET /roles/{roleId}/matches` (`getMatchesForRole`) is a plain ownership-checked read via #6.

`POST /roles/{roleId}/matches/{candidateId}/explain` (`src/domain/bedrock-explain-service.ts`) is the one
Bedrock-touching path in this codebase, and only runs at all when `packages/config`'s `aiMatching` flag
(`/zoryvex/<env>/feature-flags` SSM parameter, plain String — nothing in it is a secret) is `true`. It is
`false` in source control and, as of **2026-08-23**, `false` again in live TEST, so every real call returns
`{available: false, reason: "ai_matching_disabled"}`. **Drift correction, recorded rather than glossed:** the
live TEST parameter actually held `aiMatching: true` from 2026-08-18 until 2026-08-23, when one authorized
`put-parameter` restored the complete four-key document to all-`false` (`docs/DECISIONS.md`, 2026-08-23).
The path was never invoked during that window — the explain Lambda's log group holds 0 bytes and 0 log
streams — so no model call, spend, or AI output resulted. Production has never had this parameter at all.
When enabled, it sends **only** the role's
outcomes/must-have text and the already-authorized (non-private, already-cited-by-the-deterministic-baseline)
Evidence excerpts — never a candidate's name, email, or any other identity field (`docs/AI_SAFETY.md`
prohibited inputs) — to Amazon Nova Micro via its `eu.*` cross-Region inference profile
(`docs/DECISIONS.md`: verified lowest-cost accessible on-demand model, 2026-08-19). The model is instructed to
cite only a given evidence-ID allow-list and to treat all role/evidence text as untrusted data, never as
instructions; the real enforcement is mechanical, not just prompted — `citedEvidenceIds` returned by the model
are filtered to that allow-list in code, and a response citing nothing on the list is treated as ungrounded
and discarded (falls back to "unavailable", never a fabricated citation reaching a human reviewer). A
malformed/invalid/timed-out/throttled (after one bounded retry) response also falls back to "unavailable" —
the deterministic `rationale` is untouched either way, so hiring/visibility never depend on the model being
up. A successful explanation is persisted onto the Match's `aiExplanation` field via #35 — a suggestion
layered on top of the deterministic rationale, never the only copy of a fact.

## Privacy and contact-unlock domain (Phase 7 slice 5)

`PATCH /candidates/me/consent` (`src/domain/privacy-service.ts`) updates `discoveryOptIn` (structural, GSI1
— unchanged from earlier phases) and `contactUnlockConsent` (a new, `.optional()` `Candidate` field so
existing local-adapters fixtures keep compiling) — explicit, reversible, and **versioned** in the sense
Prompt 7 means it: every actual change appends an immutable `AuditEvent`
(`discovery_opt_in`/`discovery_opt_out`/`contact_unlock_consent_given`/`contact_unlock_consent_revoked`), so
the full history is always reconstructable, not just the current state. `contactUnlockConsent` defaults to
"not consented" whenever absent — never assumed.

`POST /roles/{roleId}/matches/{candidateId}/unlock-contact` (`src/domain/contact-unlock-service.ts`) is
always a server-side transaction, never client-asserted (Prompt 7): it checks role ownership, that the
candidate has explicitly consented, and that the employer's plan has a nonzero
`CONTACT_UNLOCK_ALLOWANCE[plan]` (`packages/contracts`, shared with `apps/web`'s local-adapter-driven UI so
neither can silently drift), then calls `match-repository.ts`'s `unlockContactAtomic` — access pattern #33
above. Both conditions are evaluated by DynamoDB against each item's pre-transaction value inside one
`TransactWriteItems` call, so two concurrent unlock requests against a near-exhausted allowance can never
both succeed (the naive "read the count, then write" approach the Phase 4 local fake uses is fine
single-threaded in a browser tab, but would race under real concurrent server traffic — this is why the real
implementation needed the atomic ledger Prompt 7 asks for, not just a derived count).

`GET /roles/{roleId}/matches/{candidateId}/contact` (`getUnlockedContactInfo`, same file — added
2026-08-26 in a product audit that found `unlockContact` above had no counterpart route that ever
actually returned the candidate's contact details afterward) is the read-only other half: strictly
gated on `match.contactUnlocked === true` already being set by a prior successful unlock, using the
identical role-ownership `GetItem` this file's `unlockContact` entry already performs — no new
access pattern, no new index, just the missing read.

`POST /candidates/me/delete` (`src/domain/deletion-service.ts`, via a new `deletion` SQS queue +
`privacy-deletion-worker` Lambda) is deliberately asynchronous — the request handler only enqueues and
returns `202`. The worker deletes, in order: every Evidence claim item, every EvidenceFile's `quarantine/`
and `accepted/` S3 objects plus its DynamoDB record, every Match the candidate appeared in (a "derived AI
artifact"), all sessions, the Account item, and finally the Candidate profile itself — then appends one
`candidate_deleted` AuditEvent. Idempotent against SQS at-least-once delivery (a candidate already deleted is
a silent no-op). A thrown error at any step lets SQS redeliver and eventually move the message to the
`deletion` queue's own DLQ, which already alarms to the founder's SNS topic
(`infrastructure/modules/messaging`) — this **is** the "deletion-failure alarm" Prompt 7 asks for, not a
separate resource. `KitOrder`/`AuditEvent` records are deliberately **not** deleted (legally required
billing/audit records, minimized — they retain only the bare `candidateId`, no longer resolvable to a live
profile once deletion completes — never a name/email/evidence).

`GET /candidates/me/export` returns the candidate's own profile, evidence claims, and evidence-file metadata
(filename/type/scan-status only — never a raw `quarantineKey`/`acceptedKey`, matching the same "search
results never expose storage keys" rule applied everywhere else).

## Recurring billing (Paystack subscriptions)

Five entities and two pointers. Both pointers exist because of the shape of Paystack's webhooks
rather than any preference for denormalisation: no Paystack payload carries an employer id, and a
renewal charge carries a reference Paystack generated rather than the one we supplied at checkout.

| Entity                    | PK                           | SK                          | Notes                                                                                                                                                                                                                                                                                      |
| ------------------------- | ---------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Payment attempt           | `EMPLOYER#<employerId>`      | `PAYMENT#<attemptId>`       | Written **before** Paystack is contacted, so an abandoned checkout leaves a record. Sparsely projected onto GSI2 as `PAYMENTS_OPEN` while unsettled, and the projection is removed in the same write that settles it                                                                       |
| Payment idempotency key   | `EMPLOYER#<employerId>`      | `PAYMENT_IDEMPOTENCY#<key>` | Conditional put inside the same transaction as the attempt. A double click, a refresh, or a client retry returns the first attempt rather than opening a second checkout                                                                                                                   |
| Billing subscription      | `EMPLOYER#<employerId>`      | `SUBSCRIPTION`              | One per organisation. Holds Paystack's `subscription_code`, `customer_code`, `plan_code`, status, next payment date, card summary, grace deadline, and the `email_token` that is the only way to cancel. The token is stripped from every API response, including the founder's diagnostic |
| Billing invoice           | `EMPLOYER#<employerId>`      | `INVOICE#<invoiceCode>`     | One per billing period. The only record that can answer "was August paid, and if not, why not"                                                                                                                                                                                             |
| Billing customer          | `EMPLOYER#<employerId>`      | `BILLINGCUSTOMER`           | Paystack's `customer_code` for this organisation                                                                                                                                                                                                                                           |
| Subscription-code pointer | `SUBCODE#<subscriptionCode>` | `POINTER`                   | → employerId. Every subscription and invoice event identifies its subject by subscription code and by nothing else                                                                                                                                                                         |
| Customer-code pointer     | `CUSCODE#<customerCode>`     | `POINTER`                   | → employerId. A renewal `charge.success` carries a Paystack-generated reference that cannot be parsed, so the customer code is the only handle it has                                                                                                                                      |

The webhook dedupe record above changes key: the id is now `body:<sha256 of the raw request body>`
rather than `data.id`. Paystack's body has no unique event id, and `data.id` is absent from every
subscription and invoice event, so keying on it would have made the first such event a permanent
500 with a seventy-two hour retry loop behind it.

| #   | Pattern                                            | How                                                                                                                                                                                                                                                                                                                               |
| --- | -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 30  | Open a checkout without allowing a duplicate       | `TransactWrite`: conditional put of `PAYMENT_IDEMPOTENCY#<key>` plus conditional put of `PAYMENT#<attemptId>`. On `TransactionCanceled`, read the key item and return the attempt it names                                                                                                                                        |
| 31  | Settle a payment without a lost update             | `UpdateItem` on `PAYMENT#<attemptId>` with `ConditionExpression status = :expected`, plus `REMOVE GSI2PK, GSI2SK` in the same expression when the new status is terminal. A webhook and a reconciliation pass can both be looking at one attempt; the loser re-reads rather than overwriting a settled outcome                    |
| 32  | List every unsettled payment, across employers     | `Query` GSI2 `GSI2PK = PAYMENTS_OPEN AND GSI2SK < :createdBefore`. Sparse, so it holds only outstanding work, and bounded so a checkout somebody is still completing is never touched                                                                                                                                             |
| 33  | Attribute a subscription or invoice event          | `GetItem(PK=SUBCODE#<code>, SK=POINTER)` → employerId                                                                                                                                                                                                                                                                             |
| 34  | Attribute a renewal charge                         | `GetItem(PK=CUSCODE#<code>, SK=POINTER)` → employerId                                                                                                                                                                                                                                                                             |
| 35  | Read one organisation's billing                    | `Query PK=EMPLOYER#<id>` with `begins_with(SK, 'PAYMENT#')`, `begins_with(SK, 'INVOICE#')`, and `GetItem` for `SUBSCRIPTION`                                                                                                                                                                                                      |
| 36  | Record what a graded submission was marked against | `PutItem(PK=CANDIDATE#<id>, SK=GRADEDATTEMPT#<evidenceId>#<at>#<id>)`, unconditional (server-generated id). Written at every exit where a rubric was actually applied and at none where it was not — a task on another track, a task that does not exist, and a submission too long to grade are refusals to mark, not judgements |
| 37  | Read a candidate's attempts at one graded task     | `Query(PK=CANDIDATE#<id>, SK begins_with GRADEDATTEMPT#<evidenceId>#)`. Read only where it can exist: a badge or repository check has no rubric, so the employer evidence view skips the query entirely rather than making one read per item for a list that is always empty                                                      |

## Proof Hiring Kit domain (Phase 7 slice 4)

`packages/kit-templates` (moved out of `apps/web` this slice) holds the one deterministic, versioned
template implementation both the free client-side preview and the real paid Kit generation call — never two
copies that could drift. `generateProofGapPreview`/`generateKitDeliverables` derive structured content
purely from a `Role`; `renderKitHtmlDocument` renders it into a single self-contained, accessible,
mobile-responsive, print-ready HTML document (real Playwright + axe-core proof in
`tests/accessibility/kit-document.spec.ts` — zero WCAG 2.1/2.2 AA violations, keyboard tab order, print-media
page-break rules, long-title/empty-optional-field edge cases). `services/api/handlers/kit/create-order.ts`
creates a `pending` KitOrder only — **no outbound Paystack API call exists anywhere in `services/api`**, the
deployed backend (CLAUDE.md: no live checkout). Stated precisely, because one file in the repository does
call Paystack's API: `scripts/paystack-test-plan.mjs`, a developer-only script that is never deployed, never
imported by the service, and hard-refuses to run unless the supplied key begins with `sk_test_`.
`handlers/webhooks/paystack.ts` verifies the real Paystack HMAC-SHA512 signature scheme
(`src/lib/paystack-signature.ts`, verified live against Paystack's docs, not guessed) against the raw body,
dedupes via the existing `WEBHOOK#<eventId>` pattern (access pattern #9 — "concurrent/replayed events must
not generate extra paid entitlements" per Prompt 7), resolves the order via a `roleId.kitOrderId` reference
embedded at order-creation time (no extra index needed), grants the entitlement, and generates the first Kit
artifact version synchronously. Regeneration (`handlers/kit/regenerate.ts`) requires an already-succeeded
order and always creates a new version — never overwrites the paid original. The exact Paystack webhook
payload field names are based on Paystack's documented `charge.success`/`charge.failed` shape, not verified
against a real Paystack test-mode event (no live integration exists to verify against) — recorded as a
residual risk in `docs/RISK_REGISTER.md`, to be reconfirmed before any live traffic.

## Evidence pipeline (Phase 7 slice 3)

`services/api/handlers/evidence/request-upload.ts` issues a short-lived S3 presigned POST bound to exactly
`quarantine/<candidateId>/<fileId>` (an exact Content-Type condition, a content-length range, both enforced
by S3 itself). GuardDuty Malware Protection for S3 scans that prefix automatically (already wired in
`infrastructure/modules/evidence-storage`) and publishes an EventBridge event
(`source: aws.guardduty`, `detail-type: "GuardDuty Malware Protection Object Scan Result"` — schema verified
live against `docs.aws.amazon.com/guardduty/latest/ug/monitor-with-eventbridge-s3-malware-protection.html`,
not guessed) routed through a new EventBridge rule into the `evidence_processing` SQS queue.
`handlers/evidence/scan-result-worker.ts` consumes it: promotion to `accepted/<candidateId>/<fileId>` happens
on **exactly one path** — `scanStatus = COMPLETED AND scanResultStatus = NO_THREATS_FOUND`, followed by a
magic-byte check that must also pass (`src/lib/magic-bytes.ts`) — every other combination
(`THREATS_FOUND`/`UNSUPPORTED`/`ACCESS_DENIED`/`FAILED`/an unrecognized combination) rejects, fail-closed by
construction, not by an else-branch that could be edited into a default-accept later. A confirmed threat is
deleted immediately; other rejections stay in `quarantine/` (an appeal/re-upload path, per Prompt 7) until
the bucket's existing `quarantine_expiry_days` lifecycle rule expires them. Image files (`image/png`,
`image/jpeg`) are re-encoded metadata-free before promotion (`src/lib/strip-{jpeg,png}-metadata.ts`,
hand-rolled rather than `sharp` — see `docs/DECISIONS.md`). PDF metadata stripping is **not implemented** —
a documented residual risk, see `docs/RISK_REGISTER.md`. Downloads are always a short-lived presigned GET
resolved from the `accepted/` key only, after the caller's own `scanStatus = clean` check
(`src/domain/evidence-download-service.ts`) — a file still in `quarantine/`, regardless of any tag, is never
served.

## Rules

- No item is ever read via `Scan` in application code. `scripts/validate.mjs`'s test suite asserts this by
  construction — repositories only expose `Query`/`GetItem`/`PutItem`/conditional-update methods, never a
  raw `Scan` wrapper. (Per-repository contract tests have existed since slice 2, so the earlier "once
  repository tests exist" caveat is obsolete and has been removed.) This rule constrains _application code_;
  an operator running a one-off read-only `aws dynamodb scan` from the CLI during an audit is outside its
  scope and does not contradict it.
- Consent state is never a filter applied after a read (see GSI1 above) — it is encoded in whether the
  indexed item exists at all, so an opt-out takes effect the moment the GSI item is deleted, not the next
  time a filter happens to run.
- `packages/contracts` schemas validate every item shape at the repository boundary before it is written;
  DynamoDB's schemaless nature never becomes "no validation."
- Every write to a user-editable record (candidate profile, role, evidence item) is a conditional update on
  its internal `version` attribute (optimistic concurrency) — an update built against a stale read fails
  loudly (`ConflictError`, 409) instead of silently overwriting a concurrent edit.
- Idempotency keys apply wherever a client action could plausibly be retried: account setup (conditional
  create, see access pattern #12's create-if-not-exists behavior), evidence uploads (server-generated
  object key, never client-suppliable), billing-event application (the existing webhook dedupe, pattern #9),
  and contact unlocks (a client-supplied idempotency key stored as part of the unlock's own conditional
  write, added when that domain is implemented).
