locals {
  api_origin          = var.api_custom_domain_name != null ? "https://${var.api_custom_domain_name}" : ""
  app_origins         = compact([var.app_origin, var.www_app_origin])
  evidence_bucket_arn = "arn:aws:s3:::${var.evidence_bucket_name}"
  # Objects, for the statements that grant per-object rather than per-bucket.
  evidence_object_arn = "arn:aws:s3:::${var.evidence_bucket_name}/*"

  # Same derivation, and the same reasoning, as infrastructure/envs/test's
  # local of this name — see that file for why the RP ID is app_origin's
  # host rather than an input allowed to disagree with it.
  webauthn_rp_id = var.webauthn_rp_id != "" ? var.webauthn_rp_id : (
    var.app_origin != "" ? split(":", split("/", replace(var.app_origin, "://", "/"))[1])[0] : ""
  )
}

data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

locals {
  # The EventBridge rule GuardDuty manages on this account's behalf for
  # Malware Protection for S3. Same derivation as test's local of this name;
  # the name is AWS's, not ours, hence the DO-NOT-DELETE prefix.
  guardduty_rule_arn = "arn:aws:events:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:rule/DO-NOT-DELETE-AmazonGuardDutyMalwareProtectionS3*"

  # See infrastructure/envs/test's identical local for why this is computed
  # rather than piped through a cross-env output.
  ses_domain_identity_arn = "arn:aws:ses:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:identity/zoryvex.space"

  # SES authorizes SendEmail against the configuration-set resource as well as
  # the identity whenever the caller passes a ConfigurationSetName, and every
  # send in this codebase does. TEST has had this since the auth route was
  # written; production had only the identity, so its sign-in email would have
  # been refused the first time anyone tried to use it.
  ses_configuration_set_arn = "arn:aws:ses:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:configuration-set/${var.ses_configuration_set_name}"
}

# Same placeholder-then-replace shape as infrastructure/envs/test's
# identical resource — see that file's comment for the full rationale.
# Not applied this phase (production stays untouched per CLAUDE.md/Prompt
# 7); kept here so this env's config validates and mirrors test's shape
# ahead of whenever production is actually applied.
resource "aws_ssm_parameter" "auth_token_pepper" {
  name        = "/zoryvex/production/auth/token-pepper"
  description = "Placeholder only — replaced by scripts/generate-auth-token-pepper.mjs right after apply. Never set via Terraform."
  type        = "SecureString"
  tier        = "Standard"
  value       = "GENERATED-BY-SCRIPT-IMMEDIATELY-AFTER-APPLY-NOT-A-REAL-PEPPER"
  tags        = var.tags

  lifecycle {
    ignore_changes = [value]
  }
}

# Same placeholder-then-founder-replace shape as infrastructure/envs/test's
# identical resource (Phase 6) — not created there for production yet
# because production stayed fully untouched through Phase 6. Added here
# now so this env's config mirrors test's shape ahead of whenever
# production is actually applied; still never applied this phase.
resource "aws_ssm_parameter" "paystack_secret_key" {
  name        = "/zoryvex/production/paystack/secret-key"
  description = "Placeholder only — founder replaces the value manually in AWS Console. Never set via Terraform."
  type        = "SecureString"
  tier        = "Standard"
  value       = "REPLACE-IN-AWS-CONSOLE-NOT-A-REAL-PAYSTACK-KEY"
  tags        = var.tags

  lifecycle {
    ignore_changes = [value]
  }
}

# See infrastructure/envs/test's identical resource for the full rationale.
# Not applied this phase (production stays untouched); kept here so this
# env's config mirrors test's shape ahead of whenever production is
# actually applied.
# Raises GitHub's anonymous rate limit for repository verification.
#
# services/api/src/repositories/github-repository.ts read
# `process.env.GITHUB_TOKEN` and no Terraform in either environment ever set
# it, so every GitHub call this product has made has been unauthenticated:
# 60 requests an hour per IP, measured against the live API on 2026-09-13,
# and one verification spends three.
#
# Placeholder, then replaced by hand with a fine-grained token carrying NO
# scopes and read-only access to public data, which is all the verifier
# needs. It reads public gists, public repositories and contributor lists,
# and nothing else. Never a token with repository write, and never one with
# access to private repositories: this raises a rate limit, it does not widen
# what can be read.
#
# Unlike test, this parameter lives in this root because no CI role plans or
# applies production, so the provider's decrypt-on-refresh cannot reach CI.
# Same reasoning the Paystack key in this file already follows.
resource "aws_ssm_parameter" "github_token" {
  name        = "/zoryvex/production/github/token"
  description = "Placeholder only — founder replaces the value manually. Fine-grained token, no scopes, public read only. Raises GitHub's 60/hour anonymous limit; the verifier works without it."
  type        = "SecureString"
  tier        = "Standard"
  value       = "REPLACE-IN-AWS-CONSOLE-NOT-A-REAL-GITHUB-TOKEN"
  tags        = var.tags

  lifecycle {
    ignore_changes = [value]
  }
}

resource "aws_ssm_parameter" "feature_flags" {
  name        = "/zoryvex/production/feature-flags"
  description = "packages/config FeatureFlagsSchema, JSON-encoded. Every risky flag defaults false; only scripts/emergency-cost-lockdown.mjs or a deliberate founder-approved AWS Console/CLI edit ever changes this in place."
  type        = "String"
  tier        = "Standard"
  value       = jsonencode({ payments = false, aiMatching = false, publicDiscovery = false, contactUnlocks = false, verificationReminders = false })
  tags        = var.tags

  lifecycle {
    ignore_changes = [value]
  }
}

# Which Paystack Plan object each of our plan keys maps to.
#
# A plain String, not a SecureString: a plan code is not a secret, it is
# visible in Paystack's own dashboard, and it is useless without the secret
# key. It is configuration rather than code for one reason that is not
# negotiable — test-mode and live-mode plan codes are different strings for
# the same product, so a code committed to this repository would be a
# live/test mix-up waiting for the switchover.
#
# Created empty. Until the six live Plan objects exist and their codes are
# written here, quoteSubscription reports every plan as unavailable and the
# checkout refuses rather than taking a one-off payment against no plan.
resource "aws_ssm_parameter" "paystack_plan_codes" {
  name        = "/zoryvex/production/paystack/plan-codes"
  description = "JSON object mapping plan keys (scout_founding_monthly, ...) to Paystack plan codes. Set by hand after the Plans are created in the Paystack dashboard."
  type        = "String"
  tier        = "Standard"
  value       = jsonencode({})
  tags        = var.tags

  lifecycle {
    ignore_changes = [value]
  }
}

module "static_site" {
  source = "../../modules/static-site"

  # Without this the site renders and does nothing.
  #
  # Next.js's static export ships inline hydration scripts, and a CSP of
  # script-src 'self' blocks them, so React never attaches: every page
  # looks correct, every link that is a real anchor works, and every
  # button, form and fetch is inert. Sign-in appeared broken with no error
  # anywhere, because the browser never made a request for anything to log.
  #
  # There is no nonce alternative here. Nonces need per-request rendering
  # and this is a static export, which is why the module documents
  # 'unsafe-inline' as the supported answer and why test has set it since
  # Phase 7. Production never set it and silently took the strict default.
  #
  # Never 'unsafe-eval' alongside it: Next.js needs eval in development
  # only, never in a production build.
  allow_inline_scripts = true

  bucket_name         = var.site_bucket_name
  domain_aliases      = var.domain_aliases
  acm_certificate_arn = var.cloudfront_acm_certificate_arn
  apex_domain         = var.apex_domain
  www_domain          = var.www_domain
  api_origin          = local.api_origin
  enable_hsts         = var.enable_hsts
  tags                = var.tags
}

# The account's GuardDuty detector, read rather than created.
#
# One detector exists per account per region, and infrastructure/envs/test
# owns creating it — its own comment says a later environment "must
# reference this same detector via a data source, never create a second one
# in the same account+region (that apply would conflict)". This is that
# environment.
#
# A data source rather than the variable this used to be, so there is no
# value for anybody to look up, paste, or get wrong on the one production
# apply. It also cannot drift: if the detector is ever replaced, production
# follows it.
#
# This is a read of a shared account-level resource, not a dependency on the
# test environment's application stack. The role below is production's own.
data "aws_guardduty_detector" "this" {}

# Production's own role for GuardDuty Malware Protection for S3.
#
# Deliberately not shared with test. An IAM role is per-name, so there is no
# conflict in having one each, and pointing production at
# zoryvex-test-guardduty-malware-protection would have made production's
# malware scanning break the day test was torn down. Founder decision,
# 2026-09-10, taken during the pre-deployment gate.
#
# Trust and permission shape mirror infrastructure/envs/test's, which were
# verified against the current AWS documentation (docs/SOURCES.md). The one
# difference is scope: test's grants also cover its isolated EICAR bucket,
# which production does not have, so production's cover the evidence bucket
# alone.
data "aws_iam_policy_document" "guardduty_malware_protection_assume_role" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["malware-protection-plan.guardduty.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [data.aws_caller_identity.current.account_id]
    }
  }
}

resource "aws_iam_role" "guardduty_malware_protection" {
  name               = "zoryvex-production-guardduty-malware-protection"
  assume_role_policy = data.aws_iam_policy_document.guardduty_malware_protection_assume_role.json
  tags               = var.tags
}

