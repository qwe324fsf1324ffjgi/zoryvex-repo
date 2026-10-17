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

  # Required for the event source mapping to actually deliver messages to
  # this function — scoped to exactly the one source queue, never sqs:*.
  statement {
    sid       = "ConsumeOwnQueueOnly"
    effect    = "Allow"
    actions   = ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes"]
    resources = [var.queue_arn]
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
      sid       = "ScopedEvidenceObjectAccess"
      effect    = "Allow"
      actions   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
      resources = ["${var.evidence_bucket_arn}/accepted/*", "${var.evidence_bucket_arn}/quarantine/*"]
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

  # Defense in depth: this role must never be able to touch IAM, another
  # account's resources, or anything outside the grants above.
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

resource "aws_lambda_event_source_mapping" "this" {
  event_source_arn = var.queue_arn
  function_name    = aws_lambda_function.this.arn
  batch_size       = var.batch_size
}
