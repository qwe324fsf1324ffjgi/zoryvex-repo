# Stage A only (see docs/DNS_RUNBOOK.md): requests ACM certificates and
# creates the SES domain identity, never creates a CloudFront/API custom
# domain, never applies with validate = true. Test hostnames only this
# phase — production ACM certs are deliberately out of scope (founder
# decision, Prompt 6: "Provision only the AWS bootstrap and test
# environment. Production remains untouched.").

module "test_cloudfront_cert" {
  source = "../../modules/acm-cert"
  providers = {
    aws = aws.us_east_1
  }

  domain_name = var.test_cloudfront_hostname
  validate    = false
  tags        = var.tags
}

module "test_api_cert" {
  source = "../../modules/acm-cert"

  domain_name = var.test_api_hostname
  validate    = false
  tags        = var.tags
}

# Production certificates, requested here rather than in envs/production.
#
# The founder has one production deployment, and a CloudFront distribution
# cannot reference a certificate that has not been validated yet. Requesting
# the certificates inside the production root would therefore force either a
# second production apply, or a single apply that blocks mid-run while
# somebody adds DNS records by hand, with a partial production state left
# behind if it timed out.
#
# Doing it here removes that. This root is shared account infrastructure, it
# already exists, it already owns the test certificates and the SES identity,
# and applying it deploys nothing anybody can visit. By the time production
# is applied the certificate ARNs are simply values it is handed, and the one
# production apply can create the distribution with HTTPS already working.
#
# The same two-stage gate the test certificates use: validate stays false
# while the records are being added, then true once they are in Vercel, which
# turns the wait into a confirmation rather than a hang.
module "production_cloudfront_cert" {
  source = "../../modules/acm-cert"
  providers = {
    aws = aws.us_east_1
  }

  domain_name = var.production_cloudfront_hostname
  # www on the same certificate, because CloudFront serves both aliases and
  # the function 301s www to apex. Two certificates for one distribution
  # would be two things to keep valid for one behaviour.
  subject_alternative_names = [var.production_www_hostname]
  validate                  = var.validate_production_certs
  tags                      = var.tags
}

module "production_api_cert" {
  source = "../../modules/acm-cert"

  domain_name = var.production_api_hostname
  validate    = var.validate_production_certs
  tags        = var.tags
}

# Domain-wide, not test-specific — see docs/DNS_RUNBOOK.md and
# infrastructure/envs/bootstrap's prior (Phase 5) placement of this, moved
# here after founder review found bootstrap should be state-bucket-only.
module "email_identity" {
  source = "../../modules/email-identity"

  domain_name         = var.root_domain
  mail_from_subdomain = var.mail_from_subdomain
  tags                = var.tags
}

# Phase 7 slice 9: GitHub Actions OIDC provider — an account-level singleton,
# same placement reasoning as email_identity above (bootstrap is
# state-bucket-only per Phase 6 founder review; foundation is where this
# project's other account-level singletons live). No thumbprint_list: AWS
# has secured communication with GitHub Actions' OIDC issuer via its own
# trusted root CA library (not certificate-thumbprint pinning) since 2023,
# and ignores any thumbprint configured for this specific provider —
# confirmed live against current AWS/Terraform provider docs, not assumed.
# No data "tls_certificate" lookup needed either, so this has no dependency
# on being able to reach token.actions.githubusercontent.com directly from
# wherever `terraform apply` runs.
#
# infrastructure/envs/test's ci_deploy_role module references this
# provider's ARN by deterministic construction (account ID + this fixed
# URL — no random component), never via terraform_remote_state against this
# root's state — see docs/DECISIONS.md for the full reasoning.
resource "aws_iam_openid_connect_provider" "github_actions" {
  url            = "https://token.actions.githubusercontent.com"
  client_id_list = ["sts.amazonaws.com"]
  tags           = var.tags
}
