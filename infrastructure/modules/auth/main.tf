# Lambda REQUEST authorizer — not Amazon Cognito and not a bare JWT-claims
# trust boundary. This is the real-AWS implementation of the flow already
# decided in docs/adr/0001-no-cognito-passwordless-email-auth.md: an opaque,
# hashed-at-rest session identifier read from the __Host-zoryvex_session
# cookie, verified per request against DynamoDB, with the same server-side
# tenant/resource checks still required in every downstream handler.
#
# CLAUDE.md hard boundary: "No Amazon Cognito, ever, for application auth."
# Prompt 5's own text asks for a Cognito User Pool + JWT authorizer; per
# CLAUDE.md's explicit override rule and docs/DECISIONS.md, ADR 0001 controls
# and no aws_cognito_* resource exists anywhere in this repository.

data "aws_region" "current" {}

data "aws_iam_policy_document" "authorizer_assume_role" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "authorizer_exec" {
  name               = "${var.function_name}-exec"
  assume_role_policy = data.aws_iam_policy_document.authorizer_assume_role.json
  tags               = var.tags
}

resource "aws_cloudwatch_log_group" "authorizer" {
  name              = "/aws/lambda/${var.function_name}"
  retention_in_days = var.log_retention_days
  tags              = var.tags
}

data "aws_iam_policy_document" "authorizer_permissions" {
  statement {
    sid       = "WriteOwnLogsOnly"
    effect    = "Allow"
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${aws_cloudwatch_log_group.authorizer.arn}:*"]
  }

  statement {
    sid       = "ReadSessionItemOnly"
    effect    = "Allow"
    actions   = ["dynamodb:GetItem"]
    resources = [var.sessions_table_arn]
  }

  # The authorizer needs the same HMAC pepper the auth handlers used to hash
  # the session id/CSRF token, to recompute and compare — see
  # docs/adr/0001-no-cognito-passwordless-email-auth.md ("keyed hash").
  statement {
    sid       = "ScopedSecureParameterReadOnly"
    effect    = "Allow"
    actions   = ["ssm:GetParameter"]
    resources = [var.auth_token_pepper_parameter_arn]
  }

  statement {
    sid       = "DecryptSecureParameterViaSsmOnly"
    effect    = "Allow"
    actions   = ["kms:Decrypt"]
    resources = ["*"]

    condition {
      test     = "StringEquals"
      variable = "kms:ViaService"
      values   = ["ssm.${data.aws_region.current.region}.amazonaws.com"]
    }
  }

  # Defense in depth: this role must never be able to touch IAM, another
  # account's resources, or anything outside the two grants above, even if a
  # future edit to this file accidentally widens a resource list above.
  statement {
    sid       = "ExplicitDenyIamAndWildcardAdmin"
    effect    = "Deny"
    actions   = ["iam:*", "organizations:*", "account:*"]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "authorizer_permissions" {
  name   = "${var.function_name}-permissions"
  role   = aws_iam_role.authorizer_exec.id
  policy = data.aws_iam_policy_document.authorizer_permissions.json
}

resource "aws_lambda_function" "authorizer" {
  function_name    = var.function_name
  role             = aws_iam_role.authorizer_exec.arn
  handler          = var.handler
  runtime          = var.runtime
  memory_size      = var.memory_size
  timeout          = var.timeout_seconds
  filename         = var.deployment_package_path
  source_code_hash = filebase64sha256(var.deployment_package_path)
  tags             = var.tags

  # No provisioned concurrency (CLAUDE.md: no always-on compute) — this is a
  # reserved *ceiling* only, a spend guardrail. A cold authorizer invocation
  # adds latency to the first authenticated request in a while; accepted per
  # docs/adr/0002, revisited only with real traffic evidence.
  reserved_concurrent_executions = var.reserved_concurrent_executions

  environment {
    variables = var.environment_variables
  }

  depends_on = [aws_cloudwatch_log_group.authorizer]
}