data "aws_iam_policy_document" "guardduty_malware_protection_permissions" {
  statement {
    sid       = "AllowManagedRuleToSendS3EventsToGuardDuty"
    effect    = "Allow"
    actions   = ["events:PutRule", "events:DeleteRule", "events:PutTargets", "events:RemoveTargets"]
    resources = [local.guardduty_rule_arn]

    condition {
      test     = "StringLike"
      variable = "events:ManagedBy"
      values   = ["malware-protection-plan.guardduty.amazonaws.com"]
    }
  }

  statement {
    sid       = "AllowGuardDutyToMonitorEventBridgeManagedRule"
    effect    = "Allow"
    actions   = ["events:DescribeRule", "events:ListTargetsByRule"]
    resources = [local.guardduty_rule_arn]
  }

  statement {
    sid       = "AllowPostScanTag"
    effect    = "Allow"
    actions   = ["s3:PutObjectTagging", "s3:GetObjectTagging", "s3:PutObjectVersionTagging", "s3:GetObjectVersionTagging"]
    resources = [local.evidence_object_arn]
  }

  statement {
    sid       = "AllowEnableS3EventBridgeEvents"
    effect    = "Allow"
    actions   = ["s3:PutBucketNotification", "s3:GetBucketNotification"]
    resources = [local.evidence_bucket_arn]
  }

  statement {
    sid       = "AllowPutValidationObject"
    effect    = "Allow"
    actions   = ["s3:PutObject"]
    resources = ["${local.evidence_bucket_arn}/malware-protection-resource-validation-object"]
  }

  statement {
    sid       = "AllowCheckBucketOwnership"
    effect    = "Allow"
    actions   = ["s3:ListBucket"]
    resources = [local.evidence_bucket_arn]
  }

  statement {
    sid       = "AllowMalwareScan"
    effect    = "Allow"
    actions   = ["s3:GetObject", "s3:GetObjectVersion"]
    resources = [local.evidence_object_arn]
  }

  # No KMS statement: the evidence bucket uses SSE-S3 (AES256), not a
  # customer-managed KMS key (infrastructure/modules/evidence-storage).
}

resource "aws_iam_role_policy" "guardduty_malware_protection_permissions" {
  name   = "zoryvex-production-guardduty-malware-protection-permissions"
  role   = aws_iam_role.guardduty_malware_protection.id
  policy = data.aws_iam_policy_document.guardduty_malware_protection_permissions.json
}

module "evidence_storage" {
  source = "../../modules/evidence-storage"

  bucket_name                           = var.evidence_bucket_name
  retention_days                        = var.evidence_retention_days
  allowed_upload_origins                = local.app_origins
  guardduty_detector_id                 = data.aws_guardduty_detector.this.id
  guardduty_malware_protection_role_arn = aws_iam_role.guardduty_malware_protection.arn
  tags                                  = var.tags
}

module "core_table" {
  source = "../../modules/data"

  table_name = "zoryvex-production-core"
  hash_key   = "PK"
  range_key  = "SK"

  # CLAUDE.md: "deletion protection in prod, point-in-time recovery in prod" —
  # both left at the module's true defaults deliberately (not overridden),
  # unlike ../test which explicitly turns them off.
  deletion_protection_enabled    = true
  point_in_time_recovery_enabled = true

  attributes = [
    { name = "PK", type = "S" },
    { name = "SK", type = "S" },
    { name = "GSI1PK", type = "S" },
    { name = "GSI1SK", type = "S" },
    { name = "GSI2PK", type = "S" },
    { name = "GSI2SK", type = "S" },
    { name = "GSI3PK", type = "S" },
    { name = "GSI3SK", type = "S" },
  ]

  global_secondary_indexes = [
    {
      name            = "GSI1"
      hash_key        = "GSI1PK"
      range_key       = "GSI1SK"
      projection_type = "ALL"
    },
    {
      name            = "GSI2"
      hash_key        = "GSI2PK"
      range_key       = "GSI2SK"
      projection_type = "ALL"
    },
    {
      # Admin entity enumeration ("list every candidate/employer") — see
      # docs/DATA_MODEL.md. The only access pattern that needs to list a
      # whole entity type rather than one item by ID.
      name            = "GSI3"
      hash_key        = "GSI3PK"
      range_key       = "GSI3SK"
      projection_type = "ALL"
    },
  ]

  tags = var.tags
}

# DynamoDB GSI ARNs follow a fixed, documented shape (table ARN + "/index/"
# + index name) — deterministic, same pattern already used elsewhere in this
# file for other derived ARNs.
locals {
  core_table_gsi1_arn = "${module.core_table.table_arn}/index/GSI1"
  core_table_gsi2_arn = "${module.core_table.table_arn}/index/GSI2"
  core_table_gsi3_arn = "${module.core_table.table_arn}/index/GSI3"
}

module "auth" {
  source                         = "../../modules/auth"
  reserved_concurrent_executions = var.lambda_reserved_concurrency

  function_name                   = "zoryvex-production-authorizer"
  deployment_package_path         = var.authorizer_deployment_package_path
  log_retention_days              = var.log_retention_days
  sessions_table_arn              = module.core_table.table_arn
  auth_token_pepper_parameter_arn = aws_ssm_parameter.auth_token_pepper.arn
  environment_variables = {
    TABLE_NAME              = module.core_table.table_name
    AUTH_TOKEN_PEPPER_PARAM = aws_ssm_parameter.auth_token_pepper.name
    APP_ORIGIN              = var.app_origin
  }
  tags = var.tags
}

module "api_gateway" {
  source = "../../modules/api-gateway"

  api_name                       = "zoryvex-production-api"
  log_retention_days             = var.log_retention_days
  cors_allow_origins             = local.app_origins
  authorizer_function_invoke_arn = module.auth.function_invoke_arn
  authorizer_function_arn        = module.auth.function_arn
  custom_domain_name             = var.api_custom_domain_name
  regional_acm_certificate_arn   = var.api_regional_acm_certificate_arn
  tags                           = var.tags
}

module "health_route" {
  source                         = "../../modules/api-route"
  reserved_concurrent_executions = var.lambda_reserved_concurrency

  function_name           = "zoryvex-production-health"
  handler                 = "handlers/health.handler"
  deployment_package_path = var.api_deployment_package_path
  route_key               = "GET /health"
  api_id                  = module.api_gateway.api_id
  api_execution_arn       = module.api_gateway.execution_arn
  authorized              = false
  log_retention_days      = var.log_retention_days
  tags                    = var.tags

  # Mirrors infrastructure/envs/test/main.tf. The build sha in the /health
  # response is baked into the bundle instead, so this names the deployment
  # target and that names the code.
  environment_variables = {
    ZORYVEX_ENVIRONMENT = "production"
  }
}

# --- Auth domain routes (Phase 7 slice 1) ---------------------------------
# See infrastructure/envs/test's identical block for the full rationale
# (unauthenticated request-code/consume-code/sign-out, authenticated
# founder_admin-only webauthn routes).

locals {
  auth_environment_variables = {
    TABLE_NAME              = module.core_table.table_name
    AUTH_TOKEN_PEPPER_PARAM = aws_ssm_parameter.auth_token_pepper.name
    APP_ORIGIN              = var.app_origin
  }
}

module "auth_request_code_route" {
  source                         = "../../modules/api-route"
  reserved_concurrent_executions = var.lambda_reserved_concurrency

  function_name             = "zoryvex-production-auth-request-code"
  handler                   = "handlers/auth-request-code.handler"
  deployment_package_path   = var.auth_request_code_deployment_package_path
  route_key                 = "POST /auth/request-code"
  api_id                    = module.api_gateway.api_id
  api_execution_arn         = module.api_gateway.execution_arn
  authorized                = false
  log_retention_days        = var.log_retention_days
  dynamodb_table_arn        = module.core_table.table_arn
  secure_ssm_parameter_arns = [aws_ssm_parameter.auth_token_pepper.arn]
  ses_identity_arn          = local.ses_domain_identity_arn
  ses_configuration_set_arn = local.ses_configuration_set_arn
  environment_variables = merge(local.auth_environment_variables, {
    SIGN_IN_EMAIL_FROM         = var.sign_in_email_from
    SES_CONFIGURATION_SET_NAME = var.ses_configuration_set_name
  })
  tags = var.tags
}

module "auth_consume_code_route" {
  source                         = "../../modules/api-route"
  reserved_concurrent_executions = var.lambda_reserved_concurrency

  function_name             = "zoryvex-production-auth-consume-code"
  handler                   = "handlers/auth-consume-code.handler"
  deployment_package_path   = var.auth_consume_code_deployment_package_path
  route_key                 = "POST /auth/consume-code"
  api_id                    = module.api_gateway.api_id
  api_execution_arn         = module.api_gateway.execution_arn
  authorized                = false
  log_retention_days        = var.log_retention_days
  dynamodb_table_arn        = module.core_table.table_arn
  secure_ssm_parameter_arns = [aws_ssm_parameter.auth_token_pepper.arn]
  environment_variables     = local.auth_environment_variables
  tags                      = var.tags
}

module "auth_sign_out_route" {
  source                         = "../../modules/api-route"
  reserved_concurrent_executions = var.lambda_reserved_concurrency

  function_name             = "zoryvex-production-auth-sign-out"
  handler                   = "handlers/auth-sign-out.handler"
  deployment_package_path   = var.auth_sign_out_deployment_package_path
  route_key                 = "POST /auth/sign-out"
  api_id                    = module.api_gateway.api_id
  api_execution_arn         = module.api_gateway.execution_arn
  authorized                = false
  log_retention_days        = var.log_retention_days
  dynamodb_table_arn        = module.core_table.table_arn
  secure_ssm_parameter_arns = [aws_ssm_parameter.auth_token_pepper.arn]
  environment_variables     = local.auth_environment_variables
  tags                      = var.tags
}

module "webauthn_register_options_route" {
  source                         = "../../modules/api-route"
  reserved_concurrent_executions = var.lambda_reserved_concurrency

  function_name             = "zoryvex-production-webauthn-register-options"
  handler                   = "handlers/webauthn-register-options.handler"
  deployment_package_path   = var.webauthn_register_options_deployment_package_path
  route_key                 = "POST /auth/webauthn/register/options"
  api_id                    = module.api_gateway.api_id
  api_execution_arn         = module.api_gateway.execution_arn
  authorized                = true
  authorizer_id             = module.api_gateway.authorizer_id
  log_retention_days        = var.log_retention_days
  dynamodb_table_arn        = module.core_table.table_arn
  secure_ssm_parameter_arns = [aws_ssm_parameter.auth_token_pepper.arn]
  environment_variables = merge(local.auth_environment_variables, {
    WEBAUTHN_RP_ID = local.webauthn_rp_id
  })
  tags = var.tags
}

module "webauthn_register_verify_route" {
  source                         = "../../modules/api-route"
  reserved_concurrent_executions = var.lambda_reserved_concurrency

