variable "aws_region" {
  description = "Region for the regional (API Gateway) ACM certificate."
  type        = string
  default     = "eu-west-1"
}

variable "test_cloudfront_hostname" {
  description = "us-east-1 cert — CloudFront requires the cert to be there regardless of the application's primary region."
  type        = string
  default     = "test.zoryvex.space"
}

variable "test_api_hostname" {
  description = "Regional (same region as the API) cert."
  type        = string
  default     = "test-api.zoryvex.space"
}

variable "production_cloudfront_hostname" {
  description = "Apex, on the us-east-1 certificate CloudFront requires."
  type        = string
  default     = "zoryvex.space"
}

variable "production_www_hostname" {
  description = "Carried as a subject alternative name on the same certificate, because one distribution serves both aliases."
  type        = string
  default     = "www.zoryvex.space"
}

variable "production_api_hostname" {
  description = "Regional (same region as the API) certificate."
  type        = string
  default     = "api.zoryvex.space"
}

variable "validate_production_certs" {
  description = <<-EOT
    Stage gate for the production certificates only, so the test ones are
    never affected by flipping it.

    False while the validation CNAMEs are being added in Vercel: the
    certificates are requested and their records exposed in the
    vercel_dns_records output, and nothing blocks.

    True once those records are in place, which turns the next apply into a
    short confirmation that AWS has issued them. Only then is
    validated_certificate_arn non-null, and only then should production be
    applied — a CloudFront distribution cannot serve HTTPS from a
    certificate that has not been validated.
  EOT
  type        = bool
  default     = false
}

variable "root_domain" {
  type    = string
  default = "zoryvex.space"
}

variable "mail_from_subdomain" {
  type    = string
  default = "mail.zoryvex.space"
}

variable "tags" {
  description = "Applied to both the test-scoped ACM certs and the domain-wide SES identity — deliberately no Environment tag, since SES identity is not test-specific."
  type        = map(string)
  default     = { Project = "zoryvex" }
}
