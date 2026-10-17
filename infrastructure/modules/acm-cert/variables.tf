variable "domain_name" {
  description = "Primary domain name on the certificate."
  type        = string
}

variable "subject_alternative_names" {
  type    = list(string)
  default = []
}

variable "validate" {
  description = "Stage A/Stage B gate (see docs/DNS_RUNBOOK.md). False (Stage A): create the certificate and expose its DNS validation records as an output, never block waiting for them to exist. True (Stage B, a later apply run only after the founder has added those records in Vercel DNS and they've had time to propagate): add aws_acm_certificate_validation, which polls until AWS confirms validation."
  type        = bool
  default     = false
}

variable "tags" {
  type    = map(string)
  default = {}
}
