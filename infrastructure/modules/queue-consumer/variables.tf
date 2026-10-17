variable "function_name" {
  type = string
}

variable "handler" {
  type = string
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
  default = 30
}

variable "reserved_concurrent_executions" {
  description = "Spend-guardrail ceiling (not a performance floor). -1 means unreserved. See docs/COST_MODEL.md."
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

variable "queue_arn" {
  description = "SQS queue this function consumes via an event source mapping."
  type        = string
}

variable "batch_size" {
  type    = number
  default = 1
}

variable "dynamodb_table_arn" {
  type    = string
  default = null
}

variable "dynamodb_index_arns" {
  type    = list(string)
  default = []
}

variable "evidence_bucket_arn" {
  type    = string
  default = null
}

variable "secure_ssm_parameter_arns" {
  type    = list(string)
  default = []
}

variable "tags" {
  type    = map(string)
  default = {}
}