  function_name             = "zoryvex-production-webauthn-register-verify"
  handler                   = "handlers/webauthn-register-verify.handler"
  deployment_package_path   = var.webauthn_register_verify_deployment_package_path
  route_key                 = "POST /auth/webauthn/register/verify"
  api_id                    = module.api_gateway.api_id
  api_execution_arn         = module.api_gateway.execution_arn
  authorized                = true
  authorizer_id             = module.api_gateway.authorizer_id
  log_retention_days        = var.log_retention_days
  dynamodb_table_arn        = module.core_table.table_arn
  secure_ssm_parameter_arns = [aws_ssm_parameter.auth_token_pepper.arn]
  environment_variables = merge(local.auth_environment_variables, {
    WEBAUTHN_RP_ID = local.webauthn_rp_id
  })
  tags = var.tags
}

module "webauthn_step_up_options_route" {
  source                         = "../../modules/api-route"
  reserved_concurrent_executions = var.lambda_reserved_concurrency

  function_name             = "zoryvex-production-webauthn-step-up-options"
  handler                   = "handlers/webauthn-step-up-options.handler"
  deployment_package_path   = var.webauthn_step_up_options_deployment_package_path
  route_key                 = "POST /auth/webauthn/step-up/options"
  api_id                    = module.api_gateway.api_id
  api_execution_arn         = module.api_gateway.execution_arn
  authorized                = true
  authorizer_id             = module.api_gateway.authorizer_id
  log_retention_days        = var.log_retention_days
  dynamodb_table_arn        = module.core_table.table_arn
  secure_ssm_parameter_arns = [aws_ssm_parameter.auth_token_pepper.arn]
  environment_variables = merge(local.auth_environment_variables, {
    WEBAUTHN_RP_ID = local.webauthn_rp_id
  })
  tags = var.tags
}

module "webauthn_step_up_verify_route" {
  source                         = "../../modules/api-route"
  reserved_concurrent_executions = var.lambda_reserved_concurrency

  function_name             = "zoryvex-production-webauthn-step-up-verify"
  handler                   = "handlers/webauthn-step-up-verify.handler"
  deployment_package_path   = var.webauthn_step_up_verify_deployment_package_path
  route_key                 = "POST /auth/webauthn/step-up/verify"
  api_id                    = module.api_gateway.api_id
  api_execution_arn         = module.api_gateway.execution_arn
  authorized                = true
  authorizer_id             = module.api_gateway.authorizer_id
  log_retention_days        = var.log_retention_days
  dynamodb_table_arn        = module.core_table.table_arn
  secure_ssm_parameter_arns = [aws_ssm_parameter.auth_token_pepper.arn]
  environment_variables = merge(local.auth_environment_variables, {
    WEBAUTHN_RP_ID = local.webauthn_rp_id
  })
  tags = var.tags
}

module "webhooks_queue" {
  source = "../../modules/messaging"

  queue_name          = "zoryvex-production-webhooks"
  alarm_sns_topic_arn = module.observability.alerts_topic_arn
  tags                = var.tags
}

module "email_queue" {
  source = "../../modules/messaging"

  queue_name          = "zoryvex-production-email"
  alarm_sns_topic_arn = module.observability.alerts_topic_arn
  tags                = var.tags
}

module "ai_queue" {
  source = "../../modules/messaging"

  queue_name          = "zoryvex-production-ai"
  alarm_sns_topic_arn = module.observability.alerts_topic_arn
  tags                = var.tags
}

module "evidence_processing_queue" {
  source = "../../modules/messaging"

  queue_name                  = "zoryvex-production-evidence-processing"
  alarm_sns_topic_arn         = module.observability.alerts_topic_arn
  allow_eventbridge_rule_arns = [aws_cloudwatch_event_rule.evidence_scan_result.arn]
  tags                        = var.tags
}

# --- Evidence pipeline (Phase 7 slice 3) -----------------------------------
# See infrastructure/envs/test's identical block for the full rationale. No
# EICAR isolated test bucket here — that rehearsal is test-only.
resource "aws_cloudwatch_event_rule" "evidence_scan_result" {
  name = "zoryvex-production-evidence-scan-result"

  event_pattern = jsonencode({
    source      = ["aws.guardduty"]
    detail-type = ["GuardDuty Malware Protection Object Scan Result"]
    detail = {
      s3ObjectDetails = {
        bucketName = [var.evidence_bucket_name]
      }
    }
  })

  tags = var.tags
}

resource "aws_cloudwatch_event_target" "evidence_scan_result_to_queue" {
  rule = aws_cloudwatch_event_rule.evidence_scan_result.name
  arn  = module.evidence_processing_queue.queue_arn
}

module "evidence_scan_worker" {
  source                         = "../../modules/queue-consumer"
  reserved_concurrent_executions = var.lambda_reserved_concurrency

  function_name           = "zoryvex-production-evidence-scan-worker"
  handler                 = "handlers/evidence-scan-result-worker.handler"
  deployment_package_path = var.evidence_scan_worker_deployment_package_path
  log_retention_days      = var.log_retention_days
  queue_arn               = module.evidence_processing_queue.queue_arn
  dynamodb_table_arn      = module.core_table.table_arn
  evidence_bucket_arn     = local.evidence_bucket_arn
  environment_variables = {
    TABLE_NAME           = module.core_table.table_name
    EVIDENCE_BUCKET_NAME = var.evidence_bucket_name
  }
  tags = var.tags
}

module "evidence_request_upload_route" {
  source                         = "../../modules/api-route"
  reserved_concurrent_executions = var.lambda_reserved_concurrency

  function_name           = "zoryvex-production-evidence-request-upload"
  handler                 = "handlers/evidence-request-upload.handler"
  deployment_package_path = var.evidence_request_upload_deployment_package_path
  route_key               = "POST /evidence/upload-requests"
  api_id                  = module.api_gateway.api_id
  api_execution_arn       = module.api_gateway.execution_arn
  authorized              = true
  authorizer_id           = module.api_gateway.authorizer_id
  log_retention_days      = var.log_retention_days
  dynamodb_table_arn      = module.core_table.table_arn
  evidence_bucket_arn     = local.evidence_bucket_arn
  environment_variables = {
    TABLE_NAME           = module.core_table.table_name
    EVIDENCE_BUCKET_NAME = var.evidence_bucket_name
  }
  tags = var.tags
}

module "evidence_download_route" {
  source                         = "../../modules/api-route"
  reserved_concurrent_executions = var.lambda_reserved_concurrency

  function_name           = "zoryvex-production-evidence-download"
  handler                 = "handlers/evidence-download.handler"
  deployment_package_path = var.evidence_download_deployment_package_path
  route_key               = "GET /evidence/files/{fileId}/download"
  api_id                  = module.api_gateway.api_id
  api_execution_arn       = module.api_gateway.execution_arn
  authorized              = true
  authorizer_id           = module.api_gateway.authorizer_id
  log_retention_days      = var.log_retention_days
  dynamodb_table_arn      = module.core_table.table_arn
  evidence_bucket_arn     = local.evidence_bucket_arn
  environment_variables = {
    TABLE_NAME           = module.core_table.table_name
    EVIDENCE_BUCKET_NAME = var.evidence_bucket_name
  }
  tags = var.tags
}

# --- Proof Hiring Kit domain (Phase 7 slice 4) -----------------------------
# See infrastructure/envs/test's identical block for the full rationale.

module "kit_preview_route" {
  source                         = "../../modules/api-route"
  reserved_concurrent_executions = var.lambda_reserved_concurrency

  function_name           = "zoryvex-production-kit-preview"
  handler                 = "handlers/kit-preview.handler"
  deployment_package_path = var.kit_preview_deployment_package_path
  route_key               = "GET /roles/{roleId}/kit-preview"
  api_id                  = module.api_gateway.api_id
  api_execution_arn       = module.api_gateway.execution_arn
  authorized              = true
  authorizer_id           = module.api_gateway.authorizer_id
  log_retention_days      = var.log_retention_days
  dynamodb_table_arn      = module.core_table.table_arn
  environment_variables = {
    TABLE_NAME = module.core_table.table_name
  }
  tags = var.tags
}

# Source mirrored only, not applied. See infrastructure/envs/test's identical
# module for the 2026-08-26 audit finding this closes.
module "kit_status_route" {
  source                         = "../../modules/api-route"
  reserved_concurrent_executions = var.lambda_reserved_concurrency

  function_name           = "zoryvex-production-kit-status"
  handler                 = "handlers/kit-status.handler"
  deployment_package_path = var.kit_status_deployment_package_path
  route_key               = "GET /roles/{roleId}/kit-status"
  api_id                  = module.api_gateway.api_id
  api_execution_arn       = module.api_gateway.execution_arn
  authorized              = true
  authorizer_id           = module.api_gateway.authorizer_id
  log_retention_days      = var.log_retention_days
  dynamodb_table_arn      = module.core_table.table_arn
  environment_variables = {
    TABLE_NAME = module.core_table.table_name
  }
  tags = var.tags
}

module "kit_create_order_route" {
  source                         = "../../modules/api-route"
  reserved_concurrent_executions = var.lambda_reserved_concurrency

  function_name           = "zoryvex-production-kit-create-order"
  handler                 = "handlers/kit-create-order.handler"
  deployment_package_path = var.kit_create_order_deployment_package_path
  route_key               = "POST /roles/{roleId}/kit-orders"
  api_id                  = module.api_gateway.api_id
  api_execution_arn       = module.api_gateway.execution_arn
  authorized              = true
  authorizer_id           = module.api_gateway.authorizer_id
  log_retention_days      = var.log_retention_days
  dynamodb_table_arn      = module.core_table.table_arn
  # Phase 8 Paystack test-mode slice: this route now calls
  # POST https://api.paystack.co/transaction/initialize server-side to get a
  # real authorization_url, so it needs the same secret-key read access the
  # webhook route already has. Source mirrored only — not applied to
  # production.
  secure_ssm_parameter_arns = [aws_ssm_parameter.paystack_secret_key.arn, aws_ssm_parameter.feature_flags.arn]
  environment_variables = {
    # Gates on a feature flag. Without this variable getFeatureFlags()
    # returns every flag false and the route reports its feature paused,
    # silently and whatever the live parameter says.
    FEATURE_FLAGS_PARAM       = aws_ssm_parameter.feature_flags.name
    TABLE_NAME                = module.core_table.table_name
    PAYSTACK_SECRET_KEY_PARAM = aws_ssm_parameter.paystack_secret_key.name
    PAYSTACK_KEY_PREFIX       = "sk_live_"
    APP_ORIGIN                = var.app_origin
  }
  tags = var.tags
}

