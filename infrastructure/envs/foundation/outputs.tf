# One row per DNS record the Vercel dashboard needs — combined from all
# three sub-resources so the founder gets one exact table, not three.
output "vercel_dns_records" {
  value = concat(
    [for r in module.test_cloudfront_cert.validation_records : merge(r, { purpose = "ACM validation — test.zoryvex.space (CloudFront)", environment = "test" })],
    [for r in module.test_api_cert.validation_records : merge(r, { purpose = "ACM validation — test-api.zoryvex.space (API Gateway)", environment = "test" })],
    [for r in module.production_cloudfront_cert.validation_records : merge(r, { purpose = "ACM validation — zoryvex.space and www.zoryvex.space (CloudFront)", environment = "production" })],
    [for r in module.production_api_cert.validation_records : merge(r, { purpose = "ACM validation — api.zoryvex.space (API Gateway)", environment = "production" })],
    [for r in module.email_identity.dns_records : merge(r, { purpose = "SES domain identity / DKIM / MAIL FROM / DMARC — zoryvex.space", environment = "shared (not test/production-specific)" })],
  )
}

output "test_cloudfront_certificate_arn" {
  value = module.test_cloudfront_cert.certificate_arn
}

output "test_api_certificate_arn" {
  value = module.test_api_cert.certificate_arn
}

output "ses_configuration_set_name" {
  value = module.email_identity.configuration_set_name
}

output "ses_domain_identity_arn" {
  value = module.email_identity.domain_identity_arn
}

# Convenience/verification only — infrastructure/envs/test never reads this
# via remote state; it constructs the same ARN deterministically itself.
output "github_actions_oidc_provider_arn" {
  value = aws_iam_openid_connect_provider.github_actions.arn
}

# The two production certificates. Use the validated_ outputs when wiring
# them into envs/production: they are null until validate_production_certs
# is true, which makes it impossible to point a distribution at a
# certificate AWS has not issued yet.
output "production_cloudfront_certificate_arn" {
  value = module.production_cloudfront_cert.certificate_arn
}

output "production_api_certificate_arn" {
  value = module.production_api_cert.certificate_arn
}

output "production_cloudfront_validated_certificate_arn" {
  value = module.production_cloudfront_cert.validated_certificate_arn
}

output "production_api_validated_certificate_arn" {
  value = module.production_api_cert.validated_certificate_arn
}
