variable "function_name" {
  description = "Lambda function name for the API Gateway REQUEST authorizer."
  type        = string
}

variable "handler" {
  type    = string
  default = "handlers/authorizer.handler"
}

variable "deployment_package_path" {
  description = "Path to the built authorizer handler zip. Built by CI, never committed."
  type        = string
}

variable "runtime" {
  type    = string
  default = "nodejs24.x"
}

variable "memory_size" {
  type    = number
  default = 256
}

variable "timeout_seconds" {
  description = "Kept short: API Gateway itself times out a REQUEST authorizer call after a fixed ceiling, and every extra second here is added latency on every authenticated request."
  type        = number
  default     = 5
}

variable "environment_variables" {
  description = "Non-secret environment variables only. Secrets are read from Parameter Store at runtime."
  type        = map(string)
  default     = {}
}

variable "log_retention_days" {
  type = number
}

variable "reserved_concurrent_executions" {
  description = "Spend-guardrail ceiling, not a performance floor (no provisioned concurrency — CLAUDE.md 'no always-on compute'). Every authenticated request invokes this function, so an unbounded runaway here is an unbounded API Gateway request rate too; -1 means unreserved (shares the account's pooled concurrency). Raise only with real load evidence, per docs/COST_MODEL.md."
  type        = number
  default     = 20
}

variable "sessions_table_arn" {
  description = "Core table ARN. The authorizer only ever needs to read a session item by key — least privilege: GetItem only, no Query/Scan/Write, scoped to this exact table ARN."
  type        = string
}

variable "auth_token_pepper_parameter_arn" {
  description = "SecureString parameter ARN holding the HMAC key used to hash session ids/CSRF tokens at rest — see the auth ADR in docs/adr/."
  type        = string
}

variable "tags" {
  type    = map(string)
  default = {}
}