module "kit_download_route" {
  source                         = "../../modules/api-route"
  reserved_concurrent_executions = var.lambda_reserved_concurrency

  function_name           = "zoryvex-production-kit-download"
  handler                 = "handlers/kit-download.handler"
  deployment_package_path = var.kit_download_deployment_package_path
  route_key               = "GET /roles/{roleId}/kit"
  api_id                  = module.api_gateway.api_id
  api_execution_arn       = module.api_gateway.execution_arn
  authorized              = true
  authorizer_id           = module.api_gateway.authorizer_id
  log_retention_days      = var.log_retention_days
  dynamodb_table_arn      = module.core_table.table_arn
  environment_variables = {
    TABLE_NAME = module.core_table.table_name
  }
  tags = var.tags
}

module "kit_regenerate_route" {
  source                         = "../../modules/api-route"
  reserved_concurrent_executions = var.lambda_reserved_concurrency

  function_name           = "zoryvex-production-kit-regenerate"
  handler                 = "handlers/kit-regenerate.handler"
  deployment_package_path = var.kit_regenerate_deployment_package_path
  route_key               = "POST /roles/{roleId}/kit/regenerate"
  api_id                  = module.api_gateway.api_id
  api_execution_arn       = module.api_gateway.execution_arn
  authorized              = true
  authorizer_id           = module.api_gateway.authorizer_id
  log_retention_days      = var.log_retention_days
  dynamodb_table_arn      = module.core_table.table_arn
  environment_variables = {
    TABLE_NAME = module.core_table.table_name
  }
  tags = var.tags
}

# The public proof page and its badge.
#
# Missing from production until the pre-deployment gate, while the consent
# route that mints a publicProofId was present. So a candidate could opt in,
# be given a link to share, and have it 404 for everyone who opened it.
#
# Unauthenticated by design: the whole point is a page a candidate can send
# to somebody with no account. The id is minted on opt-in and destroyed on
# opt-out, and public-proof-service refuses anything that is not currently
# opted in, so the route being open is not the same as the data being open.
#
# Table access only, no bucket. Same as test, and for the reason test
# records there: this route stopped reading any object when profile photos
# were removed, and an unauthenticated route holding read access to the
# evidence bucket would be a permission nobody could later explain.
module "public_proof_route" {
  source                         = "../../modules/api-route"
  reserved_concurrent_executions = var.lambda_reserved_concurrency

  function_name           = "zoryvex-production-public-proof"
  handler                 = "handlers/public-proof.handler"
  deployment_package_path = var.public_proof_deployment_package_path
  route_key               = "GET /public/proof/{publicProofId}"
  api_id                  = module.api_gateway.api_id
  api_execution_arn       = module.api_gateway.execution_arn
  authorized              = false
  log_retention_days      = var.log_retention_days
  dynamodb_table_arn      = module.core_table.table_arn
  environment_variables = {
    TABLE_NAME = module.core_table.table_name
  }
  tags = var.tags
}

module "public_proof_badge_route" {
  source                         = "../../modules/api-route"
  reserved_concurrent_executions = var.lambda_reserved_concurrency

  function_name           = "zoryvex-production-public-proof-badge"
  handler                 = "handlers/public-proof-badge.handler"
  deployment_package_path = var.public_proof_badge_deployment_package_path
  route_key               = "GET /public/proof/{publicProofId}/badge.svg"
  api_id                  = module.api_gateway.api_id
  api_execution_arn       = module.api_gateway.execution_arn
  authorized              = false
  log_retention_days      = var.log_retention_days
  dynamodb_table_arn      = module.core_table.table_arn
  environment_variables = {
    TABLE_NAME = module.core_table.table_name
  }
  tags = var.tags
}

module "webhooks_paystack_route" {
  source                         = "../../modules/api-route"
  reserved_concurrent_executions = var.lambda_reserved_concurrency

  function_name             = "zoryvex-production-webhooks-paystack"
  handler                   = "handlers/webhooks-paystack.handler"
  deployment_package_path   = var.webhooks_paystack_deployment_package_path
  route_key                 = "POST /webhooks/paystack"
  api_id                    = module.api_gateway.api_id
  api_execution_arn         = module.api_gateway.execution_arn
  authorized                = false
  log_retention_days        = var.log_retention_days
  dynamodb_table_arn        = module.core_table.table_arn
  secure_ssm_parameter_arns = [aws_ssm_parameter.paystack_secret_key.arn]
  sns_publish_arns          = [module.observability.alerts_topic_arn]
  environment_variables = {
    TABLE_NAME                = module.core_table.table_name
    PAYSTACK_SECRET_KEY_PARAM = aws_ssm_parameter.paystack_secret_key.name
    PAYSTACK_KEY_PREFIX       = "sk_live_"
    ALERTS_TOPIC_ARN          = module.observability.alerts_topic_arn
  }
  tags = var.tags
}

# --- Privacy: consent, export, deletion, contact-unlock (Phase 7 slice 5) --
# See infrastructure/envs/test's identical block for the full rationale.

module "deletion_queue" {
  source = "../../modules/messaging"

  queue_name          = "zoryvex-production-deletion"
  alarm_sns_topic_arn = module.observability.alerts_topic_arn
  tags                = var.tags
}

module "privacy_deletion_worker" {
  source                         = "../../modules/queue-consumer"
  reserved_concurrent_executions = var.lambda_reserved_concurrency

  function_name           = "zoryvex-production-privacy-deletion-worker"
  handler                 = "handlers/privacy-deletion-worker.handler"
  deployment_package_path = var.privacy_deletion_worker_deployment_package_path
  log_retention_days      = var.log_retention_days
  queue_arn               = module.deletion_queue.queue_arn
  dynamodb_table_arn      = module.core_table.table_arn
  # match-repository.ts's listMatchesForCandidate (called from
  # deletion-service.ts's deleteCandidateData) queries GSI1 — without this,
  # every real deletion fails with AccessDeniedException on dynamodb:Query
  # and retries until it dead-letters (confirmed live in TEST, Phase 7
  # slice 11 privacy acceptance). No other query in the deletion path
  # touches a GSI.
  dynamodb_index_arns = [local.core_table_gsi1_arn]
  evidence_bucket_arn = local.evidence_bucket_arn
  environment_variables = {
    TABLE_NAME           = module.core_table.table_name
    EVIDENCE_BUCKET_NAME = var.evidence_bucket_name
  }
  tags = var.tags
}

module "privacy_consent_route" {
  source                         = "../../modules/api-route"
  reserved_concurrent_executions = var.lambda_reserved_concurrency

  function_name           = "zoryvex-production-privacy-consent"
  handler                 = "handlers/privacy-consent.handler"
  deployment_package_path = var.privacy_consent_deployment_package_path
  route_key               = "PATCH /candidates/me/consent"
  api_id                  = module.api_gateway.api_id
  api_execution_arn       = module.api_gateway.execution_arn
  authorized              = true
  authorizer_id           = module.api_gateway.authorizer_id
  log_retention_days      = var.log_retention_days
  dynamodb_table_arn      = module.core_table.table_arn
  # Opting *out* of discovery withdraws the candidate from every open match,
  # and that withdrawal starts with a GSI1 Query on CANDIDATE#<id>
  # (privacy-service's withdrawFromOpenMatches -> listMatchesForCandidate).
  # Without the index ARN the opt-out fails halfway: the flag is already
  # flipped and the audit event already written when the query is denied, so
  # the candidate sees an error while still appearing in matches they just
  # asked to leave. Found by scripts/check-gsi-grants.mjs rather than by a
  # live request failing, which is the whole point of that check.
  dynamodb_index_arns = [local.core_table_gsi1_arn]
  environment_variables = {
    TABLE_NAME = module.core_table.table_name
  }
  tags = var.tags
}

module "privacy_export_route" {
  source                         = "../../modules/api-route"
  reserved_concurrent_executions = var.lambda_reserved_concurrency

  function_name           = "zoryvex-production-privacy-export"
  handler                 = "handlers/privacy-export.handler"
  deployment_package_path = var.privacy_export_deployment_package_path
  route_key               = "GET /candidates/me/export"
  api_id                  = module.api_gateway.api_id
  api_execution_arn       = module.api_gateway.execution_arn
  authorized              = true
  authorizer_id           = module.api_gateway.authorizer_id
  log_retention_days      = var.log_retention_days
  dynamodb_table_arn      = module.core_table.table_arn
  # listMatchesForCandidate queries GSI1, which the export needs since
  # 2026-09-04: the export now reports which roles an employer unlocked this
  # candidate's contact for. Without the grant the Lambda answers
  # AccessDeniedException on every export - the same defect class as the
  # subscription outage and the privacy-deletion-worker fix before it, and
  # found the same way, by scripts/check-gsi-grants.mjs rather than by a
  # candidate's export failing.
  dynamodb_index_arns = [local.core_table_gsi1_arn]
  environment_variables = {
    TABLE_NAME = module.core_table.table_name
  }
  tags = var.tags
}

module "privacy_request_deletion_route" {
  source                         = "../../modules/api-route"
  reserved_concurrent_executions = var.lambda_reserved_concurrency

  function_name           = "zoryvex-production-privacy-request-deletion"
  handler                 = "handlers/privacy-request-deletion.handler"
  deployment_package_path = var.privacy_request_deletion_deployment_package_path
  route_key               = "POST /candidates/me/delete"
  api_id                  = module.api_gateway.api_id
  api_execution_arn       = module.api_gateway.execution_arn
  authorized              = true
  authorizer_id           = module.api_gateway.authorizer_id
  log_retention_days      = var.log_retention_days
  queue_arns              = [module.deletion_queue.queue_arn]
  environment_variables = {
    DELETION_QUEUE_URL = module.deletion_queue.queue_url
  }
  tags = var.tags
}

