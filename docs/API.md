# API

Contract of record: `packages/contracts/openapi.yaml` (OpenAPI 3.1). This document explains the
conventions the contract follows; when the two disagree, the OpenAPI file wins and this file is out of
date.

Two checks keep that from being a polite fiction, because for most of this project's life it was one —
the contract described `/health` and nothing else while forty more routes shipped, and this page still
said the only route so far was unauthenticated:

- `npm run openapi:coverage` compares every `route_key` in `infrastructure/envs/test/main.tf` against the
  contract's paths, in both directions. A route that exists but is undocumented fails; so does a
  documented route that does not exist.
- `packages/contracts/tests/openapi-schema-parity.test.ts` compares the contract's component schemas
  against the zod schemas in `packages/contracts/src`, on property names and which of them are required.

## Conventions

- **Base**: API Gateway HTTP API, one Lambda per route, `AWS_PROXY` integration (see
  `infrastructure/modules/api`). 41 routes in the test environment.
- **Auth**: passwordless email sign-in, per `docs/adr/0001-no-cognito-passwordless-email-auth.md`. A
  session is an opaque, hashed-at-rest id in a `__Host-` prefixed, HttpOnly, Secure cookie, checked
  server-side on every request by a Lambda authorizer (`services/api/handlers/authorizer.ts`). The client
  never sends a role or an organization ID that is trusted without a server-side lookup (see
  `docs/THREAT_MODEL.md`, "Never trust role/org IDs from the client"). Four routes are unauthenticated by
  design: `GET /health`, the two sign-in routes, `POST /auth/sign-out`, and `POST /webhooks/paystack`,
  which authenticates by Paystack signature instead.
- **CSRF**: every mutating request (anything other than `GET`/`HEAD`) needs an exact `Origin` match plus a
  session-bound `X-Zoryvex-Csrf` header. Both are checked in the authorizer, before the request reaches a
  handler. `GET /auth/session` re-issues the token, which is what makes a page reload survivable — the
  plaintext value only ever reaches the client once per issuance.
- **Roles**: `candidate`, `employer_member`, `employer_admin`, `founder_admin`. Every handler checks the
  role it needs and answers 403 otherwise. Founder-admin routes additionally require a _recent_ WebAuthn
  step-up, not merely a stepped-up session.
- **Tenancy**: "not found" and "not yours" are deliberately the same 404 everywhere. Nothing in this API
  lets one tenant confirm that another tenant's record exists.
- **Validation**: every request body is parsed through a zod schema via
  `services/api/src/validation/validate-request.ts` before it reaches domain code. A schema failure is a
  `ValidationError` (400), never a raw 500.
- **Optimistic concurrency**: every update that can race carries a `version`. A stale version is a 409,
  never a silent overwrite of somebody else's edit.
- **Errors**: JSON body `{ "error": "<CODE>", "message": "<safe message>" }`, produced by
  `services/api/src/adapter/http.ts` from the typed errors in `services/api/src/errors/typed-errors.ts`:
  `VALIDATION_ERROR` (400), `UNAUTHORIZED` (401), `FORBIDDEN` (403), `NOT_FOUND` (404), `CONFLICT` (409),
  `TOO_MANY_REQUESTS` (429), `PAYMENT_PROVIDER_ERROR` (502), `INTERNAL_ERROR` (500). A 500's message is
  always the generic "Unexpected error" — internal detail is logged server-side with redaction per
  `docs/PRIVACY_AND_RETENTION.md`, never returned.
- **Idempotency**: `POST /roles/{roleId}/kit-orders` requires an `Idempotency-Key` header. Paystack
  webhooks are deduplicated by event id with a conditional write, and no entitlement is granted on the
  webhook body alone — a second, independent server-to-server verify call decides that. See
  `docs/PAYMENTS.md`.

## Endpoints

Grouped as the contract groups them. Every path below is authenticated unless the row says otherwise.

### Health

| Method | Path      | Handler                           | Purpose                                 |
| ------ | --------- | --------------------------------- | --------------------------------------- |
| GET    | `/health` | `services/api/handlers/health.ts` | Liveness check. No auth, no state read. |

