variable "function_name" {
  type = string
}

variable "handler" {
  type = string
}

variable "deployment_package_path" {
  type = string
}

variable "runtime" {
  type    = string
  default = "nodejs22.x"
}

variable "memory_size" {
  type    = number
  default = 256
}

variable "timeout_seconds" {
  type    = number
  default = 60
}

variable "reserved_concurrent_executions" {
  description = "A scheduled job needs exactly one runner; 1 also caps its worst-case cost."
  type        = number
  default     = 1
}

variable "environment_variables" {
  type    = map(string)
  default = {}
}

variable "log_retention_days" {
  type = number
}

variable "schedule_expression" {
  description = "EventBridge Scheduler expression, e.g. cron(0 9 * * ? *)."
  type        = string
}

variable "schedule_timezone" {
  type    = string
  default = "UTC"
}

variable "enabled" {
  description = "Whether the schedule fires. Default false: a scheduled job never starts because a deploy shipped."
  type        = bool
  default     = false
}

variable "dynamodb_table_arn" {
  type    = string
  default = null
}

variable "dynamodb_index_arns" {
  type    = list(string)
  default = []
}

variable "ses_identity_arns" {
  type    = list(string)
  default = []
}

variable "ssm_parameter_arns" {
  type    = list(string)
  default = []
}

variable "tags" {
  type    = map(string)
  default = {}
}

variable "secure_ssm_parameter_arns" {
  description = "SecureString Parameter Store ARNs this job may read. Adds the kms:Decrypt grant a SecureString needs, scoped by kms:ViaService to SSM in this region."
  type        = list(string)
  default     = []
}

variable "sns_publish_arns" {
  description = "SNS topic ARNs this job may publish to. Used for the mandatory operational alerts, never for anything customer-facing."
  type        = list(string)
  default     = []
}
