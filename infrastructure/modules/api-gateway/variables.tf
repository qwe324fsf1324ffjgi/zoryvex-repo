variable "api_name" {
  type = string
}

variable "log_retention_days" {
  type = number
}

variable "cors_allow_origins" {
  description = "Exact allow-list of app origins. Never a wildcard, especially not combined with credentials."
  type        = list(string)
  default     = []
}

variable "cors_allow_methods" {
  description = "Every method apps/web/src/lib/real-api/client.ts's ApiRequestOptions can send (GET/POST/PATCH/DELETE), plus OPTIONS for the preflight itself."
  type        = list(string)
  default     = ["GET", "POST", "PATCH", "DELETE", "OPTIONS"]
}

variable "cors_allow_headers" {
  description = "content-type/authorization are the usual suspects; x-zoryvex-csrf is this app's own header (apps/web/src/lib/real-api/client.ts, checked by services/api/handlers/authorizer.ts on every mutating request) — without it here, the browser's preflight silently blocks every authenticated write after sign-in, no error surfaced client-side beyond a generic failure. idempotency-key is the Kit order-creation route's own header (apps/web/src/lib/real-api/kit.ts, required by services/api/handlers/kit/create-order.ts) — found missing here 2026-08-26 via a real live TEST checkout attempt that failed with the same silent-preflight signature."
  type        = list(string)
  default     = ["content-type", "authorization", "x-zoryvex-csrf", "idempotency-key"]
}

variable "cors_allow_credentials" {
  description = "True because auth is a __Host- cookie (see docs/adr/0001), not a bearer header — the browser must send credentials for an authenticated call to work at all."
  type        = bool
  default     = true
}

variable "throttling_burst_limit" {
  description = "Per-stage throttle burst, a cost/abuse guardrail. See docs/COST_MODEL.md."
  type        = number
  default     = 50
}

variable "throttling_rate_limit" {
  type    = number
  default = 25
}

variable "authorizer_function_invoke_arn" {
  description = "infrastructure/modules/auth output. Required, not optional: a count = <this> != null ? 1 : 0 conditional here is unresolvable on a first apply against empty state, since a newly-created Lambda's invoke ARN is not yet known at plan time (confirmed by a real terraform plan error, not a guess). Every environment in this repository always builds an auth module and wires it in, so the null-skipping path was dead code, not a genuine feature — a route can still opt out of enforcement via authorized = false on infrastructure/modules/api-route without the authorizer itself being optional here."
  type        = string
}

variable "authorizer_function_arn" {
  type = string
}

variable "custom_domain_name" {
  description = "e.g. api.zoryvex.space / test-api.zoryvex.space. Null until Stage B (see docs/DNS_RUNBOOK.md)."
  type        = string
  default     = null
}

variable "regional_acm_certificate_arn" {
  description = "Regional (same region as the API, normally eu-west-1) validated ACM cert ARN. Required when custom_domain_name is set."
  type        = string
  default     = null
}

variable "tags" {
  type    = map(string)
  default = {}
}
