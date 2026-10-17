resource "aws_s3_bucket" "evidence" {
  bucket = var.bucket_name
  tags   = var.tags
}

resource "aws_s3_bucket_public_access_block" "evidence" {
  bucket = aws_s3_bucket.evidence.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "evidence" {
  bucket = aws_s3_bucket.evidence.id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_versioning" "evidence" {
  bucket = aws_s3_bucket.evidence.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "evidence" {
  bucket = aws_s3_bucket.evidence.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# Presigned POST only. No public access, no unauthenticated origin, no wildcard.
#
# This said PUT, and nothing in the application has ever issued a PUT. The
# server signs a POST (src/repositories/s3-presign-repository.ts calls
# createPresignedPost) and the browser sends a multipart POST with the signed
# fields (apps/web/src/lib/real-api/evidence-files.ts). S3 only attaches
# Access-Control-Allow-Origin to a response whose method is listed here, so
# every browser upload got a response the fetch could not read and failed
# before a byte reached the bucket. That is one CORS line away from every
# file feature in the product: a candidate's photo and every uploaded piece
# of evidence.
#
# No test caught it because none could. Playwright's webServer never sets
# NEXT_PUBLIC_API_BASE_URL (scripts/real-mode-awareness-check.mjs), so the
# whole suite runs against local fakes and the browser-to-S3 hop is not
# exercised anywhere in CI.
#
# PUT is not kept alongside POST. Nothing signs one, and an allowed method
# with no caller is a permission granted for no reason.
resource "aws_s3_bucket_cors_configuration" "evidence" {
  count  = length(var.allowed_upload_origins) > 0 ? 1 : 0
  bucket = aws_s3_bucket.evidence.id

  cors_rule {
    allowed_methods = ["POST"]
    allowed_origins = var.allowed_upload_origins
    allowed_headers = ["content-type", "content-length", "x-amz-*"]
    max_age_seconds = 300
  }
}

# Two prefixes: quarantine/ (unscanned or scan-failed — never readable by the app,
# expires quickly) and accepted/ (GuardDuty-clean, promoted, normal retention).
# See docs/THREAT_MODEL.md "Malicious evidence upload" and docs/PRIVACY_AND_RETENTION.md.
resource "aws_s3_bucket_lifecycle_configuration" "evidence" {
  bucket = aws_s3_bucket.evidence.id

  rule {
    id     = "quarantine-expiry"
    status = "Enabled"

    filter {
      prefix = "quarantine/"
    }

    expiration {
      days = var.quarantine_expiry_days
    }

    noncurrent_version_expiration {
      noncurrent_days = var.quarantine_expiry_days
    }
  }

  rule {
    id     = "accepted-retention"
    status = "Enabled"

    filter {
      prefix = "accepted/"
    }

    expiration {
      days = var.retention_days
    }

    noncurrent_version_expiration {
      noncurrent_days = var.retention_days
    }
  }

  rule {
    id     = "abort-incomplete-multipart-uploads"
    status = "Enabled"

    filter {}

    abort_incomplete_multipart_upload {
      days_after_initiation = 1
    }
  }
}

# On-demand, per-object malware scanning. No fixed idle charge (verified
# 2026-08-18, see docs/SOURCES.md) — cost only accrues per GB scanned above
# the monthly free tier, so this is safe to enable even with zero uploads.
# The app never serves a "quarantine/" object regardless of tag; a clean
# GuardDuty tag is what a later handler checks before promoting an object to
# "accepted/" (fail closed on timeout/error, per docs/THREAT_MODEL.md).
resource "aws_guardduty_malware_protection_plan" "evidence" {
  role = var.guardduty_malware_protection_role_arn
  tags = var.tags

  protected_resource {
    s3_bucket {
      bucket_name     = aws_s3_bucket.evidence.id
      object_prefixes = ["quarantine/"]
    }
  }

  # Required for the GuardDutyMalwareScanStatus tag this module's own docs
  # comment above depends on — without it, scan results exist but are never
  # written back onto the object as something application code can read.
  actions {
    tagging {
      status = "ENABLED"
    }
  }

  lifecycle {
    # References var.guardduty_detector_id so Terraform's dependency graph
    # applies the detector before this plan (see the variable's own
    # description) — this resource has no direct attribute for the
    # detector ID otherwise, since GuardDuty associates by account/region.
    precondition {
      # Null-checked before length(), because length(null) is an error rather
      # than zero and it aborts the plan before this precondition can say
      # anything. Found planning production for the first time: that env
      # declares guardduty_detector_id with a null default, so the plan died
      # on "argument must not be null" instead of the sentence below, which
      # is the one that tells somebody what to actually do.
      condition = var.guardduty_detector_id != null && length(var.guardduty_detector_id) > 0
      # Says where the value actually comes from. It used to say "the
      # bootstrap environment's output", which was checked during the
      # pre-deployment gate and is not true: bootstrap creates the Terraform
      # state bucket and outputs state_bucket_name alone. A detector is one
      # per account per region, and today the only one is the detector the
      # test environment creates.
      error_message = "A GuardDuty detector must exist in this account and region before Malware Protection for S3 can be configured, and guardduty_detector_id must be set to it. A detector is one per account per region, so an environment that does not create its own has to be given the existing one."
    }
  }
}