module "matches_unlock_contact_route" {
  source                         = "../../modules/api-route"
  reserved_concurrent_executions = var.lambda_reserved_concurrency

  function_name           = "zoryvex-production-matches-unlock-contact"
  handler                 = "handlers/matches-unlock-contact.handler"
  deployment_package_path = var.matches_unlock_contact_deployment_package_path
  route_key               = "POST /roles/{roleId}/matches/{candidateId}/unlock-contact"
  api_id                  = module.api_gateway.api_id
  api_execution_arn       = module.api_gateway.execution_arn
  authorized              = true
  authorizer_id           = module.api_gateway.authorizer_id
  log_retention_days      = var.log_retention_days
  dynamodb_table_arn      = module.core_table.table_arn
  # The candidate is told when their contact is shared, so this route sends
  # mail. Same verified identity as sign-in — a second sender would need its
  # own verified identity for nothing a reader would notice.
  ses_identity_arn          = local.ses_domain_identity_arn
  ses_configuration_set_arn = local.ses_configuration_set_arn
  # Plain String, not a secret, but the read still needs an
  # explicit grant: getFeatureFlags() rethrows anything that is not
  # ParameterNotFound, so an ungranted route fails with a 500 rather
  # than the quiet default.
  secure_ssm_parameter_arns = [aws_ssm_parameter.feature_flags.arn]
  environment_variables = {
    # Gates on a feature flag. Without this variable getFeatureFlags()
    # returns every flag false and the route reports its feature paused,
    # silently and whatever the live parameter says.
    FEATURE_FLAGS_PARAM        = aws_ssm_parameter.feature_flags.name
    TABLE_NAME                 = module.core_table.table_name
    APP_ORIGIN                 = var.app_origin
    REMINDER_FROM_ADDRESS      = var.sign_in_email_from
    SES_CONFIGURATION_SET_NAME = var.ses_configuration_set_name
  }
  tags = var.tags
}

# GET counterpart — source mirrored only, not applied. See infrastructure/envs/test's
# identical module for the 2026-08-26 audit finding this closes.
module "matches_get_contact_route" {
  source                         = "../../modules/api-route"
  reserved_concurrent_executions = var.lambda_reserved_concurrency

  function_name           = "zoryvex-production-matches-get-contact"
  handler                 = "handlers/matches-get-contact.handler"
  deployment_package_path = var.matches_get_contact_deployment_package_path
  route_key               = "GET /roles/{roleId}/matches/{candidateId}/contact"
  api_id                  = module.api_gateway.api_id
  api_execution_arn       = module.api_gateway.execution_arn
  authorized              = true
  authorizer_id           = module.api_gateway.authorizer_id
  log_retention_days      = var.log_retention_days
  dynamodb_table_arn      = module.core_table.table_arn
  # Plain String, not a secret, but the read still needs an
  # explicit grant: getFeatureFlags() rethrows anything that is not
  # ParameterNotFound, so an ungranted route fails with a 500 rather
  # than the quiet default.
  secure_ssm_parameter_arns = [aws_ssm_parameter.feature_flags.arn]
  environment_variables = {
    # Gates on a feature flag. Without this variable getFeatureFlags()
    # returns every flag false and the route reports its feature paused,
    # silently and whatever the live parameter says.
    FEATURE_FLAGS_PARAM = aws_ssm_parameter.feature_flags.name
    TABLE_NAME          = module.core_table.table_name
  }
  tags = var.tags
}

module "matches_evidence_route" {
  source                         = "../../modules/api-route"
  reserved_concurrent_executions = var.lambda_reserved_concurrency

  function_name           = "zoryvex-production-matches-evidence"
  handler                 = "handlers/matches-evidence.handler"
  deployment_package_path = var.matches_evidence_deployment_package_path
  route_key               = "GET /roles/{roleId}/matches/{candidateId}/evidence"
  api_id                  = module.api_gateway.api_id
  api_execution_arn       = module.api_gateway.execution_arn
  authorized              = true
  authorizer_id           = module.api_gateway.authorizer_id
  log_retention_days      = var.log_retention_days
  dynamodb_table_arn      = module.core_table.table_arn
  # This route tells the candidate, so it sends mail. Same verified identity
  # as sign-in and the unlock notice, for the same reason: a second sender
  # would need its own verified identity for nothing a reader would notice.
  #
  # Absent until 2026-09-14, which made the notice impossible rather than
  # unreliable. `requireEnv('APP_ORIGIN')` throws before SES is even reached,
  # the caller treats a failed notice as non-fatal, and the candidate was
  # simply never told. Verified against the deployed function, which carried
  # TABLE_NAME and nothing else.
  ses_identity_arn          = local.ses_domain_identity_arn
  ses_configuration_set_arn = local.ses_configuration_set_arn
  environment_variables = {
    TABLE_NAME                 = module.core_table.table_name
    APP_ORIGIN                 = var.app_origin
    REMINDER_FROM_ADDRESS      = var.sign_in_email_from
    SES_CONFIGURATION_SET_NAME = var.ses_configuration_set_name
  }
  tags = var.tags
}

# --- Matching baseline + gated Bedrock explain path (Phase 7 slice 6) -----
# See infrastructure/envs/test's identical locals for the ARN-scoping
# rationale.
locals {
  bedrock_inference_profile_arn = "arn:aws:bedrock:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:inference-profile/${var.bedrock_model_id}"
  bedrock_foundation_model_arn  = "arn:aws:bedrock:*::foundation-model/amazon.nova-micro-v1:0"
}

module "matches_recompute_route" {
  source                         = "../../modules/api-route"
  reserved_concurrent_executions = var.lambda_reserved_concurrency

  function_name           = "zoryvex-production-matches-recompute"
  handler                 = "handlers/matches-recompute.handler"
  deployment_package_path = var.matches_recompute_deployment_package_path
  route_key               = "POST /roles/{roleId}/matches/recompute"
  api_id                  = module.api_gateway.api_id
  api_execution_arn       = module.api_gateway.execution_arn
  authorized              = true
  authorizer_id           = module.api_gateway.authorizer_id
  log_retention_days      = var.log_retention_days
  dynamodb_table_arn      = module.core_table.table_arn
  # discovery-repository.ts's listDiscoveryOptedCandidates (called from
  # matching-service.ts's recomputeMatchesForRole) queries GSI1 — without
  # this, every real recompute fails with AccessDeniedException on
  # dynamodb:Query (confirmed live in TEST, Phase 7 slice 11 matching
  # acceptance; same defect class as PR #43's privacy-deletion-worker fix).
  # No other query in this route touches a GSI.
  dynamodb_index_arns = [local.core_table_gsi1_arn]
  # Plain String, not a secret, but the read still needs an
  # explicit grant: getFeatureFlags() rethrows anything that is not
  # ParameterNotFound, so an ungranted route fails with a 500 rather
  # than the quiet default.
  secure_ssm_parameter_arns = [aws_ssm_parameter.feature_flags.arn]
  environment_variables = {
    # Gates on a feature flag. Without this variable getFeatureFlags()
    # returns every flag false and the route reports its feature paused,
    # silently and whatever the live parameter says.
    FEATURE_FLAGS_PARAM = aws_ssm_parameter.feature_flags.name
    TABLE_NAME          = module.core_table.table_name
  }
  tags = var.tags
}

module "matches_list_route" {
  source                         = "../../modules/api-route"
  reserved_concurrent_executions = var.lambda_reserved_concurrency

  function_name           = "zoryvex-production-matches-list"
  handler                 = "handlers/matches-list.handler"
  deployment_package_path = var.matches_list_deployment_package_path
  route_key               = "GET /roles/{roleId}/matches"
  api_id                  = module.api_gateway.api_id
  api_execution_arn       = module.api_gateway.execution_arn
  authorized              = true
  authorizer_id           = module.api_gateway.authorizer_id
  log_retention_days      = var.log_retention_days
  dynamodb_table_arn      = module.core_table.table_arn
  # Plain String, not a secret, but the read still needs an
  # explicit grant: getFeatureFlags() rethrows anything that is not
  # ParameterNotFound, so an ungranted route fails with a 500 rather
  # than the quiet default.
  secure_ssm_parameter_arns = [aws_ssm_parameter.feature_flags.arn]
  environment_variables = {
    # Gates on a feature flag. Without this variable getFeatureFlags()
    # returns every flag false and the route reports its feature paused,
    # silently and whatever the live parameter says.
    FEATURE_FLAGS_PARAM = aws_ssm_parameter.feature_flags.name
    TABLE_NAME          = module.core_table.table_name
  }
  tags = var.tags
}

# aiMatching stays false in feature_flags (above) — see
# infrastructure/envs/test's identical route for the full rationale.
module "matches_explain_route" {
  source                         = "../../modules/api-route"
  reserved_concurrent_executions = var.lambda_reserved_concurrency

  function_name             = "zoryvex-production-matches-explain"
  handler                   = "handlers/matches-explain.handler"
  deployment_package_path   = var.matches_explain_deployment_package_path
  route_key                 = "POST /roles/{roleId}/matches/{candidateId}/explain"
  api_id                    = module.api_gateway.api_id
  api_execution_arn         = module.api_gateway.execution_arn
  authorized                = true
  authorizer_id             = module.api_gateway.authorizer_id
  log_retention_days        = var.log_retention_days
  dynamodb_table_arn        = module.core_table.table_arn
  secure_ssm_parameter_arns = [aws_ssm_parameter.feature_flags.arn]
  bedrock_invoke_arns       = [local.bedrock_inference_profile_arn, local.bedrock_foundation_model_arn]
  environment_variables = {
    TABLE_NAME          = module.core_table.table_name
    FEATURE_FLAGS_PARAM = aws_ssm_parameter.feature_flags.name
    BEDROCK_MODEL_ID    = var.bedrock_model_id
  }
  tags = var.tags
}

# --- Operations and automation (Phase 7 slice 7) ---------------------------
# See infrastructure/envs/test's identical route for the full rationale.
module "admin_exceptions_route" {
  source                         = "../../modules/api-route"
  reserved_concurrent_executions = var.lambda_reserved_concurrency

