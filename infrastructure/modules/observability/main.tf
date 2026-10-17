# AI usage/cost and Paystack-backlog/entitlement-mismatch alarms are
# deliberately not defined here yet: both need an application-emitted custom
# metric that doesn't exist until the backend-implementation phase writes
# it. An alarm with no real metric source would sit permanently in
# INSUFFICIENT_DATA — a decorative gate, not a working one (see the
# Phase 4 "decorative allowance meter" lesson in docs/ARCHITECTURE.md).
# Tracked as a follow-up in docs/COST_MODEL.md instead of faked here.

resource "aws_sns_topic" "alerts" {
  name = "zoryvex-${var.environment_name}-alerts"
  tags = var.tags
}

resource "aws_sns_topic_subscription" "alert_email" {
  topic_arn = aws_sns_topic.alerts.arn
  protocol  = "email"
  endpoint  = var.alert_email
}

# Same optional-grant shape as infrastructure/modules/messaging's identical
# variable for its SQS queue — only the named EventBridge rule(s) may
# publish here (e.g. Phase 7 slice 6's ACM certificate-expiry rule), never a
# blanket "any EventBridge rule in this account" grant.
data "aws_iam_policy_document" "allow_eventbridge_publish" {
  count = length(var.allow_eventbridge_rule_arns) > 0 ? 1 : 0

  statement {
    sid       = "AllowNamedEventBridgeRulesToPublish"
    effect    = "Allow"
    actions   = ["sns:Publish"]
    resources = [aws_sns_topic.alerts.arn]

    principals {
      type        = "Service"
      identifiers = ["events.amazonaws.com"]
    }

    condition {
      test     = "ArnEquals"
      variable = "aws:SourceArn"
      values   = var.allow_eventbridge_rule_arns
    }
  }
}

resource "aws_sns_topic_policy" "allow_eventbridge_publish" {
  count  = length(var.allow_eventbridge_rule_arns) > 0 ? 1 : 0
  arn    = aws_sns_topic.alerts.arn
  policy = data.aws_iam_policy_document.allow_eventbridge_publish[0].json
}

resource "aws_cloudwatch_metric_alarm" "api_5xx" {
  alarm_name          = "zoryvex-${var.environment_name}-api-5xx"
  comparison_operator = "GreaterThanOrEqualToThreshold"
  evaluation_periods  = 1
  metric_name         = "5xx"
  namespace           = "AWS/ApiGateway"
  period              = 300
  statistic           = "Sum"
  threshold           = var.api_5xx_threshold
  treat_missing_data  = "notBreaching"
  tags                = var.tags

  dimensions = {
    ApiId = var.api_gateway_id
  }

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]
}

# The burst alarm above needs five server errors inside five minutes, which is
# the right shape for an outage and the wrong shape for this product's traffic.
# Every subscription checkout failed for days in TEST, twelve attempts spread
# across separate sessions, and nothing ever fired: the founder found it by
# clicking a button. At roughly 90 requests a day, a fault can break one whole
# workflow without ever putting five errors in one five-minute window.
#
# This is the slow-burn companion. An hour is long enough that a single
# transient failure or a Lambda replaced mid-deploy stays quiet, and short
# enough that a broken workflow is reported the same morning rather than
# whenever somebody happens to try it.
resource "aws_cloudwatch_metric_alarm" "api_5xx_sustained" {
  alarm_name          = "zoryvex-${var.environment_name}-api-5xx-sustained"
  comparison_operator = "GreaterThanOrEqualToThreshold"
  evaluation_periods  = 1
  metric_name         = "5xx"
  namespace           = "AWS/ApiGateway"
  period              = 3600
  statistic           = "Sum"
  threshold           = var.api_5xx_sustained_threshold
  treat_missing_data  = "notBreaching"
  tags                = var.tags

  dimensions = {
    ApiId = var.api_gateway_id
  }

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]
}

resource "aws_cloudwatch_metric_alarm" "api_4xx_throttle_proxy" {
  alarm_name          = "zoryvex-${var.environment_name}-api-4xx"
  comparison_operator = "GreaterThanOrEqualToThreshold"
  evaluation_periods  = 2
  metric_name         = "4xx"
  namespace           = "AWS/ApiGateway"
  period              = 300
  statistic           = "Sum"
  # A 4xx burst is the visible signature of both abuse and a throttled/
  # rejected client (API Gateway does not emit a separate "Throttles" metric
  # for HTTP APIs the way it does for REST APIs) — treated as the same
  # signal here, investigated via the access log's $context.status/error
  # fields (see infrastructure/modules/api-gateway) to tell them apart.
  threshold          = 50
  treat_missing_data = "notBreaching"
  tags               = var.tags

  dimensions = {
    ApiId = var.api_gateway_id
  }

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]
}

