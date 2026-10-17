# GitHub Actions OIDC deploy role. No AWS access key of any kind is ever
# generated for CI (CLAUDE.md: "no IAM users, no static AWS keys"). Scoped
# to exactly one environment's resource-name prefix — see
# infrastructure/envs/bootstrap for why test and production get separate
# roles/trust conditions rather than one shared role.
#
# This policy is a genuine least-privilege attempt, not a rubber-stamped
# wildcard — but like any hand-written IAM policy written before a real
# apply exists to test against, it may need one follow-up tightening or
# widening pass once a real `terraform plan`/`apply` surfaces a concrete
# AccessDenied. Document any such change in docs/DECISIONS.md when it
# happens; never respond to an AccessDenied by attaching a broad managed
# policy as a shortcut.

data "aws_iam_policy_document" "assume_role" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [var.oidc_provider_arn]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values   = [var.subject_claim]
    }
  }
}

resource "aws_iam_role" "this" {
  name                 = "zoryvex-${var.environment_name}-deploy"
  assume_role_policy   = data.aws_iam_policy_document.assume_role.json
  max_session_duration = 3600
  tags                 = var.tags
}

locals {
  name_prefix    = "zoryvex-${var.environment_name}"
  s3_bucket_arns = ["arn:aws:s3:::${local.name_prefix}-*"]
  s3_object_arns = ["arn:aws:s3:::${local.name_prefix}-*/*"]
  lambda_arns    = ["arn:aws:lambda:${var.aws_region}:${var.account_id}:function:${local.name_prefix}-*"]
  # Event source mapping IDs are AWS-assigned UUIDs, not name-prefixable
  # like every other resource in this file — scoped to this account+region
  # only, matching every event-source-mapping ARN this project has ever
  # seen (there is no per-environment namespace for them the way Lambda
  # functions/SQS queues/etc. get one from their own name).
  event_source_mapping_arns = ["arn:aws:lambda:${var.aws_region}:${var.account_id}:event-source-mapping:*"]
  dynamodb_arns             = ["arn:aws:dynamodb:${var.aws_region}:${var.account_id}:table/${local.name_prefix}-*"]
  sqs_arns                  = ["arn:aws:sqs:${var.aws_region}:${var.account_id}:${local.name_prefix}-*"]
  log_group_arns            = ["arn:aws:logs:${var.aws_region}:${var.account_id}:log-group:/aws/lambda/${local.name_prefix}-*", "arn:aws:logs:${var.aws_region}:${var.account_id}:log-group:/aws/apigateway/${local.name_prefix}-*"]
  alarm_arns                = ["arn:aws:cloudwatch:${var.aws_region}:${var.account_id}:alarm:zoryvex-${var.environment_name}-*"]
  sns_arns                  = ["arn:aws:sns:${var.aws_region}:${var.account_id}:zoryvex-${var.environment_name}-*"]
  iam_role_arns             = ["arn:aws:iam::${var.account_id}:role/${local.name_prefix}-*"]
  ssm_param_arns            = ["arn:aws:ssm:${var.aws_region}:${var.account_id}:parameter/zoryvex/${var.environment_name}/*"]
  event_rule_arns           = ["arn:aws:events:${var.aws_region}:${var.account_id}:rule/${local.name_prefix}-*"]
  # EventBridge Scheduler always uses the account's built-in "default"
  # schedule group (this project never creates a custom group) — see
  # infrastructure/envs/test/main.tf's aws_scheduler_schedule resources.
  scheduler_arns = ["arn:aws:scheduler:${var.aws_region}:${var.account_id}:schedule/default/${local.name_prefix}-*"]
  # Single non-secret parameter this role is allowed to actually read the
  # value of — never the whole /zoryvex/<environment>/* namespace (which
  # would also cover the SecureString paths test-secrets isolates this role
  # from). "feature-flags" matches the one fixed literal name every
  # environment's aws_ssm_parameter.feature_flags resource uses.
  feature_flags_param_arn = "arn:aws:ssm:${var.aws_region}:${var.account_id}:parameter/zoryvex/${var.environment_name}/feature-flags"
  # scripts/rollback.mjs's last-known-good marker. A git sha, not a secret,
  # which is why it is a plain String and why reading it does not reopen the
  # SecureString boundary above — this stays a list of exact literal names,
  # never the /zoryvex/<environment>/* namespace. PutParameter on it is
  # already covered by SsmParameterMetadataOnly's namespace-scoped write.
  last_good_commit_param_arn = "arn:aws:ssm:${var.aws_region}:${var.account_id}:parameter/zoryvex/${var.environment_name}/last-good-commit"
  # The six Paystack plan codes, as a JSON object of PLN_ identifiers.
  #
  # Terraform manages this parameter, so every plan reads it, and without
  # this the deploy fails at plan with AccessDenied before it changes
  # anything. That is exactly what happened on the first CI deploy after
  # billing landed (2026-09-01): the parameter was added to the environment
  # and never to this list.
  #
  # A plan code is a public identifier, not a credential. It appears in a
  # Paystack dashboard and in the body of a transaction-initialize call, and
  # knowing one grants nothing. It belongs on this list for the same reason
  # the two above do, and the Paystack SECRET KEY lives under the same
  # /zoryvex/<environment>/ prefix and must stay off it — which is the whole
  # reason this is a list of exact literal names rather than a namespace.
  plan_codes_param_arn = "arn:aws:ssm:${var.aws_region}:${var.account_id}:parameter/zoryvex/${var.environment_name}/paystack/plan-codes"
}

