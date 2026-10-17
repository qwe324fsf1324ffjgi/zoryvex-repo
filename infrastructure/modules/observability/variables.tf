variable "environment_name" {
  description = "test | production — used in resource names/alarm descriptions only."
  type        = string
}

variable "alert_email" {
  description = "Founder's personal Gmail, used only as the alert recipient (see docs/MANUAL_ACTIONS.md). Never given a default and never committed — supplied via a real (gitignored) terraform.tfvars, same pattern as every other environment-specific value in this repo."
  type        = string
  sensitive   = true
}

variable "api_gateway_id" {
  description = "HTTP API (v2) CloudWatch metrics are dimensioned by ApiId, not ApiName."
  type        = string
}

variable "api_lambda_function_name" {
  description = "Currently the only real handler (GET /health) — will become a list once the backend-implementation phase adds more routes behind infrastructure/modules/api-route."
  type        = string
}

variable "authorizer_lambda_function_name" {
  type = string
}

variable "dynamodb_table_name" {
  type = string
}

variable "ses_configuration_set_name" {
  description = "Null until SES sends anything (bounce/complaint metrics have nothing to alarm on before then)."
  type        = string
  default     = null
}

variable "api_5xx_threshold" {
  type    = number
  default = 5
}

# Deliberately lower than the burst threshold, over a much longer window.
# Three server errors in an hour is not noise at this traffic level: it is a
# workflow that has stopped working for whoever tried it. Two is too eager,
# because a deploy replaces Lambda code in place and can drop a request or
# two while it does.
variable "api_5xx_sustained_threshold" {
  type    = number
  default = 3
}

variable "api_latency_ms_threshold" {
  type    = number
  default = 3000
}

variable "lambda_error_threshold" {
  type    = number
  default = 5
}

variable "dynamodb_throttle_threshold" {
  type    = number
  default = 1
}

variable "allow_eventbridge_rule_arns" {
  description = "Grants events.amazonaws.com sns:Publish on the alerts topic, scoped via aws:SourceArn to exactly these EventBridge rule ARNs (e.g. an ACM certificate-expiry rule declared in the calling env). Empty grants nothing — same pattern as infrastructure/modules/messaging's identical variable for its SQS queue."
  type        = list(string)
  default     = []
}

variable "tags" {
  type    = map(string)
  default = {}
}
