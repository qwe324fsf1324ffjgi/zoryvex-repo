output "api_id" {
  value = aws_apigatewayv2_api.this.id
}

output "api_endpoint" {
  value = aws_apigatewayv2_api.this.api_endpoint
}

output "execution_arn" {
  value = aws_apigatewayv2_api.this.execution_arn
}

output "stage_id" {
  value = aws_apigatewayv2_stage.default.id
}

output "authorizer_id" {
  value = aws_apigatewayv2_authorizer.session.id
}

# Vercel-compatible CNAME target for custom_domain_name (Stage B) — see
# docs/DNS_RUNBOOK.md. Null until custom_domain_name is set.
output "custom_domain_target" {
  value = var.custom_domain_name != null ? aws_apigatewayv2_domain_name.this[0].domain_name_configuration[0].target_domain_name : null
}
