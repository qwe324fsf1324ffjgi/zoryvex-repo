variable "aws_region" {
  type    = string
  default = "eu-west-1"
}

variable "site_bucket_name" {
  type = string
}

variable "evidence_bucket_name" {
  type = string
}

variable "api_deployment_package_path" {
  description = "Path to the health-handler zip built by CI. Not committed."
  type        = string
  default     = "../../../services/api/dist/health.zip"
}

variable "authorizer_deployment_package_path" {
  description = "Path to the authorizer-handler zip built by CI. Not committed."
  type        = string
  default     = "../../../services/api/dist/authorizer.zip"
}

variable "auth_request_code_deployment_package_path" {
  type    = string
  default = "../../../services/api/dist/auth-request-code.zip"
}

variable "auth_consume_code_deployment_package_path" {
  type    = string
  default = "../../../services/api/dist/auth-consume-code.zip"
}

variable "auth_sign_out_deployment_package_path" {
  type    = string
  default = "../../../services/api/dist/auth-sign-out.zip"
}

variable "webauthn_register_options_deployment_package_path" {
  type    = string
  default = "../../../services/api/dist/webauthn-register-options.zip"
}

variable "webauthn_register_verify_deployment_package_path" {
  type    = string
  default = "../../../services/api/dist/webauthn-register-verify.zip"
}

variable "webauthn_step_up_options_deployment_package_path" {
  type    = string
  default = "../../../services/api/dist/webauthn-step-up-options.zip"
}

variable "webauthn_step_up_verify_deployment_package_path" {
  type    = string
  default = "../../../services/api/dist/webauthn-step-up-verify.zip"
}

variable "sign_in_email_from" {
  description = "e.g. auth@zoryvex.space — must be a verified sender under the foundation env's SES domain identity."
  type        = string
  default     = "auth@zoryvex.space"
}

variable "webauthn_rp_id" {
  description = "Optional override for the WebAuthn Relying Party ID. Leave empty and it is derived from app_origin's host — see infrastructure/envs/test/variables.tf for the full reasoning."
  type        = string
  default     = ""

  validation {
    condition     = var.webauthn_rp_id == "" || can(regex("^[a-z0-9]([a-z0-9-]*[a-z0-9])?([.][a-z0-9]([a-z0-9-]*[a-z0-9])?)+$", var.webauthn_rp_id))
    error_message = "webauthn_rp_id must be a bare hostname (no scheme, port, path or trailing dot), e.g. zoryvex.space, or empty to derive it from app_origin."
  }
}

variable "ses_configuration_set_name" {
  description = "infrastructure/envs/foundation output. Null skips SES wiring rather than failing."
  type        = string
  default     = null
}

variable "evidence_scan_worker_deployment_package_path" {
  type    = string
  default = "../../../services/api/dist/evidence-scan-result-worker.zip"
}

variable "evidence_request_upload_deployment_package_path" {
  type    = string
  default = "../../../services/api/dist/evidence-request-upload.zip"
}

variable "evidence_download_deployment_package_path" {
  type    = string
  default = "../../../services/api/dist/evidence-download.zip"
}

variable "kit_preview_deployment_package_path" {
  type    = string
  default = "../../../services/api/dist/kit-preview.zip"
}

variable "kit_status_deployment_package_path" {
  type    = string
  default = "../../../services/api/dist/kit-status.zip"
}

variable "kit_create_order_deployment_package_path" {
  type    = string
  default = "../../../services/api/dist/kit-create-order.zip"
}

variable "kit_download_deployment_package_path" {
  type    = string
  default = "../../../services/api/dist/kit-download.zip"
}

variable "kit_regenerate_deployment_package_path" {
  type    = string
  default = "../../../services/api/dist/kit-regenerate.zip"
}

variable "webhooks_paystack_deployment_package_path" {
  type    = string
  default = "../../../services/api/dist/webhooks-paystack.zip"
}

variable "privacy_deletion_worker_deployment_package_path" {
  type    = string
  default = "../../../services/api/dist/privacy-deletion-worker.zip"
}

variable "privacy_consent_deployment_package_path" {
  type    = string
  default = "../../../services/api/dist/privacy-consent.zip"
}

variable "privacy_export_deployment_package_path" {
  type    = string
  default = "../../../services/api/dist/privacy-export.zip"
}

variable "privacy_request_deletion_deployment_package_path" {
  type    = string
  default = "../../../services/api/dist/privacy-request-deletion.zip"
}

variable "matches_unlock_contact_deployment_package_path" {
  type    = string
  default = "../../../services/api/dist/matches-unlock-contact.zip"
}

