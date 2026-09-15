variable "aws_region" {
  description = "AWS region for all regional resources (ECR, Lambda, S3). CloudFront and IAM are global."
  type        = string
  default     = "us-east-1"
}

variable "project_name" {
  description = "Project slug used in resource names. Lowercase letters, digits, and hyphens (it becomes part of S3 bucket names)."
  type        = string
  default     = "progress-tracker"

  validation {
    condition     = can(regex("^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$", var.project_name))
    error_message = "project_name must be 3-32 chars of lowercase letters, digits, and hyphens, starting and ending with a letter or digit."
  }
}

variable "environment" {
  description = "Environment name, used in resource names and the Environment tag."
  type        = string
  default     = "alpha"

  validation {
    condition     = can(regex("^[a-z0-9]{1,12}$", var.environment))
    error_message = "environment must be 1-12 lowercase letters or digits."
  }
}

variable "github_repository" {
  description = "GitHub repository allowed to assume the deploy role, as owner/name. Case must match GitHub exactly, because the OIDC sub claim comparison is case-sensitive."
  type        = string
  default     = "santiago-torres1/progress-tracker"

  validation {
    condition     = can(regex("^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})/[A-Za-z0-9._-]{1,100}$", var.github_repository))
    error_message = "github_repository must look like owner/name (for example octocat/hello-world)."
  }
}

variable "github_branch" {
  description = "Branch whose push workflows may assume the deploy role."
  type        = string
  default     = "main"
}

variable "bootstrap_image_tag" {
  description = "ECR image tag used only when the Lambda function is first created. After that, CI owns the image (see lambda.tf)."
  type        = string
  default     = "bootstrap"
}

variable "lambda_memory_mb" {
  description = "Lambda memory in MB. CPU scales with memory."
  type        = number
  default     = 512

  validation {
    condition     = var.lambda_memory_mb >= 128 && var.lambda_memory_mb <= 10240
    error_message = "lambda_memory_mb must be between 128 and 10240."
  }
}

variable "lambda_timeout_seconds" {
  description = "Lambda timeout in seconds."
  type        = number
  default     = 10

  validation {
    condition     = var.lambda_timeout_seconds >= 1 && var.lambda_timeout_seconds <= 900
    error_message = "lambda_timeout_seconds must be between 1 and 900."
  }
}

variable "log_retention_days" {
  description = "CloudWatch Logs retention for the Lambda log group. Without a retention setting, logs are kept (and billed) forever."
  type        = number
  default     = 14

  validation {
    condition     = contains([1, 3, 5, 7, 14, 30, 60, 90, 120, 150, 180, 365, 400, 545, 731, 1096, 1827, 2192, 2557, 2922, 3288, 3653], var.log_retention_days)
    error_message = "log_retention_days must be a retention value CloudWatch Logs accepts (e.g. 7, 14, 30, 90)."
  }
}

variable "create_github_oidc_provider" {
  description = "Create the GitHub Actions OIDC provider. An AWS account can have only ONE provider for token.actions.githubusercontent.com. If one already exists, set this to false and it will be looked up instead."
  type        = bool
  default     = true
}
