resource "aws_sqs_queue" "dlq" {
  name                      = "${var.queue_name}-dlq"
  message_retention_seconds = 1209600 # 14 days — max, so a failed message is never silently lost before anyone looks
  sqs_managed_sse_enabled   = true
  tags                      = var.tags
}

resource "aws_sqs_queue" "this" {
  name                       = var.queue_name
  visibility_timeout_seconds = var.visibility_timeout_seconds
  message_retention_seconds  = var.message_retention_seconds
  sqs_managed_sse_enabled    = true
  tags                       = var.tags

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.dlq.arn
    maxReceiveCount     = var.max_receive_count
  })
}

# EventBridge → SQS needs a resource-based policy on the queue (a Lambda
# event-source-mapping consumer does not — that grant is identity-based, on
# the consuming function's own role instead). Scoped to exactly the rule
# ARNs the caller names, never a blanket events.amazonaws.com allow.
data "aws_iam_policy_document" "allow_eventbridge" {
  count = length(var.allow_eventbridge_rule_arns) > 0 ? 1 : 0

  statement {
    sid       = "AllowNamedEventBridgeRulesToSendMessages"
    effect    = "Allow"
    actions   = ["sqs:SendMessage"]
    resources = [aws_sqs_queue.this.arn]

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

resource "aws_sqs_queue_policy" "allow_eventbridge" {
  count     = length(var.allow_eventbridge_rule_arns) > 0 ? 1 : 0
  queue_url = aws_sqs_queue.this.id
  policy    = data.aws_iam_policy_document.allow_eventbridge[0].json
}

# The DLQ's own redrive_allow_policy — only this queue may redrive into it,
# not an arbitrary future queue.
resource "aws_sqs_queue_redrive_allow_policy" "dlq" {
  queue_url = aws_sqs_queue.dlq.id

  redrive_allow_policy = jsonencode({
    redrivePermission = "byQueue"
    sourceQueueArns   = [aws_sqs_queue.this.arn]
  })
}

resource "aws_cloudwatch_metric_alarm" "dlq_not_empty" {
  alarm_name          = "${var.queue_name}-dlq-not-empty"
  comparison_operator = "GreaterThanOrEqualToThreshold"
  evaluation_periods  = 1
  metric_name         = "ApproximateNumberOfMessagesVisible"
  namespace           = "AWS/SQS"
  period              = 300
  statistic           = "Maximum"
  threshold           = var.dlq_alarm_threshold
  treat_missing_data  = "notBreaching"
  tags                = var.tags

  dimensions = {
    QueueName = aws_sqs_queue.dlq.name
  }

  alarm_actions = [var.alarm_sns_topic_arn]
  ok_actions    = [var.alarm_sns_topic_arn]
}

resource "aws_cloudwatch_metric_alarm" "oldest_message_age" {
  alarm_name          = "${var.queue_name}-oldest-message-age"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "ApproximateAgeOfOldestMessage"
  namespace           = "AWS/SQS"
  period              = 300
  statistic           = "Maximum"
  # 30 minutes — generous for a queue with a handful of async jobs a day at
  # this stage; tighten once real throughput evidence exists.
  threshold          = 1800
  treat_missing_data = "notBreaching"
  tags               = var.tags

  dimensions = {
    QueueName = aws_sqs_queue.this.name
  }

  alarm_actions = [var.alarm_sns_topic_arn]
  ok_actions    = [var.alarm_sns_topic_arn]
}
