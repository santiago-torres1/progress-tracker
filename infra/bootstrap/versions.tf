terraform {
  # >= 1.10 so the S3 backend in infra/main can later switch to native S3 locking
  # (use_lockfile = true) without a Terraform upgrade.
  required_version = ">= 1.10"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }

  # Intentionally no backend block: this root uses LOCAL state. See main.tf.
}
