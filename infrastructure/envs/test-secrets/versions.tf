terraform {
  required_version = ">= 1.10.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }

  # Founder/local-admin applied only — never wired to the GitHub Actions
  # ci-deploy-role. infrastructure/modules/ci-deploy-role's IAM policy is
  # scoped to exactly the test/* backend state-key prefix and has no grant
  # anywhere for test-secrets/*. See docs/DECISIONS.md (Phase 7 slice 9):
  # the AWS provider's aws_ssm_parameter resource reads the current value
  # (ssm:GetParameter + kms:Decrypt) on every refresh regardless of
  # lifecycle.ignore_changes on value, so any Terraform root a CI role can
  # plan/apply must never contain one of these resources directly.
  backend "s3" {
    # Filled in via -backend-config at init time, once
    # infrastructure/envs/bootstrap has been applied. Same shared state
    # bucket as every other environment, distinct key.
    # bucket       = "<from bootstrap output state_bucket_name>"
    # key          = "test-secrets/terraform.tfstate"
    # region       = "eu-west-1"
    # use_lockfile = true
    # encrypt      = true
  }
}

provider "aws" {
  region = var.aws_region
}