### Auth

| Method | Path                 | Handler                                      | Purpose                                                                        |
| ------ | -------------------- | -------------------------------------------- | ------------------------------------------------------------------------------ |
| POST   | `/auth/request-code` | `services/api/handlers/auth/request-code.ts` | Send a sign-in link. No auth. Same answer whether or not the address is known. |
| POST   | `/auth/consume-code` | `services/api/handlers/auth/consume-code.ts` | Exchange a single-use token for a session. No auth.                            |
| POST   | `/auth/sign-out`     | `services/api/handlers/auth/sign-out.ts`     | End the session. No auth, idempotent.                                          |
| GET    | `/auth/session`      | `services/api/handlers/auth/session.ts`      | Who am I, plus a fresh CSRF token.                                             |

### WebAuthn (founder-admin only)

| Method | Path                              | Handler                                                   | Purpose                      |
| ------ | --------------------------------- | --------------------------------------------------------- | ---------------------------- |
| POST   | `/auth/webauthn/register/options` | `services/api/handlers/auth/webauthn-register-options.ts` | Start registering a passkey. |
| POST   | `/auth/webauthn/register/verify`  | `services/api/handlers/auth/webauthn-register-verify.ts`  | Complete registration.       |
| POST   | `/auth/webauthn/step-up/options`  | `services/api/handlers/auth/webauthn-step-up-options.ts`  | Start a step-up.             |
| POST   | `/auth/webauthn/step-up/verify`   | `services/api/handlers/auth/webauthn-step-up-verify.ts`   | Complete a step-up.          |

### Candidate

| Method | Path                                                | Handler                                                     | Purpose                                                  |
| ------ | --------------------------------------------------- | ----------------------------------------------------------- | -------------------------------------------------------- |
| GET    | `/candidates/me`                                    | `services/api/handlers/candidates/profile-get.ts`           | Read own profile.                                        |
| PATCH  | `/candidates/me`                                    | `services/api/handlers/candidates/profile-update.ts`        | Update own profile.                                      |
| GET    | `/candidates/me/evidence`                           | `services/api/handlers/candidates/evidence-list.ts`         | List own evidence claims.                                |
| POST   | `/candidates/me/evidence`                           | `services/api/handlers/candidates/evidence-create.ts`       | Add an evidence claim.                                   |
| GET    | `/candidates/me/evidence/{evidenceId}`              | `services/api/handlers/candidates/evidence-get.ts`          | Read one claim.                                          |
| PATCH  | `/candidates/me/evidence/{evidenceId}`              | `services/api/handlers/candidates/evidence-update.ts`       | Edit a claim. Editing its substance resets verification. |
| DELETE | `/candidates/me/evidence/{evidenceId}`              | `services/api/handlers/candidates/evidence-delete.ts`       | Delete a claim.                                          |
| POST   | `/candidates/me/evidence/{evidenceId}/verify/begin` | `services/api/handlers/candidates/evidence-verify-begin.ts` | Get a one-time nonce for proving repo ownership.         |
| POST   | `/candidates/me/evidence/{evidenceId}/verify`       | `services/api/handlers/candidates/evidence-verify.ts`       | Verify a claim against a third party.                    |
| GET    | `/candidates/me/graded-task`                        | `services/api/handlers/candidates/graded-task.ts`           | The practical tasks offered for this candidate's track.  |

### Evidence files

| Method | Path                                | Handler                                            | Purpose                                              |
| ------ | ----------------------------------- | -------------------------------------------------- | ---------------------------------------------------- |
| POST   | `/evidence/upload-requests`         | `services/api/handlers/evidence/request-upload.ts` | Presigned POST into a quarantine prefix, scan-gated. |
| GET    | `/evidence/files/{fileId}/download` | `services/api/handlers/evidence/download.ts`       | Short-lived presigned GET for an accepted file.      |

### Privacy

