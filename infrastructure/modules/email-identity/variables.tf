variable "domain_name" {
  description = "e.g. zoryvex.space. Account/domain singleton — called once (see infrastructure/envs/bootstrap), not once per environment."
  type        = string
}

variable "mail_from_subdomain" {
  description = "e.g. mail.zoryvex.space. no-reply@zoryvex.space is a sender identity, not a mailbox (CLAUDE.md); this is the Return-Path domain SES uses for bounce handling."
  type        = string
}

variable "tags" {
  type    = map(string)
  default = {}
}
