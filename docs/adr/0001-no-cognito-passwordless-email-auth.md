# ADR 0001: No Amazon Cognito — AWS-native passwordless email magic-link auth

Status: Accepted (binding decision, not yet implemented)
Date: 2026-08-15

## Decision

Amazon Cognito is **prohibited** for Zoryvex application authentication, in any form: no user pool, client, hosted-UI domain, authorizer, SDK flow, MFA flow, test, environment value, cost line, architecture diagram, or Terraform resource. This supersedes any earlier version of the plan that referenced Cognito. IAM Identity Center is retained, but **only** for founder AWS console/CLI access — never for application end users.

Application authentication is instead AWS-native passwordless email magic links, built from: SES (delivery), API Gateway HTTP API, Lambda, DynamoDB.

A static/policy gate (see [[docs/COST_GUARDRAILS]]) must fail CI if "Cognito" appears in Terraform, code, dependency manifests, generated bundles, tests, or cost models, outside the small documentation allowlist that exists to state this prohibition.

## Required properties of the magic-link flow

- Generic responses to every request (no user-enumeration signal).
- Bounded, per-email and per-network abuse controls.
- Tokens: at least 256 bits of randomness, single-purpose, bound to the specific action requested.
- At rest: only a keyed hash of the token is stored, never the raw token.
- Expiry: 10 minutes.
- The email link is a `GET` that does **not** consume the token by itself.
- The token travels in a URL **fragment**, which the client clears immediately on load.
- Consumption happens via a deliberate `POST` exchange initiated by the page, not the `GET`.
- Consumption is an **atomic conditional** DynamoDB write (consume-once; a race must not allow double-use).
- The raw token must never appear in: server logs, the `Referer` header of outbound requests, browser storage (localStorage/sessionStorage), analytics events, or error-reporting/screenshots.

## Session issuance after exchange

- Issue an **opaque** session identifier; only its keyed hash is stored in DynamoDB (same principle as the magic-link token — never store the verifier itself).
- Cookie: `__Host-zoryvex_session`, `Secure`, `HttpOnly`, `Path=/`, no `Domain` attribute, `SameSite=Lax`.
- Idle expiry and absolute expiry, both enforced server-side.
- Session rotation on privilege change (e.g., step-up).
- Logout (current session) and revoke-all (all sessions for the account).
- CSRF defense: exact `Origin` check plus session-bound CSRF token — not `Referer`-only, not cookie-alone (`SameSite=Lax` is defense-in-depth, not the whole answer for state-changing requests).
- CORS: exact allow-list, no wildcard with credentials.
- Every handler performs its own server-side tenant/resource authorization — never inferred from a shared middleware assumption alone.
- DynamoDB TTL is cleanup-only; a read path must independently reject an expired record even before TTL deletion runs.

## Authorizer

A Lambda `REQUEST` authorizer (or a verified equivalent that provides the same per-request checks) — not a bare JWT-claims trust boundary.

## Founder/admin step-up

WebAuthn/passkey required for founder/admin actions, with strict checks on: origin, RP ID, challenge freshness/uniqueness, replay prevention, a defined recovery path, and audit logging/tests for all of the above.

## Launch gate for public auth

Public authentication stays **off** until: SES is in production sending mode (out of the SES sandbox) **and** every auth/security test in this ADR's scope passes. Neither condition alone is sufficient.

## Consequences

- More implementation work up front than adopting a managed Cognito user pool.
- Full control over the token/session model, which is required to meet the property list above (Cognito's hosted flows do not natively give fragment-token GET/POST separation, atomic single-use consumption, or the exact cookie/CSRF/CORS shape specified).
- This ADR does not implement the flow — see [[docs/THREAT_MODEL]] for the attack-surface reasoning and [[docs/COST_GUARDRAILS]] for the CI gate requirement. Implementation belongs to the preserved numbered prompt that reaches application authentication, not this binding turn.
