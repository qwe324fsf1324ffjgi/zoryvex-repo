# Cost and Quality Guardrails

## Allowed architecture (AWS-first serverless, Cognito removed — see [[adr/0001-no-cognito-passwordless-email-auth]])

- Private S3 + CloudFront with Origin Access Control for the static frontend.
- API Gateway HTTP API.
- Small TypeScript Lambdas, no provisioned concurrency.
- DynamoDB, on-demand capacity.
- Private S3 for evidence storage.
- SQS + DLQ, only where a flow is genuinely asynchronous.
- SES for transactional email (including the passwordless magic-link flow).
- Parameter Store, `SecureString`, for Paystack secret values.
- CloudWatch for logs/metrics/alarms.
- GitHub Actions with OIDC (no long-lived AWS keys in CI).
- Amazon Bedrock, on-demand only, only after an explicit evaluation, and only with a deterministic (non-AI) fallback path.
- CloudFront pay-as-you-go (not the $0 flat-rate plan — Terraform can't manage plan selection today; see [[docs/adr/0003-cloudfront-pay-as-you-go-no-waf-at-launch]]), no AWS WAF web ACL at launch (real, sustained fixed cost, not bundled on this path — same ADR has the risk/trigger).
- GuardDuty Malware Protection for S3 for evidence-upload scanning (no fixed idle charge, verified — see [[docs/SOURCES]]), in preference to a custom-maintained scanner.
- GitHub Actions OIDC deploy roles (`infrastructure/modules/ci-deploy-role`), one per environment — no static AWS key in CI, ever.

## Explicitly forbidden (do not create, regardless of convenience)

- Amazon Cognito, in any form, for application authentication (hard gate — see ADR 0001).
- Route 53 (Vercel is registrar/DNS).
- A Vercel *project* (Vercel is DNS/registrar only).
- App Runner, Amplify, EC2, ECS.
- RDS/Aurora or any relational/search cluster.
- VPC, subnet, NAT Gateway, load balancer.
- Any third-party analytics, CRM, support, or marketing service.

## Never trade away for cost savings

Secret protection, tenant/resource authorization, payment verification, backups/restore proof, accessibility, automated tests, abuse/deletion handling, cost alarms, and rollback capability are never in scope for cost-cutting. If a cost reduction idea touches any of these, it is rejected regardless of savings.

## Before any optional spend

Record, before turning it on: current official price basis, expected idle/minimum/likely/worst-credible monthly cost, assumptions behind that estimate, whether it depends on a free tier, the shutdown method, the effect on data if shut down, and the rollback plan. This applies especially to Bedrock usage.

## AI usage posture

Off by default. When enabled: per-user and global quotas enforced server-side, plus a tested emergency kill switch that can be exercised without a deploy.

## Launch posture

No paid ads at launch. Scale infrastructure from measured demand, not projections.

## Exactly five MCP capabilities (project scope only, not connected this turn)

Only these five may ever be connected in this project: **21st/Magic** (treated as one capability, not two), **GitHub**, **Filesystem**, **Context7**, **Playwright**. Never a sixth. Rules to apply at connection time (a later prompt, not this one):

- Resolve current official server names/transports/versions/security guidance first; configure at **project** scope only.
- **Filesystem**: restricted to exactly `C:\Users\zerah\Documents\zoryvex`.
- **GitHub**: official read-only server mode, fine-grained PAT scoped to `zoryvex-platform` only, read-only permissions, expiry ≤ 30 days; after connecting, inspect the actual exposed tool inventory — a read-only flag is not proof by itself.
- **Playwright**: isolated clean browser profile, no saved provider session, workspace-restricted, narrow allowed-origins list, no unrestricted filesystem access.
- **Context7** and **21st/Magic**: free-tier routes only, unless paid use is explicitly approved first.
- Pin/lock versions wherever the tool supports it. Never print configuration secrets (tokens, keys) to logs, docs, or chat.

## Cognito static gate (requirement, to be wired in Prompt 0+)

A CI/policy check must fail the build if the literal term "Cognito" (case-insensitive) appears anywhere in Terraform, application code, dependency manifests (`package.json`, lockfiles), generated bundles, tests, or cost models — outside of the small, explicit allowlist of documentation files that exist specifically to *prohibit* it (this file, the ADR, and [[V48_BINDING]]/[[FOUNDER_READINESS]]). This binding turn documents the requirement; it does not add application code, so the gate itself is wired up when the repository first gains source files.

### Known conflict, resolved

The founder's preserved "Prompt 0" text lists Cognito in its own "FIXED ARCHITECTURE" paragraph (a pre-v4.8 line carried over in the saved manual). Per the explicit text of the v4.8 binding ("this replaces every older line that asks for a Cognito user pool..."), [[adr/0001-no-cognito-passwordless-email-auth]] controls. Cognito is not installed, configured, or referenced in any implementation. This note exists so a later phase does not "fix" this by re-adding Cognito because an older prompt still names it.

## v4.5 commercial addendum cost rules

See [[docs/COMMERCIAL_RUNBOOK]] for the full "NO-WASTE COST RULES" section (zero paid ads at launch, no new paid service/account without an explicit cost memo and founder approval, budgets/alarms are warnings not caps, Bedrock stays off unless a versioned evaluation proves material usefulness within a recorded per-output cost cap, scale from measured traffic only). Those rules apply in addition to, not instead of, the architecture boundary above.
