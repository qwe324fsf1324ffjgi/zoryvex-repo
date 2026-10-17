terraform {
  required_version = ">= 1.10.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }

  backend "s3" {
    # Filled in via -backend-config at init time, once infrastructure/envs/bootstrap
    # has been applied. use_lockfile uses S3-native locking (Terraform >= 1.10) —
    # no DynamoDB lock table.
    # bucket       = "<from bootstrap output state_bucket_name>"
    # key          = "test/terraform.tfstate"
    # region       = "eu-west-1"
    # use_lockfile = true
    # encrypt      = true
  }
}

provider "aws" {
  region = var.aws_region
}

# CloudFront and its response-headers/cache/function resources are global,
# but a handful of associated resources (the ACM cert, and the CloudFront
# CloudWatch alarm) must be created against us-east-1 specifically,
# regardless of var.aws_region. See docs/DNS_RUNBOOK.md.
provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"
}
