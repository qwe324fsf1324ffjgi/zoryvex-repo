variable "aws_region" {
  description = "Region for the Terraform state bucket."
  type        = string
  default     = "eu-west-1"
}

variable "state_bucket_name" {
  description = "Globally unique S3 bucket name for Terraform state, across all environments."
  type        = string
}

variable "tags" {
  type    = map(string)
  default = { Project = "zoryvex" }
}