  function_name           = "zoryvex-production-admin-exceptions"
  handler                 = "handlers/admin-exceptions.handler"
  deployment_package_path = var.admin_exceptions_deployment_package_path
  route_key               = "GET /admin/exceptions"
  api_id                  = module.api_gateway.api_id
  api_execution_arn       = module.api_gateway.execution_arn
  authorized              = true
  authorizer_id           = module.api_gateway.authorizer_id
  log_retention_days      = var.log_retention_days
  dynamodb_table_arn      = module.core_table.table_arn
  # audit-event-repository.ts's listRecentAuditEvents (called from
  # admin-service.ts's getExceptionQueue) queries GSI3 — without this, every
  # real call to GET /admin/exceptions fails with AccessDeniedException on
  # dynamodb:Query (confirmed in TEST by the follow-up audit PR #43/#44
  # asked for). No other query in this route touches a GSI.
  dynamodb_index_arns = [local.core_table_gsi3_arn]
  environment_variables = {
    TABLE_NAME = module.core_table.table_name
  }
  tags = var.tags
}

# --- Session read + basic entity CRUD (Phase 7 slice 8, part 1) -----------
# See infrastructure/envs/test's identical routes for the full rationale.

module "auth_session_route" {
  source                         = "../../modules/api-route"
  reserved_concurrent_executions = var.lambda_reserved_concurrency

  function_name           = "zoryvex-production-auth-session"
  handler                 = "handlers/auth-session.handler"
  deployment_package_path = var.auth_session_deployment_package_path
  route_key               = "GET /auth/session"
  api_id                  = module.api_gateway.api_id
  api_execution_arn       = module.api_gateway.execution_arn
  authorized              = true
  authorizer_id           = module.api_gateway.authorizer_id
  log_retention_days      = var.log_retention_days
  # Added when the handler started re-issuing a fresh CSRF token on every
  # call (Phase 7 slice 12, PR #51) — before that it was a pure passthrough
  # of the authorizer context and never touched the session table or the
  # auth pepper, so this route never needed either. Same pattern as the
  # other auth_*_route modules above.
  dynamodb_table_arn        = module.core_table.table_arn
  secure_ssm_parameter_arns = [aws_ssm_parameter.auth_token_pepper.arn]
  environment_variables     = local.auth_environment_variables
  tags                      = var.tags
}

module "roles_create_route" {
  source                         = "../../modules/api-route"
  reserved_concurrent_executions = var.lambda_reserved_concurrency

  function_name           = "zoryvex-production-roles-create"
  handler                 = "handlers/roles-create.handler"
  deployment_package_path = var.roles_create_deployment_package_path
  route_key               = "POST /roles"
  api_id                  = module.api_gateway.api_id
  api_execution_arn       = module.api_gateway.execution_arn
  authorized              = true
  authorizer_id           = module.api_gateway.authorizer_id
  log_retention_days      = var.log_retention_days
  dynamodb_table_arn      = module.core_table.table_arn
  environment_variables = {
    TABLE_NAME = module.core_table.table_name
  }
  tags = var.tags
}

module "roles_get_route" {
  source                         = "../../modules/api-route"
  reserved_concurrent_executions = var.lambda_reserved_concurrency

  function_name           = "zoryvex-production-roles-get"
  handler                 = "handlers/roles-get.handler"
  deployment_package_path = var.roles_get_deployment_package_path
  route_key               = "GET /roles/{roleId}"
  api_id                  = module.api_gateway.api_id
  api_execution_arn       = module.api_gateway.execution_arn
  authorized              = true
  authorizer_id           = module.api_gateway.authorizer_id
  log_retention_days      = var.log_retention_days
  dynamodb_table_arn      = module.core_table.table_arn
  environment_variables = {
    TABLE_NAME = module.core_table.table_name
  }
  tags = var.tags
}

module "roles_list_route" {
  source                         = "../../modules/api-route"
  reserved_concurrent_executions = var.lambda_reserved_concurrency

  function_name           = "zoryvex-production-roles-list"
  handler                 = "handlers/roles-list.handler"
  deployment_package_path = var.roles_list_deployment_package_path
  route_key               = "GET /roles"
  api_id                  = module.api_gateway.api_id
  api_execution_arn       = module.api_gateway.execution_arn
  authorized              = true
  authorizer_id           = module.api_gateway.authorizer_id
  log_retention_days      = var.log_retention_days
  dynamodb_table_arn      = module.core_table.table_arn
  # role-repository.ts's listRolesByEmployer (called from role-service.ts's
  # listOwnRoles) queries GSI2 — without this, every real call to GET /roles
  # fails with AccessDeniedException on dynamodb:Query (confirmed in TEST by
  # the follow-up audit PR #43/#44 asked for). No other query in this route
  # touches a GSI.
  dynamodb_index_arns = [local.core_table_gsi2_arn]
  environment_variables = {
    TABLE_NAME = module.core_table.table_name
  }
  tags = var.tags
}

module "roles_update_route" {
  source                         = "../../modules/api-route"
  reserved_concurrent_executions = var.lambda_reserved_concurrency

  function_name           = "zoryvex-production-roles-update"
  handler                 = "handlers/roles-update.handler"
  deployment_package_path = var.roles_update_deployment_package_path
  route_key               = "PATCH /roles/{roleId}"
  api_id                  = module.api_gateway.api_id
  api_execution_arn       = module.api_gateway.execution_arn
  authorized              = true
  authorizer_id           = module.api_gateway.authorizer_id
  log_retention_days      = var.log_retention_days
  dynamodb_table_arn      = module.core_table.table_arn
  environment_variables = {
    TABLE_NAME = module.core_table.table_name
  }
  tags = var.tags
}

module "candidates_profile_get_route" {
  source                         = "../../modules/api-route"
  reserved_concurrent_executions = var.lambda_reserved_concurrency

  function_name           = "zoryvex-production-candidates-profile-get"
  handler                 = "handlers/candidates-profile-get.handler"
  deployment_package_path = var.candidates_profile_get_deployment_package_path
  route_key               = "GET /candidates/me"
  api_id                  = module.api_gateway.api_id
  api_execution_arn       = module.api_gateway.execution_arn
  authorized              = true
  authorizer_id           = module.api_gateway.authorizer_id
  log_retention_days      = var.log_retention_days
  dynamodb_table_arn      = module.core_table.table_arn
  environment_variables = {
    TABLE_NAME = module.core_table.table_name
  }
  tags = var.tags
}

module "candidates_profile_update_route" {
  source                         = "../../modules/api-route"
  reserved_concurrent_executions = var.lambda_reserved_concurrency

  function_name           = "zoryvex-production-candidates-profile-update"
  handler                 = "handlers/candidates-profile-update.handler"
  deployment_package_path = var.candidates_profile_update_deployment_package_path
  route_key               = "PATCH /candidates/me"
  api_id                  = module.api_gateway.api_id
  api_execution_arn       = module.api_gateway.execution_arn
  authorized              = true
  authorizer_id           = module.api_gateway.authorizer_id
  log_retention_days      = var.log_retention_days
  dynamodb_table_arn      = module.core_table.table_arn
  environment_variables = {
    TABLE_NAME = module.core_table.table_name
  }
  tags = var.tags
}

module "candidates_evidence_create_route" {
  source                         = "../../modules/api-route"
  reserved_concurrent_executions = var.lambda_reserved_concurrency

  function_name           = "zoryvex-production-candidates-evidence-create"
  handler                 = "handlers/candidates-evidence-create.handler"
  deployment_package_path = var.candidates_evidence_create_deployment_package_path
  route_key               = "POST /candidates/me/evidence"
  api_id                  = module.api_gateway.api_id
  api_execution_arn       = module.api_gateway.execution_arn
  authorized              = true
  authorizer_id           = module.api_gateway.authorizer_id
  log_retention_days      = var.log_retention_days
  dynamodb_table_arn      = module.core_table.table_arn
  environment_variables = {
    TABLE_NAME = module.core_table.table_name
  }
  tags = var.tags
}

module "candidates_evidence_list_route" {
  source                         = "../../modules/api-route"
  reserved_concurrent_executions = var.lambda_reserved_concurrency

  function_name           = "zoryvex-production-candidates-evidence-list"
  handler                 = "handlers/candidates-evidence-list.handler"
  deployment_package_path = var.candidates_evidence_list_deployment_package_path
  route_key               = "GET /candidates/me/evidence"
  api_id                  = module.api_gateway.api_id
  api_execution_arn       = module.api_gateway.execution_arn
  authorized              = true
  authorizer_id           = module.api_gateway.authorizer_id
  log_retention_days      = var.log_retention_days
  dynamodb_table_arn      = module.core_table.table_arn
  environment_variables = {
    TABLE_NAME = module.core_table.table_name
  }
  tags = var.tags
}

module "candidates_evidence_get_route" {
  source                         = "../../modules/api-route"
  reserved_concurrent_executions = var.lambda_reserved_concurrency

  function_name           = "zoryvex-production-candidates-evidence-get"
  handler                 = "handlers/candidates-evidence-get.handler"
  deployment_package_path = var.candidates_evidence_get_deployment_package_path
  route_key               = "GET /candidates/me/evidence/{evidenceId}"
  api_id                  = module.api_gateway.api_id
  api_execution_arn       = module.api_gateway.execution_arn
  authorized              = true
  authorizer_id           = module.api_gateway.authorizer_id
  log_retention_days      = var.log_retention_days
  dynamodb_table_arn      = module.core_table.table_arn
  environment_variables = {
    TABLE_NAME = module.core_table.table_name
  }
  tags = var.tags
}

module "candidates_evidence_update_route" {
  source                         = "../../modules/api-route"
  reserved_concurrent_executions = var.lambda_reserved_concurrency

  function_name           = "zoryvex-production-candidates-evidence-update"
  handler                 = "handlers/candidates-evidence-update.handler"
  deployment_package_path = var.candidates_evidence_update_deployment_package_path
  route_key               = "PATCH /candidates/me/evidence/{evidenceId}"
  api_id                  = module.api_gateway.api_id
  api_execution_arn       = module.api_gateway.execution_arn
  authorized              = true
  authorizer_id           = module.api_gateway.authorizer_id
  log_retention_days      = var.log_retention_days
  dynamodb_table_arn      = module.core_table.table_arn
  environment_variables = {
    TABLE_NAME = module.core_table.table_name
  }
  tags = var.tags
}

