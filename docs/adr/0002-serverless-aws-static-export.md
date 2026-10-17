# ADR 0002: Serverless AWS (static export + API Gateway/Lambda/DynamoDB), no always-on compute

Status: Accepted
Date: 2026-08-17

## Decision

Zoryvex's application layer is:

- **Frontend**: Next.js static export (`output: 'export'`) served from a private S3 bucket behind
  CloudFront with Origin Access Control. No Vercel hosting project (Vercel stays DNS/registrar-only per
  `CLAUDE.md`).
- **Backend**: API Gateway HTTP API in front of per-route AWS Lambda functions.
- **Data**: DynamoDB, on-demand billing mode, no provisioned capacity.
- **Evidence storage**: private S3, versioned, lifecycle-expired per `docs/PRIVACY_AND_RETENTION.md`.
- **State/lock**: Terraform state in a versioned, encrypted S3 bucket with S3-native locking
  (`use_lockfile = true`, Terraform >= 1.10) — no DynamoDB lock table, no Terraform Cloud.

## Rejected: always-on compute

ECS, EKS, EC2, RDS/Aurora, an Application Load Balancer, NAT Gateway, ElastiCache/Redis, Lambda provisioned
concurrency, and a default VPC are all rejected for this system, matching the existing hard boundary in
`CLAUDE.md` and the full reasoning in `docs/COST_GUARDRAILS.md` (this ADR does not restate that reasoning —
it only records the resulting architecture decision).

## Why

- **Cost at zero/low traffic**: pre-revenue and early-revenue, the platform should cost close to nothing
  when nobody is using it. Every rejected service above bills by the hour or requires a permanently-running
  resource (NAT Gateway, an ALB, a database instance) regardless of traffic; the accepted stack bills by
  request/storage.
- **Operational surface**: no OS patching, no cluster to manage, no capacity planning, appropriate for a
  solo non-technical founder who cannot operate always-on infrastructure.
- **Matches the existing auth decision**: [[docs/adr/0001-no-cognito-passwordless-email-auth]] already
  commits to API Gateway + Lambda + DynamoDB + SES for auth; this ADR generalizes the same shape to the rest
  of the application rather than introducing a second architecture style.

## Consequences

- Cold starts are possible on low-traffic Lambda functions; accepted at this stage, revisited only with
  real traffic evidence (never providing provisioned concurrency by default — that is itself a rejected
  always-on cost).
- DynamoDB access patterns must be designed up front (see `docs/DATA_MODEL.md`); there is no ad-hoc SQL
  fallback.
- CloudFront/S3 static hosting means every "dynamic" page interaction is a client-side call to the API —
  no server-rendered personalization, which is consistent with the "no SSR" boundary already fixed in
  `CLAUDE.md`.
