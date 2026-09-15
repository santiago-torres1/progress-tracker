terraform {
  required_version = ">= 1.10"

  required_providers {
    aws = {
      source = "hashicorp/aws"
      # 6.28 is the floor, not just 6.0: that release made aws_lambda_function_url
      # add the lambda:InvokeFunction permission that public Function URLs now
      # need (see lambda.tf). Older 6.x providers create a URL that returns
      # 403 Forbidden.
      version = "~> 6.28"
    }
  }

  # Partial configuration: backend blocks can't use variables, and the bucket
  # and table names are account-specific. Supply them at init time:
  #   terraform -chdir=infra/main init -backend-config=backend.hcl
  # backend.hcl is gitignored. Copy backend.hcl.example, or generate the file
  # from `terraform -chdir=infra/bootstrap output -raw backend_hcl`.
  backend "s3" {}
}
