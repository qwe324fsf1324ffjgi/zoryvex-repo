resource "aws_apigatewayv2_api" "this" {
  name          = var.api_name
  protocol_type = "HTTP"
  tags          = var.tags

  cors_configuration {
    allow_origins     = var.cors_allow_origins
    allow_methods     = var.cors_allow_methods
    allow_headers     = var.cors_allow_headers
    allow_credentials = var.cors_allow_credentials
    max_age           = 300
  }
}

resource "aws_cloudwatch_log_group" "access_logs" {
  name              = "/aws/apigateway/${var.api_name}"
  retention_in_days = var.log_retention_days
  tags              = var.tags
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.this.id
  name        = "$default"
  auto_deploy = true
  tags        = var.tags

  default_route_settings {
    throttling_burst_limit = var.throttling_burst_limit
    throttling_rate_limit  = var.throttling_rate_limit
  }

  # Field allowlist only — never the request body or headers, so an
  # authenticated session cookie or Paystack webhook payload can never reach
  # a log. See docs/adr/0001's "raw token must never appear in server logs"
  # requirement, applied generally.
  access_log_settings {
    destination_arn = aws_cloudwatch_log_group.access_logs.arn
    format = jsonencode({
      requestId               = "$context.requestId"
      ip                      = "$context.identity.sourceIp"
      requestTime             = "$context.requestTime"
      httpMethod              = "$context.httpMethod"
      routeKey                = "$context.routeKey"
      status                  = "$context.status"
      protocol                = "$context.protocol"
      responseLength          = "$context.responseLength"
      integrationErrorMessage = "$context.integrationErrorMessage"
      authorizerError         = "$context.authorizer.error"
    })
  }
}

# REQUEST authorizer per docs/adr/0001 — not Cognito, not a bare JWT-claims
# trust boundary. One per API, attached per-route by infrastructure/modules/
# api-route via var.authorized.
resource "aws_apigatewayv2_authorizer" "session" {
  api_id                            = aws_apigatewayv2_api.this.id
  authorizer_type                   = "REQUEST"
  name                              = "${var.api_name}-session-authorizer"
  authorizer_uri                    = var.authorizer_function_invoke_arn
  authorizer_payload_format_version = "2.0"
  enable_simple_responses           = true
  identity_sources                  = ["$request.header.Cookie"]

  # No caching, and this is a correctness requirement rather than a tuning
  # choice. The cache key is the identity source above, which is the cookie
  # and nothing else, while the authorizer also checks the Origin header
  # and the session-bound CSRF token — the two halves of the defence ADR
  # 0001 requires. Neither is part of the key, so a cached decision let
  # both through.
  #
  # Measured against the deployed test API, not reasoned about. With the
  # authorizer cold, a PATCH with no CSRF header was refused 403 and a
  # PATCH from another origin was refused 403. Within thirty seconds of any
  # request carrying the same cookie — a plain GET of the profile page is
  # enough — both were answered 200, because API Gateway replayed the
  # cached decision and never invoked the authorizer. In other words the
  # CSRF defence was inert for practically every real request, since a
  # signed-in browser is always inside that window.
  #
  # Two other controls stood between that and an actual attack: the session
  # cookie is SameSite=Lax, so a cross-site mutating request does not carry
  # it, and API Gateway's CORS allow-list fails the preflight for an unknown
  # origin. They were designed as complements to this check, not as
  # replacements for it, and neither was written with the job of being the
  # last line.
  #
  # The cost is one Lambda invocation and one DynamoDB GetItem per request
  # instead of per thirty seconds. Adding the CSRF header to
  # `identity_sources` is not the fix: API Gateway rejects a request that
  # omits any listed identity source, which would refuse every GET.
  authorizer_result_ttl_in_seconds = 0
}

resource "aws_lambda_permission" "authorizer_invoke" {
  statement_id  = "AllowAPIGatewayInvokeAuthorizer"
  action        = "lambda:InvokeFunction"
  function_name = var.authorizer_function_arn
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.this.execution_arn}/authorizers/${aws_apigatewayv2_authorizer.session.id}"
}

# Stage B of the DNS workflow only (see docs/DNS_RUNBOOK.md) — omitted
# entirely until the regional ACM certificate is validated, so a Stage A
# apply never fails waiting on a certificate that can't validate yet.
resource "aws_apigatewayv2_domain_name" "this" {
  count       = var.custom_domain_name != null ? 1 : 0
  domain_name = var.custom_domain_name
  tags        = var.tags

  domain_name_configuration {
    certificate_arn = var.regional_acm_certificate_arn
    endpoint_type   = "REGIONAL"
    security_policy = "TLS_1_2"
  }
}

resource "aws_apigatewayv2_api_mapping" "this" {
  count       = var.custom_domain_name != null ? 1 : 0
  api_id      = aws_apigatewayv2_api.this.id
  domain_name = aws_apigatewayv2_domain_name.this[0].id
  stage       = aws_apigatewayv2_stage.default.id
}
