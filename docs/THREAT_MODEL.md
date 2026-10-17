# Threat Model — Passwordless Email Auth + Session (initial, pre-implementation)

Scope: the flow described in [[docs/adr/0001-no-cognito-passwordless-email-auth]]. This is written ahead of implementation so the preserved numbered prompt that builds auth has explicit test targets, not just a design.

## Assets

- Account access (session).
- Magic-link tokens (bearer, single-use, short-lived).
- Session tokens (bearer, longer-lived).
- Candidate proof data and consent state (see [[docs/CUSTOMER_DEVOTION]] — revocable, consent-gated).
- Founder/admin console and CLI access (IAM Identity Center — out of this flow's scope, but the founder step-up below guards the analogous application-side risk).

## Threats and required mitigations

| Threat | Mitigation | Verify by |
|---|---|---|
| Attacker enumerates valid emails via signup/login responses | Generic response regardless of whether the email exists | Test: identical response body/timing-order-of-magnitude for known vs unknown email |
| Attacker brute-forces or floods the request-link endpoint | Per-email and per-network rate limiting | Test: request N+1 within window is rejected/throttled |
| Token guessed or brute-forced | ≥256-bit random, single-purpose token | Code review of generator; no custom weak RNG |
| Token stolen from storage (DB breach) | Only a keyed hash stored, never the raw token | Test: DB record contains no reversible raw token |
| Token stolen from logs / Referer / analytics / browser storage | Token lives in URL fragment only, cleared on load; never logged; not persisted client-side | Test: grep server logs after a real exchange finds no raw token; check no `localStorage`/`sessionStorage` write; check outbound requests from the landing page carry no `Referer` leaking the fragment |
| Link pre-fetched/scanned by email security software (GET is not safe to be state-changing) | `GET` does not consume the token; only an explicit user-initiated `POST` consumes it | Test: issuing the `GET` twice does not burn the token; only `POST` does |
| Token replay / double-spend race | Atomic conditional consumption in DynamoDB | Test: two concurrent `POST`s with the same token — exactly one succeeds |
| Expired token accepted | 10-minute expiry enforced server-side at read time, not just via TTL cleanup | Test: token used at 10:01 is rejected even if the TTL-based deletion hasn't run yet |
| Session token theft via XSS | `HttpOnly` cookie — never exposed to page JS | Test: `document.cookie` does not contain the session value |
| Session token theft via network | `Secure`, HTTPS-only | Test: cookie not sent over plain HTTP |
| Cookie leaks to subdomains it shouldn't | `__Host-` prefix (forces no `Domain` attribute, `Path=/`, `Secure`) | Test: cookie attributes match `__Host-` requirements exactly |
| CSRF on state-changing requests | Exact `Origin` check + session-bound CSRF token, checked server-side on every mutating request | Test: request with mismatched/absent `Origin` or missing/invalid CSRF token is rejected |
| Cross-origin credentialed reads | Exact CORS allow-list, no wildcard + credentials combination | Test: disallowed origin cannot read authenticated responses |
| Session lives forever / can't be killed | Idle expiry, absolute expiry, logout, revoke-all | Test: session unusable after idle timeout, after absolute timeout, and immediately after revoke-all |
| Cross-tenant data access via a single compromised or confused handler | Every handler independently authorizes the resource against the caller's tenant — no reliance on "the router already checked" | Test: authenticated user A cannot read/write user B's resource via any single handler, tested per-handler not just per-route-group |
| Founder/admin account takeover | WebAuthn/passkey step-up: strict origin, RP ID, fresh/unique challenge, replay rejection, defined recovery path, audit log | Test: replayed assertion rejected; mismatched origin/RP ID rejected; step-up action logged |
| Auth shipped before delivery actually works | Public auth gated off until SES is out of sandbox **and** all of the above tests pass | Launch checklist gate, not a runtime check |

## System-wide threat model (added Phase 3)

Scope beyond the auth flow above: the rest of the platform described in [[docs/ARCHITECTURE]] and
[[docs/DATA_MODEL]]. Written the same way as the auth section — ahead of the implementation it constrains,
so later phases have explicit test targets.

### Assets

- Candidate evidence and profile data (private by default; see [[docs/PRIVACY_AND_RETENTION]]).
- Employer role/entitlement data and payment state (see [[docs/PAYMENTS]]).
- The DynamoDB core table and its GSIs (see [[docs/DATA_MODEL]]).
- The static site origin bucket and CloudFront distribution.
- AI matching outputs (candidate rankings/summaries) — an integrity target, not just a confidentiality one:
  a manipulated ranking is as much a threat as a leaked one (see [[docs/AI_SAFETY]]).

### Actors

- Anonymous visitor, authenticated candidate, authenticated employer, founder/admin, Paystack (external,
  semi-trusted webhook sender), an AI model invocation (untrusted output, trusted only after validation).

### Trust boundaries

- Browser <-> API Gateway (public internet, zero trust — every request re-authenticated/re-authorized).
- API Gateway/Lambda <-> DynamoDB/S3 (private, IAM-authenticated, but still least-privilege per handler —
  a handler's execution role only grants the actions/resources that handler actually needs).
- Paystack <-> webhook endpoint (public internet; authenticity comes only from signature verification, never
  from the source IP or a shared secret in the URL).
- Lambda <-> Bedrock (only when the `aiMatching` feature flag is on; output is treated as untrusted
  suggestion data, never executed or trusted as a command).

### Threats and required mitigations

| Threat | Mitigation | Verify by |
|---|---|---|
| Cross-tenant read via a crafted resource ID (e.g. `roleId` belonging to another employer) | Every repository call scopes by the caller's own ID, never by a client-supplied tenant/owner field alone | Test: authenticated employer A requesting employer B's `roleId` gets 404, not the resource |
| Client-supplied role/org ID trusted for authorization | Authorization always re-derives the caller's role/org server-side from the session, never from a request body/query field | Test: a request with a forged `employerId` in the body, different from the session's employer, is rejected |
| Non-opted-in candidate appears in employer-facing search | Discovery visibility is structural (GSI1 item only exists while opted in — see [[docs/DATA_MODEL]]), not a runtime filter that can be forgotten | Test: an opted-out candidate's GSI1 item does not exist; a direct GSI1 query for their track never returns them |
| Forged/replayed Paystack webhook | HMAC signature verification against the raw body before any parsing; event ID recorded and checked for idempotent replay | Test: unsigned/mis-signed payload rejected before processing; same event ID processed twice only applies the entitlement once |
| AI-generated content used as if it were a decision | Domain layer never auto-applies an AI output as a hiring decision — human employer action is the only state-changing step (see [[docs/AI_SAFETY]]) | Test: an AI ranking call, by itself, produces no entitlement/status change in the data model |
| Evidence bucket read by the wrong candidate/employer | S3 object keys are never guessable from a public ID alone; access goes through the API (pre-signed URL scoped to the authenticated caller's own resource, short expiry) | Test: a valid session cannot obtain a working URL for another user's evidence object |
| Evidence retained past its consented lifetime | S3 lifecycle expiration matches `docs/PRIVACY_AND_RETENTION.md`'s retention window; deletion request path removes the DynamoDB item and the S3 object together | Test: an evidence item past its retention window is unreachable via the API and absent from a fresh S3 listing |
| Overly broad Lambda execution role | Each Lambda's IAM role grants only the specific table/index/bucket actions that handler's repositories use, no wildcard resource ARNs | Code review: every `infrastructure/modules/api` invocation's attached policy is enumerable and minimal |

## Non-goals of this document

Implementation details of any single feature (e.g. the exact AI evaluation harness) live in that feature's
own docs once built, not here. This document stays at the level of assets/actors/boundaries/mitigations that
constrain every future feature, per [[docs/adr/0001-no-cognito-passwordless-email-auth]] and
[[docs/adr/0002-serverless-aws-static-export]].