resource "aws_cloudwatch_metric_alarm" "api_latency" {
  alarm_name          = "zoryvex-${var.environment_name}-api-latency"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 3
  metric_name         = "Latency"
  namespace           = "AWS/ApiGateway"
  period              = 300
  extended_statistic  = "p99"
  threshold           = var.api_latency_ms_threshold
  treat_missing_data  = "notBreaching"
  tags                = var.tags

  dimensions = {
    ApiId = var.api_gateway_id
  }

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]
}

locals {
  lambda_function_names = {
    api        = var.api_lambda_function_name
    authorizer = var.authorizer_lambda_function_name
  }
}

# Every other function, caught without one alarm each.
#
# `lambda_function_names` covers `api` and `authorizer`. The environment has
# 45 functions, so a silent failure loop in any of the other 43 surfaced only
# as a downstream symptom: a queue consumer's DLQ filling, or the aggregate
# API 5xx rising. `docs/RISK_REGISTER.md` has carried that as open since
# Phase 5.
#
# These two alarms watch the AWS/Lambda namespace with no `FunctionName`
# dimension, which CloudWatch publishes as an account-and-region aggregate.
# One metric each, so two alarm metrics, $0.20 a month at CloudWatch's
# $0.10-per-alarm-metric standard-resolution rate (checked 2026-08-31, see
# docs/SOURCES.md).
#
# The alternative was three alarms on each of 43 more functions: 129 alarm
# metrics, about $12.90 a month, against a project whose cost posture is zero
# idle spend. A `SEARCH` expression is not the cheap middle ground it looks
# like either, because Metrics Insights alarms bill per metric analysed, so
# searching 45 functions costs roughly what 45 alarms cost.
#
# What this deliberately does not give you is *which* function failed. It
# tells you something did, which is the part that was missing; CloudWatch
# tells you the rest in about thirty seconds. For a pre-launch product with
# one operator that is the right side of the trade, and it can be replaced
# with per-function alarms the day somebody is paged often enough to want
# them.
resource "aws_cloudwatch_metric_alarm" "lambda_errors_any_function" {
  alarm_name          = "zoryvex-${var.environment_name}-lambda-any-errors"
  comparison_operator = "GreaterThanOrEqualToThreshold"
  evaluation_periods  = 1
  metric_name         = "Errors"
  namespace           = "AWS/Lambda"
  period              = 300
  statistic           = "Sum"
  threshold           = var.lambda_error_threshold
  treat_missing_data  = "notBreaching"
  tags                = var.tags

  alarm_description = "Any Lambda in this account/region raised an error. Names the fact, not the function - check CloudWatch for which."

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]
}

resource "aws_cloudwatch_metric_alarm" "lambda_throttles_any_function" {
  alarm_name          = "zoryvex-${var.environment_name}-lambda-any-throttles"
  comparison_operator = "GreaterThanOrEqualToThreshold"
  evaluation_periods  = 1
  metric_name         = "Throttles"
  namespace           = "AWS/Lambda"
  period              = 300
  statistic           = "Sum"
  # Same reasoning as the per-function throttle alarm below: any throttle at
  # all means a reserved-concurrency ceiling was hit.
  threshold          = 1
  treat_missing_data = "notBreaching"
  tags               = var.tags

  alarm_description = "Any Lambda in this account/region was throttled, meaning a reserved-concurrency ceiling was reached."

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]
}

resource "aws_cloudwatch_metric_alarm" "lambda_errors" {
  for_each = local.lambda_function_names

  alarm_name          = "zoryvex-${var.environment_name}-lambda-${each.key}-errors"
  comparison_operator = "GreaterThanOrEqualToThreshold"
  evaluation_periods  = 1
  metric_name         = "Errors"
  namespace           = "AWS/Lambda"
  period              = 300
  statistic           = "Sum"
  threshold           = var.lambda_error_threshold
  treat_missing_data  = "notBreaching"
  tags                = var.tags

  dimensions = {
    FunctionName = each.value
  }

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]
}

resource "aws_cloudwatch_metric_alarm" "lambda_throttles" {
  for_each = local.lambda_function_names

  alarm_name          = "zoryvex-${var.environment_name}-lambda-${each.key}-throttles"
  comparison_operator = "GreaterThanOrEqualToThreshold"
  evaluation_periods  = 1
  metric_name         = "Throttles"
  namespace           = "AWS/Lambda"
  period              = 300
  statistic           = "Sum"
  # Any throttle at all means the reserved-concurrency ceiling (see
  # infrastructure/modules/api and infrastructure/modules/auth) was hit —
  # worth knowing immediately, not just above some volume.
  threshold          = 1
  treat_missing_data = "notBreaching"
  tags               = var.tags

  dimensions = {
    FunctionName = each.value
  }

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]
}

