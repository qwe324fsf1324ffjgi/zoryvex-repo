# Repository map

What is actually in this repository, established by reading it on 2026-09-14.

Everything here was verified by inspection. Where something could not be
confirmed from the repository or from live AWS, it says **NOT VERIFIED**
rather than guessing. Nothing in this document was taken from memory,
documentation prose, or a previous session.

---

## 1. Shape of the project

A TypeScript monorepo using npm workspaces. The root `package.json` declares
three workspace globs:

```
apps/*        services/*        packages/*
```

| Workspace | What it is |
| --- | --- |
| `apps/web` | The application people use. Next.js, exported as static files. |
| `apps/web-safe-shell` | A separate minimal build. A neutral status page with no forms, no outbound links and no payment references, asserted by `npm run safe-shell:assert`. |
| `services/api` | Every backend route. One Lambda per route, not a server. |
| `packages/contracts` | Zod schemas and the rules both sides share. The single source of truth for prices, plans, evidence shape and matching vocabulary. |
| `packages/config` | Feature-flag shape only. Values live in AWS Parameter Store, never here. |
| `packages/local-adapters` | Fake in-browser implementations used for local development and browser tests. Fictional data only. |
| `packages/kit-templates` | Generates the six Proof Hiring Kit deliverables as HTML. |

Counts, measured rather than estimated:

- **59** API handler files under `services/api/handlers`
- **36** domain service files under `services/api/src/domain`
- **323** unit/contract test files
- **19** browser spec files under `tests/`
- **45** operational scripts under `scripts/`
- **31** documents under `docs/`
- **14** Terraform modules, **5** Terraform roots

---

## 2. Directories

### `apps/web`

The real product. Next.js with a **static export** — there is no Node server
in production, which is why the frontend can be served from S3 behind
CloudFront.

One consequence shapes a lot of the code: because the export is static, the
API base URL is baked in at **build time** via `NEXT_PUBLIC_API_BASE_URL`.
`isRealApiConfigured()` is literally `Boolean(process.env.NEXT_PUBLIC_API_BASE_URL)`.
Built without it, every page silently runs on the browser-local fakes in
`packages/local-adapters` and looks completely normal while calling no API at
all.

Route groups:

- `(marketing)` — public pages
- `candidate/(app)` — signed-in candidate
- `employer/(app)` — signed-in employer
- `admin/(app)` — founder-admin

### `services/api`

Structured so decisions are testable without AWS anywhere near them:

| Layer | Directory | Role |
| --- | --- | --- |
| Handler | `handlers/` | Reads the HTTP event, checks role, delegates. Thin. |
| Domain | `src/domain/` | Every business rule. Pure, dependency-injected. |
| Composition | `src/composition/` | Wires domain dependencies to real AWS clients. |
| Repository | `src/repositories/` | DynamoDB, SSM, SES, S3, Paystack, GitHub, Bedrock. |
| Adapter | `src/adapter/http.ts` | Maps typed domain errors to HTTP responses. |

The domain layer takes its dependencies as an interface, so its tests supply
fakes and never touch AWS. This is why a passing unit test proves the rule and
says nothing about whether the deployed function can reach anything.

### `infrastructure`

Terraform. Five roots:

| Root | Purpose |
| --- | --- |
| `bootstrap` | Account-level singletons (state bucket, OIDC provider). |
| `foundation` | Shared account resources. |
| `test` | The whole test environment. |
| `test-secrets` | **Separate on purpose.** SecureString parameters live here, not in `test`. |
| `production` | The whole production environment. |

The `test-secrets` split is a real security boundary, not tidiness. The AWS
provider calls `GetParameter` with `kms:Decrypt` on every refresh regardless
of `lifecycle.ignore_changes`, so a SecureString in a root the CI deploy role
can plan would hand CI the plaintext simply by running a plan. Production
keeps its SecureStrings in its own root because no CI role plans production.

### `packages/contracts`

Where a rule lives when both sides must agree on it. Prices, plan codes,
evidence strength, engagement kinds, matching vocabulary, the OpenAPI
document, and parity tests that fail when the spec and the schemas drift.

---

## 3. API surface

**51 routes**, confirmed identical between the production Terraform and the
deployed API Gateway (compared in both directions on 2026-09-14 — no
undeclared deployed routes, no undeployed declared routes).

**7 are unauthenticated**, each for a defensible reason:

| Route | Why it has no authorizer |
| --- | --- |
| `POST /auth/request-code` | Nobody has a session yet. |
| `POST /auth/consume-code` | Same. |
| `POST /auth/sign-out` | Must work even with a dead session. |
| `GET /health` | Health check. |
| `GET /public/proof/{publicProofId}` | Candidate's opt-in public page. |
| `GET /public/proof/{publicProofId}/badge.svg` | Same. |
| `POST /webhooks/paystack` | Paystack calls it. Authenticity is HMAC-SHA512 over the raw body, never a session. |

