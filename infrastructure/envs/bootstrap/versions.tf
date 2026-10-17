terraform {
  required_version = ">= 1.10.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }

  # This config created the very S3 bucket its own state now lives in — the
  # standard bootstrap chicken-and-egg resolution: apply once with local
  # state, then `terraform init -migrate-state` into the bucket it just
  # created. Filled in via -backend-config at init time (bucket name is not
  # committed here since it embeds the AWS account ID).
  backend "s3" {
    # bucket       = "<from the bootstrap apply's state_bucket_name output>"
    # key          = "bootstrap/terraform.tfstate"
    # region       = "eu-west-1"
    # use_lockfile = true
    # encrypt      = true
  }
}

provider "aws" {
  region = var.aws_region
}