data "aws_iam_policy_document" "deploy_permissions" {
  statement {
    sid    = "S3BucketLifecycleAndConfig"
    effect = "Allow"
    actions = [
      "s3:CreateBucket", "s3:DeleteBucket", "s3:GetBucketLocation", "s3:GetBucketVersioning",
      "s3:PutBucketVersioning", "s3:GetBucketPolicy", "s3:PutBucketPolicy", "s3:DeleteBucketPolicy",
      "s3:GetBucketTagging", "s3:PutBucketTagging", "s3:GetEncryptionConfiguration", "s3:PutEncryptionConfiguration",
      "s3:GetBucketPublicAccessBlock", "s3:PutBucketPublicAccessBlock", "s3:GetBucketOwnershipControls",
      "s3:PutBucketOwnershipControls", "s3:GetLifecycleConfiguration", "s3:PutLifecycleConfiguration",
      "s3:GetBucketCORS", "s3:PutBucketCORS", "s3:GetBucketNotification", "s3:PutBucketNotification",
      "s3:ListBucket", "s3:ListBucketVersions",
      # Read-only bucket-attribute calls Terraform's S3 provider makes on
      # every refresh regardless of whether the feature is actually used —
      # confirmed via a real AccessDenied (GetBucketAcl) plus a full
      # CloudTrail audit of an admin-session plan (Phase 7 slice 9).
      "s3:GetBucketAcl", "s3:GetAccelerateConfiguration", "s3:GetBucketLogging",
      "s3:GetBucketObjectLockConfiguration", "s3:GetReplicationConfiguration",
      "s3:GetBucketRequestPayment", "s3:GetBucketWebsite",
    ]
    resources = local.s3_bucket_arns
  }

  statement {
    sid       = "S3ObjectDeploy"
    effect    = "Allow"
    actions   = ["s3:PutObject", "s3:GetObject", "s3:DeleteObject", "s3:GetObjectVersion", "s3:DeleteObjectVersion"]
    resources = local.s3_object_arns
  }

  statement {
    sid    = "CloudFrontManage"
    effect = "Allow"
    actions = [
      "cloudfront:CreateDistribution", "cloudfront:UpdateDistribution", "cloudfront:DeleteDistribution",
      "cloudfront:GetDistribution", "cloudfront:GetDistributionConfig", "cloudfront:ListDistributions",
      "cloudfront:TagResource", "cloudfront:UntagResource", "cloudfront:ListTagsForResource",
      "cloudfront:CreateOriginAccessControl", "cloudfront:GetOriginAccessControl", "cloudfront:UpdateOriginAccessControl", "cloudfront:DeleteOriginAccessControl",
      "cloudfront:CreateFunction", "cloudfront:UpdateFunction", "cloudfront:DeleteFunction", "cloudfront:DescribeFunction", "cloudfront:PublishFunction",
      "cloudfront:CreateCachePolicy", "cloudfront:UpdateCachePolicy", "cloudfront:DeleteCachePolicy", "cloudfront:GetCachePolicy",
      "cloudfront:CreateResponseHeadersPolicy", "cloudfront:UpdateResponseHeadersPolicy", "cloudfront:DeleteResponseHeadersPolicy", "cloudfront:GetResponseHeadersPolicy",
      "cloudfront:CreateInvalidation", "cloudfront:GetInvalidation",
      # GetFunction (the function's actual code, distinct from
      # DescribeFunction's metadata-only read) and ListCachePolicies —
      # confirmed missing via a real AccessDenied (Phase 7 slice 9).
      "cloudfront:GetFunction", "cloudfront:ListCachePolicies",
    ]
    # CloudFront's console/API do not support per-distribution ARN scoping
    # for every one of these calls (e.g. ListDistributions is inherently
    # account-wide) — resource-level restriction is not available for this
    # service the way it is for S3/DynamoDB/Lambda.
    resources = ["*"]
  }

  statement {
    sid    = "ApiGatewayManage"
    effect = "Allow"
    # Explicit actions, not apigateway:* — the HTTP API surface this project
    # actually uses (infrastructure/modules/api): api/stage/route/
    # integration/authorizer CRUD, custom domain + mapping CRUD, tagging.
    actions = [
      "apigateway:GET", "apigateway:POST", "apigateway:PUT", "apigateway:PATCH", "apigateway:DELETE",
      "apigateway:TagResource", "apigateway:UntagResource",
    ]
    resources = [
      "arn:aws:apigateway:${var.aws_region}::/apis",
      "arn:aws:apigateway:${var.aws_region}::/apis/*",
      "arn:aws:apigateway:${var.aws_region}::/domainnames",
      "arn:aws:apigateway:${var.aws_region}::/domainnames/*",
      "arn:aws:apigateway:${var.aws_region}::/tags/*",
    ]
  }

  statement {
    sid    = "LambdaManage"
    effect = "Allow"
    actions = [
      "lambda:CreateFunction", "lambda:UpdateFunctionCode", "lambda:UpdateFunctionConfiguration",
      "lambda:DeleteFunction", "lambda:GetFunction", "lambda:GetFunctionConfiguration", "lambda:ListVersionsByFunction",
      "lambda:TagResource", "lambda:UntagResource", "lambda:ListTags",
      "lambda:AddPermission", "lambda:RemovePermission", "lambda:GetPolicy",
      "lambda:PutFunctionConcurrency", "lambda:DeleteFunctionConcurrency", "lambda:GetFunctionConcurrency",
      # Confirmed missing via full CloudTrail audit (Phase 7 slice 9):
      # GetFunctionCodeSigningConfig is scoped by function ARN, same as
      # everything else in this statement. GetEventSourceMapping is NOT —
      # see LambdaGetEventSourceMappingAccountWide below.
      "lambda:GetFunctionCodeSigningConfig",
    ]
    resources = local.lambda_arns
  }

  statement {
    sid    = "LambdaEventSourceMappingManage"
    effect = "Allow"
    # A real AccessDenied (Phase 7 slice 9, first live-permissions
    # deploy-test run) revealed GetEventSourceMapping is authorized
    # against the event source mapping's own ARN
    # (event-source-mapping:<AWS-assigned-UUID>), not the triggering
    # function's ARN — the LambdaManage grant above never actually
    # covered it despite looking scoped. A follow-up run then hit the
    # same gap for ListTags/TagResource/UntagResource (proactively
    # verified via the IAM Policy Simulator before either surfaced for
    # real, to avoid a third round-trip). Confirmed via the simulator
    # that Get/Update/Delete/ListTags/TagResource/UntagResource all
    # authorize correctly scoped to this account+region's
    # event-source-mapping namespace — a real narrowing from the
    # Resource="*" this statement started as, not just a renamed
    # wildcard.
    #
    # CreateEventSourceMapping is deliberately NOT included here: the
    # simulator confirms AWS requires Resource="*" for it specifically
    # (tested against both the event-source-mapping and the target
    # function's own ARN — both implicitDeny), and nothing has ever
    # needed this role to create one — both of this environment's
    # mappings were created by the founder's local session. Add it,
    # scoped no better than "*", only once a real need (and AccessDenied)
    # actually surfaces, per this file's own header rule against
    # pre-emptive widening.
    #
    # ListTags/TagResource/UntagResource are also kept in LambdaManage
    # above (function-scoped) — Lambda functions need the same action
    # names for their own tags; this statement covers the event source
    # mapping resource class only, deliberately not deduplicated across
    # the two different resource types.
    actions = [
      "lambda:GetEventSourceMapping", "lambda:UpdateEventSourceMapping", "lambda:DeleteEventSourceMapping",
      "lambda:ListTags", "lambda:TagResource", "lambda:UntagResource",
    ]
    resources = local.event_source_mapping_arns
  }

  statement {
    sid    = "DynamoDbManage"
    effect = "Allow"
    actions = [
      "dynamodb:CreateTable", "dynamodb:UpdateTable", "dynamodb:DeleteTable", "dynamodb:DescribeTable",
      "dynamodb:DescribeTimeToLive", "dynamodb:UpdateTimeToLive", "dynamodb:DescribeContinuousBackups",
      "dynamodb:UpdateContinuousBackups", "dynamodb:TagResource", "dynamodb:UntagResource", "dynamodb:ListTagsOfResource",
    ]
    resources = local.dynamodb_arns
  }

  statement {
    sid    = "SqsManage"
    effect = "Allow"
    actions = [
      "sqs:CreateQueue", "sqs:DeleteQueue", "sqs:GetQueueAttributes", "sqs:SetQueueAttributes",
      "sqs:TagQueue", "sqs:UntagQueue", "sqs:ListQueueTags",
    ]
    resources = local.sqs_arns
  }

  statement {
    sid    = "LogsAndAlarms"
    effect = "Allow"
    actions = [
      "logs:CreateLogGroup", "logs:DeleteLogGroup", "logs:PutRetentionPolicy",
      "logs:TagResource", "logs:UntagResource", "logs:PutMetricFilter", "logs:DeleteMetricFilter", "logs:DescribeMetricFilters",
      "cloudwatch:PutMetricAlarm", "cloudwatch:DeleteAlarms", "cloudwatch:DescribeAlarms",
      # Read counterparts of TagResource/UntagResource above — confirmed
      # missing via full CloudTrail audit (Phase 7 slice 9).
      "logs:ListTagsForResource", "cloudwatch:ListTagsForResource",
    ]
    resources = concat(local.log_group_arns, local.alarm_arns)
  }

  statement {
    sid    = "LogsDescribeLogGroupsAccountWide"
    effect = "Allow"
    # DescribeLogGroups is a list/enumerate action — confirmed via a real
    # AccessDenied (Phase 7 slice 9) that AWS evaluates it against a fixed
    # placeholder resource, not a per-log-group ARN, so name-prefix scoping
    # (used for every other logs: action above) does not apply here, the
    # same category as CloudFront's ListDistributions below.
    actions   = ["logs:DescribeLogGroups"]
    resources = ["*"]
  }

  statement {
    sid    = "EventBridgeRuleManage"
    effect = "Allow"
    actions = [
      "events:PutRule", "events:DeleteRule", "events:DescribeRule",
      "events:PutTargets", "events:RemoveTargets", "events:ListTargetsByRule",
      "events:TagResource", "events:UntagResource",
      # Read counterpart of TagResource/UntagResource — confirmed missing
      # via full CloudTrail audit (Phase 7 slice 9).
      "events:ListTagsForResource",
    ]
    resources = local.event_rule_arns
  }

  statement {
    sid       = "GuardDutyDetectorReadOnly"
    effect    = "Allow"
    actions   = ["guardduty:GetDetector"]
    resources = [var.guardduty_detector_arn]
  }

  statement {
    sid     = "SsmGetOwnNonSecretParametersOnly"
    effect  = "Allow"
    actions = ["ssm:GetParameter"]
    resources = [
      local.feature_flags_param_arn,
      local.last_good_commit_param_arn,
      local.plan_codes_param_arn,
    ]
  }

  statement {
    sid    = "SnsManage"
    effect = "Allow"
    # GetSubscriptionAttributes and ListTagsForResource confirmed missing
    # via full CloudTrail audit (Phase 7 slice 9).
    actions   = ["sns:CreateTopic", "sns:DeleteTopic", "sns:GetTopicAttributes", "sns:SetTopicAttributes", "sns:Subscribe", "sns:Unsubscribe", "sns:ListSubscriptionsByTopic", "sns:TagResource", "sns:UntagResource", "sns:GetSubscriptionAttributes", "sns:ListTagsForResource"]
    resources = local.sns_arns
  }

  statement {
    sid     = "AcmManageAndDescribe"
    effect  = "Allow"
    actions = ["acm:RequestCertificate", "acm:DeleteCertificate", "acm:DescribeCertificate", "acm:ListTagsForCertificate", "acm:AddTagsToCertificate"]
    # ACM certificates are not name-prefixable the way S3/DynamoDB are; this
    # role can only describe/manage certs it itself requested (ACM does not
    # support resource-level restriction on RequestCertificate), so the
    # blast radius is bounded by what this role actually creates, not by
    # the IAM Resource clause.
    resources = ["*"]
  }

  statement {
    sid    = "SesReadOnly"
    effect = "Allow"
    # SES domain identity/DKIM/MAIL FROM are bootstrap-managed singletons
    # (infrastructure/envs/bootstrap), not per-environment — this role only
    # ever needs to read that state (e.g. to reference the configuration
    # set name), never create/delete it.
    actions   = ["ses:GetIdentityVerificationAttributes", "ses:GetIdentityDkimAttributes", "ses:GetIdentityMailFromDomainAttributes", "ses:ListConfigurationSets", "ses:DescribeConfigurationSet"]
    resources = ["*"]
  }

  statement {
    sid    = "GuardDutyAssociateOnly"
    effect = "Allow"
    # Detector creation is bootstrap-only (one per account/region — see
    # infrastructure/envs/bootstrap). This role only ever associates this
    # environment's evidence bucket with the existing detector.
    # ListTagsForResource confirmed missing via full CloudTrail audit
    # (Phase 7 slice 9).
    actions   = ["guardduty:CreateMalwareProtectionPlan", "guardduty:UpdateMalwareProtectionPlan", "guardduty:DeleteMalwareProtectionPlan", "guardduty:GetMalwareProtectionPlan", "guardduty:ListMalwareProtectionPlans", "guardduty:TagResource", "guardduty:UntagResource", "guardduty:ListTagsForResource"]
    resources = ["*"]
  }

  statement {
    sid    = "SsmParameterMetadataOnly"
    effect = "Allow"
    # Creates/describes the parameter *resource* only — never reads a
    # SecureString value (no ssm:GetParameter here). The real secret is
    # entered by the founder through the Console after apply, per
    # CLAUDE.md. ListTagsForResource is safe to scope the same as the rest
    # of this statement — it returns only tag key/value pairs, never a
    # parameter's Value, so it doesn't reopen the SecureString-value
    # boundary the separate SsmFeatureFlagsGetOwnParameterOnly statement
    # exists to avoid. DescribeParameters is NOT scoped here — see
    # SsmDescribeParametersAccountWide below.
    actions   = ["ssm:PutParameter", "ssm:AddTagsToResource", "ssm:RemoveTagsFromResource", "ssm:DeleteParameter", "ssm:ListTagsForResource"]
    resources = local.ssm_param_arns
  }

  statement {
    sid    = "SsmDescribeParametersAccountWide"
    effect = "Allow"
    # A real AccessDenied (Phase 7 slice 9, first live-permissions
    # deploy-test run) revealed AWS evaluates this specific action against
    # the account-wide pseudo-resource arn:...:ssm:region:account:*, not a
    # per-parameter ARN — the ssm_param_arns-scoped grant above never
    # actually covered it, the same "list/enumerate action forced to
    # Resource=*" category as LogsDescribeLogGroupsAccountWide. Safe: this
    # action lists parameter *names*/metadata only, never a Value — it
    # cannot read the isolated SecureString values either.
    actions   = ["ssm:DescribeParameters"]
    resources = ["*"]
  }

  # EventBridge Scheduler — no statement existed for this at all until a
  # full CloudTrail audit (Phase 7 slice 9) found scheduler:GetSchedule
  # denied refreshing aws_scheduler_schedule.health_check. Full CRUD
  # granted (not just the one action that had already surfaced), matching
  # every other "Manage" statement in this module.
  statement {
    sid    = "SchedulerManage"
    effect = "Allow"
    actions = [
      "scheduler:CreateSchedule", "scheduler:UpdateSchedule", "scheduler:DeleteSchedule",
      "scheduler:GetSchedule", "scheduler:TagResource", "scheduler:UntagResource", "scheduler:ListTagsForResource",
    ]
    resources = local.scheduler_arns
  }

  # KMS — no statement existed for this at all until the same CloudTrail
  # audit found aws_lambda_function refresh (GetFunctionConfiguration)
  # triggers AWS Lambda to decrypt each function's environment variables
  # server-side, and aws_dynamodb_table refresh calls kms:DescribeKey —
  # both against the account's own default AWS-managed keys (this project
  # never configures a customer-managed KMS key for either). Key ARNs are
  # random per account (like the GuardDuty detector), not deterministic,
  # so they're resolved via data "aws_kms_key" in the calling root and
  # passed in — confirmed via the IAM Policy Simulator that the alias ARN
  # form does NOT satisfy these actions, only the real key ARN does.
  statement {
    sid       = "KmsDecryptLambdaEnvVarsOnly"
    effect    = "Allow"
    actions   = ["kms:Decrypt"]
    resources = [var.lambda_default_kms_key_arn]
  }

  statement {
    sid       = "KmsDescribeDefaultKeysReadOnly"
    effect    = "Allow"
    actions   = ["kms:DescribeKey"]
    resources = [var.lambda_default_kms_key_arn, var.dynamodb_default_kms_key_arn]
  }

  statement {
    sid       = "PassLambdaExecRolesOnly"
    effect    = "Allow"
    actions   = ["iam:CreateRole", "iam:DeleteRole", "iam:GetRole", "iam:TagRole", "iam:UntagRole", "iam:PutRolePolicy", "iam:DeleteRolePolicy", "iam:GetRolePolicy", "iam:AttachRolePolicy", "iam:DetachRolePolicy", "iam:ListAttachedRolePolicies", "iam:ListRolePolicies"]
    resources = local.iam_role_arns
  }

  statement {
    # Lambda and EventBridge Scheduler only. Still scoped to this
    # environment's own role ARNs, and still refusing every other service.
    #
    # scheduler.amazonaws.com was added 2026-08-27, before it could break a
    # deploy rather than after. Creating an aws_scheduler_schedule whose
    # target names a role requires PassRole to the scheduler service, and
    # this role could only pass to Lambda. The one existing schedule
    # (health_check) never exposed the gap because CI has only ever
    # refreshed it — it was created by a founder-run local apply, back when
    # this role had no scheduler permissions at all. The first schedule CI
    # actually creates is modules/scheduled-job's, and it would have failed
    # with AccessDenied on the first run after the Actions budget reset.
    sid       = "PassRoleToLambdaAndSchedulerOnly"
    effect    = "Allow"
    actions   = ["iam:PassRole"]
    resources = local.iam_role_arns

    condition {
      test     = "StringEquals"
      variable = "iam:PassedToService"
      values   = ["lambda.amazonaws.com", "scheduler.amazonaws.com"]
    }
  }

  # Terraform-backend access — Phase 7 slice 9. Scoped to exactly this
  # environment's state-object and S3-native-lock-object keys within the
  # shared state bucket (infrastructure/envs/bootstrap), never the whole
  # bucket and never another environment's key — bootstrap/foundation/
  # production's state stays unreachable from this role. Lock mechanism
  # confirmed live against Terraform's own S3-backend docs: use_lockfile
  # creates a separate `<key>.tflock` object, not a conditional write on
  # the state object itself.
  statement {
    sid       = "TerraformBackendListOwnPrefixOnly"
    effect    = "Allow"
    actions   = ["s3:ListBucket"]
    resources = [var.state_bucket_arn]

    condition {
      test     = "StringLike"
      variable = "s3:prefix"
      values   = ["${var.environment_name}/*"]
    }
  }

  statement {
    sid       = "TerraformBackendStateObject"
    effect    = "Allow"
    actions   = ["s3:GetObject", "s3:PutObject"]
    resources = ["${var.state_bucket_arn}/${var.environment_name}/terraform.tfstate"]
  }

  statement {
    sid       = "TerraformBackendLockObject"
    effect    = "Allow"
    actions   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
    resources = ["${var.state_bucket_arn}/${var.environment_name}/terraform.tfstate.tflock"]
  }

  # Defense in depth: even if a statement above is ever widened by mistake,
  # this role can never touch IAM users/access keys, another environment's
  # namespace, or account/organization-level settings.
  statement {
    sid    = "ExplicitDenyDangerousActions"
    effect = "Deny"
    actions = [
      "iam:CreateUser", "iam:CreateAccessKey", "iam:AttachUserPolicy", "iam:CreatePolicy",
      "organizations:*", "account:*", "iam:CreateAccountAlias", "iam:DeleteAccountAlias",
      "guardduty:CreateDetector", "guardduty:DeleteDetector",
    ]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "deploy_permissions" {
  name   = "zoryvex-${var.environment_name}-deploy-permissions"
  role   = aws_iam_role.this.id
  policy = data.aws_iam_policy_document.deploy_permissions.json
}
