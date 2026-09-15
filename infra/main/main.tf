# -----------------------------------------------------------------------------
# infra/main: runtime infrastructure for progress-tracker
#
#   ecr.tf          backend container image repository
#   lambda.tf       backend Lambda (container image) + public Function URL
#                   (READ ITS HEADER: first-time setup needs two applies)
#   frontend.tf     private S3 bucket + CloudFront (OAC) for the SPA
#   github_oidc.tf  GitHub Actions OIDC provider + least-privilege deploy role
#   outputs.tf      values for GitHub secrets
#
# State lives in the S3 bucket and DynamoDB table created by infra/bootstrap.
# -----------------------------------------------------------------------------

data "aws_caller_identity" "current" {}

locals {
  account_id  = data.aws_caller_identity.current.account_id
  name_prefix = "${var.project_name}-${var.environment}"

  lambda_function_name = "${local.name_prefix}-backend"
}
