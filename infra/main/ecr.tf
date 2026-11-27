# Backend container images. Every deploy pushes its image tagged with the git
# commit SHA. A release merge (one that changes backend/package.json's version)
# also tags the same image v<version>, e.g. v0.5.0-alpha: the form release.yml
# requires of git tags. See deploy.yml.
#
# The resource address `aws_ecr_repository.backend` is referenced by the
# first-time setup commands in lambda.tf (terraform apply -target=...).
# Don't rename it.
#
# Lambda pull access: when the function is first created (pass 2, run by a
# human with admin rights), Lambda adds its own statement to this repository's
# policy so the Lambda service can pull images. Terraform doesn't manage the
# repository policy, so that statement causes no drift.
resource "aws_ecr_repository" "backend" {
  name = "${local.name_prefix}-backend"

  # MUTABLE: a re-run of a failed deploy pushes the same tags again, which an
  # immutable repository refuses with ImageTagAlreadyExistsException. SHA tags
  # are unique per commit in practice.
  #
  # The v<version> tags don't need immutability here: they are written only by
  # the deploy role, and deploy.yml writes one only on a release merge, so in
  # practice the only re-write is a re-run of that same release's deploy, and
  # making the tag immutable would turn exactly that re-run into a failure. If
  # they ever do need protecting, MUTABLE_WITH_EXCLUSION with an
  # image_tag_mutability_exclusion_filter of "v*" (AWS provider >= 6.8, so
  # within ~> 6.28) makes only those tags immutable. IMMUTABLE_WITH_EXCLUSION
  # is the inverse: everything immutable except the tags the filter matches.
  image_tag_mutability = "MUTABLE"

  # Refuses to delete the repository while it still holds images.
  force_delete = false

  # Basic scanning is free. (Enhanced/Inspector scanning is a registry-level
  # setting and would be billed.)
  image_scanning_configuration {
    scan_on_push = true
  }

  encryption_configuration {
    encryption_type = "AES256"
  }
}

# Cost guard: keep ECR storage bounded. The Lambda only ever runs the newest
# image, so older images are only useful for manual rollback, and the ones
# worth rolling back to by name are releases.
#
# Rule 1 keeps release images out of rule 3's reach. From AWS's lifecycle
# evaluation rules (Amazon ECR User Guide, "Lifecycle policies in Amazon ECR",
# https://docs.aws.amazon.com/AmazonECR/latest/userguide/LifecyclePolicies.html):
#   "An image that matches the tagging requirements of a rule cannot be expired
#    or archived by a rule with a lower priority."
# and a lower rulePriority number is a higher priority. So an image tagged
# v<version> matches rule 1 and rule 3 can never expire it, however many merges
# follow. It may still occupy one of rule 3's ten slots while it is among the
# newest ten ("Filtering on multiple rules", Example A, in the same guide).
#
# tagPrefixList ["v"] matches an image if any one of its tags starts with "v",
# so a release image carrying both <sha> and v<version> matches. SHA tags are
# hexadecimal (0-9, a-f) and can never start with "v"; neither can `bootstrap`.
# Anything else pushed with a tag starting with "v" would be kept as a release.
#
# 100, because it is a ceiling and not a target: six releases so far
# (0.1.0-alpha to 0.4.1-alpha), so at that pace 100 is years of them and in
# practice every release is kept, while storage still cannot grow without
# limit. Past 100, the oldest release images expire.
#
# The `bootstrap` tag counts toward rule 3's 10 images and eventually expires.
# That's fine: it's only needed when the function is first created. If the
# function ever has to be recreated, push the bootstrap tag again, or pass
# -var bootstrap_image_tag=<an existing SHA or version tag>.
resource "aws_ecr_lifecycle_policy" "backend" {
  repository = aws_ecr_repository.backend.name

  policy = jsonencode({
    rules = [
      {
        # Highest priority: must stay first, or release images fall under rule 3.
        rulePriority = 1
        description  = "Keep the 100 most recent release images (tags starting with v)"
        selection = {
          tagStatus     = "tagged"
          tagPrefixList = ["v"]
          countType     = "imageCountMoreThan"
          countNumber   = 100
        }
        action = { type = "expire" }
      },
      {
        rulePriority = 2
        description  = "Expire untagged images 1 day after push (e.g. overwritten tags from re-runs)"
        selection = {
          tagStatus   = "untagged"
          countType   = "sinceImagePushed"
          countUnit   = "days"
          countNumber = 1
        }
        action = { type = "expire" }
      },
      {
        # tagStatus "any" must have the highest rulePriority number.
        rulePriority = 3
        description  = "Keep only the 10 most recent images"
        selection = {
          tagStatus   = "any"
          countType   = "imageCountMoreThan"
          countNumber = 10
        }
        action = { type = "expire" }
      },
    ]
  })
}
