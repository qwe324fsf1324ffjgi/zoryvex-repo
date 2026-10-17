locals {
  # CSP connect-src target for apps/web — the test API's own origin, once
  # Stage B has assigned one.
  api_origin  = var.api_custom_domain_name != null ? "https://${var.api_custom_domain_name}" : ""
  app_origins = var.app_origin != "" ? [var.app_origin] : []

  # WebAuthn's Relying Party ID is the hostname the browser is sitting on,
  # so it is app_origin's host by definition — a separate input that is
  # allowed to disagree with app_origin can only ever disagree by being
  # wrong.
  #
  # Deriving it also closes a real hole. terraform.tfvars is gitignored, so
  # a CI-driven apply supplies these values as TF_VAR_* instead, and the
  # deploy job supplies seven of them. webauthn_rp_id was not one, and its
  # pre-Stage-B default is "" — so the first pipeline deploy would have
  # written WEBAUTHN_RP_ID="" to all four WebAuthn Lambdas, and
  # services/api/src/composition/aws-webauthn-dependencies.ts throws on an
  # empty value at cold start. Founder-admin step-up would have started
  # returning 500 with nothing in the plan that looked like a regression.
  #
  # var.webauthn_rp_id still wins when set, for the one legitimate case
  # where the RP ID is deliberately a registrable parent of the app's own
  # host (e.g. app on app.example.com, credentials scoped to example.com).
  webauthn_rp_id = var.webauthn_rp_id != "" ? var.webauthn_rp_id : (
    var.app_origin != "" ? split(":", split("/", replace(var.app_origin, "://", "/"))[1])[0] : ""
  )
}

data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

# Deterministic bucket names — same "no random component, account ID + a
# fixed name" reasoning as oidc_provider_arn/state_bucket_arn below: these
# were plain variables until Phase 7 slice 9 discovered a CI-driven deploy
# has no local terraform.tfvars to supply them from, at which point it
# became clear they never needed to be variables at all.
locals {
  site_bucket_name               = "zoryvex-test-site-${data.aws_caller_identity.current.account_id}"
  evidence_bucket_name           = "zoryvex-test-evidence-${data.aws_caller_identity.current.account_id}"
  evidence_scan_test_bucket_name = "zoryvex-test-evidence-scan-eicar-${data.aws_caller_identity.current.account_id}"
}

# --- CI-driven deploy (Phase 7 slice 9) ------------------------------------
# GitHub Actions authenticates via OIDC (no AWS access key, ever) and
# assumes this role to plan/apply this exact environment. oidc_provider_arn
# and state_bucket_arn are both constructed deterministically — an OIDC
# provider ARN and an S3 bucket ARN each have no random component (account
# ID + a fixed URL/name, matching the already-established
# zoryvex-terraform-state-<account-id> naming convention from
# infrastructure/envs/bootstrap) — rather than read via
# terraform_remote_state against infrastructure/envs/foundation or
# infrastructure/envs/bootstrap, which would otherwise require granting
# this environment's applier read access to those entirely unrelated state
# objects just to extract one predictable string each. subject_claim is the
# exact repo+branch, no wildcard — see infrastructure/modules/ci-deploy-role
# for the full trust-policy and least-privilege IAM reasoning.
module "ci_deploy_role" {
  source = "../../modules/ci-deploy-role"

  environment_name  = "test"
  oidc_provider_arn = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:oidc-provider/token.actions.githubusercontent.com"
  # This repository's actual GitHub Actions OIDC sub claim embeds immutable
  # owner/repo IDs (repo:OWNER@OWNER_ID/REPO@REPO_ID:ref:...) — confirmed live
  # via `gh api repos/qwe324fsf1324ffjgi/zoryvex-platform/actions/oidc/customization/sub`
  # and via the actual denied CloudTrail AssumeRoleWithWebIdentity events from
  # the first real deploy-test run (Phase 7 slice 9). The plain owner/repo-name
  # form below no longer matches what GitHub issues, which is why that first
  # run failed with "Not authorized to perform sts:AssumeRoleWithWebIdentity"
  # despite the trust policy being correctly applied.
  subject_claim    = "repo:qwe324fsf1324ffjgi@115540979/zoryvex-platform@1333102520:ref:refs/heads/main"
  state_bucket_arn = "arn:aws:s3:::zoryvex-terraform-state-${data.aws_caller_identity.current.account_id}"
  aws_region       = data.aws_region.current.region
  account_id       = data.aws_caller_identity.current.account_id
  # Real AccessDenied evidence (Phase 7 slice 9, first deploy-test run past
  # OIDC + config supply): CI needs guardduty:GetDetector to refresh
  # aws_guardduty_detector.this. Detector IDs are AWS-assigned, not
  # deterministic, so the module scopes this to the exact ARN rather than a
  # wildcard — passed straight from the resource this same root creates.
  guardduty_detector_arn = aws_guardduty_detector.this.arn
  # Full CloudTrail audit of an admin-session plan (Phase 7 slice 9): Lambda
  # env-var refresh needs kms:Decrypt, DynamoDB table refresh needs
  # kms:DescribeKey, both against the account's own default AWS-managed
  # keys (never a customer-managed key in this project). Key ARNs are
  # AWS-assigned, not deterministic, so resolved via data source the same
  # way the GuardDuty detector ARN is passed straight through above.
  lambda_default_kms_key_arn   = data.aws_kms_key.lambda_default.arn
  dynamodb_default_kms_key_arn = data.aws_kms_key.dynamodb_default.arn
  tags                         = var.tags
}

data "aws_kms_key" "lambda_default" {
  key_id = "alias/aws/lambda"
}

data "aws_kms_key" "dynamodb_default" {
  key_id = "alias/aws/dynamodb"
}

# GuardDuty detector — one per account per region. This environment applies
# first (production stays untouched this phase, per CLAUDE.md/Prompt 6), so
# it owns creating it; a later phase that provisions production must
# reference this same detector via a data source, never create a second one
# in the same account+region (that apply would conflict). Deliberately no
# aws_guardduty_detector_feature("S3_DATA_EVENTS") here — that is GuardDuty
# S3 Protection, a separate, real, usage-billed feature unrelated to Malware
# Protection for S3 below; enabling it was a Phase 5 mistake, corrected
# during Phase 6 founder review (see docs/DECISIONS.md).
resource "aws_guardduty_detector" "this" {
  enable = true
  tags   = var.tags
}

# The role GuardDuty Malware Protection for S3 assumes to scan objects and
# tag scan results. Exact trust/permission shape verified against current
# AWS docs (docs.aws.amazon.com/guardduty/latest/ug/
# malware-protection-s3-iam-policy-prerequisite.html) — see docs/SOURCES.md.
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
  name               = "zoryvex-test-guardduty-malware-protection"
  assume_role_policy = data.aws_iam_policy_document.guardduty_malware_protection_assume_role.json
  tags               = var.tags
}

locals {
  evidence_bucket_arn = "arn:aws:s3:::${local.evidence_bucket_name}"
  evidence_object_arn = "arn:aws:s3:::${local.evidence_bucket_name}/*"
  # The EICAR isolated test bucket (below) shares the same GuardDuty
  # malware-protection role — it needs the identical scan/tag grants, on
  # its own separate bucket ARN, not the real evidence bucket's.
  eicar_bucket_arn   = "arn:aws:s3:::${local.evidence_scan_test_bucket_name}"
  eicar_object_arn   = "arn:aws:s3:::${local.evidence_scan_test_bucket_name}/*"
  guardduty_rule_arn = "arn:aws:events:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:rule/DO-NOT-DELETE-AmazonGuardDutyMalwareProtectionS3*"
  # SES domain identity ARNs are deterministic
  # (docs.aws.amazon.com/ses/latest/dg/sending-authorization-policies.html)
  # — computed rather than piped through a cross-env output, since
  # infrastructure/envs/foundation applies independently and this avoids a
  # hard apply-order dependency for a value that's fully derivable here.
  # zoryvex.space itself (not a test/production subdomain) is the one
  # domain identity infrastructure/envs/foundation verifies — shared by
  # every environment's outbound mail, per docs/DNS_RUNBOOK.md.
  ses_domain_identity_arn = "arn:aws:ses:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:identity/zoryvex.space"

  # Same deterministic-ARN reasoning as ses_domain_identity_arn above —
  # the configuration set name is this environment's own var, so the ARN
  # is fully derivable without a cross-state lookup. Required alongside
  # the identity ARN for any route that sends via a configuration set
  # (see infrastructure/modules/api-route's ses_configuration_set_arn).
  ses_configuration_set_arn = "arn:aws:ses:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:configuration-set/${var.ses_configuration_set_name}"
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
    resources = [local.evidence_object_arn, local.eicar_object_arn]
  }

  statement {
    sid       = "AllowEnableS3EventBridgeEvents"
    effect    = "Allow"
    actions   = ["s3:PutBucketNotification", "s3:GetBucketNotification"]
    resources = [local.evidence_bucket_arn, local.eicar_bucket_arn]
  }

  statement {
    sid     = "AllowPutValidationObject"
    effect  = "Allow"
    actions = ["s3:PutObject"]
    resources = [
      "${local.evidence_bucket_arn}/malware-protection-resource-validation-object",
      "${local.eicar_bucket_arn}/malware-protection-resource-validation-object",
    ]
  }

  statement {
    sid       = "AllowCheckBucketOwnership"
    effect    = "Allow"
    actions   = ["s3:ListBucket"]
    resources = [local.evidence_bucket_arn, local.eicar_bucket_arn]
  }

  statement {
    sid       = "AllowMalwareScan"
    effect    = "Allow"
    actions   = ["s3:GetObject", "s3:GetObjectVersion"]
    resources = [local.evidence_object_arn, local.eicar_object_arn]
  }

  # No KMS statement: the evidence bucket uses SSE-S3 (AES256), not a
  # customer-managed KMS key (infrastructure/modules/evidence-storage).
}

