# DNS validation only (no email validation — doesn't depend on a mailbox
# existing at the domain). Terraform never guesses or hard-codes the
# validation token; AWS generates it and it is only ever read back via the
# domain_validation_options attribute below, exposed as an output for the
# founder to enter into Vercel DNS by hand (Vercel remains the only DNS
# authority — see CLAUDE.md).
resource "aws_acm_certificate" "this" {
  domain_name               = var.domain_name
  subject_alternative_names = var.subject_alternative_names
  validation_method         = "DNS"
  tags                      = var.tags

  lifecycle {
    create_before_destroy = true
  }
}

# Stage B only. Left absent (not merely 0-count-and-ignored) during Stage A
# so a Stage-A apply can never hang waiting on records that don't exist yet.
resource "aws_acm_certificate_validation" "this" {
  count = var.validate ? 1 : 0

  certificate_arn = aws_acm_certificate.this.arn
}
