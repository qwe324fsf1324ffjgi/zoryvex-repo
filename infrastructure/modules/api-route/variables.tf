variable "function_name" {
  type = string
}

variable "handler" {
  description = "Lambda handler entrypoint, e.g. handlers/health.handler."
  type        = string
}

variable "deployment_package_path" {
  description = "Path to the built handler zip. Built by CI, never committed."
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
  type    = number
  default = 10
}

variable "reserved_concurrent_executions" {
  description = "Spend-guardrail ceiling (not a performance floor — no provisioned concurrency). -1 means unreserved. See docs/COST_MODEL.md."
  type        = number
  default     = 20
}

variable "environment_variables" {
  description = "Non-secret environment variables only. Secrets are read from Parameter Store at runtime."
  type        = map(string)
  default     = {}
}

variable "log_retention_days" {
  type = number
}

variable "route_key" {
  description = "e.g. GET /health."
  type        = string
}

variable "api_id" {
  type = string
}

variable "api_execution_arn" {
  type = string
}

variable "authorized" {
  description = "Whether this route requires the API's REQUEST authorizer."
  type        = bool
  default     = false
}

variable "authorizer_id" {
  description = "infrastructure/modules/api-gateway output. Required when authorized = true."
  type        = string
  default     = null
}

variable "dynamodb_table_arn" {
  description = "Grants this handler's execution role scoped read/write on the core table. Null grants nothing (e.g. a handler that never touches DynamoDB)."
  type        = string
  default     = null
}

variable "dynamodb_index_arns" {
  type    = list(string)
  default = []
}

variable "evidence_bucket_arn" {
  description = "Grants scoped s3:GetObject/PutObject on this bucket's accepted/ prefix only. Null grants nothing."
  type        = string
  default     = null
}

variable "queue_arns" {
  description = "Grants scoped sqs:SendMessage on exactly these queues. Empty grants nothing."
  type        = list(string)
  default     = []
}

variable "secure_ssm_parameter_arns" {
  description = "Grants scoped ssm:GetParameter + kms:Decrypt (via the SSM service only, AWS-managed key) on exactly these SecureString parameter ARNs. Empty grants nothing."
  type        = list(string)
  default     = []
}

variable "ses_identity_arn" {
  description = "Grants scoped ses:SendEmail/ses:SendRawEmail restricted to this one verified SES identity ARN. Null grants nothing."
  type        = string
  default     = null
}

variable "ses_configuration_set_arn" {
  description = "SES also authorizes SendEmail against the configuration-set resource whenever the caller passes a ConfigurationSetName (every real send in this codebase does) — required in addition to ses_identity_arn, not instead of it. Null is only safe if this route's SES call never sets a ConfigurationSetName."
  type        = string
  default     = null
}

variable "sns_publish_arns" {
  description = "Grants scoped sns:Publish on exactly these SNS topic ARNs. Empty grants nothing."
  type        = list(string)
  default     = []
}

variable "bedrock_invoke_arns" {
  description = "Grants scoped bedrock:InvokeModel on exactly these ARNs (an inference-profile ARN plus the foundation-model ARN(s) it routes to — AWS requires both, see docs/DECISIONS.md). Empty grants nothing."
  type        = list(string)
  default     = []
}

variable "tags" {
  type    = map(string)
  default = {}
}
