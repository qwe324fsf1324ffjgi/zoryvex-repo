variable "bucket_name" {
  description = "Globally unique S3 bucket name that holds the Next.js static export."
  type        = string
}

variable "domain_aliases" {
  description = "CloudFront alternate domain names (CNAMEs). Empty until DNS/ACM are wired up."
  type        = list(string)
  default     = []
}

variable "acm_certificate_arn" {
  description = "us-east-1 ACM certificate ARN for domain_aliases. Required only when domain_aliases is non-empty."
  type        = string
  default     = null
}

variable "apex_domain" {
  description = "e.g. zoryvex.space or test.zoryvex.space. Used by the CloudFront Function redirect target and CSP; empty string before Stage B."
  type        = string
  default     = ""
}

variable "www_domain" {
  description = "e.g. www.zoryvex.space. Only set on the production distribution — CloudFront accepts both aliases and the function 301-redirects www to apex. Empty string disables the redirect branch entirely."
  type        = string
  default     = ""
}

variable "api_origin" {
  description = "e.g. https://api.zoryvex.space. Used only to build the CSP connect-src. Empty string omits it from the policy."
  type        = string
  default     = ""
}

variable "enable_hsts" {
  description = "Keep false until HTTPS is verified end-to-end on the real domain (Prompt 5: 'HSTS only after HTTPS is verified') — an HSTS header sent before that is confirmed can lock a browser out of the site with no easy way back. Flip true once Stage B's smoke test passes."
  type        = bool
  default     = false
}

variable "allow_inline_scripts" {
  description = "Adds 'unsafe-inline' to the CSP's script-src. Default false (strict). Real Phase 7 slice 11 browser testing proved Next.js's own required inline hydration scripts (output: 'export' has no server/middleware to inject per-request nonces — Next.js's own docs require dynamic rendering for nonces, and its documented non-nonce alternative for static export is exactly 'unsafe-inline') are blocked without this, which silently breaks all client-side hydration site-wide, not just one page. Never add 'unsafe-eval' alongside this — Next.js docs confirm eval is a development-only concern, never required in production."
  type        = bool
  default     = false
}

variable "price_class" {
  description = "CloudFront price class."
  type        = string
  default     = "PriceClass_100"
}

variable "html_cache_ttl_seconds" {
  description = "TTL for the distribution's default cache behaviour, which is what serves every page. Short by design: Next.js static export does not content-hash HTML, so a long TTL means a stale page can survive a deploy. Only /_next/static/* — where the filename carries a content hash — gets the long-TTL managed CachingOptimized policy."
  type        = number
  default     = 60
}

variable "tags" {
  description = "Common resource tags."
  type        = map(string)
  default     = {}
}