| Method | Path                     | Handler                                             | Purpose                                                       |
| ------ | ------------------------ | --------------------------------------------------- | ------------------------------------------------------------- |
| PATCH  | `/candidates/me/consent` | `services/api/handlers/privacy/consent.ts`          | Change discovery and contact-sharing consent.                 |
| GET    | `/candidates/me/export`  | `services/api/handlers/privacy/export.ts`           | Export own data. Files by metadata only, never a storage key. |
| POST   | `/candidates/me/delete`  | `services/api/handlers/privacy/request-deletion.ts` | Request deletion. Queued; answers 202.                        |

### Employer roles

| Method | Path              | Handler                                 | Purpose         |
| ------ | ----------------- | --------------------------------------- | --------------- |
| GET    | `/roles`          | `services/api/handlers/roles/list.ts`   | List own roles. |
| POST   | `/roles`          | `services/api/handlers/roles/create.ts` | Create a role.  |
| GET    | `/roles/{roleId}` | `services/api/handlers/roles/get.ts`    | Read one role.  |
| PATCH  | `/roles/{roleId}` | `services/api/handlers/roles/update.ts` | Update a role.  |

### Matching

| Method | Path                                                   | Handler                                           | Purpose                                                                                        |
| ------ | ------------------------------------------------------ | ------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| GET    | `/roles/{roleId}/matches`                              | `services/api/handlers/matches/list-for-role.ts`  | This role's matches.                                                                           |
| POST   | `/roles/{roleId}/matches/recompute`                    | `services/api/handlers/matches/recompute.ts`      | Recompute, deterministically.                                                                  |
| GET    | `/roles/{roleId}/matches/{candidateId}/evidence`       | `services/api/handlers/matches/evidence.ts`       | Verified evidence, each with where to re-check it at source.                                   |
| POST   | `/roles/{roleId}/matches/{candidateId}/explain`        | `services/api/handlers/matches/explain.ts`        | AI summary. Off behind the `aiMatching` flag; answers `available: false` rather than erroring. |
| POST   | `/roles/{roleId}/matches/{candidateId}/unlock-contact` | `services/api/handlers/matches/unlock-contact.ts` | Spend one contact unlock. Server-side entitlement transaction.                                 |
| GET    | `/roles/{roleId}/matches/{candidateId}/contact`        | `services/api/handlers/matches/get-contact.ts`    | Contact details, only after a prior successful unlock.                                         |

### Proof Hiring Kit

| Method | Path                             | Handler                                     | Purpose                                               |
| ------ | -------------------------------- | ------------------------------------------- | ----------------------------------------------------- |
| GET    | `/roles/{roleId}/kit-preview`    | `services/api/handlers/kit/preview.ts`      | Free proof-gap preview. Never a fabricated candidate. |
| GET    | `/roles/{roleId}/kit-status`     | `services/api/handlers/kit/status.ts`       | Whether this role's Kit has been bought.              |
| POST   | `/roles/{roleId}/kit-orders`     | `services/api/handlers/kit/create-order.ts` | Start a purchase. Requires `Idempotency-Key`.         |
| GET    | `/roles/{roleId}/kit`            | `services/api/handlers/kit/download.ts`     | The generated Kit, HTML with a print stylesheet.      |
| POST   | `/roles/{roleId}/kit/regenerate` | `services/api/handlers/kit/regenerate.ts`   | New immutable version. Requires a succeeded order.    |

### Admin

| Method | Path                | Handler                                     | Purpose                                                      |
| ------ | ------------------- | ------------------------------------------- | ------------------------------------------------------------ |
| GET    | `/admin/exceptions` | `services/api/handlers/admin/exceptions.ts` | Unresolved audit and flagged items. Recent step-up required. |

### Webhooks

| Method | Path                 | Handler                                      | Purpose                                                                |
| ------ | -------------------- | -------------------------------------------- | ---------------------------------------------------------------------- |
| POST   | `/webhooks/paystack` | `services/api/handlers/webhooks/paystack.ts` | Signature-verified Paystack events. No session; signature is the auth. |

## Adding an endpoint

Contract first: add it to `packages/contracts/openapi.yaml`, then the handler, domain function and
repository, then the Terraform route, then this table — in one PR. `npm run openapi:coverage` will fail
until the contract and the route table agree, in whichever order you get to them.
