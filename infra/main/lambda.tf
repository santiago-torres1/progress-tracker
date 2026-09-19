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

# !!! ALPHA ONLY: this URL is PUBLIC and UNAUTHENTICATED at the AWS level !!!
# Anyone on the internet who has the URL can invoke the function, and CORS
# doesn't stop non-browser clients. The line that used to sit here -- "that's
# acceptable while the API serves only /health and no user data" -- stopped
# being true in 0.2.0-alpha, so: there IS user data behind this URL now.
#
# What protects that data is the layer above, not this one. Every /api route
# requires the caller's own Supabase token and is served as that user, so
# row-level security decides what any request can reach; an unauthenticated
# caller gets a 401 and nothing else. What that does NOT protect is spend --
# an unauthenticated invoke still runs the function. The account's concurrency
# cap of 10 and the $5 budget alarm are what bound that today.
#
# Putting the URL itself behind auth is still the right move before this is
# public: authorization_type = "AWS_IAM" fronted by CloudFront with an Origin
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
  # dev needs no entry because Vite proxies the API, so the browser sees a
  # single origin.
  #
  # These two lists are load-bearing, and they fail in a way that hides itself.
  # Every /api request carries `authorization: Bearer <token>`, which is not a
  # CORS-safelisted header, so the browser preflights every one of them --
  # including the GETs. If `authorization` is not allowed here, the browser
  # refuses the request before it is ever sent, and the app cannot make a
  # single call. Meanwhile GET /health, which sends no such header and needs no
  # preflight, keeps answering perfectly: every smoke test passes and the
  # status panel reads "Pass" on a site where nothing works. That is precisely
  # how 0.2.0-alpha reached production.
  #
  # So: every method frontend/src/lib/api.ts uses, and every header it sets.
  # Adding either there means adding it here in the same change -- and note
  # that `terraform apply` is run by hand, so merging that change is not what
  # makes it true. deploy.yml re-reads this config and refuses to publish a
  # frontend it cannot support.
  cors {
    allow_origins = ["https://${aws_cloudfront_distribution.frontend.domain_name}"]
    allow_methods = ["GET", "POST", "PUT", "PATCH", "DELETE"]
    allow_headers = ["authorization", "content-type"]
    max_age       = 300
  }
}
