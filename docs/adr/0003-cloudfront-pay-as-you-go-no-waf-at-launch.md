# ADR 0003: CloudFront pay-as-you-go (not the $0 flat-rate plan), no WAF at launch

Status: Accepted
Date: 2026-08-18

## Decision

`infrastructure/modules/static-site`'s `aws_cloudfront_distribution` uses standard pay-as-you-go billing,
not CloudFront's $0/month flat-rate "Free" plan. No `aws_wafv2_web_acl` is created at launch.

## Why (flat-rate plan)

Prompt 5 asked to prefer the flat-rate $0 plan if Terraform/console management, account eligibility, the
quota, the required WAF association, and this distribution's own security-header/cache-behavior needs all
pass. Verified live, 2026-08-18 (see `docs/SOURCES.md`):

- The `aws_cloudfront_distribution` Terraform resource has **no argument for selecting a flat-rate plan**.
  This is tracked as an open, unresolved feature request against `hashicorp/terraform-provider-aws`
  (issue #45450, linked PR #49235 still open, unmerged) — enrollment is console-only today.
- Terraform owning all supported AWS resources (`CLAUDE.md`) rules out a console-only enrollment step that
  Terraform can't represent, re-apply idempotently, or keep in sync with the rest of this distribution's
  configuration.
- AWS's own pricing page additionally shows WAF as unavailable on the Free tier specifically (bundled only
  from the $15/month Pro tier up) — the "required WAF association" premise in Prompt 5's text does not hold
  for the $0 tier specifically, a second, independent reason it wouldn't have satisfied the stated
  preference conditions even if Terraform could manage it.

Per Prompt 5's own fallback instruction ("If either is unsupported, use the documented safe fallback"):
pay-as-you-go, with cost alarms (`infrastructure/modules/observability`) and a documented idle floor (see
`docs/COST_MODEL.md`) — never Route 53 for the bundle, and never a claim that other AWS usage charges can't
occur.

## Why (no WAF)

AWS WAFv2 is not bundled at $0 on the (pay-as-you-go) path this ADR selects — it is a real, separate,
sustained fixed cost verified live 2026-08-18: $5/month per web ACL + $1/month per attached rule/rule group

- $0.60 per million requests evaluated (see `docs/SOURCES.md`). Prompt 5's own instruction: "if AWS WAF is
  included in the selected CloudFront plan, use current managed core rules and rate limits; otherwise
  document the risk and activation trigger without silently adding fixed cost." Since it is not included on
  this path, it is not created.

**Risk accepted**: no L7 web-application-firewall layer (managed core rule set, bot control, IP reputation)
in front of CloudFront at launch. Mitigated in the meantime by: CloudFront/Shield Standard's always-on,
automatic, no-cost DDoS protection (unrelated to WAFv2 and unaffected by this decision); API Gateway's
per-stage throttle limits (`infrastructure/modules/api-gateway`); the REQUEST authorizer's per-request
verification (`infrastructure/modules/auth`); and CloudWatch alarms on API 4xx/5xx rate and CloudFront
error rate (`infrastructure/modules/observability`), which are the earliest signal this project actually
has visibility into today.

**Activation trigger** (tracked in `docs/RISK_REGISTER.md`): sustained abusive traffic actually observed via
those alarms (repeated credential-stuffing-shaped 4xx bursts, a CloudFront error-rate spike with no
corresponding legitimate traffic increase, or a cost-anomaly alert traced to request volume) — not a
calendar date, not "before commercial launch" by default. When triggered, add one `aws_wafv2_web_acl`
scoped to CloudFront with the AWS Managed Core Rule Set plus a rate-based rule, as its own reviewed,
budgeted Terraform change (`docs/COST_GUARDRAILS.md`'s "before any optional spend" checklist applies).

## Consequences

- CloudFront's per-request/per-GB pay-as-you-go pricing means true idle cost is close to (but not exactly)
  zero — see `docs/COST_MODEL.md` for the exact assumptions.
- Revisiting this decision to the flat-rate plan later requires re-checking Terraform provider support
  (issue #45450) — do not assume it has landed without re-verifying against current official documentation
  first, per this project's CURRENT-DOC GATE discipline.