resource "aws_cloudwatch_metric_alarm" "lambda_duration" {
  for_each = local.lambda_function_names

  alarm_name          = "zoryvex-${var.environment_name}-lambda-${each.key}-duration"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 3
  metric_name         = "Duration"
  namespace           = "AWS/Lambda"
  period              = 300
  extended_statistic  = "p99"
  # A sustained near-timeout duration is the leading indicator of an
  # imminent throttle/error spike, not just the spike itself.
  threshold          = 4000
  treat_missing_data = "notBreaching"
  tags               = var.tags

  dimensions = {
    FunctionName = each.value
  }

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]
}

resource "aws_cloudwatch_metric_alarm" "dynamodb_throttles" {
  alarm_name          = "zoryvex-${var.environment_name}-dynamodb-throttles"
  comparison_operator = "GreaterThanOrEqualToThreshold"
  evaluation_periods  = 1
  metric_name         = "ThrottledRequests"
  namespace           = "AWS/DynamoDB"
  period              = 300
  statistic           = "Sum"
  threshold           = var.dynamodb_throttle_threshold
  treat_missing_data  = "notBreaching"
  tags                = var.tags

  dimensions = {
    TableName = var.dynamodb_table_name
  }

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]
}

# CloudFront's own alarm lives in infrastructure/modules/cloudfront-alarm
# instead, called separately with the us-east-1 provider swapped in
# entirely at the call site — see that module's own header comment for why
# a configuration_aliases + dual-provider passthrough into this module
# (which also needs the default eu-west-1 provider for everything else
# here) did not reliably work in a real apply, despite matching the
# documented pattern.

resource "aws_cloudwatch_metric_alarm" "ses_bounce_rate" {
  count = var.ses_configuration_set_name != null ? 1 : 0

  alarm_name          = "zoryvex-${var.environment_name}-ses-bounce-rate"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "Reputation.BounceRate"
  namespace           = "AWS/SES"
  period              = 3600
  statistic           = "Average"
  # AWS suspends sending well above this; alarm early so a human acts first.
  threshold          = 0.05
  treat_missing_data = "notBreaching"
  tags               = var.tags

  dimensions = {
    ConfigurationSetName = var.ses_configuration_set_name
  }

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]
}

resource "aws_cloudwatch_metric_alarm" "ses_complaint_rate" {
  count = var.ses_configuration_set_name != null ? 1 : 0

  alarm_name          = "zoryvex-${var.environment_name}-ses-complaint-rate"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "Reputation.ComplaintRate"
  namespace           = "AWS/SES"
  period              = 3600
  statistic           = "Average"
  threshold           = 0.001
  treat_missing_data  = "notBreaching"
  tags                = var.tags

  dimensions = {
    ConfigurationSetName = var.ses_configuration_set_name
  }

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]
}

# Auth failures: a structured log line the authorizer handler is expected to
# emit (e.g. {"event":"AUTH_DENIED", ...}) once its business logic exists —
# the metric filter and alarm are real infrastructure now; the log line
# itself is written in the backend-implementation phase. No raw
# cookie/token value is ever logged (docs/adr/0001).
resource "aws_cloudwatch_log_metric_filter" "auth_denied" {
  name           = "zoryvex-${var.environment_name}-auth-denied"
  log_group_name = "/aws/lambda/${var.authorizer_lambda_function_name}"
  pattern        = "{ $.event = \"AUTH_DENIED\" }"

  metric_transformation {
    name      = "AuthDeniedCount"
    namespace = "Zoryvex/${var.environment_name}"
    value     = "1"
    unit      = "Count"
  }
}

resource "aws_cloudwatch_metric_alarm" "auth_failures_spike" {
  alarm_name          = "zoryvex-${var.environment_name}-auth-denied-spike"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "AuthDeniedCount"
  namespace           = "Zoryvex/${var.environment_name}"
  period              = 300
  statistic           = "Sum"
  # A spike (not the baseline trickle of expired sessions/typos) — tuned
  # once real traffic gives a baseline; see docs/COST_MODEL.md.
  threshold          = 100
  treat_missing_data = "notBreaching"
  tags               = var.tags

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]

  depends_on = [aws_cloudwatch_log_metric_filter.auth_denied]
}
