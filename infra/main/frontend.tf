# -----------------------------------------------------------------------------
# Frontend hosting: private S3 bucket served only through CloudFront (OAC)
#
# The bucket isn't a website endpoint and is never public. CloudFront signs
# every origin request with SigV4 (Origin Access Control), and the bucket policy
# accepts reads only from this one distribution.
# -----------------------------------------------------------------------------

resource "aws_s3_bucket" "frontend" {
  # Account ID suffix: globally unique without hardcoding anything.
  bucket = "${local.name_prefix}-frontend-${local.account_id}"

  # Refuses to delete the bucket while it still holds objects.
  force_destroy = false
}

resource "aws_s3_bucket_ownership_controls" "frontend" {
  bucket = aws_s3_bucket.frontend.id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_public_access_block" "frontend" {
  bucket = aws_s3_bucket.frontend.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# SSE-S3 (AES256), not SSE-KMS: with a KMS key, CloudFront's OAC would also
# need a KMS key policy allowing it to decrypt. That's extra moving parts and
# KMS request charges, for public static assets.
resource "aws_s3_bucket_server_side_encryption_configuration" "frontend" {
  bucket = aws_s3_bucket.frontend.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# OAC (sigv4, always signs), not the legacy Origin Access Identity (OAI).
resource "aws_cloudfront_origin_access_control" "frontend" {
  name                              = "${local.name_prefix}-frontend"
  description                       = "CloudFront to S3 access for the ${local.name_prefix} frontend bucket"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

# Managed policies are looked up by name, never by hardcoded ID.
data "aws_cloudfront_cache_policy" "caching_optimized" {
  name = "Managed-CachingOptimized"
}

# Adds HSTS, X-Content-Type-Options, X-Frame-Options, Referrer-Policy, and
# X-XSS-Protection. It sets no CSP, so the SPA can still call the Function URL.
data "aws_cloudfront_response_headers_policy" "security_headers" {
  name = "Managed-SecurityHeadersPolicy"
}

locals {
  frontend_origin_id = "s3-${aws_s3_bucket.frontend.id}"
}

resource "aws_cloudfront_distribution" "frontend" {
  enabled             = true
  comment             = "${local.name_prefix} frontend (SPA)"
  default_root_object = "index.html"
  is_ipv6_enabled     = true
  http_version        = "http2and3"

  # PriceClass_100 is the cheapest class: edge locations in North America and
  # Europe only. Viewers elsewhere are served from those locations, which is
  # slightly slower.
  price_class = "PriceClass_100"

  origin {
    origin_id                = local.frontend_origin_id
    domain_name              = aws_s3_bucket.frontend.bucket_regional_domain_name # S3 REST endpoint, not a website endpoint
    origin_access_control_id = aws_cloudfront_origin_access_control.frontend.id
  }

  default_cache_behavior {
    target_origin_id       = local.frontend_origin_id
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true

    # Honors the origin's Cache-Control headers (the deploy sets hashed assets
    # immutable and index.html no-cache) within 1s min to 1y max TTLs.
    cache_policy_id            = data.aws_cloudfront_cache_policy.caching_optimized.id
    response_headers_policy_id = data.aws_cloudfront_response_headers_policy.security_headers.id
  }

  # SPA fallback: client-side routes like /tasks aren't S3 objects, so serve
  # index.html with a 200 and let the router handle them. S3 returns 403, not
  # 404, for missing keys when the caller lacks s3:ListBucket (CloudFront
  # deliberately doesn't have it), so both codes are mapped.
  #
  # Consequences:
  #   - /health on the CloudFront domain serves the SPA, not the API. The API
  #     lives on the Lambda Function URL.
  #   - A missing JS/CSS asset comes back as index.html with a 200, not a 404.
  custom_error_response {
    error_code            = 403
    response_code         = 200
    response_page_path    = "/index.html"
    error_caching_min_ttl = 10
  }

  custom_error_response {
    error_code            = 404
    response_code         = 200
    response_page_path    = "/index.html"
    error_caching_min_ttl = 10
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  # Default *.cloudfront.net certificate. A custom domain would need an ACM
  # certificate in us-east-1 plus aliases.
  viewer_certificate {
    cloudfront_default_certificate = true
  }
}

# The only access to the bucket: s3:GetObject for this specific distribution.
data "aws_iam_policy_document" "frontend_bucket" {
  statement {
    sid       = "AllowCloudFrontOACReadOnly"
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.frontend.arn}/*"]

    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.frontend.arn]
    }
  }
}

resource "aws_s3_bucket_policy" "frontend" {
  bucket = aws_s3_bucket.frontend.id
  policy = data.aws_iam_policy_document.frontend_bucket.json

  # Avoids S3 "conflicting conditional operation" errors from concurrent bucket
  # configuration calls on a brand-new bucket.
  depends_on = [aws_s3_bucket_public_access_block.frontend]
}
