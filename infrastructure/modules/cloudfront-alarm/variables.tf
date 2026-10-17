variable "environment_name" {
  type = string
}

variable "cloudfront_distribution_id" {
  type = string
}

variable "alarm_sns_topic_arn" {
  type = string
}

variable "tags" {
  type    = map(string)
  default = {}
}