variable "matches_get_contact_deployment_package_path" {
  type    = string
  default = "../../../services/api/dist/matches-get-contact.zip"
}

variable "matches_recompute_deployment_package_path" {
  type    = string
  default = "../../../services/api/dist/matches-recompute.zip"
}

variable "matches_list_deployment_package_path" {
  type    = string
  default = "../../../services/api/dist/matches-list.zip"
}

variable "matches_explain_deployment_package_path" {
  type    = string
  default = "../../../services/api/dist/matches-explain.zip"
}

variable "admin_exceptions_deployment_package_path" {
  type    = string
  default = "../../../services/api/dist/admin-exceptions.zip"
}

variable "auth_session_deployment_package_path" {
  type    = string
  default = "../../../services/api/dist/auth-session.zip"
}

variable "roles_create_deployment_package_path" {
  type    = string
  default = "../../../services/api/dist/roles-create.zip"
}

variable "roles_get_deployment_package_path" {
  type    = string
  default = "../../../services/api/dist/roles-get.zip"
}

variable "roles_list_deployment_package_path" {
  type    = string
  default = "../../../services/api/dist/roles-list.zip"
}

variable "roles_update_deployment_package_path" {
  type    = string
  default = "../../../services/api/dist/roles-update.zip"
}

variable "candidates_profile_get_deployment_package_path" {
  type    = string
  default = "../../../services/api/dist/candidates-profile-get.zip"
}

variable "candidates_profile_update_deployment_package_path" {
  type    = string
  default = "../../../services/api/dist/candidates-profile-update.zip"
}

variable "candidates_evidence_create_deployment_package_path" {
  type    = string
  default = "../../../services/api/dist/candidates-evidence-create.zip"
}

variable "candidates_evidence_list_deployment_package_path" {
  type    = string
  default = "../../../services/api/dist/candidates-evidence-list.zip"
}

variable "candidates_evidence_get_deployment_package_path" {
  type    = string
  default = "../../../services/api/dist/candidates-evidence-get.zip"
}

variable "candidates_evidence_update_deployment_package_path" {
  type    = string
  default = "../../../services/api/dist/candidates-evidence-update.zip"
}

variable "candidates_evidence_verify_begin_deployment_package_path" {
  type    = string
  default = "../../../services/api/dist/candidates-evidence-verify-begin.zip"
}

variable "candidates_evidence_verify_deployment_package_path" {
  type    = string
  default = "../../../services/api/dist/candidates-evidence-verify.zip"
}

variable "candidates_graded_task_deployment_package_path" {
  type    = string
  default = "../../../services/api/dist/candidates-graded-task.zip"
}

variable "matches_evidence_deployment_package_path" {
  type    = string
  default = "../../../services/api/dist/matches-evidence.zip"
}

variable "candidates_evidence_delete_deployment_package_path" {
  type    = string
  default = "../../../services/api/dist/candidates-evidence-delete.zip"
}

variable "bedrock_model_id" {
  description = "See infrastructure/envs/test's identical variable for the full rationale (docs/DECISIONS.md)."
  type        = string
  default     = "eu.amazon.nova-micro-v1:0"
}

variable "alert_email" {
  description = "Founder's personal Gmail — see infrastructure/modules/observability. Never committed."
  type        = string
  sensitive   = true
}

variable "app_origin" {
  description = "https://zoryvex.space. Empty string before Stage B."
  type        = string
  default     = ""
}

variable "www_app_origin" {
  description = "https://www.zoryvex.space. Included in CORS alongside app_origin since CloudFront accepts both aliases even though www immediately redirects — a direct browser fetch() from a www tab (before the redirect navigates it away) should still not be silently blocked."
  type        = string
  default     = ""
}

variable "apex_domain" {
  description = "zoryvex.space. Empty string before Stage B."
  type        = string
  default     = ""
}

variable "www_domain" {
  description = "www.zoryvex.space. Empty string before Stage B."
  type        = string
  default     = ""
}

variable "domain_aliases" {
  description = "[zoryvex.space, www.zoryvex.space] once Stage B is complete. Empty until then."
  type        = list(string)
  default     = []
}

variable "cloudfront_acm_certificate_arn" {
  description = "us-east-1, validated, covering both zoryvex.space and www.zoryvex.space. Null until Stage B."
  type        = string
  default     = null
}

variable "api_custom_domain_name" {
  description = "api.zoryvex.space. Null until Stage B."
  type        = string
  default     = null
}

variable "api_regional_acm_certificate_arn" {
  description = "eu-west-1, validated. Null until Stage B."
  type        = string
  default     = null
}

