# -----------------------------------------------------------------------------
# Backend Lambda (container image) + public Function URL
#
# FIRST-TIME SETUP NEEDS TWO APPLIES
# A Lambda with package_type = "Image" can't be created until an image exists
# in ECR, and the ECR repository is created by this same root. So:
#
#   Pass 1: create only the ECR repository (run from the repo root)
#     terraform -chdir=infra/main init -backend-config=backend.hcl
#     terraform -chdir=infra/main apply -target=aws_ecr_repository.backend
#
#     The lifecycle policy doesn't need targeting. Between the passes the
#     repository holds exactly one image, so there's nothing to expire, and
#     pass 2 creates the policy. (The "resource targeting is in effect" warning
#     is expected.)
#
#   Push the bootstrap image (from the repo root, with Docker running and AWS
#   credentials for the account)
#     REGION=us-east-1   # same as var.aws_region
#     REPO="$(terraform -chdir=infra/main output -raw ecr_repository_url)"
#     aws ecr get-login-password --region "$REGION" \
#       | docker login --username AWS --password-stdin "${REPO%%/*}"
#     docker buildx build --platform linux/amd64 --provenance=false \
#       --build-arg GIT_SHA=bootstrap -t "$REPO:bootstrap" --push backend
#
#     --platform linux/amd64: the function is x86_64.
#     --provenance=false: Lambda rejects OCI image indexes that carry
#     attestation manifests.
#
#   Pass 2: create everything else
#     terraform -chdir=infra/main apply
#
# After that, CI owns the image and the environment variables (see the
# lifecycle block below). Later changes to this root need a plain
# `terraform apply` only.
# -----------------------------------------------------------------------------

# --- Execution role -----------------------------------------------------------

data "aws_iam_policy_document" "lambda_assume_role" {
  statement {
    sid     = "LambdaServiceAssumeRole"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "lambda_exec" {
  name               = "${local.lambda_function_name}-exec"
  description        = "Execution role for the ${local.lambda_function_name} Lambda function."
  assume_role_policy = data.aws_iam_policy_document.lambda_assume_role.json
}

# Custom policy instead of the managed AWSLambdaBasicExecutionRole: that
# managed policy allows logs:CreateLogGroup/CreateLogStream/PutLogEvents on
# Resource "*" (every log group in the account). This one allows writing only
# to this function's log group. CreateLogGroup isn't needed because Terraform
# creates the group below, with a retention policy.
data "aws_iam_policy_document" "lambda_logs" {
  statement {
    sid     = "WriteOwnLogGroupOnly"
    actions = ["logs:CreateLogStream", "logs:PutLogEvents"]
    # The provider's log group `arn` has no trailing ":*". The suffix is added
    # here so the statement covers the group's log streams.
    resources = ["${aws_cloudwatch_log_group.lambda.arn}:*"]
  }
}

resource "aws_iam_role_policy" "lambda_logs" {
  name   = "write-own-logs"
  role   = aws_iam_role.lambda_exec.id
  policy = data.aws_iam_policy_document.lambda_logs.json
}

# Created explicitly so it has a retention period. If Lambda auto-created it,
# the log group would keep (and bill for) logs forever.
resource "aws_cloudwatch_log_group" "lambda" {
  name              = "/aws/lambda/${local.lambda_function_name}"
  retention_in_days = var.log_retention_days
}

# --- Function -----------------------------------------------------------------

resource "aws_lambda_function" "backend" {
  function_name = local.lambda_function_name
  description   = "progress-tracker Express backend (serverless-http)"
  role          = aws_iam_role.lambda_exec.arn

  package_type  = "Image"
  image_uri     = "${aws_ecr_repository.backend.repository_url}:${var.bootstrap_image_tag}"
  architectures = ["x86_64"]

  memory_size = var.lambda_memory_mb
  timeout     = var.lambda_timeout_seconds

  lifecycle {
    # CI owns both of these after the first apply:
    #   image_uri   : `aws lambda update-function-code --image-uri <repo>:<sha>`
    #   environment : `aws lambda update-function-configuration` sets SUPABASE_*
    #                 from GitHub secrets
    # Without this, every `terraform apply` would roll the function back to the
    # bootstrap image and wipe its environment variables. Supabase credentials
    # never pass through Terraform or its state.
    ignore_changes = [image_uri, environment]
  }

  depends_on = [
    # The log group and the log-write permission must exist before the first
    # invocation. The role can't create log groups, so without this ordering
    # early logs would be dropped.
    aws_cloudwatch_log_group.lambda,
    aws_iam_role_policy.lambda_logs,
  ]
}

# --- Function URL ---------------------------------------------------------------

# !!! ALPHA ONLY: this URL is PUBLIC and UNAUTHENTICATED !!!
# Anyone on the internet who has the URL can invoke the function, and CORS
# doesn't stop non-browser clients. That's acceptable while the API serves only
# /health and no user data. Before real user data exists, put it behind auth:
# e.g. authorization_type = "AWS_IAM" fronted by CloudFront with an Origin
# Access Control for Lambda URLs, or API Gateway / a custom domain with an
# authorizer.
#
# Public-invoke permissions: with authorization_type = "NONE", the function's
# resource-based policy must allow public invocation, or the URL returns
# 403 Forbidden. Since late 2025, AWS requires TWO statements for this:
#   1. lambda:InvokeFunctionUrl, principal "*", condition
#      lambda:FunctionUrlAuthType = NONE
#   2. lambda:InvokeFunction, principal "*", condition
#      lambda:InvokedViaFunctionUrl = true (applies only to calls that come
#      through the URL, not to direct Invoke API calls)
# AWS provider >= 6.28 (the floor in versions.tf) adds both automatically when
# it creates this resource, as statement IDs "FunctionURLAllowPublicAccess" and
# "FunctionURLAllowInvokeAction". That's why this root has no
# aws_lambda_permission resources. Don't add any with those statement IDs;
# they would conflict.
# Caveat: the provider doesn't track those two statements in state. If
# authorization_type is later changed to AWS_IAM, remove them explicitly
# (`aws lambda remove-permission --statement-id ...`) as part of that change.
resource "aws_lambda_function_url" "backend" {
  function_name      = aws_lambda_function.backend.function_name
  authorization_type = "NONE"

  # CORS is configured ONLY here. Express adds no CORS middleware; doing both
  # would send duplicate headers. Only the CloudFront origin is allowed. Local
  # dev needs no entry because Vite proxies /health, so the browser sees a
  # single origin.
  cors {
    allow_origins = ["https://${aws_cloudfront_distribution.frontend.domain_name}"]
    allow_methods = ["GET"]
    allow_headers = ["content-type"]
    max_age       = 300
  }
}
