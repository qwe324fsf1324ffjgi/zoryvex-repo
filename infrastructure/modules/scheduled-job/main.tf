data "aws_region" "current" {}

# A Lambda that runs on a timer rather than in response to a request or a
# queue message. Modelled on modules/queue-consumer, minus the event source
# mapping and plus an EventBridge schedule, so the IAM posture is identical:
# writes only its own logs, touches only the table/parameters/identities it
# is explicitly granted, and can never reach IAM.
#
# Deliberately a module rather than resources inlined into an environment:
# docs/RUNBOOKS.md lists several more scheduled jobs to come, and the health
# check already proved that hand-rolling the scheduler role per job spreads
# the same eight resources across the environment file.

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
      sid    = "ScopedTableAccess"
      effect = "Allow"
      # No Scan, matching every other role in this system: the access
      # patterns are index-backed by design and a Scan grant would quietly
      # permit a full-table read.
      actions   = ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:Query"]
      resources = concat([var.dynamodb_table_arn], var.dynamodb_index_arns)
    }
  }

  dynamic "statement" {
    for_each = length(var.ses_identity_arns) > 0 ? [1] : []
    content {
      sid       = "SendFromOwnIdentityOnly"
      effect    = "Allow"
      actions   = ["ses:SendEmail"]
      resources = var.ses_identity_arns
    }
  }

  dynamic "statement" {
    for_each = length(var.ssm_parameter_arns) > 0 ? [1] : []
    content {
      sid       = "ScopedParameterReadOnly"
      effect    = "Allow"
      actions   = ["ssm:GetParameter"]
      resources = var.ssm_parameter_arns
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

  # AWS-managed keys (alias/aws/ssm) have no stable per-account resource ARN
  # to scope to, so the documented pattern is a kms:ViaService condition
  # instead. Still least privilege: this decrypts only when called through
  # SSM in this region, never as a blanket kms:Decrypt.
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
    for_each = length(var.sns_publish_arns) > 0 ? [1] : []
    content {
      sid       = "ScopedSnsPublishOnly"
      effect    = "Allow"
      actions   = ["sns:Publish"]
      resources = var.sns_publish_arns
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

# --- The schedule, and the one role allowed to fire it ---------------------

data "aws_iam_policy_document" "scheduler_assume_role" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["scheduler.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "scheduler" {
  name               = "${var.function_name}-scheduler"
  assume_role_policy = data.aws_iam_policy_document.scheduler_assume_role.json
  tags               = var.tags
}

data "aws_iam_policy_document" "scheduler_invoke" {
  statement {
    sid       = "InvokeOwnFunctionOnly"
    effect    = "Allow"
    actions   = ["lambda:InvokeFunction"]
    resources = [aws_lambda_function.this.arn]
  }
}

resource "aws_iam_role_policy" "scheduler_invoke" {
  name   = "${var.function_name}-scheduler-invoke"
  role   = aws_iam_role.scheduler.id
  policy = data.aws_iam_policy_document.scheduler_invoke.json
}

resource "aws_scheduler_schedule" "this" {
  name       = var.function_name
  group_name = "default"

  # OFF, not a window: a job that reads a kill switch before doing anything
  # should run when it is told to, so an operator can reason about when the
  # last run happened.
  flexible_time_window {
    mode = "OFF"
  }

  schedule_expression          = var.schedule_expression
  schedule_expression_timezone = var.schedule_timezone

  # Whether the schedule runs at all is the caller's decision, and the
  # default across this system is off. Every job on this module also reads a
  # feature flag before it does any work, so an accidentally-enabled
  # schedule costs one parameter read and does nothing — two independent
  # guards, because the jobs here either email somebody who did not ask or
  # touch money.
  state = var.enabled ? "ENABLED" : "DISABLED"

  target {
    arn      = aws_lambda_function.this.arn
    role_arn = aws_iam_role.scheduler.arn

    retry_policy {
      maximum_retry_attempts = 0
    }
  }
}
