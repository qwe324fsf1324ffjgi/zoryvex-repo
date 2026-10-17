# Phase 7 slice 9 — SecureString isolation from the CI-managed test stack.
#
# Both parameters below used to be aws_ssm_parameter resources in
# infrastructure/envs/test/main.tf, applied there for real during Phase 6
# (paystack_secret_key) or declared but never yet applied
# (auth_token_pepper, added Phase 7 slice 1). They move here — via
# `terraform import` in this root plus `terraform state rm` in test/, never
# a destroy/recreate — because Slice 9 gives the GitHub Actions
# ci-deploy-role permission to plan/apply infrastructure/envs/test, and the
# AWS provider's aws_ssm_parameter resource calls ssm:GetParameter (+
# kms:Decrypt for SecureString) on every refresh regardless of
# lifecycle.ignore_changes on value (hashicorp/terraform-provider-aws
# #20548, #42849). Keeping these two resources out of the CI-managed root
# is the only way to let CI deploy the application stack without CI ever
# being able to obtain the Paystack secret or the auth-token pepper.
#
# This root is applied only from the founder's own local AWS SSO session
# (see versions.tf) — infrastructure/modules/ci-deploy-role has no grant
# for this state key. infrastructure/envs/test references these two
# parameters only by their deterministically-constructed ARN/name (see the
# locals block that replaced these resources there), never by a resource
# attribute, remote-state read, or decrypting data source.

# Placeholder SecureString for the test Paystack secret key. Terraform never
# holds the real value — this creates the parameter with an unusable
# placeholder so the founder can replace it manually in the AWS Console
# (Parameter Store), never by pasting it to this assistant. lifecycle.
# ignore_changes on value is required so the next terraform apply doesn't
# revert the founder's real value back to the placeholder (also enforced by
# scripts/terraform-policy-check.mjs for every SecureString parameter).
#
# IAM access: services/api's webhooks-paystack Lambda execution role (a
# separate, narrowly-scoped runtime role — not this Terraform root's own
# applier, and not the CI deploy role) reads this (ssm:GetParameter +
# kms:Decrypt, scoped to exactly this parameter's ARN via
# secure_ssm_parameter_arns in infrastructure/envs/test) to verify inbound
# webhook signatures — read-only, never writes. That handler never calls
# outbound to Paystack (no live checkout exists anywhere in this codebase);
# only the founder's own SSO admin session can write this parameter's real
# value.
resource "aws_ssm_parameter" "paystack_secret_key" {
  name        = "/zoryvex/test/paystack/secret-key"
  description = "Placeholder only — founder replaces the value manually in AWS Console. Never set via Terraform."
  type        = "SecureString"
  tier        = "Standard"
  value       = "REPLACE-IN-AWS-CONSOLE-NOT-A-REAL-PAYSTACK-KEY"
  tags        = var.tags

  lifecycle {
    ignore_changes = [value]
  }
}

# HMAC key for hashing magic-link tokens/session ids/CSRF tokens at rest
# (docs/adr/0001-no-cognito-passwordless-email-auth.md: "only a keyed hash
# ... is stored, never the raw value"). Same placeholder-then-replace shape
# as the Paystack parameter above, but the replacement step is run by this
# assistant via scripts/generate-auth-token-pepper.mjs immediately after
# apply (not a founder browser/Console action) — this value has no external
# owner, it just needs to exist and never be visible to anyone. That script
# checks the parameter's Version via metadata only (same technique already
# used to confirm the Paystack replacement in Phase 6) and only generates a
# value the first time (Version == 1), so a second run is a safe no-op
# rather than a silent rotation that would invalidate every session.
#
# Not yet applied anywhere as of this migration (confirmed via
# `aws ssm describe-parameters` returning no live parameter under this
# name) — its first-ever apply happens here, in this founder-only root, not
# in the CI-managed test stack.
resource "aws_ssm_parameter" "auth_token_pepper" {
  name        = "/zoryvex/test/auth/token-pepper"
  description = "Placeholder only — replaced by scripts/generate-auth-token-pepper.mjs right after apply. Never set via Terraform."
  type        = "SecureString"
  tier        = "Standard"
  value       = "GENERATED-BY-SCRIPT-IMMEDIATELY-AFTER-APPLY-NOT-A-REAL-PEPPER"
  tags        = var.tags

  lifecycle {
    ignore_changes = [value]
  }
}

# Raises GitHub's anonymous rate limit for repository verification.
#
# services/api/src/repositories/github-repository.ts read
# `process.env.GITHUB_TOKEN` and no Terraform in either environment ever set
# it, so every GitHub call this product has made has been unauthenticated.
# Measured against the live API on 2026-09-13 that is 60 requests an hour per
# IP, and one verification spends three: roughly twenty verifications an hour
# for the whole platform, sharing a Lambda egress address.
#
# A SecureString, and therefore in this root rather than in envs/test: the
# AWS provider calls GetParameter and kms:Decrypt on every refresh regardless
# of ignore_changes, so a parameter of this type in a root the CI deploy role
# can plan would hand CI the plaintext merely by deploying. Same reasoning as
# the two parameters above, and the reason envs/test refers to it by
# deterministic name and ARN only.
#
# Placeholder, then replaced by hand. The founder creates a fine-grained
# token with NO scopes and read-only access to public data, which is all the
# verifier needs: it reads public gists, public repositories and their
# contributor lists, and nothing else. The empty placeholder is not an error
# state — getGithubToken treats absent, empty and unreadable alike and
# carries on unauthenticated, which is exactly how production behaves today.
resource "aws_ssm_parameter" "github_token" {
  name        = "/zoryvex/test/github/token"
  description = "Placeholder only — founder replaces the value manually. Fine-grained token, no scopes, public read only. Raises GitHub's 60/hour anonymous limit; the verifier works without it."
  type        = "SecureString"
  tier        = "Standard"
  value       = "REPLACE-IN-AWS-CONSOLE-NOT-A-REAL-GITHUB-TOKEN"
  tags        = var.tags

  lifecycle {
    ignore_changes = [value]
  }
}
