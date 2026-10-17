variable "queue_name" {
  type = string
}

variable "max_receive_count" {
  description = "Bounded retries before a message moves to the DLQ — an unbounded retry loop on a poison message is itself a cost/availability risk."
  type        = number
  default     = 5
}

variable "visibility_timeout_seconds" {
  description = "Should exceed the consuming Lambda's timeout, or the same message can be picked up twice before the first attempt finishes."
  type        = number
  default     = 60
}

variable "message_retention_seconds" {
  type    = number
  default = 345600 # 4 days
}

variable "dlq_alarm_threshold" {
  description = "Any message on the DLQ at all means something is failing repeatedly — alarm at >=1, not a percentage."
  type        = number
  default     = 1
}

variable "alarm_sns_topic_arn" {
  description = "infrastructure/modules/observability output. Required, not optional: a count = <this> != null ? 1 : 0 conditional here is unresolvable on a first apply against empty state, since the referenced resource's ARN is not yet known at plan time (confirmed by a real terraform plan error, not a guess) — every real caller in this repository always provides observability's alerts_topic_arn anyway, so the null-skipping path was dead code, not a genuine feature."
  type        = string
}

variable "allow_eventbridge_rule_arns" {
  description = "Grants sqs:SendMessage to EventBridge, scoped to exactly these rule ARNs via an aws:SourceArn condition. Empty grants nothing — most queues are written to by a Lambda's own SendMessage call instead."
  type        = list(string)
  default     = []
}

variable "tags" {
  type    = map(string)
  default = {}
}
