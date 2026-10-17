output "certificate_arn" {
  description = "Usable immediately by name (e.g. wired into another module's variable) even during Stage A — AWS assigns the ARN at creation, before validation completes. Anything that actually serves traffic over TLS with this cert (CloudFront/API Gateway) must not be pointed at it for real until Stage B has run, though — an unvalidated cert cannot serve HTTPS."
  value       = aws_acm_certificate.this.arn
}

output "validated_certificate_arn" {
  description = "Null until Stage B (validate = true). Prefer this output, not certificate_arn, when wiring the cert into CloudFront/API Gateway for a real cutover."
  value       = var.validate ? aws_acm_certificate_validation.this[0].certificate_arn : null
}

# One row per DNS validation record AWS requires — the exact Vercel-
# compatible table for Stage A's HUMAN ACTION REQUIRED.
output "validation_records" {
  value = [
    for dvo in aws_acm_certificate.this.domain_validation_options : {
      type  = "CNAME"
      name  = dvo.resource_record_name
      value = dvo.resource_record_value
    }
  ]
}
