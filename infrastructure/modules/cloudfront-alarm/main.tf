# A standalone single-resource module, deliberately not part of
# infrastructure/modules/observability. CloudFront metrics are only
# published to us-east-1 regardless of the distribution's actual edge
# locations or the rest of the environment's region — a real apply proved
# that a configuration_aliases + dual providers = { aws = aws, aws.x = aws.x
# } passthrough into observability (which also needs the *default* eu-west-1
# provider for its other ~20 alarms) did not reliably force this one
# resource onto us-east-1, even with both `provider = aws.us_east_1` and an
# explicit `region = "us-east-1"` argument set (two separate real attempts,
# both failed with the identical AWS-side "Invalid region eu-west-1
# specified" error). This module has only ever one provider requirement
# (the plain default "aws"), entirely swapped for the us-east-1 alias at
# the call site — the exact same single-provider-swap pattern already
# proven to work for infrastructure/modules/acm-cert's CloudFront
# certificates. See docs/DECISIONS.md.
resource "aws_cloudwatch_metric_alarm" "cloudfront_error_rate" {
  alarm_name          = "zoryvex-${var.environment_name}-cloudfront-error-rate"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "5xxErrorRate"
  namespace           = "AWS/CloudFront"
  period              = 300
  statistic           = "Average"
  threshold           = 5 # percent
  treat_missing_data  = "notBreaching"
  tags                = var.tags

  dimensions = {
    DistributionId = var.cloudfront_distribution_id
    Region         = "Global"
  }

  alarm_actions = [var.alarm_sns_topic_arn]
  ok_actions    = [var.alarm_sns_topic_arn]
}
