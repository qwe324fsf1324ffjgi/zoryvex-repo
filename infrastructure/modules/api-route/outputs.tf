output "function_name" {
  value = aws_lambda_function.this.function_name
}

output "function_arn" {
  value = aws_lambda_function.this.arn
}

output "lambda_role_name" {
  value = aws_iam_role.lambda_exec.name
}