resource "aws_iam_role_policy" "guardduty_malware_protection_permissions" {
  name   = "zoryvex-test-guardduty-malware-protection-permissions"
  role   = aws_iam_role.guardduty_malware_protection.id
  policy = data.aws_iam_policy_document.guardduty_malware_protection_permissions.json
}

# Phase 7 slice 9: the Paystack secret key and the auth-token pepper used to
# be aws_ssm_parameter resources in this file. They now live in
# infrastructure/envs/test-secrets — a separate, founder/local-admin-applied
# Terraform root, deliberately never wired to the GitHub Actions
# ci-deploy-role. Reason: the AWS provider's aws_ssm_parameter resource
# calls ssm:GetParameter (+ kms:Decrypt for SecureString) on every refresh
# regardless of lifecycle.ignore_changes on value (hashicorp/terraform-
# provider-aws#20548, #42849) — so any Terraform root a CI role can plan or
# apply must never contain one of these resources directly, or CI would
# obtain the plaintext value merely by deploying infrastructure. See
# docs/DECISIONS.md for the full migration record.
#
# Both parameters are still created via terraform import (preserving the
# existing AWS resource, never destroy/recreate) — see
# infrastructure/envs/test-secrets/main.tf for their resource blocks and
# original comments. Referenced here only by deterministic ARN/name — an
# SSM parameter ARN has no random component, so this needs no data source,
# no remote-state read, and no decrypting call, the same reasoning already
# used above for local.ses_domain_identity_arn and local.guardduty_rule_arn.
locals {
  paystack_secret_key_name = "/zoryvex/test/paystack/secret-key"
  paystack_secret_key_arn  = "arn:aws:ssm:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:parameter${local.paystack_secret_key_name}"
  auth_token_pepper_name   = "/zoryvex/test/auth/token-pepper"
  auth_token_pepper_arn    = "arn:aws:ssm:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:parameter${local.auth_token_pepper_name}"
  # Created in envs/test-secrets for the same reason as the two above: a
  # SecureString resource in this root would be decrypted by the provider on
  # every CI refresh.
  github_token_name = "/zoryvex/test/github/token"
  github_token_arn  = "arn:aws:ssm:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:parameter${local.github_token_name}"
}

