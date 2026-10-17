data "aws_region" "current" {}

data "aws_iam_policy_document" "lambda_assume_role" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "lambda_exec" {
  name               = "${var.function_name}-exec"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume_role.json
  tags               = var.tags
}

resource "aws_cloudwatch_log_group" "lambda" {
  name              = "/aws/lambda/${var.function_name}"
  retention_in_days = var.log_retention_days
  tags              = var.tags
}

data "aws_iam_policy_document" "lambda_permissions" {
  statement {
    sid       = "WriteOwnLogsOnly"
    effect    = "Allow"
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${aws_cloudwatch_log_group.lambda.arn}:*"]
  }

  dynamic "statement" {
    for_each = var.dynamodb_table_arn != null ? [1] : []
    content {
      sid       = "ScopedTableAccess"
      effect    = "Allow"
      actions   = ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:DeleteItem", "dynamodb:Query"]
      resources = concat([var.dynamodb_table_arn], var.dynamodb_index_arns)
    }
  }

  dynamic "statement" {
    for_each = var.evidence_bucket_arn != null ? [1] : []
    content {
      sid       = "ScopedAcceptedEvidenceAccess"
      effect    = "Allow"
      actions   = ["s3:GetObject", "s3:PutObject"]
      resources = ["${var.evidence_bucket_arn}/accepted/*", "${var.evidence_bucket_arn}/quarantine/*"]
    }
  }

  dynamic "statement" {
    for_each = length(var.queue_arns) > 0 ? [1] : []
    content {
      sid       = "ScopedQueueSendOnly"
      effect    = "Allow"
      actions   = ["sqs:SendMessage"]
      resources = var.queue_arns
    }
  }

  dynamic "statement" {
    for_each = length(var.secure_ssm_parameter_arns) > 0 ? [1] : []
    content {
      sid       = "ScopedSecureParameterReadOnly"
      effect    = "Allow"
      actions   = ["ssm:GetParameter"]
      resources = var.secure_ssm_parameter_arns
    }
  }

  # AWS-managed keys (alias/aws/ssm) don't have a stable per-account
  # resource ARN to scope to directly; the documented pattern is a
  # kms:ViaService condition instead — still least-privilege (only decrypts
  # when called via SSM in this region, not a blanket kms:Decrypt grant).
  dynamic "statement" {
    for_each = length(var.secure_ssm_parameter_arns) > 0 ? [1] : []
    content {
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
  }

  dynamic "statement" {
    for_each = var.ses_identity_arn != null ? [1] : []
    content {
      sid     = "ScopedSesSendEmailOnly"
      effect  = "Allow"
      actions = ["ses:SendEmail", "ses:SendRawEmail"]
      # SES authorizes a SendEmail call against BOTH the sending identity
      # and, whenever the caller specifies a ConfigurationSetName (every
      # real send in this codebase does), the configuration-set resource
      # too — confirmed via a real AccessDenied (Phase 7 slice 11 live
      # acceptance attempt) naming the configuration-set ARN specifically,
      # not the identity ARN this statement already granted. compact()
      # keeps this statement valid for any future route that sends without
      # a configuration set (ses_configuration_set_arn left null).
      resources = compact([var.ses_identity_arn, var.ses_configuration_set_arn])
    }
  }

  dynamic "statement" {
    for_each = length(var.sns_publish_arns) > 0 ? [1] : []
    content {
      sid       = "ScopedSnsPublishOnly"
      effect    = "Allow"
      actions   = ["sns:Publish"]
      resources = var.sns_publish_arns
    }
  }

  dynamic "statement" {
    for_each = length(var.bedrock_invoke_arns) > 0 ? [1] : []
    content {
      sid       = "ScopedBedrockInvokeOnly"
      effect    = "Allow"
      actions   = ["bedrock:InvokeModel"]
      resources = var.bedrock_invoke_arns
    }
  }

  # Defense in depth: this role must never be able to touch IAM, another
  # account's resources, or anything outside the grants above, even if a
  # future edit accidentally widens a resource list above.
  statement {
    sid       = "ExplicitDenyIamAndWildcardAdmin"
    effect    = "Deny"
    actions   = ["iam:*", "organizations:*", "account:*"]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "lambda_permissions" {
  name   = "${var.function_name}-permissions"
  role   = aws_iam_role.lambda_exec.id
  policy = data.aws_iam_policy_document.lambda_permissions.json
}

resource "aws_lambda_function" "this" {
  function_name    = var.function_name
  role             = aws_iam_role.lambda_exec.arn
  handler          = var.handler
  runtime          = var.runtime
  memory_size      = var.memory_size
  timeout          = var.timeout_seconds
  filename         = var.deployment_package_path
  source_code_hash = filebase64sha256(var.deployment_package_path)
  tags             = var.tags

  reserved_concurrent_executions = var.reserved_concurrent_executions

  environment {
    variables = var.environment_variables
  }

  depends_on = [aws_cloudwatch_log_group.lambda]
}

resource "aws_apigatewayv2_integration" "this" {
  api_id                 = var.api_id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.this.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "this" {
  api_id    = var.api_id
  route_key = var.route_key
  target    = "integrations/${aws_apigatewayv2_integration.this.id}"

  authorization_type = var.authorized ? "CUSTOM" : "NONE"
  authorizer_id      = var.authorized ? var.authorizer_id : null
}

resource "aws_lambda_permission" "apigw_invoke" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.this.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${var.api_execution_arn}/*/*"
}