module "candidates_evidence_delete_route" {
  source                         = "../../modules/api-route"
  reserved_concurrent_executions = var.lambda_reserved_concurrency

  function_name           = "zoryvex-production-candidates-evidence-delete"
  handler                 = "handlers/candidates-evidence-delete.handler"
  deployment_package_path = var.candidates_evidence_delete_deployment_package_path
  route_key               = "DELETE /candidates/me/evidence/{evidenceId}"
  api_id                  = module.api_gateway.api_id
  api_execution_arn       = module.api_gateway.execution_arn
  authorized              = true
  authorizer_id           = module.api_gateway.authorizer_id
  log_retention_days      = var.log_retention_days
  dynamodb_table_arn      = module.core_table.table_arn
  environment_variables = {
    TABLE_NAME = module.core_table.table_name
  }
  tags = var.tags
}

module "candidates_evidence_verify_begin_route" {
  source                         = "../../modules/api-route"
  reserved_concurrent_executions = var.lambda_reserved_concurrency

  function_name           = "zoryvex-production-candidates-evidence-verify-begin"
  handler                 = "handlers/candidates-evidence-verify-begin.handler"
  deployment_package_path = var.candidates_evidence_verify_begin_deployment_package_path
  route_key               = "POST /candidates/me/evidence/{evidenceId}/verify/begin"
  api_id                  = module.api_gateway.api_id
  api_execution_arn       = module.api_gateway.execution_arn
  authorized              = true
  authorizer_id           = module.api_gateway.authorizer_id
  log_retention_days      = var.log_retention_days
  dynamodb_table_arn      = module.core_table.table_arn
  environment_variables = {
    TABLE_NAME = module.core_table.table_name
  }
  tags = var.tags
}

module "candidates_evidence_verify_route" {
  source                         = "../../modules/api-route"
  reserved_concurrent_executions = var.lambda_reserved_concurrency

  function_name           = "zoryvex-production-candidates-evidence-verify"
  handler                 = "handlers/candidates-evidence-verify.handler"
  deployment_package_path = var.candidates_evidence_verify_deployment_package_path
  route_key               = "POST /candidates/me/evidence/{evidenceId}/verify"
  api_id                  = module.api_gateway.api_id
  api_execution_arn       = module.api_gateway.execution_arn
  authorized              = true
  authorizer_id           = module.api_gateway.authorizer_id
  log_retention_days      = var.log_retention_days
  dynamodb_table_arn      = module.core_table.table_arn
  # Longer than the default, matching test: one repository verification makes
  # three sequential upstream calls, each with its own 5s client timeout.
  timeout_seconds = 20
  # The only route that talks to GitHub, so the only one granted the token.
  secure_ssm_parameter_arns = [aws_ssm_parameter.github_token.arn]
  environment_variables = {
    TABLE_NAME = module.core_table.table_name
    # Absent, empty or unreadable all mean "carry on unauthenticated", so
    # naming the parameter before it holds a value changes nothing.
    GITHUB_TOKEN_PARAM = aws_ssm_parameter.github_token.name
  }
  tags = var.tags
}

module "candidates_graded_task_route" {
  source                         = "../../modules/api-route"
  reserved_concurrent_executions = var.lambda_reserved_concurrency

  function_name           = "zoryvex-production-candidates-graded-task"
  handler                 = "handlers/candidates-graded-task.handler"
  deployment_package_path = var.candidates_graded_task_deployment_package_path
  route_key               = "GET /candidates/me/graded-task"
  api_id                  = module.api_gateway.api_id
  api_execution_arn       = module.api_gateway.execution_arn
  authorized              = true
  authorizer_id           = module.api_gateway.authorizer_id
  log_retention_days      = var.log_retention_days
  dynamodb_table_arn      = module.core_table.table_arn
  environment_variables = {
    TABLE_NAME = module.core_table.table_name
  }
  tags = var.tags
}

# See infrastructure/envs/test's identical rule for the full rationale.
resource "aws_cloudwatch_event_rule" "acm_certificate_expiring" {
  name        = "zoryvex-production-acm-cert-expiring"
  description = "ACM 'Certificate Approaching Expiration' -> founder alerts topic."
  event_pattern = jsonencode({
    source      = ["aws.acm"]
    detail-type = ["ACM Certificate Approaching Expiration"]
  })
  tags = var.tags
}

# Deliberately NOT mirroring infrastructure/envs/test's verification-reminder
# job here, for the same reason the health-check scheduler below is not
# mirrored: it is a scheduled automation job, Prompt 7 is explicit that
# production enables only signed-launch-mode jobs, and no launch mode has
# been selected (.zoryvex/state.json selectedLaunchMode: null). It is also
# the one thing in this system that emails a person who did not ask, which
# is not something to have sitting in production configuration ahead of the
# decision to switch it on. scripts/check-gsi-grants.mjs records the same
# exception on its own side so the absence stays deliberate rather than
# reading as drift.

# Deliberately NOT mirroring infrastructure/envs/test's health-check
# EventBridge Scheduler here: that is a real scheduled *automation* job, and
# Prompt 7 is explicit that "production enables only signed-launch-mode
# jobs" — no launch mode has been selected (.zoryvex/state.json
# selectedLaunchMode: null). The ACM cert-expiry rule above is a monitoring/
# alert concern, not a job, so it is mirrored the same way every other
# alarm/route in this file already is (unapplied, ready, consistent with
# test's shape).
module "observability" {
  source = "../../modules/observability"

  # Null means "no SES metrics to alarm on yet", which was true while this
  # environment had never sent an email. It sends real sign-in mail to real
  # customers now, so bounces and complaints are worth waking somebody for:
  # a rising complaint rate is how a sending domain gets suspended, and the
  # first warning is usually the suspension.
  ses_configuration_set_name = var.ses_configuration_set_name

  environment_name                = "production"
  alert_email                     = var.alert_email
  api_gateway_id                  = module.api_gateway.api_id
  api_lambda_function_name        = module.health_route.function_name
  authorizer_lambda_function_name = module.auth.function_name
  dynamodb_table_name             = module.core_table.table_name
  allow_eventbridge_rule_arns     = [aws_cloudwatch_event_rule.acm_certificate_expiring.arn]
  tags                            = var.tags
}

resource "aws_cloudwatch_event_target" "acm_certificate_expiring_to_alerts" {
  rule      = aws_cloudwatch_event_rule.acm_certificate_expiring.name
  target_id = "alerts-topic"
  arn       = module.observability.alerts_topic_arn
}

# module.cloudfront_alarm is deliberately not called here — see
# infrastructure/envs/test's identical comment for the full, real
# investigation (three failed apply attempts, a confirmed provider
# limitation, not a guess).

# --- Billing: subscriptions, reconciliation, diagnostics -------------------
#
# Source mirrored from the test environment, not applied to production. It
# exists here so the live switchover is a plan and an apply rather than a
# session of writing infrastructure against a deadline, and so the two
# environments cannot silently diverge.
#
# The one deliberate difference is the reconciliation schedule, which is
# disabled here. CLAUDE.md keeps production automation off until
# PHASE 10 COMMERCIAL GO; enabling it is on the go-live checklist in
# docs/PAYMENTS.md, and until then the payments flag would stop the job
# anyway.

module "billing_create_subscription_route" {
  source                         = "../../modules/api-route"
  reserved_concurrent_executions = var.lambda_reserved_concurrency

  function_name           = "zoryvex-production-billing-create-subscription"
  handler                 = "handlers/billing-create-subscription.handler"
  deployment_package_path = var.billing_create_subscription_deployment_package_path
  route_key               = "POST /billing/subscription"
  api_id                  = module.api_gateway.api_id
  api_execution_arn       = module.api_gateway.execution_arn
  authorized              = true
  authorizer_id           = module.api_gateway.authorizer_id
  log_retention_days      = var.log_retention_days
  dynamodb_table_arn      = module.core_table.table_arn
  # The marketplace gate reads the organization's roles before a checkout is
  # allowed to start, and that read is a GSI2 query. Missing until 2026-09-02:
  # every subscription checkout in TEST returned AccessDeniedException on
  # GSI2, and check-gsi-grants could not see it because the dependency is
  # wired as an inline object method rather than a bare identifier.
  dynamodb_index_arns = [local.core_table_gsi2_arn]
  secure_ssm_parameter_arns = [
    aws_ssm_parameter.paystack_secret_key.arn,
    aws_ssm_parameter.feature_flags.arn,
    aws_ssm_parameter.paystack_plan_codes.arn,
  ]
  environment_variables = {
    TABLE_NAME                = module.core_table.table_name
    FEATURE_FLAGS_PARAM       = aws_ssm_parameter.feature_flags.name
    PAYSTACK_SECRET_KEY_PARAM = aws_ssm_parameter.paystack_secret_key.name
    PAYSTACK_KEY_PREFIX       = "sk_live_"
    PAYSTACK_PLAN_CODES_PARAM = aws_ssm_parameter.paystack_plan_codes.name
    APP_ORIGIN                = var.app_origin
  }
  tags = var.tags
}

module "billing_overview_route" {
  source                         = "../../modules/api-route"
  reserved_concurrent_executions = var.lambda_reserved_concurrency

  function_name           = "zoryvex-production-billing-overview"
  handler                 = "handlers/billing-overview.handler"
  deployment_package_path = var.billing_overview_deployment_package_path
  route_key               = "GET /billing"
  api_id                  = module.api_gateway.api_id
  api_execution_arn       = module.api_gateway.execution_arn
  authorized              = true
  authorizer_id           = module.api_gateway.authorizer_id
  log_retention_days      = var.log_retention_days
  dynamodb_table_arn      = module.core_table.table_arn
  # quoteSubscription now reports the organization's real marketplace size,
  # which reads its roles, which is a GSI2 query. Added 2026-09-02 in the same
  # change that introduced the read — caught by check-gsi-grants before it
  # shipped, which is the failure mode that broke subscription checkout.
  dynamodb_index_arns = [local.core_table_gsi2_arn]
  secure_ssm_parameter_arns = [
    aws_ssm_parameter.feature_flags.arn,
    aws_ssm_parameter.paystack_plan_codes.arn,
  ]
  environment_variables = {
    TABLE_NAME                = module.core_table.table_name
    FEATURE_FLAGS_PARAM       = aws_ssm_parameter.feature_flags.name
    PAYSTACK_PLAN_CODES_PARAM = aws_ssm_parameter.paystack_plan_codes.name
  }
  tags = var.tags
}

