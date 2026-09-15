# -----------------------------------------------------------------------------
# infra/bootstrap: remote-state infrastructure for infra/main
#
# Why local state: this root creates the S3 bucket and DynamoDB table that every
# other Terraform root stores its state in. It can't keep its own state in a
# bucket that doesn't exist yet, so its state stays on disk.
#
# Run it ONCE per AWS account:
#   terraform -chdir=infra/bootstrap init
#   terraform -chdir=infra/bootstrap apply
#   terraform -chdir=infra/bootstrap output -raw backend_hcl > infra/main/backend.hcl
#
# Keep infra/bootstrap/terraform.tfstate somewhere safe (a password manager or
# private storage). It is gitignored and must never be committed. Losing it is
# recoverable: losing local state deletes nothing in AWS. Re-create it with
# `terraform import` for each resource, using the bucket name
# (<project>-tfstate-<account_id>) and the table name (<project>-tflock).
#
# Locking note: Terraform >= 1.10 supports native S3 state locking
# (`use_lockfile = true` in the backend block), and upstream has deprecated the
# S3 backend's `dynamodb_table` argument. DynamoDB is used here because the
# project brief requires it. Migrating later is a one-line change in
# infra/main/backend.hcl (swap `dynamodb_table` for `use_lockfile = true`),
# followed by `terraform init -reconfigure` and removing this table.
# -----------------------------------------------------------------------------

data "aws_caller_identity" "current" {}

locals {
  # Suffixing with the account ID makes the global S3 name unique without
  # hardcoding anything account-specific in the repo.
  state_bucket_name = "${var.project_name}-tfstate-${data.aws_caller_identity.current.account_id}"
  lock_table_name   = "${var.project_name}-tflock"

  # Cost guard: old state versions are kept for rollback, but not forever.
  noncurrent_version_retention_days = 90
  # The newest N noncurrent versions are always kept, even after long periods
  # with no applies, so there's always some history to roll back to.
  noncurrent_versions_to_keep = 10
}

# --- S3 state bucket ----------------------------------------------------------

resource "aws_s3_bucket" "state" {
  bucket = local.state_bucket_name

  lifecycle {
    prevent_destroy = true
  }
}

# ACLs disabled; the bucket owner owns every object. ACLs are a legacy access
# path that could otherwise bypass the bucket policy.
resource "aws_s3_bucket_ownership_controls" "state" {
  bucket = aws_s3_bucket.state.id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_public_access_block" "state" {
  bucket = aws_s3_bucket.state.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# Versioning lets you recover from a corrupted or accidentally overwritten
# state file.
resource "aws_s3_bucket_versioning" "state" {
  bucket = aws_s3_bucket.state.id

  versioning_configuration {
    status = "Enabled"
  }
}

# SSE-S3 (AES256) instead of SSE-KMS: no per-key monthly fee, no KMS request
# charges, and no key policy to manage. It still encrypts at rest, which is
# enough for a single-user project's state. Switch to a customer-managed KMS
# key if you ever need key-level access control or audit.
resource "aws_s3_bucket_server_side_encryption_configuration" "state" {
  bucket = aws_s3_bucket.state.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "state" {
  bucket = aws_s3_bucket.state.id

  rule {
    id     = "expire-old-state-versions"
    status = "Enabled"

    # Empty filter = applies to every object in the bucket.
    filter {}

    noncurrent_version_expiration {
      noncurrent_days           = local.noncurrent_version_retention_days
      newer_noncurrent_versions = local.noncurrent_versions_to_keep
    }

    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }

  # Lifecycle rules on noncurrent versions need versioning in place first.
  depends_on = [aws_s3_bucket_versioning.state]
}

# Reject any request that doesn't use TLS. This is a Deny statement, so the
# broad "s3:*" action narrows access rather than granting it.
data "aws_iam_policy_document" "state_bucket" {
  statement {
    sid     = "DenyInsecureTransport"
    effect  = "Deny"
    actions = ["s3:*"]
    resources = [
      aws_s3_bucket.state.arn,
      "${aws_s3_bucket.state.arn}/*",
    ]

    principals {
      type        = "*"
      identifiers = ["*"]
    }

    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }
}

resource "aws_s3_bucket_policy" "state" {
  bucket = aws_s3_bucket.state.id
  policy = data.aws_iam_policy_document.state_bucket.json

  # Avoids S3 "conflicting conditional operation" errors from concurrent bucket
  # configuration calls on a brand-new bucket.
  depends_on = [aws_s3_bucket_public_access_block.state]
}

# --- DynamoDB lock table --------------------------------------------------------

# Holds Terraform's state lock so two applies can't write state at the same
# time. On-demand billing costs effectively nothing at a few requests per apply.
resource "aws_dynamodb_table" "lock" {
  name         = local.lock_table_name
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "LockID"

  attribute {
    name = "LockID"
    type = "S"
  }

  # DynamoDB always encrypts at rest. `enabled = true` switches from the
  # AWS-owned key to the AWS-managed `aws/dynamodb` KMS key, which shows up in
  # the account and CloudTrail. That key has no monthly fee, and lock-table
  # traffic stays well inside KMS's always-free request tier.
  server_side_encryption {
    enabled = true
  }

  lifecycle {
    prevent_destroy = true
  }
}
