variable "table_name" {
  type = string
}

variable "hash_key" {
  type = string
}

variable "range_key" {
  type    = string
  default = null
}

variable "attributes" {
  description = "All attributes referenced by the hash/range key or any GSI. DynamoDB requires every key attribute to be declared here."
  type = list(object({
    name = string
    type = string # S | N | B
  }))
}

variable "global_secondary_indexes" {
  description = "One entry per access pattern that cannot be served by the base table key. Every screen/API access pattern must map to either the base key or one of these — never a scan."
  type = list(object({
    name            = string
    hash_key        = string
    range_key       = optional(string)
    projection_type = string # ALL | KEYS_ONLY | INCLUDE
  }))
  default = []
}

variable "deletion_protection_enabled" {
  description = "Required true in production (CLAUDE.md: no data destruction without a plan/diff/rollback/approval). Defaults false so a disposable test table never blocks terraform destroy of the test environment."
  type        = bool
  default     = false
}

variable "point_in_time_recovery_enabled" {
  description = "Required true in production for data-restore capability (see docs/RUNBOOKS.md 'Data restore'). Defaults true; test may disable to save the small continuous-backup cost since test data is synthetic and disposable."
  type        = bool
  default     = true
}

variable "tags" {
  type    = map(string)
  default = {}
}