variable "enable_hsts" {
  description = <<-EOT
    On by default from 2026-09-10, founder decision at the pre-deployment gate.

    This used to default false, with the instruction to flip it true afterwards
    in its own reviewed change. The reasoning was right — HSTS is close to
    irreversible for the length of its max-age, so it should not precede a
    working HTTPS setup — but "afterwards" assumed a spare deploy to spend on
    it, and the answer to "when do we turn this on" was becoming never.

    Turning it on is safe here because it is not a promise made in advance.
    The header is only served once a distribution exists and is already
    answering over HTTPS, CloudFront is set to redirect-to-https on every
    behaviour, and the certificate is validated before the alias is attached.
    A browser that receives it has just completed a successful HTTPS request
    to the host that sent it.

    preload stays false, and that is the part that would be genuinely hard to
    undo: submission to the browser preload list is not something a later
    apply can take back. Left for a deliberate decision once HSTS has run
    cleanly on the real domain for a while.

    Set false for a first apply on the CloudFront default domain if the plan
    is to move hosts afterwards; there is nothing to protect there and the
    header would follow a domain being abandoned.
  EOT
  type        = bool
  default     = true
}

variable "lambda_reserved_concurrency" {
  description = <<-EOT
    Per-function reserved concurrency for PRODUCTION. A ceiling that bounds
    spend, not a floor that guarantees capacity. See docs/SLO.md.

    Production previously set this nowhere, so every route inherited the
    api-route module's default of 20. That cannot physically fit: 48 routes
    at 20 is 960, and the account's entire concurrency limit is 1000, shared
    with the test environment's 262. The first production apply failed on
    fourteen functions with "decreases account's UnreservedConcurrentExecution
    below its minimum value of [10]", which is the only way this was ever
    going to be discovered, because production had never been applied.

    Ten rather than test's five: production should have more headroom per
    endpoint than test, and ten still leaves the account comfortably clear of
    its floor. Ten concurrent executions of a request handler that returns in
    well under a second is far more than a launch needs, and raising it later
    is a one-line change rather than a migration.
  EOT
  type        = number
  default     = 10

  validation {
    condition     = var.lambda_reserved_concurrency >= 1 && var.lambda_reserved_concurrency <= 20
    error_message = "lambda_reserved_concurrency must be between 1 and 20. Above that, the routes together exceed what the account can reserve alongside the test environment."
  }
}

variable "evidence_retention_days" {
  type    = number
  default = 365
}

variable "log_retention_days" {
  description = "Production application log retention — CLAUDE.md: 'prod application retention 30 days unless legal requirements demand otherwise.'"
  type        = number
  default     = 30
}

variable "tags" {
  type    = map(string)
  default = { Environment = "production", Project = "zoryvex" }
}

# --- Billing: subscriptions, reconciliation, diagnostics -------------------

variable "billing_create_subscription_deployment_package_path" {
  type    = string
  default = "../../../services/api/dist/billing-create-subscription.zip"
}

variable "billing_overview_deployment_package_path" {
  type    = string
  default = "../../../services/api/dist/billing-overview.zip"
}

variable "billing_cancel_deployment_package_path" {
  type    = string
  default = "../../../services/api/dist/billing-cancel.zip"
}

variable "billing_card_update_link_deployment_package_path" {
  type    = string
  default = "../../../services/api/dist/billing-card-update-link.zip"
}

variable "admin_billing_diagnostic_deployment_package_path" {
  type    = string
  default = "../../../services/api/dist/admin-billing-diagnostic.zip"
}

variable "jobs_billing_reconciliation_deployment_package_path" {
  type    = string
  default = "../../../services/api/dist/jobs-billing-reconciliation.zip"
}

variable "public_proof_deployment_package_path" {
  description = "Zip for the unauthenticated public proof page handler. Fixed, deterministic, environment-independent path — not committed (dist/ is gitignored)."
  type        = string
  default     = "../../../services/api/dist/public-proof.zip"
}

variable "public_proof_badge_deployment_package_path" {
  description = "Zip for the unauthenticated public proof badge (SVG) handler. Fixed, deterministic, environment-independent path — not committed (dist/ is gitignored)."
  type        = string
  default     = "../../../services/api/dist/public-proof-badge.zip"
}

variable "matches_employer_interest_deployment_package_path" {
  type    = string
  default = "../../../services/api/dist/matches-set-employer-interest.zip"
}

variable "candidates_matches_deployment_package_path" {
  type    = string
  default = "../../../services/api/dist/candidates-list-matches.zip"
}

variable "candidates_interest_deployment_package_path" {
  type    = string
  default = "../../../services/api/dist/candidates-set-interest.zip"
}