# Plain String, not SecureString — nothing in this value is a secret
# (docs/DECISIONS.md). scripts/emergency-cost-lockdown.mjs's own proposed
# path, now the real read path (services/api/src/repositories/
# feature-flags-repository.ts). Same ignore_changes-on-value reasoning as
# the two SecureString placeholders above: the lockdown script overwrites
# this value out of band during an incident, and a later `terraform apply`
# must never silently revert that back to the checked-in default.
resource "aws_ssm_parameter" "feature_flags" {
  name        = "/zoryvex/test/feature-flags"
  description = "packages/config FeatureFlagsSchema, JSON-encoded. Only scripts/emergency-cost-lockdown.mjs or a deliberate founder-approved AWS Console/CLI edit ever changes this in place."
  type        = "String"
  tier        = "Standard"

  # TEST enables payments and contact unlocks, PRODUCTION does not.
  #
  # This environment exists to exercise the whole product, and its Paystack
  # credentials are test-mode keys, so "payments on" here moves no real
  # money — the live/test distinction is the key in Parameter Store, never a
  # code branch. An employer walking the test build should hit the same
  # checkout and the same contact unlock a real one would.
  #
  # aiMatching stays off until the evaluation gate in docs/AI_SAFETY.md
  # passes. verificationReminders stays off because it emails real people.
  # publicDiscovery stays off: nothing reads it yet, and a flag that gates
  # nothing should not be switched on as though it does.
  #
  # ignore_changes below means this value only applies at CREATE. The live
  # parameter already exists, so changing these numbers does not move it;
  # that is a deliberate CLI edit, by design.
  value = jsonencode({ payments = true, aiMatching = false, publicDiscovery = false, contactUnlocks = true, verificationReminders = false })
  tags  = var.tags

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
# the same product, so a code committed to the repository would be a
# live/test mix-up waiting for the switchover.
#
# Created empty on purpose. Until the founder creates the six Plan objects
# in the Paystack dashboard and writes their codes here, `quoteSubscription`
# reports every plan as unavailable and the checkout refuses rather than
# taking a one-off payment against no plan. Same ignore_changes reasoning as
# the feature flags beside it: the value is set out of band by a founder
# action, and a later apply must not revert it.
resource "aws_ssm_parameter" "paystack_plan_codes" {
  name        = "/zoryvex/test/paystack/plan-codes"
  description = "JSON object mapping plan keys (scout_founding_monthly, ...) to Paystack plan codes. Set by hand after the Plans are created in the Paystack dashboard."
  type        = "String"
  tier        = "Standard"

  value = jsonencode({})
  tags  = var.tags

  lifecycle {
    ignore_changes = [value]
  }
}

module "static_site" {
  source = "../../modules/static-site"

  bucket_name         = local.site_bucket_name
  domain_aliases      = var.domain_aliases
  acm_certificate_arn = var.cloudfront_acm_certificate_arn
  apex_domain         = var.apex_domain
  www_domain          = "" # test has no www alias
  api_origin          = local.api_origin
  enable_hsts         = false # test stays off permanently by design, not just "until verified"
  # Confirmed live (Phase 7 slice 11): without this, Next.js's static-export
  # inline hydration scripts are blocked by CSP script-src, breaking client
  # hydration site-wide. See infrastructure/modules/static-site/variables.tf.
  allow_inline_scripts = true
  tags                 = var.tags
}

module "evidence_storage" {
  source = "../../modules/evidence-storage"

  bucket_name                           = local.evidence_bucket_name
  retention_days                        = var.evidence_retention_days
  allowed_upload_origins                = local.app_origins
  guardduty_detector_id                 = aws_guardduty_detector.this.id
  guardduty_malware_protection_role_arn = aws_iam_role.guardduty_malware_protection.arn
  tags                                  = var.tags
}

module "core_table" {
  source = "../../modules/data"

  table_name = "zoryvex-test-core"
  hash_key   = "PK"
  range_key  = "SK"

  # Test data is synthetic and disposable — no deletion protection, no
  # continuous-backup cost. Production overrides both (see ../production).
  deletion_protection_enabled    = false
  point_in_time_recovery_enabled = false

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
# file for other derived ARNs (e.g. the SES/EICAR bucket ARNs above).
locals {
  core_table_gsi1_arn = "${module.core_table.table_arn}/index/GSI1"
  core_table_gsi2_arn = "${module.core_table.table_arn}/index/GSI2"
  core_table_gsi3_arn = "${module.core_table.table_arn}/index/GSI3"
}

module "auth" {
  source = "../../modules/auth"

  function_name                   = "zoryvex-test-authorizer"
  deployment_package_path         = var.authorizer_deployment_package_path
  log_retention_days              = var.log_retention_days
  sessions_table_arn              = module.core_table.table_arn
  auth_token_pepper_parameter_arn = local.auth_token_pepper_arn
  environment_variables = {
    TABLE_NAME              = module.core_table.table_name
    AUTH_TOKEN_PEPPER_PARAM = local.auth_token_pepper_name
    APP_ORIGIN              = var.app_origin
  }
  reserved_concurrent_executions = var.lambda_reserved_concurrency
  tags                           = var.tags
}

module "api_gateway" {
  source = "../../modules/api-gateway"

  api_name                       = "zoryvex-test-api"
  log_retention_days             = var.log_retention_days
  cors_allow_origins             = local.app_origins
  authorizer_function_invoke_arn = module.auth.function_invoke_arn
  authorizer_function_arn        = module.auth.function_arn
  custom_domain_name             = var.api_custom_domain_name
  regional_acm_certificate_arn   = var.api_regional_acm_certificate_arn
  tags                           = var.tags
}

module "health_route" {
  source = "../../modules/api-route"

  function_name                  = "zoryvex-test-health"
  handler                        = "handlers/health.handler"
  deployment_package_path        = var.api_deployment_package_path
  route_key                      = "GET /health"
  api_id                         = module.api_gateway.api_id
  api_execution_arn              = module.api_gateway.execution_arn
  authorized                     = false
  log_retention_days             = var.log_retention_days
  reserved_concurrent_executions = var.lambda_reserved_concurrency
  tags                           = var.tags

  # Which environment answered. The build sha alongside it in the /health
  # response is baked into the bundle instead (scripts/build-lambda.mjs), so
  # that one identifies the code while this one identifies the deployment
  # target — one bundle stays deployable to more than one environment.
  environment_variables = {
    ZORYVEX_ENVIRONMENT = "test"
  }
}

# --- Auth domain routes (Phase 7 slice 1) ---------------------------------
# request-code/consume-code/sign-out are unauthenticated by design: a caller
# has no session yet when requesting or consuming a magic link, and sign-out
# reads its own cookie directly (idempotent no-op with no cookie) rather
# than depending on the authorizer having already accepted a possibly-
# already-expired session. The four webauthn routes require an existing
# session (authorized = true) since they are founder_admin-only actions
# gated inside the handler itself via the authorizer's context.

locals {
  auth_environment_variables = {
    TABLE_NAME              = module.core_table.table_name
    AUTH_TOKEN_PEPPER_PARAM = local.auth_token_pepper_name
    APP_ORIGIN              = var.app_origin
  }
}

module "auth_request_code_route" {
  source = "../../modules/api-route"

  function_name             = "zoryvex-test-auth-request-code"
  handler                   = "handlers/auth-request-code.handler"
  deployment_package_path   = var.auth_request_code_deployment_package_path
  route_key                 = "POST /auth/request-code"
  api_id                    = module.api_gateway.api_id
  api_execution_arn         = module.api_gateway.execution_arn
  authorized                = false
  log_retention_days        = var.log_retention_days
  dynamodb_table_arn        = module.core_table.table_arn
  secure_ssm_parameter_arns = [local.auth_token_pepper_arn]
  ses_identity_arn          = local.ses_domain_identity_arn
  ses_configuration_set_arn = local.ses_configuration_set_arn
  environment_variables = merge(local.auth_environment_variables, {
    SIGN_IN_EMAIL_FROM         = var.sign_in_email_from
    SES_CONFIGURATION_SET_NAME = var.ses_configuration_set_name
  })
  reserved_concurrent_executions = var.lambda_reserved_concurrency
  tags                           = var.tags
}

module "auth_consume_code_route" {
  source = "../../modules/api-route"

  function_name                  = "zoryvex-test-auth-consume-code"
  handler                        = "handlers/auth-consume-code.handler"
  deployment_package_path        = var.auth_consume_code_deployment_package_path
  route_key                      = "POST /auth/consume-code"
  api_id                         = module.api_gateway.api_id
  api_execution_arn              = module.api_gateway.execution_arn
  authorized                     = false
  log_retention_days             = var.log_retention_days
  dynamodb_table_arn             = module.core_table.table_arn
  secure_ssm_parameter_arns      = [local.auth_token_pepper_arn]
  environment_variables          = local.auth_environment_variables
  reserved_concurrent_executions = var.lambda_reserved_concurrency
  tags                           = var.tags
}

module "auth_sign_out_route" {
  source = "../../modules/api-route"

  function_name                  = "zoryvex-test-auth-sign-out"
  handler                        = "handlers/auth-sign-out.handler"
  deployment_package_path        = var.auth_sign_out_deployment_package_path
  route_key                      = "POST /auth/sign-out"
  api_id                         = module.api_gateway.api_id
  api_execution_arn              = module.api_gateway.execution_arn
  authorized                     = false
  log_retention_days             = var.log_retention_days
  dynamodb_table_arn             = module.core_table.table_arn
  secure_ssm_parameter_arns      = [local.auth_token_pepper_arn]
  environment_variables          = local.auth_environment_variables
  reserved_concurrent_executions = var.lambda_reserved_concurrency
  tags                           = var.tags
}

module "webauthn_register_options_route" {
  source = "../../modules/api-route"

  function_name             = "zoryvex-test-webauthn-register-options"
  handler                   = "handlers/webauthn-register-options.handler"
  deployment_package_path   = var.webauthn_register_options_deployment_package_path
  route_key                 = "POST /auth/webauthn/register/options"
  api_id                    = module.api_gateway.api_id
  api_execution_arn         = module.api_gateway.execution_arn
  authorized                = true
  authorizer_id             = module.api_gateway.authorizer_id
  log_retention_days        = var.log_retention_days
  dynamodb_table_arn        = module.core_table.table_arn
  secure_ssm_parameter_arns = [local.auth_token_pepper_arn]
  environment_variables = merge(local.auth_environment_variables, {
    WEBAUTHN_RP_ID = local.webauthn_rp_id
  })
  reserved_concurrent_executions = var.lambda_reserved_concurrency
  tags                           = var.tags
}

module "webauthn_register_verify_route" {
  source = "../../modules/api-route"

  function_name             = "zoryvex-test-webauthn-register-verify"
  handler                   = "handlers/webauthn-register-verify.handler"
  deployment_package_path   = var.webauthn_register_verify_deployment_package_path
  route_key                 = "POST /auth/webauthn/register/verify"
  api_id                    = module.api_gateway.api_id
  api_execution_arn         = module.api_gateway.execution_arn
  authorized                = true
  authorizer_id             = module.api_gateway.authorizer_id
  log_retention_days        = var.log_retention_days
  dynamodb_table_arn        = module.core_table.table_arn
  secure_ssm_parameter_arns = [local.auth_token_pepper_arn]
  environment_variables = merge(local.auth_environment_variables, {
    WEBAUTHN_RP_ID = local.webauthn_rp_id
  })
  reserved_concurrent_executions = var.lambda_reserved_concurrency
  tags                           = var.tags
}

module "webauthn_step_up_options_route" {
  source = "../../modules/api-route"

  function_name             = "zoryvex-test-webauthn-step-up-options"
  handler                   = "handlers/webauthn-step-up-options.handler"
  deployment_package_path   = var.webauthn_step_up_options_deployment_package_path
  route_key                 = "POST /auth/webauthn/step-up/options"
  api_id                    = module.api_gateway.api_id
  api_execution_arn         = module.api_gateway.execution_arn
  authorized                = true
  authorizer_id             = module.api_gateway.authorizer_id
  log_retention_days        = var.log_retention_days
  dynamodb_table_arn        = module.core_table.table_arn
  secure_ssm_parameter_arns = [local.auth_token_pepper_arn]
  environment_variables = merge(local.auth_environment_variables, {
    WEBAUTHN_RP_ID = local.webauthn_rp_id
  })
  reserved_concurrent_executions = var.lambda_reserved_concurrency
  tags                           = var.tags
}

module "webauthn_step_up_verify_route" {
  source = "../../modules/api-route"

  function_name             = "zoryvex-test-webauthn-step-up-verify"
  handler                   = "handlers/webauthn-step-up-verify.handler"
  deployment_package_path   = var.webauthn_step_up_verify_deployment_package_path
  route_key                 = "POST /auth/webauthn/step-up/verify"
  api_id                    = module.api_gateway.api_id
  api_execution_arn         = module.api_gateway.execution_arn
  authorized                = true
  authorizer_id             = module.api_gateway.authorizer_id
  log_retention_days        = var.log_retention_days
  dynamodb_table_arn        = module.core_table.table_arn
  secure_ssm_parameter_arns = [local.auth_token_pepper_arn]
  environment_variables = merge(local.auth_environment_variables, {
    WEBAUTHN_RP_ID = local.webauthn_rp_id
  })
  reserved_concurrent_executions = var.lambda_reserved_concurrency
  tags                           = var.tags
}

module "webhooks_queue" {
  source = "../../modules/messaging"

  queue_name          = "zoryvex-test-webhooks"
  alarm_sns_topic_arn = module.observability.alerts_topic_arn
  tags                = var.tags
}

module "email_queue" {
  source = "../../modules/messaging"

  queue_name          = "zoryvex-test-email"
  alarm_sns_topic_arn = module.observability.alerts_topic_arn
  tags                = var.tags
}

module "ai_queue" {
  source = "../../modules/messaging"

  queue_name          = "zoryvex-test-ai"
  alarm_sns_topic_arn = module.observability.alerts_topic_arn
  tags                = var.tags
}

module "evidence_processing_queue" {
  source = "../../modules/messaging"

  queue_name                  = "zoryvex-test-evidence-processing"
  alarm_sns_topic_arn         = module.observability.alerts_topic_arn
  allow_eventbridge_rule_arns = [aws_cloudwatch_event_rule.evidence_scan_result.arn]
  tags                        = var.tags
}

# --- Evidence pipeline (Phase 7 slice 3) -----------------------------------
# GuardDuty Malware Protection for S3 publishes a scan-result event to the
# default EventBridge bus for every object it scans (source aws.guardduty,
# detail-type "GuardDuty Malware Protection Object Scan Result" — verified
# live against docs.aws.amazon.com/guardduty/latest/ug/
# monitor-with-eventbridge-s3-malware-protection.html, not guessed). Routed
# to the evidence_processing queue rather than invoking a Lambda directly,
# so a worker outage doesn't drop scan results — they wait in the queue.
resource "aws_cloudwatch_event_rule" "evidence_scan_result" {
  name = "zoryvex-test-evidence-scan-result"

  event_pattern = jsonencode({
    source      = ["aws.guardduty"]
    detail-type = ["GuardDuty Malware Protection Object Scan Result"]
    detail = {
      s3ObjectDetails = {
        bucketName = [local.evidence_bucket_name]
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
  source = "../../modules/queue-consumer"

  function_name           = "zoryvex-test-evidence-scan-worker"
  handler                 = "handlers/evidence-scan-result-worker.handler"
  deployment_package_path = var.evidence_scan_worker_deployment_package_path
  log_retention_days      = var.log_retention_days
  queue_arn               = module.evidence_processing_queue.queue_arn
  dynamodb_table_arn      = module.core_table.table_arn
  evidence_bucket_arn     = local.evidence_bucket_arn
  environment_variables = {
    TABLE_NAME           = module.core_table.table_name
    EVIDENCE_BUCKET_NAME = local.evidence_bucket_name
  }
  # Unreserved — same account-wide concurrency-limit constraint as every
  # other function in this environment (see module.auth's comment).
  reserved_concurrent_executions = var.lambda_reserved_concurrency
  tags                           = var.tags
}

module "evidence_request_upload_route" {
  source = "../../modules/api-route"

  function_name           = "zoryvex-test-evidence-request-upload"
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
    EVIDENCE_BUCKET_NAME = local.evidence_bucket_name
  }
  reserved_concurrent_executions = var.lambda_reserved_concurrency
  tags                           = var.tags
}

module "evidence_download_route" {
  source = "../../modules/api-route"

  function_name           = "zoryvex-test-evidence-download"
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
    EVIDENCE_BUCKET_NAME = local.evidence_bucket_name
  }
  reserved_concurrent_executions = var.lambda_reserved_concurrency
  tags                           = var.tags
}

# --- Proof Hiring Kit domain (Phase 7 slice 4) -----------------------------
# See docs/DATA_MODEL.md's "Proof Hiring Kit domain" section for the full
# design. create-order/regenerate are employer_admin-only billing-adjacent
# actions, gated inside each handler via the authorizer's session context —
# the authorizer itself only proves a valid session, never a specific role.

module "kit_preview_route" {
  source = "../../modules/api-route"

  function_name           = "zoryvex-test-kit-preview"
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
  reserved_concurrent_executions = var.lambda_reserved_concurrency
  tags                           = var.tags
}

# Read-only Kit-order status check — added 2026-08-26 after an audit found
# the real-mode roles list and role detail page had no way to know whether
# a Kit had actually been purchased, so both omitted the status badge
# entirely. Base-table access only, same shape as kit_preview_route above.
module "kit_status_route" {
  source = "../../modules/api-route"

  function_name           = "zoryvex-test-kit-status"
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
  reserved_concurrent_executions = var.lambda_reserved_concurrency
  tags                           = var.tags
}

module "kit_create_order_route" {
  source = "../../modules/api-route"

  function_name           = "zoryvex-test-kit-create-order"
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
  # webhook route already has.
  secure_ssm_parameter_arns = [local.paystack_secret_key_arn, aws_ssm_parameter.feature_flags.arn]
  environment_variables = {
    # Gates on a feature flag. Without this variable getFeatureFlags()
    # returns every flag false and the route reports its feature paused,
    # silently and whatever the live parameter says.
    FEATURE_FLAGS_PARAM       = aws_ssm_parameter.feature_flags.name
    TABLE_NAME                = module.core_table.table_name
    PAYSTACK_SECRET_KEY_PARAM = local.paystack_secret_key_name
    PAYSTACK_KEY_PREFIX       = "sk_test_"
    APP_ORIGIN                = var.app_origin
  }
  reserved_concurrent_executions = var.lambda_reserved_concurrency
  tags                           = var.tags
}

module "kit_download_route" {
  source = "../../modules/api-route"

  function_name           = "zoryvex-test-kit-download"
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
  reserved_concurrent_executions = var.lambda_reserved_concurrency
  tags                           = var.tags
}

module "kit_regenerate_route" {
  source = "../../modules/api-route"

  function_name           = "zoryvex-test-kit-regenerate"
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
  reserved_concurrent_executions = var.lambda_reserved_concurrency
  tags                           = var.tags
}

# Unauthenticated by design — Paystack calls this directly (see
# services/api/handlers/webhooks/paystack.ts). Authenticity comes from the
# HMAC signature check against the Paystack secret parameter, read here via
# the same secure_ssm_parameter_arns grant pattern already used for the
# auth-token pepper — this is the first real consumer of
# local.paystack_secret_key_arn (infrastructure/envs/test-secrets as of
# Phase 7 slice 9; originally a same-file resource back in Phase 6).
# The two unauthenticated read routes behind a candidate's public proof page.
#
# `authorized = false` is the whole security question here, so it is worth
# saying why it is safe. Both handlers compose from
# aws-public-proof-dependencies, which wires reads and no write of any kind,
# so neither route can change anything whatever it is sent. The only
# credential is the opaque id in the path, which a candidate mints by opting
# in and destroys by opting out. Every failure returns the same 404, so the
# URL cannot be used to discover whether an account exists.
#
# Neither is granted a GSI or the evidence bucket: the page is built from a
# GetItem on the pointer, a GetItem on the profile, and the candidate's own
# evidence. Nothing here needs to look across candidates, and not granting it
# is what keeps that true.
# The peer-confirmation flow: one authenticated route for the candidate asking,
# and two unauthenticated ones for the colleague answering.
#
# `authorized = false` on the last two is the security question, so the reason
# is worth stating. A verifier has no account and should never need one to
# answer a question about somebody else's work, so the opaque single-use token
# in the request body is the only credential. Both are POST rather than GET
# specifically so that token never lands in a URL that access logs, referrer
# headers and browser history would keep.
#
# Neither is granted a GSI or the evidence bucket. Between them they need one
# GetItem on the token, one on the candidate, one on the evidence, and a
# conditional write; not granting more is what keeps that true.
module "peer_request_route" {
  source = "../../modules/api-route"

  function_name             = "zoryvex-test-peer-request"
  handler                   = "handlers/peer-request.handler"
  deployment_package_path   = var.peer_request_deployment_package_path
  route_key                 = "POST /evidence/{evidenceId}/peer-requests"
  api_id                    = module.api_gateway.api_id
  api_execution_arn         = module.api_gateway.execution_arn
  authorized                = true
  authorizer_id             = module.api_gateway.authorizer_id
  log_retention_days        = var.log_retention_days
  dynamodb_table_arn        = module.core_table.table_arn
  secure_ssm_parameter_arns = [local.auth_token_pepper_arn]
  ses_identity_arn          = local.ses_domain_identity_arn
  # Granted because this function sends through the configuration set named
  # in its own environment below, and SES authorizes SendEmail against the
  # configuration-set resource as well as the identity. Omitting it made
  # every "ask someone to confirm this" request fail with an AccessDenied
  # the handler could only report as "Unexpected error" — the one route in
  # this file that sent mail without this grant.
  ses_configuration_set_arn = local.ses_configuration_set_arn
  environment_variables = {
    TABLE_NAME                 = module.core_table.table_name
    AUTH_TOKEN_PEPPER_PARAM    = local.auth_token_pepper_name
    APP_ORIGIN                 = var.app_origin
    SIGN_IN_EMAIL_FROM         = "auth@${var.apex_domain}"
    SES_CONFIGURATION_SET_NAME = var.ses_configuration_set_name
  }
  reserved_concurrent_executions = var.lambda_reserved_concurrency
  tags                           = var.tags
}

module "peer_preview_route" {
  source = "../../modules/api-route"

  function_name             = "zoryvex-test-peer-preview"
  handler                   = "handlers/peer-preview.handler"
  deployment_package_path   = var.peer_preview_deployment_package_path
  route_key                 = "POST /peer-attestations/preview"
  api_id                    = module.api_gateway.api_id
  api_execution_arn         = module.api_gateway.execution_arn
  authorized                = false
  log_retention_days        = var.log_retention_days
  dynamodb_table_arn        = module.core_table.table_arn
  secure_ssm_parameter_arns = [local.auth_token_pepper_arn]
  environment_variables = {
    TABLE_NAME              = module.core_table.table_name
    AUTH_TOKEN_PEPPER_PARAM = local.auth_token_pepper_name
  }
  reserved_concurrent_executions = var.lambda_reserved_concurrency
  tags                           = var.tags
}

module "peer_confirm_route" {
  source = "../../modules/api-route"

  function_name             = "zoryvex-test-peer-confirm"
  handler                   = "handlers/peer-confirm.handler"
  deployment_package_path   = var.peer_confirm_deployment_package_path
  route_key                 = "POST /peer-attestations/confirm"
  api_id                    = module.api_gateway.api_id
  api_execution_arn         = module.api_gateway.execution_arn
  authorized                = false
  log_retention_days        = var.log_retention_days
  dynamodb_table_arn        = module.core_table.table_arn
  secure_ssm_parameter_arns = [local.auth_token_pepper_arn]
  # This route now sends one message of its own: the notice telling the
  # candidate that somebody confirmed their claim. Without these two grants
  # that send fails with the same AccessDenied that took down the request
  # route above, and it would fail invisibly here, because the notice is
  # deliberately swallowed so a mail failure cannot rob the verifier of a
  # confirmation they have already completed.
  ses_identity_arn          = local.ses_domain_identity_arn
  ses_configuration_set_arn = local.ses_configuration_set_arn
  environment_variables = {
    TABLE_NAME                 = module.core_table.table_name
    AUTH_TOKEN_PEPPER_PARAM    = local.auth_token_pepper_name
    SIGN_IN_EMAIL_FROM         = "auth@${var.apex_domain}"
    SES_CONFIGURATION_SET_NAME = var.ses_configuration_set_name
  }
  reserved_concurrent_executions = var.lambda_reserved_concurrency
  tags                           = var.tags
}

module "public_proof_route" {
  source = "../../modules/api-route"

  function_name           = "zoryvex-test-public-proof"
  handler                 = "handlers/public-proof.handler"
  deployment_package_path = var.public_proof_deployment_package_path
  route_key               = "GET /public/proof/{publicProofId}"
  api_id                  = module.api_gateway.api_id
  api_execution_arn       = module.api_gateway.execution_arn
  authorized              = false
  log_retention_days      = var.log_retention_days
  dynamodb_table_arn      = module.core_table.table_arn
  # No bucket access. This route read one object, the photo a candidate put
  # on their own public page, and profile photos are gone: they invited a
  # face next to a shortlist, which is how demographic bias reaches
  # screening, and a link somebody chose to publish says more about their
  # work than a photograph does.
  #
  # The grant goes with the feature. An unauthenticated route holding read
  # access to the evidence bucket it no longer touches is exactly the
  # permission somebody finds later and cannot explain.
  environment_variables = {
    TABLE_NAME = module.core_table.table_name
  }
  reserved_concurrent_executions = var.lambda_reserved_concurrency
  tags                           = var.tags
}

module "public_proof_badge_route" {
  source = "../../modules/api-route"

  function_name           = "zoryvex-test-public-proof-badge"
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
  reserved_concurrent_executions = var.lambda_reserved_concurrency
  tags                           = var.tags
}

module "webhooks_paystack_route" {
  source = "../../modules/api-route"

  function_name             = "zoryvex-test-webhooks-paystack"
  handler                   = "handlers/webhooks-paystack.handler"
  deployment_package_path   = var.webhooks_paystack_deployment_package_path
  route_key                 = "POST /webhooks/paystack"
  api_id                    = module.api_gateway.api_id
  api_execution_arn         = module.api_gateway.execution_arn
  authorized                = false
  log_retention_days        = var.log_retention_days
  dynamodb_table_arn        = module.core_table.table_arn
  secure_ssm_parameter_arns = [local.paystack_secret_key_arn]
  sns_publish_arns          = [module.observability.alerts_topic_arn]
  environment_variables = {
    TABLE_NAME                = module.core_table.table_name
    PAYSTACK_SECRET_KEY_PARAM = local.paystack_secret_key_name
    PAYSTACK_KEY_PREFIX       = "sk_test_"
    ALERTS_TOPIC_ARN          = module.observability.alerts_topic_arn
  }
  reserved_concurrent_executions = var.lambda_reserved_concurrency
  tags                           = var.tags
}

# --- Privacy: consent, export, deletion, contact-unlock (Phase 7 slice 5) --
# Deletion is deliberately asynchronous (Prompt 7) — the request handler
# only enqueues; the worker does the real cross-resource work. A thrown
# error there lets SQS redeliver and eventually DLQ, which already alarms
# to the founder's SNS topic via module.deletion_queue's own
# dlq_not_empty alarm — no separate "deletion-failure alarm" resource
# needed, this queue's own DLQ alarm *is* that alarm.
module "deletion_queue" {
  source = "../../modules/messaging"

  queue_name          = "zoryvex-test-deletion"
  alarm_sns_topic_arn = module.observability.alerts_topic_arn
  tags                = var.tags
}

module "privacy_deletion_worker" {
  source = "../../modules/queue-consumer"

  function_name           = "zoryvex-test-privacy-deletion-worker"
  handler                 = "handlers/privacy-deletion-worker.handler"
  deployment_package_path = var.privacy_deletion_worker_deployment_package_path
  log_retention_days      = var.log_retention_days
  queue_arn               = module.deletion_queue.queue_arn
  dynamodb_table_arn      = module.core_table.table_arn
  # match-repository.ts's listMatchesForCandidate (called from
  # deletion-service.ts's deleteCandidateData) queries GSI1 — without this,
  # every real deletion fails with AccessDeniedException on dynamodb:Query
  # and retries until it dead-letters (confirmed live, Phase 7 slice 11
  # privacy acceptance). No other query in the deletion path touches a GSI.
  dynamodb_index_arns = [local.core_table_gsi1_arn]
  evidence_bucket_arn = local.evidence_bucket_arn
  environment_variables = {
    TABLE_NAME           = module.core_table.table_name
    EVIDENCE_BUCKET_NAME = local.evidence_bucket_name
  }
  reserved_concurrent_executions = var.lambda_reserved_concurrency
  tags                           = var.tags
}

module "privacy_consent_route" {
  source = "../../modules/api-route"

  function_name           = "zoryvex-test-privacy-consent"
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
  reserved_concurrent_executions = var.lambda_reserved_concurrency
  tags                           = var.tags
}

module "privacy_export_route" {
  source = "../../modules/api-route"

  function_name           = "zoryvex-test-privacy-export"
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
  reserved_concurrent_executions = var.lambda_reserved_concurrency
  tags                           = var.tags
}

module "privacy_request_deletion_route" {
  source = "../../modules/api-route"

  function_name           = "zoryvex-test-privacy-request-deletion"
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
  reserved_concurrent_executions = var.lambda_reserved_concurrency
  tags                           = var.tags
}

module "matches_unlock_contact_route" {
  source = "../../modules/api-route"

  function_name           = "zoryvex-test-matches-unlock-contact"
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
  reserved_concurrent_executions = var.lambda_reserved_concurrency
  tags                           = var.tags
}

# GET counterpart to matches_unlock_contact_route above — added 2026-08-26
# after an audit found unlockContact had never had any route that actually
# returned the candidate's contact details afterward (see docs/DECISIONS.md).
# Read-only, base-table access only (no GSI): mirrors the same three
# GetItem lookups (role/match/candidate) unlockContact already performs.
module "matches_get_contact_route" {
  source = "../../modules/api-route"

  function_name           = "zoryvex-test-matches-get-contact"
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
  reserved_concurrent_executions = var.lambda_reserved_concurrency
  tags                           = var.tags
}

# --- Matching baseline + gated Bedrock explain path (Phase 7 slice 6) -----
# Foundation-model ARN uses no account ID (`::`) and a wildcard region: AWS
# requires both the inference-profile ARN AND the underlying foundation-
# model ARN(s) to be IAM-granted for a cross-Region inference profile call,
# and the eu.* profile's destination Regions span more than one EU Region
# (docs/DECISIONS.md, verified 2026-08-19 against AWS's own inference-
# profile IAM documentation) — the model ID itself stays exactly scoped,
# only the Region is wildcarded, which is unavoidable for this AWS feature.
locals {
  bedrock_inference_profile_arn = "arn:aws:bedrock:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:inference-profile/${var.bedrock_model_id}"
  bedrock_foundation_model_arn  = "arn:aws:bedrock:*::foundation-model/amazon.nova-micro-v1:0"
}

module "matches_recompute_route" {
  source = "../../modules/api-route"

  function_name           = "zoryvex-test-matches-recompute"
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
  # dynamodb:Query (confirmed live, Phase 7 slice 11 matching acceptance;
  # same defect class as PR #43's privacy-deletion-worker fix). No other
  # query in this route touches a GSI.
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
  reserved_concurrent_executions = var.lambda_reserved_concurrency
  tags                           = var.tags
}

module "matches_list_route" {
  source = "../../modules/api-route"

  function_name           = "zoryvex-test-matches-list"
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
  reserved_concurrent_executions = var.lambda_reserved_concurrency
  tags                           = var.tags
}

# aiMatching stays false in feature_flags (above) this phase — this route
# exists and is fully wired/tested, but every real invocation returns
# {available:false, reason:"ai_matching_disabled"} until the flag is
# deliberately turned on after the evaluation gate passes (docs/AI_SAFETY.md).
module "matches_explain_route" {
  source = "../../modules/api-route"

  function_name             = "zoryvex-test-matches-explain"
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
  reserved_concurrent_executions = var.lambda_reserved_concurrency
  tags                           = var.tags
}

# --- Operations and automation (Phase 7 slice 7) --------------------------
# founder_admin-only, WebAuthn-stepped-up-only (requireFounderStepUp) — the
# founder's exception queue (CLAUDE.md: "not a daily ops dashboard"), not a
# public route despite living at a normal, discoverable path (ADR 0001: "Do
# not hide admin access behind an obscure URL").
module "admin_exceptions_route" {
  source = "../../modules/api-route"

  function_name           = "zoryvex-test-admin-exceptions"
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
  # dynamodb:Query (same defect class as PR #43/#44's GSI1 fixes, found by
  # the follow-up audit those PRs asked for). No other query in this route
  # touches a GSI.
  dynamodb_index_arns = [local.core_table_gsi3_arn]
  environment_variables = {
    TABLE_NAME = module.core_table.table_name
  }
  reserved_concurrent_executions = var.lambda_reserved_concurrency
  tags                           = var.tags
}

# --- Session read + basic entity CRUD (Phase 7 slice 8, part 1) -----------
# A newly-discovered gap, not planned as its own slice: none of Phase 7's
# earlier slices ever exposed an HTTP surface for "who am I" or for
# creating/editing the Role/Candidate-profile/Evidence-claim records every
# later slice (matching, kit, evidence files) actually operates on — see
# docs/DECISIONS.md. All application logic reuses slice 2's already-tested
# repository functions verbatim; this is wiring, not new domain logic.

module "auth_session_route" {
  source = "../../modules/api-route"

  function_name           = "zoryvex-test-auth-session"
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
  # auth pepper, so this route never needed either. Same pattern as
  # auth_consume_code_route/auth_sign_out_route above.
  dynamodb_table_arn             = module.core_table.table_arn
  secure_ssm_parameter_arns      = [local.auth_token_pepper_arn]
  environment_variables          = local.auth_environment_variables
  reserved_concurrent_executions = var.lambda_reserved_concurrency
  tags                           = var.tags
}

module "roles_create_route" {
  source = "../../modules/api-route"

  function_name           = "zoryvex-test-roles-create"
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
  reserved_concurrent_executions = var.lambda_reserved_concurrency
  tags                           = var.tags
}

module "roles_get_route" {
  source = "../../modules/api-route"

  function_name           = "zoryvex-test-roles-get"
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
  reserved_concurrent_executions = var.lambda_reserved_concurrency
  tags                           = var.tags
}

module "roles_list_route" {
  source = "../../modules/api-route"

  function_name           = "zoryvex-test-roles-list"
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
  # fails with AccessDeniedException on dynamodb:Query (same defect class as
  # PR #43/#44's GSI1 fixes, found by the follow-up audit those PRs asked
  # for). No other query in this route touches a GSI.
  dynamodb_index_arns = [local.core_table_gsi2_arn]
  environment_variables = {
    TABLE_NAME = module.core_table.table_name
  }
  reserved_concurrent_executions = var.lambda_reserved_concurrency
  tags                           = var.tags
}

module "roles_update_route" {
  source = "../../modules/api-route"

  function_name           = "zoryvex-test-roles-update"
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
  reserved_concurrent_executions = var.lambda_reserved_concurrency
  tags                           = var.tags
}

module "candidates_profile_get_route" {
  source = "../../modules/api-route"

  function_name           = "zoryvex-test-candidates-profile-get"
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
  reserved_concurrent_executions = var.lambda_reserved_concurrency
  tags                           = var.tags
}

module "candidates_profile_update_route" {
  source = "../../modules/api-route"

  function_name           = "zoryvex-test-candidates-profile-update"
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
  reserved_concurrent_executions = var.lambda_reserved_concurrency
  tags                           = var.tags
}

module "candidates_evidence_create_route" {
  source = "../../modules/api-route"

  function_name           = "zoryvex-test-candidates-evidence-create"
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
  reserved_concurrent_executions = var.lambda_reserved_concurrency
  tags                           = var.tags
}

module "candidates_evidence_list_route" {
  source = "../../modules/api-route"

  function_name           = "zoryvex-test-candidates-evidence-list"
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
  reserved_concurrent_executions = var.lambda_reserved_concurrency
  tags                           = var.tags
}

module "candidates_evidence_get_route" {
  source = "../../modules/api-route"

  function_name           = "zoryvex-test-candidates-evidence-get"
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
  reserved_concurrent_executions = var.lambda_reserved_concurrency
  tags                           = var.tags
}

module "candidates_evidence_update_route" {
  source = "../../modules/api-route"

  function_name           = "zoryvex-test-candidates-evidence-update"
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
  reserved_concurrent_executions = var.lambda_reserved_concurrency
  tags                           = var.tags
}

# Autonomous evidence verification (services/api/src/domain/verification-service.ts).
# These two are the only Lambdas in the system that make outbound calls to a
# third party (Credly, GitHub). They are deliberately NOT VPC-attached, like
# every other function here, which is what gives them internet egress without
# a NAT Gateway (forbidden by CLAUDE.md's architecture boundary).
module "candidates_graded_task_route" {
  source = "../../modules/api-route"

  function_name           = "zoryvex-test-candidates-graded-task"
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
  reserved_concurrent_executions = var.lambda_reserved_concurrency
  tags                           = var.tags
}

module "matches_evidence_route" {
  source = "../../modules/api-route"

  function_name           = "zoryvex-test-matches-evidence"
  handler                 = "handlers/matches-evidence.handler"
  deployment_package_path = var.matches_evidence_deployment_package_path
  route_key               = "GET /roles/{roleId}/matches/{candidateId}/evidence"
  api_id                  = module.api_gateway.api_id
  api_execution_arn       = module.api_gateway.execution_arn
  authorized              = true
  authorizer_id           = module.api_gateway.authorizer_id
  log_retention_days      = var.log_retention_days
  dynamodb_table_arn      = module.core_table.table_arn
  # A candidate is told when an employer opens their proof, so this route
  # sends mail. Same verified identity and configuration set as every other
  # sender here; granting the identity without the configuration set is what
  # broke the peer-request route, and the policy check now refuses it.
  ses_identity_arn          = local.ses_domain_identity_arn
  ses_configuration_set_arn = local.ses_configuration_set_arn
  environment_variables = {
    TABLE_NAME                 = module.core_table.table_name
    APP_ORIGIN                 = var.app_origin
    REMINDER_FROM_ADDRESS      = var.sign_in_email_from
    SES_CONFIGURATION_SET_NAME = var.ses_configuration_set_name
  }
  reserved_concurrent_executions = var.lambda_reserved_concurrency
  tags                           = var.tags
}

module "candidates_evidence_verify_begin_route" {
  source = "../../modules/api-route"

  function_name           = "zoryvex-test-candidates-evidence-verify-begin"
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
  reserved_concurrent_executions = var.lambda_reserved_concurrency
  tags                           = var.tags
}

module "candidates_evidence_verify_route" {
  source = "../../modules/api-route"

  function_name           = "zoryvex-test-candidates-evidence-verify"
  handler                 = "handlers/candidates-evidence-verify.handler"
  deployment_package_path = var.candidates_evidence_verify_deployment_package_path
  route_key               = "POST /candidates/me/evidence/{evidenceId}/verify"
  api_id                  = module.api_gateway.api_id
  api_execution_arn       = module.api_gateway.execution_arn
  authorized              = true
  authorizer_id           = module.api_gateway.authorizer_id
  log_retention_days      = var.log_retention_days
  dynamodb_table_arn      = module.core_table.table_arn
  # Longer than the default: one repository verification makes three
  # sequential upstream calls, each with its own 5s client timeout.
  timeout_seconds = 20
  # The only route that talks to GitHub, so the only one that needs the
  # token. Granted narrowly rather than to every function that happens to
  # read a parameter.
  secure_ssm_parameter_arns = [local.github_token_arn]
  environment_variables = {
    TABLE_NAME = module.core_table.table_name
    # Absent, empty or unreadable all mean "carry on unauthenticated", so
    # naming the parameter before it holds a value changes nothing.
    GITHUB_TOKEN_PARAM = local.github_token_name
  }
  reserved_concurrent_executions = var.lambda_reserved_concurrency
  tags                           = var.tags
}

module "candidates_evidence_delete_route" {
  source = "../../modules/api-route"

  function_name           = "zoryvex-test-candidates-evidence-delete"
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
  reserved_concurrent_executions = var.lambda_reserved_concurrency
  tags                           = var.tags
}

# Isolated bucket used solely by the EICAR fail-closed integration test
# (Prompt 7: prove the malware-scan gate "without storing the test artifact
# outside the isolated test bucket") — never the real evidence bucket, no
# browser-upload CORS path (SDK-driven test only), same GuardDuty wiring so
# the scan actually runs. Test-env only; never created in production.
module "evidence_scan_test_bucket" {
  source = "../../modules/evidence-storage"

  bucket_name                           = local.evidence_scan_test_bucket_name
  retention_days                        = 1
  quarantine_expiry_days                = 1
  allowed_upload_origins                = []
  guardduty_detector_id                 = aws_guardduty_detector.this.id
  guardduty_malware_protection_role_arn = aws_iam_role.guardduty_malware_protection.arn
  tags                                  = var.tags
}

# ACM's own EventBridge event (source/detail-type verified live against AWS
# docs, 2026-08-19 — see docs/DECISIONS.md) — "domain/cert problem"
# (Prompt 7's mandatory-alert list). Account-wide match (no per-certificate
# filter): this account has very few certificates, all this project's own,
# so scoping further would add complexity without a real precision benefit.
resource "aws_cloudwatch_event_rule" "acm_certificate_expiring" {
  name        = "zoryvex-test-acm-cert-expiring"
  description = "ACM 'Certificate Approaching Expiration' -> founder alerts topic."
  event_pattern = jsonencode({
    source      = ["aws.acm"]
    detail-type = ["ACM Certificate Approaching Expiration"]
  })
  tags = var.tags
}

module "observability" {
  source = "../../modules/observability"

  environment_name                = "test"
  alert_email                     = var.alert_email
  api_gateway_id                  = module.api_gateway.api_id
  api_lambda_function_name        = module.health_route.function_name
  authorizer_lambda_function_name = module.auth.function_name
  dynamodb_table_name             = module.core_table.table_name
  ses_configuration_set_name      = var.ses_configuration_set_name
  allow_eventbridge_rule_arns     = [aws_cloudwatch_event_rule.acm_certificate_expiring.arn]
  tags                            = var.tags
}

resource "aws_cloudwatch_event_target" "acm_certificate_expiring_to_alerts" {
  rule      = aws_cloudwatch_event_rule.acm_certificate_expiring.name
  target_id = "alerts-topic"
  arn       = module.observability.alerts_topic_arn
}

# --- Scheduled health-check job (Phase 7 slice 7) --------------------------
# EventBridge Scheduler invokes the existing health Lambda directly (not
# through API Gateway) on a fixed cadence — no new application code needed:
# module.observability's existing lambda_errors["api"] alarm (this function
# is that "api" entry) already alarms on any invocation failure. Test-only:
# "production automation stays fully disabled — no launch mode is selected
# yet" (Prompt 7).
data "aws_iam_policy_document" "health_check_scheduler_assume_role" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["scheduler.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "health_check_scheduler" {
  name               = "zoryvex-test-health-check-scheduler"
  assume_role_policy = data.aws_iam_policy_document.health_check_scheduler_assume_role.json
  tags               = var.tags
}

data "aws_iam_policy_document" "health_check_scheduler_invoke" {
  statement {
    sid       = "InvokeHealthLambdaOnly"
    effect    = "Allow"
    actions   = ["lambda:InvokeFunction"]
    resources = [module.health_route.function_arn]
  }
}

resource "aws_iam_role_policy" "health_check_scheduler_invoke" {
  name   = "zoryvex-test-health-check-scheduler-invoke"
  role   = aws_iam_role.health_check_scheduler.id
  policy = data.aws_iam_policy_document.health_check_scheduler_invoke.json
}

# --- Verification reminder (one nudge, once, per candidate) -----------------
# Two independent guards, both off, and each has to be turned on
# deliberately: the schedule itself is DISABLED, and the verificationReminders
# feature flag is false. This is the only job in the system that emails
# somebody who did not ask, so it must never begin because a deploy shipped.
#
# The worker reads the flag before it reads any candidate, so even an
# accidentally-enabled schedule costs one parameter read and sends nothing.
module "verification_reminder_job" {
  source = "../../modules/scheduled-job"

  function_name           = "zoryvex-test-verification-reminder"
  handler                 = "handlers/jobs-verification-reminder.handler"
  deployment_package_path = var.jobs_verification_reminder_deployment_package_path
  log_retention_days      = var.log_retention_days

  # Once a day, mid-morning West Africa time. A reminder that lands at 3am
  # reads as a machine talking, which is the wrong first impression from a
  # product whose whole pitch is that a person thought about this.
  schedule_expression = "cron(0 10 * * ? *)"
  schedule_timezone   = "Africa/Lagos"
  enabled             = false

  # GSI1 query to list opted-in candidates, Query for their evidence, and a
  # conditional PutItem for the one-reminder-ever claim.
  dynamodb_table_arn  = module.core_table.table_arn
  dynamodb_index_arns = [local.core_table_gsi1_arn]

  # Both the identity and the configuration set, because SendEmail is
  # authorized against each when a configuration set is named.
  ses_identity_arns  = [local.ses_domain_identity_arn, local.ses_configuration_set_arn]
  ssm_parameter_arns = [aws_ssm_parameter.feature_flags.arn]

  # Generous for four index queries plus a bounded number of sends, and caps
  # the damage if an upstream hangs.
  timeout_seconds = 60

  environment_variables = {
    TABLE_NAME          = module.core_table.table_name
    FEATURE_FLAGS_PARAM = aws_ssm_parameter.feature_flags.name
    APP_ORIGIN          = var.app_origin
    # The same verified sender as sign-in. A second address would need its
    # own verified identity for no benefit the reader would notice.
    REMINDER_FROM_ADDRESS      = var.sign_in_email_from
    SES_CONFIGURATION_SET_NAME = var.ses_configuration_set_name
  }

  tags = var.tags
}

# --- Billing: subscriptions, reconciliation, diagnostics -------------------
#
# Every route here that moves money reads the Paystack secret key, and all of
# them read the feature flags: `payments` is the kill switch, and a route
# that gates on a flag without the parameter to read it reports "paused"
# whatever the live value says. That hole already existed on five routes
# once; `npm run flags:wiring` now fails the build on it.

module "billing_create_subscription_route" {
  source = "../../modules/api-route"

  function_name           = "zoryvex-test-billing-create-subscription"
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
    local.paystack_secret_key_arn,
    aws_ssm_parameter.feature_flags.arn,
    aws_ssm_parameter.paystack_plan_codes.arn,
  ]
  environment_variables = {
    TABLE_NAME                = module.core_table.table_name
    FEATURE_FLAGS_PARAM       = aws_ssm_parameter.feature_flags.name
    PAYSTACK_SECRET_KEY_PARAM = local.paystack_secret_key_name
    PAYSTACK_KEY_PREFIX       = "sk_test_"
    PAYSTACK_PLAN_CODES_PARAM = aws_ssm_parameter.paystack_plan_codes.name
    APP_ORIGIN                = var.app_origin
  }
  reserved_concurrent_executions = var.lambda_reserved_concurrency
  tags                           = var.tags
}

# Reads only. It quotes prices and lists history; it never contacts Paystack,
# so it gets the plan-code registry and the flags and not the secret key.
module "billing_overview_route" {
  source = "../../modules/api-route"

  function_name           = "zoryvex-test-billing-overview"
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
  reserved_concurrent_executions = var.lambda_reserved_concurrency
  tags                           = var.tags
}

module "billing_cancel_route" {
  source = "../../modules/api-route"

  function_name             = "zoryvex-test-billing-cancel"
  handler                   = "handlers/billing-cancel.handler"
  deployment_package_path   = var.billing_cancel_deployment_package_path
  route_key                 = "POST /billing/cancel"
  api_id                    = module.api_gateway.api_id
  api_execution_arn         = module.api_gateway.execution_arn
  authorized                = true
  authorizer_id             = module.api_gateway.authorizer_id
  log_retention_days        = var.log_retention_days
  dynamodb_table_arn        = module.core_table.table_arn
  secure_ssm_parameter_arns = [local.paystack_secret_key_arn, aws_ssm_parameter.feature_flags.arn]
  environment_variables = {
    TABLE_NAME                = module.core_table.table_name
    FEATURE_FLAGS_PARAM       = aws_ssm_parameter.feature_flags.name
    PAYSTACK_SECRET_KEY_PARAM = local.paystack_secret_key_name
    PAYSTACK_KEY_PREFIX       = "sk_test_"
  }
  reserved_concurrent_executions = var.lambda_reserved_concurrency
  tags                           = var.tags
}

module "billing_card_update_link_route" {
  source = "../../modules/api-route"

  function_name             = "zoryvex-test-billing-card-update-link"
  handler                   = "handlers/billing-card-update-link.handler"
  deployment_package_path   = var.billing_card_update_link_deployment_package_path
  route_key                 = "POST /billing/card-update-link"
  api_id                    = module.api_gateway.api_id
  api_execution_arn         = module.api_gateway.execution_arn
  authorized                = true
  authorizer_id             = module.api_gateway.authorizer_id
  log_retention_days        = var.log_retention_days
  dynamodb_table_arn        = module.core_table.table_arn
  secure_ssm_parameter_arns = [local.paystack_secret_key_arn, aws_ssm_parameter.feature_flags.arn]
  environment_variables = {
    TABLE_NAME                = module.core_table.table_name
    FEATURE_FLAGS_PARAM       = aws_ssm_parameter.feature_flags.name
    PAYSTACK_SECRET_KEY_PARAM = local.paystack_secret_key_name
    PAYSTACK_KEY_PREFIX       = "sk_test_"
  }
  reserved_concurrent_executions = var.lambda_reserved_concurrency
  tags                           = var.tags
}

# founder_admin plus a recent WebAuthn step-up, the same gate as the
# exception queue. It reads another organization's payment history, which is
# the most sensitive non-candidate data in this system.
module "admin_billing_diagnostic_route" {
  source = "../../modules/api-route"

  function_name           = "zoryvex-test-admin-billing-diagnostic"
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
  reserved_concurrent_executions = var.lambda_reserved_concurrency
  tags                           = var.tags
}

# The half of the billing system webhooks cannot cover.
#
# Paystack sends no webhook for an abandoned checkout or a declined card, and
# a charge.success whose delivery fails for the whole 72-hour retry window
# leaves a customer charged with nothing to show for it. This job asks
# Paystack directly about every payment that never reached an outcome, and
# looks the other way for successful payments Paystack has that this system
# does not.
#
# Enabled, unlike the reminder job: this one sends nothing to anybody, it
# only reads Paystack and corrects our own records, and its whole value is
# that it runs without being asked. The payments flag is still the kill
# switch, checked before any read.
#
# GSI2 is the sparse open-payments index. It holds only unsettled attempts
# and empties itself as they settle, so a quiet hour costs one query that
# returns nothing.
module "billing_reconciliation_job" {
  source = "../../modules/scheduled-job"

  function_name           = "zoryvex-test-billing-reconciliation"
  handler                 = "handlers/jobs-billing-reconciliation.handler"
  deployment_package_path = var.jobs_billing_reconciliation_deployment_package_path
  log_retention_days      = var.log_retention_days

  # Hourly. A payment recovered an hour late is still recovered, and
  # Paystack's own retries already cover the first three minutes and the
  # first four attempts. Running every minute would spend rate limit rather
  # than buy latency.
  schedule_expression = "rate(1 hour)"
  schedule_timezone   = "Africa/Lagos"
  enabled             = true

  dynamodb_table_arn  = module.core_table.table_arn
  dynamodb_index_arns = [local.core_table_gsi2_arn]

  ssm_parameter_arns        = [aws_ssm_parameter.feature_flags.arn]
  secure_ssm_parameter_arns = [local.paystack_secret_key_arn]
  sns_publish_arns          = [module.observability.alerts_topic_arn]

  # One verify call per open attempt plus one list call, each with a
  # ten-second client timeout and up to three attempts. Sixty seconds covers
  # a realistic backlog and caps the damage if Paystack hangs.
  timeout_seconds = 60

  environment_variables = {
    TABLE_NAME                = module.core_table.table_name
    FEATURE_FLAGS_PARAM       = aws_ssm_parameter.feature_flags.name
    PAYSTACK_SECRET_KEY_PARAM = local.paystack_secret_key_name
    PAYSTACK_KEY_PREFIX       = "sk_test_"
    ALERTS_TOPIC_ARN          = module.observability.alerts_topic_arn
  }

  tags = var.tags
}

resource "aws_scheduler_schedule" "health_check" {
  name       = "zoryvex-test-health-check"
  group_name = "default"

  flexible_time_window {
    mode = "OFF"
  }

  schedule_expression = "rate(5 minutes)"

  target {
    arn      = module.health_route.function_arn
    role_arn = aws_iam_role.health_check_scheduler.arn
  }
}

# module.cloudfront_alarm is deliberately NOT called here. Three real,
# isolated terraform apply attempts (bare provider alias; provider alias +
# explicit resource-level region argument; full module isolation with only
# the us-east-1 provider as this module's sole "aws" requirement) all
# failed with the identical AWS-side error ("Invalid region eu-west-1
# specified. Only us-east-1 is supported"), even though every attempt's
# `terraform plan` correctly showed `region = "us-east-1"` beforehand. This
# points to a genuine current limitation in aws_cloudwatch_metric_alarm's
# region/cross-provider handling in hashicorp/aws ~> 6.0 (see
# docs/DECISIONS.md and docs/RISK_REGISTER.md for the full investigation
# and hashicorp/terraform-provider-aws#28971 for prior art on this exact
# resource's region-support gap) — not something more Terraform-side
# retrying will fix. Deferred honestly, not silently dropped: every other
# alarm in infrastructure/modules/observability applies and works
# correctly; only this one CloudFront-specific alarm is missing monitoring
# coverage until the provider gap is resolved or a tracked
# apply-outside-Terraform-then-import exception is deliberately taken.

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

  function_name           = "zoryvex-test-matches-employer-interest"
  handler                 = "handlers/matches-set-employer-interest.handler"
  deployment_package_path = var.matches_employer_interest_deployment_package_path
  route_key               = "POST /roles/{roleId}/matches/{candidateId}/interest"
  api_id                  = module.api_gateway.api_id
  api_execution_arn       = module.api_gateway.execution_arn
  authorized              = true
  authorizer_id           = module.api_gateway.authorizer_id
  log_retention_days      = var.log_retention_days
  dynamodb_table_arn      = module.core_table.table_arn
  # Tells the candidate an employer said yes, so it sends mail. Mirrors the
  # evidence route beside it, which already had this; the interest route
  # never did, because until 2026-09-14 it sent nothing at all.
  ses_identity_arn = local.ses_domain_identity_arn
  environment_variables = {
    TABLE_NAME            = module.core_table.table_name
    APP_ORIGIN            = var.app_origin
    REMINDER_FROM_ADDRESS = var.sign_in_email_from
  }
  tags = var.tags
}

module "candidates_matches_route" {
  source                         = "../../modules/api-route"
  reserved_concurrent_executions = var.lambda_reserved_concurrency

  function_name           = "zoryvex-test-candidates-matches"
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

  function_name           = "zoryvex-test-candidates-interest"
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
