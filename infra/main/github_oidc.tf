# -----------------------------------------------------------------------------
# GitHub Actions -> AWS via OIDC. No static access keys exist anywhere.
#
# deploy.yml requests a short-lived GitHub OIDC token, and STS exchanges it for
# temporary credentials for the role below. The trust policy decides WHICH
# workflows can do that; the permissions policy decides WHAT they can do (the
# exact action list from CLAUDE.md's Deploy contract).
# -----------------------------------------------------------------------------

locals {
  github_oidc_url  = "https://token.actions.githubusercontent.com"
  github_oidc_host = "token.actions.githubusercontent.com"

  # GitHub signs each workflow's token with an *immutable* subject claim: the owner and repository
  # names are each followed by their numeric ID, which survives renames and cannot be re-created by
  # someone who later claims a freed-up name:
  #   repo:OWNER@OWNER_ID/NAME@REPO_ID:ref:refs/heads/BRANCH
  # The older name-only form (repo:OWNER/NAME:ref:...) is NOT what this repository's tokens carry,
  # and a trust policy written against it fails with "Not authorized to perform
  # sts:AssumeRoleWithWebIdentity". To see what a run actually sent, look up the
  # AssumeRoleWithWebIdentity event in CloudTrail: userIdentity.userName is the subject claim.
  github_owner_name = split("/", var.github_repository)[0]
  github_repo_name  = split("/", var.github_repository)[1]

  github_oidc_sub = format(
    "repo:%s@%s/%s@%s:ref:refs/heads/%s",
    local.github_owner_name,
    var.github_owner_id,
    local.github_repo_name,
    var.github_repository_id,
    var.github_branch,
  )

  github_oidc_provider_arn = (
    var.create_github_oidc_provider
    ? aws_iam_openid_connect_provider.github[0].arn
    : data.aws_iam_openid_connect_provider.github[0].arn
  )
}

# An AWS account can have only one OIDC provider per URL. If another project
# already created it, set create_github_oidc_provider = false to look it up
# instead. Otherwise the apply fails with EntityAlreadyExists, and managing a
# shared provider from here would mean a destroy breaks the other project.
resource "aws_iam_openid_connect_provider" "github" {
  count = var.create_github_oidc_provider ? 1 : 0

  url            = local.github_oidc_url
  client_id_list = ["sts.amazonaws.com"]

  # thumbprint_list is omitted on purpose. It's optional in provider 6.x, and
  # for GitHub's issuer AWS validates the TLS certificate against its own
  # trusted CA store rather than a pinned thumbprint, so there's no thumbprint
  # to rotate when GitHub changes certificates.
}

data "aws_iam_openid_connect_provider" "github" {
  count = var.create_github_oidc_provider ? 0 : 1

  url = local.github_oidc_url
}

# --- Deploy role: trust policy ------------------------------------------------

data "aws_iam_policy_document" "github_actions_assume_role" {
  statement {
    sid     = "GitHubActionsOIDCMainBranchOnly"
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [local.github_oidc_provider_arn]
    }

    condition {
      test     = "StringEquals"
      variable = "${local.github_oidc_host}:aud"
      values   = ["sts.amazonaws.com"]
    }

    # Exact match (StringEquals, no wildcards): only workflows running for a
    # push to this one branch of this one repository can assume the role.
    # Pull requests (whose claim ends in :pull_request), forks, tags, and other
    # branches cannot.
    #
    # If deploy.yml later uses a GitHub Environment (`environment:` on the job),
    # GitHub replaces the ":ref:refs/heads/..." suffix with ":environment:NAME",
    # and this value must change with it.
    condition {
      test     = "StringEquals"
      variable = "${local.github_oidc_host}:sub"
      values   = [local.github_oidc_sub]
    }
  }
}

resource "aws_iam_role" "github_actions_deploy" {
  name                 = "${local.name_prefix}-github-actions-deploy"
  description          = "Assumed by GitHub Actions (OIDC) on pushes to ${var.github_repository}@${var.github_branch} to deploy ${local.name_prefix}."
  assume_role_policy   = data.aws_iam_policy_document.github_actions_assume_role.json
  max_session_duration = 3600
}

# --- Deploy role: permissions ---------------------------------------------------
# Exactly the actions in CLAUDE.md "Deploy contract". No iam:*, no
# lambda:CreateFunction, no s3:*, and no Resource "*" except where AWS requires
# it (ecr:GetAuthorizationToken).

data "aws_iam_policy_document" "github_actions_deploy" {
  # GetAuthorizationToken issues a registry-wide login token and doesn't
  # support resource-level permissions, so AWS requires Resource "*". The token
  # alone grants nothing; the push/pull actions below are still limited to one
  # repository.
  statement {
    sid       = "EcrLogin"
    actions   = ["ecr:GetAuthorizationToken"]
    resources = ["*"]
  }

  statement {
    sid = "EcrPushPullBackendRepoOnly"
    actions = [
      "ecr:BatchCheckLayerAvailability",
      "ecr:InitiateLayerUpload",
      "ecr:UploadLayerPart",
      "ecr:CompleteLayerUpload",
      "ecr:PutImage",
      # Pull actions: Lambda checks that the caller of UpdateFunctionCode can
      # read the image it's pointed at.
      "ecr:BatchGetImage",
      "ecr:GetDownloadUrlForLayer",
    ]
    resources = [aws_ecr_repository.backend.arn]
  }

  statement {
    sid = "LambdaDeployBackendFunctionOnly"
    actions = [
      # Points the function at the newly pushed <repo>:<sha> image.
      "lambda:UpdateFunctionCode",
      # Delivers SUPABASE_* from GitHub secrets to the function's environment.
      # It can't change the execution role (no iam:PassRole is granted), and it
      # can't attach layers (container-image functions don't support them).
      "lambda:UpdateFunctionConfiguration",
      # Used by `aws lambda wait function-updated` between the two updates.
      "lambda:GetFunctionConfiguration",
      # Lets CI discover the Function URL for the smoke test and the frontend
      # build (VITE_API_BASE_URL) without storing it as another secret.
      "lambda:GetFunctionUrlConfig",
    ]
    resources = [aws_lambda_function.backend.arn]
  }

  # `aws s3 sync` lists the bucket to diff against local files.
  statement {
    sid       = "FrontendBucketList"
    actions   = ["s3:ListBucket"]
    resources = [aws_s3_bucket.frontend.arn]
  }

  # Upload new build files and delete stale ones (sync --delete).
  statement {
    sid       = "FrontendObjectsWriteDelete"
    actions   = ["s3:PutObject", "s3:DeleteObject"]
    resources = ["${aws_s3_bucket.frontend.arn}/*"]
  }

  statement {
    sid       = "CloudFrontInvalidateFrontendOnly"
    actions   = ["cloudfront:CreateInvalidation"]
    resources = [aws_cloudfront_distribution.frontend.arn]
  }
}

resource "aws_iam_role_policy" "github_actions_deploy" {
  name   = "deploy"
  role   = aws_iam_role.github_actions_deploy.id
  policy = data.aws_iam_policy_document.github_actions_deploy.json
}
