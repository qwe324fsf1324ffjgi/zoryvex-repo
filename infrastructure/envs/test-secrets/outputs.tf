# Name/ARN only — never the value. Convenience outputs for the founder's
# own terraform apply session (e.g. to confirm the exact parameter name
# before replacing its value in the AWS Console), not consumed by any other
# Terraform root — infrastructure/envs/test references these same ARNs via
# its own deterministic locals, not via a remote-state read of this root.

output "paystack_secret_key_name" {
  value = aws_ssm_parameter.paystack_secret_key.name
}

output "paystack_secret_key_arn" {
  value = aws_ssm_parameter.paystack_secret_key.arn
}

output "auth_token_pepper_name" {
  value = aws_ssm_parameter.auth_token_pepper.name
}

output "auth_token_pepper_arn" {
  value = aws_ssm_parameter.auth_token_pepper.arn
}
