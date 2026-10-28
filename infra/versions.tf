terraform {
  required_version = ">= 1.6"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }
}

provider "aws" {
  region = var.region
  # null uses the usual chain: AWS_PROFILE, then the default profile
  profile = var.aws_profile

  default_tags {
    tags = {
      Project   = "coldroute-sg"
      ManagedBy = "terraform"
    }
  }
}
