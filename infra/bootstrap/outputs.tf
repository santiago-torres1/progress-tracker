output "state_bucket_name" {
  description = "S3 bucket holding Terraform remote state."
  value       = aws_s3_bucket.state.bucket
}

output "lock_table_name" {
  description = "DynamoDB table used for Terraform state locking."
  value       = aws_dynamodb_table.lock.name
}

output "aws_region" {
  description = "Region of the state bucket and lock table."
  value       = var.aws_region
}

# Ready-to-paste partial backend config for infra/main:
#   terraform -chdir=infra/bootstrap output -raw backend_hcl > infra/main/backend.hcl
output "backend_hcl" {
  description = "Contents for infra/main/backend.hcl (gitignored)."
  value       = <<-EOT
    bucket         = "${aws_s3_bucket.state.bucket}"
    key            = "main/terraform.tfstate"
    region         = "${var.aws_region}"
    dynamodb_table = "${aws_dynamodb_table.lock.name}"
    encrypt        = true
  EOT
}