module "billing_cancel_route" {
  source                         = "../../modules/api-route"
  reserved_concurrent_executions = var.lambda_reserved_concurrency

  function_name           = "zoryvex-production-billing-cancel"
  handler                 = "handlers/billing-cancel.handler"
  deployment_package_path = var.billing_cancel_deployment_package_path
  route_key               = "POST /billing/cancel"
  api_id                  = module.api_gateway.api_id
  api_execution_arn       = module.api_gateway.execution_arn
  authorized              = true
  authorizer_id           = module.api_gateway.authorizer_id
  log_retention_days      = var.log_retention_days
  dynamodb_table_arn      = module.core_table.table_arn
  secure_ssm_parameter_arns = [
    aws_ssm_parameter.paystack_secret_key.arn,
    aws_ssm_parameter.feature_flags.arn,
  ]
  environment_variables = {
    TABLE_NAME                = module.core_table.table_name
    FEATURE_FLAGS_PARAM       = aws_ssm_parameter.feature_flags.name
    PAYSTACK_SECRET_KEY_PARAM = aws_ssm_parameter.paystack_secret_key.name
    PAYSTACK_KEY_PREFIX       = "sk_live_"
  }
  tags = var.tags
}

module "billing_card_update_link_route" {
  source                         = "../../modules/api-route"
  reserved_concurrent_executions = var.lambda_reserved_concurrency

  function_name           = "zoryvex-production-billing-card-update-link"
  handler                 = "handlers/billing-card-update-link.handler"
  deployment_package_path = var.billing_card_update_link_deployment_package_path
  route_key               = "POST /billing/card-update-link"
  api_id                  = module.api_gateway.api_id
  api_execution_arn       = module.api_gateway.execution_arn
  authorized              = true
  authorizer_id           = module.api_gateway.authorizer_id
  log_retention_days      = var.log_retention_days
  dynamodb_table_arn      = module.core_table.table_arn
  secure_ssm_parameter_arns = [
    aws_ssm_parameter.paystack_secret_key.arn,
    aws_ssm_parameter.feature_flags.arn,
  ]
  environment_variables = {
    TABLE_NAME                = module.core_table.table_name
    FEATURE_FLAGS_PARAM       = aws_ssm_parameter.feature_flags.name
    PAYSTACK_SECRET_KEY_PARAM = aws_ssm_parameter.paystack_secret_key.name
    PAYSTACK_KEY_PREFIX       = "sk_live_"
  }
  tags = var.tags
}

module "admin_billing_diagnostic_route" {
  source                         = "../../modules/api-route"
  reserved_concurrent_executions = var.lambda_reserved_concurrency

  function_name           = "zoryvex-production-admin-billing-diagnostic"
  handler                 = "handlers/admin-billing-diagnostic.handler"
  deployment_package_path = var.admin_billing_diagnostic_deployment_package_path
  route_key               = "GET /admin/billing"
  api_id                  = module.api_gateway.api_id
  api_execution_arn       = module.api_gateway.execution_arn
  authorized              = true
  authorizer_id           = module.api_gateway.authorizer_id
  log_retention_days      = var.log_retention_days
  dynamodb_table_arn      = module.core_table.table_arn
  environment_variables = {
    TABLE_NAME = module.core_table.table_name
  }
  tags = var.tags
}

module "billing_reconciliation_job" {
  source = "../../modules/scheduled-job"

  function_name           = "zoryvex-production-billing-reconciliation"
  handler                 = "handlers/jobs-billing-reconciliation.handler"
  deployment_package_path = var.jobs_billing_reconciliation_deployment_package_path
  log_retention_days      = var.log_retention_days

  schedule_expression = "rate(1 hour)"
  schedule_timezone   = "Africa/Lagos"

  # On, because production is taking real payments.
  #
  # This was written "disabled until PHASE 10 COMMERCIAL GO", with the note
  # that it is the one piece of production automation that MUST be switched
  # on at go-live, since without it an abandoned checkout, a declined card
  # and a webhook that never arrived are indistinguishable from silence.
  # Production went live on live Paystack keys on 2026-09-11 and this stayed
  # off: the feature flags were flipped by go-live-payments.mjs, and this is
  # Terraform, so nothing carried it across.
  #
  # The gap is not theoretical and the product states it as a promise. When
  # a webhook has not arrived, the billing page tells the buyer "we check
  # again automatically every hour and your access will start without you
  # doing anything." In test that is true — the schedule is enabled at
  # rate(1 hour). In production it was false, and the failure it describes
  # is precisely the one nobody notices: the money left the customer's
  # account and the access never opened.
  #
  # The commercial-legal gate is a separate question and is unchanged by
  # this. Leaving recovery off does not make an unclear legal position
  # safer; it only means a customer who has already paid can lose what they
  # paid for with nothing to catch it.
  enabled = true

  dynamodb_table_arn  = module.core_table.table_arn
  dynamodb_index_arns = [local.core_table_gsi2_arn]

  ssm_parameter_arns        = [aws_ssm_parameter.feature_flags.arn]
  secure_ssm_parameter_arns = [aws_ssm_parameter.paystack_secret_key.arn]
  sns_publish_arns          = [module.observability.alerts_topic_arn]

  timeout_seconds = 60

  environment_variables = {
    TABLE_NAME                = module.core_table.table_name
    FEATURE_FLAGS_PARAM       = aws_ssm_parameter.feature_flags.name
    PAYSTACK_SECRET_KEY_PARAM = aws_ssm_parameter.paystack_secret_key.name
    PAYSTACK_KEY_PREFIX       = "sk_live_"
    ALERTS_TOPIC_ARN          = module.observability.alerts_topic_arn
  }

  tags = var.tags
}

# --- Mutual interest ---------------------------------------------------
#
# Matching says who could work together. These say who wants to, which the
# product promised and could not represent: an employer could pay to
# unlock somebody who had never seen the role, and a candidate had no way
# to put their hand up or to say no.
#
# No SES grant on any of them. Recording an answer sends nothing; the
# notification question is a separate decision and granting mail "just in
# case" is how a route ends up able to send it by accident.

module "matches_employer_interest_route" {
  source                         = "../../modules/api-route"
  reserved_concurrent_executions = var.lambda_reserved_concurrency

  function_name           = "zoryvex-production-matches-employer-interest"
  handler                 = "handlers/matches-set-employer-interest.handler"
  deployment_package_path = var.matches_employer_interest_deployment_package_path
  route_key               = "POST /roles/{roleId}/matches/{candidateId}/interest"
  api_id                  = module.api_gateway.api_id
  api_execution_arn       = module.api_gateway.execution_arn
  authorized              = true
  authorizer_id           = module.api_gateway.authorizer_id
  log_retention_days      = var.log_retention_days
  dynamodb_table_arn      = module.core_table.table_arn
  # This route tells the candidate, so it sends mail. Same verified identity
  # as sign-in and the unlock notice, for the same reason: a second sender
  # would need its own verified identity for nothing a reader would notice.
  #
  # Absent until 2026-09-14, which made the notice impossible rather than
  # unreliable. `requireEnv('APP_ORIGIN')` throws before SES is even reached,
  # the caller treats a failed notice as non-fatal, and the candidate was
  # simply never told. Verified against the deployed function, which carried
  # TABLE_NAME and nothing else.
  ses_identity_arn          = local.ses_domain_identity_arn
  ses_configuration_set_arn = local.ses_configuration_set_arn
  environment_variables = {
    TABLE_NAME                 = module.core_table.table_name
    APP_ORIGIN                 = var.app_origin
    REMINDER_FROM_ADDRESS      = var.sign_in_email_from
    SES_CONFIGURATION_SET_NAME = var.ses_configuration_set_name
  }
  tags = var.tags
}

module "candidates_matches_route" {
  source                         = "../../modules/api-route"
  reserved_concurrent_executions = var.lambda_reserved_concurrency

  function_name           = "zoryvex-production-candidates-matches"
  handler                 = "handlers/candidates-list-matches.handler"
  deployment_package_path = var.candidates_matches_deployment_package_path
  route_key               = "GET /candidates/me/matches"
  api_id                  = module.api_gateway.api_id
  api_execution_arn       = module.api_gateway.execution_arn
  authorized              = true
  authorizer_id           = module.api_gateway.authorizer_id
  log_retention_days      = var.log_retention_days
  dynamodb_table_arn      = module.core_table.table_arn
  // Queries GSI1: a candidate's own matches are stored under the role's
  // partition and reached through the CANDIDATE# index. Without the index
  // in the grant the query returns AccessDenied at runtime, which no plan
  // and no unit test would have shown.
  dynamodb_index_arns = [local.core_table_gsi1_arn]
  environment_variables = {
    TABLE_NAME = module.core_table.table_name
  }
  tags = var.tags
}

module "candidates_interest_route" {
  source                         = "../../modules/api-route"
  reserved_concurrent_executions = var.lambda_reserved_concurrency

  function_name           = "zoryvex-production-candidates-interest"
  handler                 = "handlers/candidates-set-interest.handler"
  deployment_package_path = var.candidates_interest_deployment_package_path
  route_key               = "POST /candidates/me/matches/{roleId}/interest"
  api_id                  = module.api_gateway.api_id
  api_execution_arn       = module.api_gateway.execution_arn
  authorized              = true
  authorizer_id           = module.api_gateway.authorizer_id
  log_retention_days      = var.log_retention_days
  dynamodb_table_arn      = module.core_table.table_arn
  environment_variables = {
    TABLE_NAME = module.core_table.table_name
  }
  tags = var.tags
}
