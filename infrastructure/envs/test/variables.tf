variable "aws_region" {
  type    = string
  default = "eu-west-1"
}

variable "api_deployment_package_path" {
  description = "Path to the health-handler zip built by `npm run build:lambda` (scripts/build-lambda.mjs). Fixed, deterministic, environment-independent path — not committed (dist/ is gitignored)."
  type        = string
  default     = "../../../services/api/dist/health.zip"
}

variable "authorizer_deployment_package_path" {
  description = "Path to the authorizer-handler zip built by `npm run build:lambda`. Not committed."
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

variable "jobs_verification_reminder_deployment_package_path" {
  type    = string
  default = "../../../services/api/dist/jobs-verification-reminder.zip"
}

variable "candidates_graded_task_deployment_package_path" {
  type    = string
  default = "../../../services/api/dist/candidates-graded-task.zip"
}

variable "matches_evidence_deployment_package_path" {
  type    = string
  default = "../../../services/api/dist/matches-evidence.zip"
}

variable "candidates_evidence_verify_begin_deployment_package_path" {
  type    = string
  default = "../../../services/api/dist/candidates-evidence-verify-begin.zip"
}

variable "candidates_evidence_verify_deployment_package_path" {
  type    = string
  default = "../../../services/api/dist/candidates-evidence-verify.zip"
}

variable "candidates_evidence_delete_deployment_package_path" {
  type    = string
  default = "../../../services/api/dist/candidates-evidence-delete.zip"
}

variable "bedrock_model_id" {
  description = "docs/DECISIONS.md: verified (2026-08-19, AWS pricing/docs pages) lowest-cost accessible on-demand text model as of Phase 7 slice 6 — Amazon Nova Micro, invoked via its eu.* cross-Region inference profile since this API runs in eu-west-1. aiMatching stays off regardless (packages/config); this only takes effect once that flag is deliberately turned on after the evaluation gate passes."
  type        = string
  default     = "eu.amazon.nova-micro-v1:0"
}

variable "sign_in_email_from" {
  description = "e.g. auth@zoryvex.space — must be a verified sender under the foundation env's SES domain identity."
  type        = string
  default     = "auth@zoryvex.space"
}

variable "webauthn_rp_id" {
  description = "Optional override for the WebAuthn Relying Party ID. Leave empty and it is derived from app_origin's host (local.webauthn_rp_id in main.tf), which is what it has to equal anyway. Set it only to scope credentials to a registrable parent of the app's own host."
  type        = string
  default     = ""

  # A scheme, port, path or trailing dot here would be accepted silently by
  # Terraform and then rejected by the browser at registration time, with
  # nothing in the deploy to explain it. WebAuthn RP IDs are bare hosts.
  validation {
    condition     = var.webauthn_rp_id == "" || can(regex("^[a-z0-9]([a-z0-9-]*[a-z0-9])?([.][a-z0-9]([a-z0-9-]*[a-z0-9])?)+$", var.webauthn_rp_id))
    error_message = "webauthn_rp_id must be a bare hostname (no scheme, port, path or trailing dot), e.g. test.zoryvex.space, or empty to derive it from app_origin."
  }
}

variable "alert_email" {
  description = "Founder's personal Gmail — see infrastructure/modules/observability. Never committed. CI supplies this via a GitHub Actions secret (TF_VAR_alert_email), never a repo variable or committed tfvars."
  type        = string
  sensitive   = true
}

variable "ses_configuration_set_name" {
  description = "infrastructure/envs/foundation output. Null skips SES bounce/complaint alarm wiring rather than failing — foundation applies before test."
  type        = string
  default     = null
}

variable "app_origin" {
  description = "e.g. https://test.zoryvex.space. Empty string before Stage B — CORS/CSP fall back to an empty allow-list rather than a wildcard, which just means the deployed app can't call the API yet (safe default), not an open CORS hole."
  type        = string
  default     = ""
}

variable "apex_domain" {
  description = "e.g. test.zoryvex.space. Empty string before Stage B."
  type        = string
  default     = ""
}

variable "domain_aliases" {
  description = "Empty until DNS/ACM are wired up via Stage B (see docs/DNS_RUNBOOK.md)."
  type        = list(string)
  default     = []
}

variable "cloudfront_acm_certificate_arn" {
  description = "us-east-1, validated. Null until Stage B."
  type        = string
  default     = null
}

variable "api_custom_domain_name" {
  description = "e.g. test-api.zoryvex.space. Null until Stage B."
  type        = string
  default     = null
}

variable "api_regional_acm_certificate_arn" {
  description = "eu-west-1 (same region as the API), validated. Null until Stage B."
  type        = string
  default     = null
}

variable "evidence_retention_days" {
  type    = number
  default = 365
}

variable "log_retention_days" {
  description = "Test retention — CLAUDE.md: 'test retention 7 days.'"
  type        = number
  default     = 7
}

variable "tags" {
  type    = map(string)
  default = { Environment = "test", Project = "zoryvex" }
}

# Phase 7 slice 10. A spend guardrail, not a performance floor: this caps how
# much concurrency any one function can take, so a runaway loop or a burst of
# traffic against a single route cannot consume the whole account pool.
#
# Chosen from scripts/lib/load-quota-model.mjs rather than picked: that model
# puts the modelled peak concurrency of the entire system at 0.42 at the
# largest tier it covers (100,000 registered users), so 5 on a single function
# is roughly twelve times the peak the whole platform is modelled to need.
#
# The arithmetic that matters is the account pool. AWS refuses to leave fewer
# than 100 concurrent executions unreserved, and this account now has 1,000
# (confirmed read-only 2026-08-28: the earlier 10 restriction has been lifted
# to the AWS default). 44 functions at 5 reserves 220 and leaves 780
# unreserved, which is 7.8x the floor AWS requires.
#
# Not the module's own default of 20, which would now fit but only just: 880
# reserved leaves 120 against a floor of 100. Twenty buys nothing the model
# says is needed and spends the buffer that absorbs whatever function gets
# added next.
#
# Every site that sets this previously carried -1 with a comment explaining
# that no positive reservation was arithmetically possible under the old
# ceiling of 10. That is no longer true, and those comments have gone with it.
variable "lambda_reserved_concurrency" {
  description = "Per-function reserved concurrency for TEST. A ceiling that bounds spend, not a floor that guarantees capacity. See docs/SLO.md."
  type        = number
  default     = 5

  validation {
    condition     = var.lambda_reserved_concurrency >= 1 && var.lambda_reserved_concurrency <= 20
    error_message = "Keep this small. 44 functions share a 1,000 pool and AWS requires 100 to stay unreserved, so anything above 20 per function cannot fit."
  }
}

# --- Billing: subscriptions, reconciliation, diagnostics -------------------

variable "billing_create_subscription_deployment_package_path" {
  description = "Path to the built billing-create-subscription Lambda zip."
  type        = string
  default     = "../../../services/api/dist/billing-create-subscription.zip"
}

variable "billing_overview_deployment_package_path" {
  description = "Path to the built billing-overview Lambda zip."
  type        = string
  default     = "../../../services/api/dist/billing-overview.zip"
}

variable "billing_cancel_deployment_package_path" {
  description = "Path to the built billing-cancel Lambda zip."
  type        = string
  default     = "../../../services/api/dist/billing-cancel.zip"
}

variable "billing_card_update_link_deployment_package_path" {
  description = "Path to the built billing-card-update-link Lambda zip."
  type        = string
  default     = "../../../services/api/dist/billing-card-update-link.zip"
}

variable "admin_billing_diagnostic_deployment_package_path" {
  description = "Path to the built admin-billing-diagnostic Lambda zip."
  type        = string
  default     = "../../../services/api/dist/admin-billing-diagnostic.zip"
}

variable "jobs_billing_reconciliation_deployment_package_path" {
  description = "Path to the built jobs-billing-reconciliation Lambda zip."
  type        = string
  default     = "../../../services/api/dist/jobs-billing-reconciliation.zip"
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

variable "peer_request_deployment_package_path" {
  description = "Zip for the peer-confirmation request handler. Fixed, deterministic path."
  type        = string
  default     = "../../../services/api/dist/peer-request.zip"
}

variable "peer_preview_deployment_package_path" {
  description = "Zip for the unauthenticated peer-confirmation preview handler. Fixed, deterministic path."
  type        = string
  default     = "../../../services/api/dist/peer-preview.zip"
}

variable "peer_confirm_deployment_package_path" {
  description = "Zip for the unauthenticated peer-confirmation handler. Fixed, deterministic path."
  type        = string
  default     = "../../../services/api/dist/peer-confirm.zip"
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
