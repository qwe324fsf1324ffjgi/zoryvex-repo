terraform {
  required_version = ">= 1.10.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }

  backend "s3" {
    # Filled in via -backend-config at init time.
    # bucket       = "<bootstrap output: state_bucket_name>"
    # key          = "foundation/terraform.tfstate"
    # region       = "eu-west-1"
    # use_lockfile = true
    # encrypt      = true
  }
}

provider "aws" {
  region = var.aws_region
}

# CloudFront certificates must be in us-east-1 regardless of the
# application's primary region.
provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"
}
