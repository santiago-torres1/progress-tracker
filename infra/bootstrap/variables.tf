variable "aws_region" {
  description = "AWS region for the Terraform state bucket and lock table. Must match the region used in infra/main's backend config."
  type        = string
  default     = "us-east-1"
}

variable "project_name" {
  description = "Project slug used to name resources. Lowercase letters, digits, and hyphens (it becomes part of an S3 bucket name)."
  type        = string
  default     = "progress-tracker"

  validation {
    condition     = can(regex("^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$", var.project_name))
    error_message = "project_name must be 3-32 chars of lowercase letters, digits, and hyphens, starting and ending with a letter or digit."
  }
}
