variable "bucket_name" {
  type = string
}

variable "retention_days" {
  description = "How long accepted candidate evidence is retained before automatic expiry, per docs/PRIVACY_AND_RETENTION.md."
  type        = number
}

variable "quarantine_expiry_days" {
  description = "Objects under quarantine/ that are never promoted to accepted/ (scan never completed, or scan failed) are deleted after this many days. Short by design: quarantined objects are never downloadable, previewable, indexed, or sent to AI (see docs/THREAT_MODEL.md), so nothing is lost by expiring them quickly."
  type        = number
  default     = 1
}

variable "allowed_upload_origins" {
  description = "Exact app origins allowed to presigned-PUT evidence objects (CORS). No wildcard."
  type        = list(string)
  default     = []
}

variable "guardduty_detector_id" {
  description = "Account/region GuardDuty detector ID. Required, not optional: a count = <this> != null ? 1 : 0 conditional here is unresolvable on a first apply against empty state, since a newly-created detector's ID is not yet known at plan time (confirmed by a real terraform plan error, not a guess). Referenced only in this module's lifecycle precondition below — that reference is what makes Terraform apply the detector before this module's malware-protection plan, since aws_guardduty_malware_protection_plan has no direct attribute argument for the detector ID (GuardDuty associates it by account/region, not by ID reference)."
  type        = string
}

variable "guardduty_malware_protection_role_arn" {
  description = "IAM role GuardDuty assumes to scan this bucket."
  type        = string
}

variable "tags" {
  type    = map(string)
  default = {}
}
