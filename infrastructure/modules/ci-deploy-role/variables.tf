variable "environment_name" {
  description = "test | production."
  type        = string
}

variable "oidc_provider_arn" {
  type = string
}

variable "subject_claim" {
  description = "Exact token.actions.githubusercontent.com:sub value this role trusts. Never a wildcard across environments — see infrastructure/envs/bootstrap for how test vs production differ."
  type        = string
}

variable "aws_region" {
  type = string
}

variable "account_id" {
  type = string
}

variable "state_bucket_arn" {
  description = "ARN of the shared Terraform state bucket (infrastructure/envs/bootstrap). This role only ever gets access to its own environment's state-object and lock-object keys within it — never the whole bucket, never another environment's key."
  type        = string
}

variable "guardduty_detector_arn" {
  description = "This environment's aws_guardduty_detector.this.arn — GuardDuty detector IDs are AWS-assigned (not deterministic like a bucket/parameter name), so guardduty:GetDetector is scoped to this exact ARN rather than a wildcard."
  type        = string
}

variable "lambda_default_kms_key_arn" {
  description = "ARN of the account's default alias/aws/lambda key (data.aws_kms_key in the calling root) — needed for kms:Decrypt/DescribeKey when Terraform refreshes a Lambda function's encrypted environment variables. Key ARNs are AWS-assigned, not deterministic, same reasoning as guardduty_detector_arn."
  type        = string
}

variable "dynamodb_default_kms_key_arn" {
  description = "ARN of the account's default alias/aws/dynamodb key (data.aws_kms_key in the calling root) — needed for kms:DescribeKey when Terraform refreshes a DynamoDB table's encryption settings."
  type        = string
}

variable "tags" {
  type    = map(string)
  default = {}
}
