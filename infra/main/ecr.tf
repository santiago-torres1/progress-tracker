# Backend container images. CI pushes one image per commit, tagged with the git SHA.
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

  # MUTABLE: tags are git SHAs, so they're unique in practice. Mutable tags let
  # a failed deploy workflow be re-run for the same commit without hitting
  # "ImageTagAlreadyExistsException".
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
# image, so older images are only useful for manual rollback.
#
# The `bootstrap` tag counts toward the 10 images and eventually expires. That's
# fine: it's only needed when the function is first created. If the function
# ever has to be recreated, push the bootstrap tag again, or pass
# -var bootstrap_image_tag=<an existing SHA tag>.
resource "aws_ecr_lifecycle_policy" "backend" {
  repository = aws_ecr_repository.backend.name

  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
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
        rulePriority = 2
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
