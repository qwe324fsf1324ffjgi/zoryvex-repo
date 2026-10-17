data "aws_region" "current" {}

resource "aws_ses_domain_identity" "this" {
  domain = var.domain_name
}

resource "aws_ses_domain_dkim" "this" {
  domain = aws_ses_domain_identity.this.domain
}

resource "aws_ses_domain_mail_from" "this" {
  domain           = aws_ses_domain_identity.this.domain
  mail_from_domain = var.mail_from_subdomain
}

resource "aws_ses_configuration_set" "this" {
  name = replace(var.domain_name, ".", "-")

  reputation_metrics_enabled = true

  delivery_options {
    tls_policy = "Require"
  }
}