The remaining **44** sit behind a Lambda REQUEST authorizer.

Grouping by area: auth and WebAuthn (7), candidate profile and evidence (11),
roles (4), matching and interest (7), contact (2), Kit (5), billing (4),
privacy and export (3), public proof (2), admin (2), evidence files (2),
webhook (1), health (1).

---

## 4. Data

A **single DynamoDB table per environment** (`zoryvex-<env>-core`), composite
key `PK`/`SK`, with GSIs defined through the `data` module.

Item kinds observed in the live production table on 2026-09-14:

```
WINDOW   SESSION   AUTHTOKEN   AUDIT   PAYMENT   PAYMENT_IDEMPOTENCY
PROFILE  EVIDENCE  KITORDER    KITORDER_IDEMPOTENCY   ENTITLEMENT
VERIFYATTEMPTS      MATCH       WEBHOOK/EVENT
```

Single-table design means one query pattern per access path rather than
joins. `docs/DATA_MODEL.md` holds the access-pattern table.

---

## 5. External integrations

| Integration | Used for | Where |
| --- | --- | --- |
| **Paystack** | Kit payment, subscriptions, webhooks | `src/repositories/paystack-*`, `src/lib/paystack-client.ts` |
| **GitHub** | Repository-ownership verification | `src/repositories/github-repository.ts` |
| **Credly** | Certification verification | via `verification-source.ts` |
| **SES** | Sign-in codes and three candidate notices | `src/repositories/ses-repository.ts` |
| **Bedrock** | AI explanation, gated off | `src/repositories/bedrock-repository.ts` |

Bedrock is present but its flag is `false` in production, so the
deterministic matcher is the only one that runs.

---

## 6. Commands

Verified from `package.json`.

| Command | What it does | Safe? |
| --- | --- | --- |
| `npm run validate:all` | The full gate: format, lint, typecheck, tests, OpenAPI, secrets, Terraform validate, licences, dependency audit | **Read-only** |
| `npm test` | Unit and contract tests | **Read-only** |
| `npm run e2e` | Playwright browser suite | **Read-only** |
| `npm run secrets:scan` | Secret scan over the tracked tree | **Read-only** |
| `npm run flags:check` | Compares live feature flags against Terraform | **Reads live AWS** |
| `npm run verify:deployed` | Checks the deployed artifact | **Reads live AWS** |
| `npm run build` | Builds `apps/web` | **Read-only** |
| `npm run build:lambda` | Builds Lambda bundles | **Read-only** |
| `scripts/deploy.mjs --env test` | Plans, or applies with `--apply` | **CHANGES TEST** |
| `scripts/release.mjs` | The only production entry point | **CHANGES PRODUCTION** |
| `scripts/rollback.mjs` | Redeploys the last-good commit | **CHANGES INFRASTRUCTURE** |
| `scripts/emergency-cost-lockdown.mjs` | Writes feature flags off | **CHANGES LIVE FLAGS** |

`deploy.mjs` refuses `--env production` under any flag. `release.mjs` is the
single reviewed path, and it requires two separate confirmations.

---

## 7. CI/CD

One workflow, `.github/workflows/ci.yml`, triggered on pull request, on push
to `main`, and manually.

Four jobs:

1. `changed-paths` — detects a docs-only change
2. `validate` — the full gate
3. `e2e` — Playwright
4. `deploy-test` — needs all three above

**There is no production deploy job.** Production is only ever deployed by
running `scripts/release.mjs` by hand. A push to `main` cannot reach
production.

Authentication to AWS is GitHub OIDC assuming `zoryvex-test-deploy`. No
static AWS keys exist anywhere in the workflow.

---

## 8. Entry points

| Surface | Entry |
| --- | --- |
| Frontend | `apps/web/app/(marketing)/page.tsx` |
| Candidate app | `apps/web/app/candidate/(app)/layout.tsx` |
| Employer app | `apps/web/app/employer/(app)/layout.tsx` |
| API | One Lambda per route; `services/api/handlers/**` |
| Authorization | `services/api/handlers/authorizer.ts` |
| Production deploy | `scripts/release.mjs` |
| Infrastructure | `infrastructure/envs/production/main.tf` |

---

## 9. NOT VERIFIED

Stated plainly rather than assumed:

- **Whether any candidate has completed GitHub verification in production.**
  The code path exists and its live suite passes against `api.github.com`, but
  no production record was inspected proving a real candidate completed it.
- **The full DynamoDB GSI definitions.** The `data` module builds them from
  variables; the concrete list per environment was not enumerated here.
- **`apps/web-safe-shell` deployment status.** The build exists and has its
  own assertion script; whether it is currently deployed anywhere was not
  checked.
- **Queue and DLQ runtime behaviour.** The `messaging` and `queue-consumer`
  modules exist; no live queue was inspected.
