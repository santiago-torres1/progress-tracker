# Most outputs feed a GitHub Actions secret of the same meaning (named in each
# description). None of them are credentials. After pass 2, set all six at once
# with the loop in the `github_secrets` description.

output "aws_region" {
  description = "GitHub secret: AWS_REGION"
  value       = var.aws_region
}

output "github_actions_role_arn" {
  description = "GitHub secret: AWS_ROLE_ARN (the role deploy.yml assumes via OIDC)"
  value       = aws_iam_role.github_actions_deploy.arn
}

output "ecr_repository_url" {
  description = "GitHub secret: ECR_REPOSITORY_URI"
  value       = aws_ecr_repository.backend.repository_url
}

output "lambda_function_name" {
  description = "GitHub secret: LAMBDA_FUNCTION_NAME"
  value       = aws_lambda_function.backend.function_name
}

output "frontend_bucket_name" {
  description = "GitHub secret: S3_FRONTEND_BUCKET"
  value       = aws_s3_bucket.frontend.bucket
}

output "cloudfront_distribution_id" {
  description = "GitHub secret: CLOUDFRONT_DISTRIBUTION_ID"
  value       = aws_cloudfront_distribution.frontend.id
}

# Not a secret: CI discovers it at deploy time via lambda:GetFunctionUrlConfig.
output "lambda_function_url" {
  description = "Public backend URL (ends with /). Smoke test: curl \"$(terraform -chdir=infra/main output -raw lambda_function_url)health\""
  value       = aws_lambda_function_url.backend.function_url
}

# Not a secret: the app's public address.
output "cloudfront_domain_name" {
  description = "Frontend URL host (https://<this>)."
  value       = aws_cloudfront_distribution.frontend.domain_name
}

output "github_secrets" {
  description = <<-EOT
    GitHub secret name -> value, for every AWS-derived secret (SUPABASE_* are set separately).
    Set them all with the GitHub CLI (from the repo root):
      terraform -chdir=infra/main output -json github_secrets \
        | jq -r 'to_entries[] | "\(.key)\t\(.value)"' \
        | while IFS=$'\t' read -r name value; do gh secret set "$name" --body "$value"; done
  EOT
  value = {
    AWS_REGION                 = var.aws_region
    AWS_ROLE_ARN               = aws_iam_role.github_actions_deploy.arn
    ECR_REPOSITORY_URI         = aws_ecr_repository.backend.repository_url
    LAMBDA_FUNCTION_NAME       = aws_lambda_function.backend.function_name
    S3_FRONTEND_BUCKET         = aws_s3_bucket.frontend.bucket
    CLOUDFRONT_DISTRIBUTION_ID = aws_cloudfront_distribution.frontend.id
  }
}
