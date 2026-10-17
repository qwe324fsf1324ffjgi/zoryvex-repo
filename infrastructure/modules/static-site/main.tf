resource "aws_s3_bucket" "site" {
  bucket = var.bucket_name
  tags   = var.tags
}

resource "aws_s3_bucket_public_access_block" "site" {
  bucket = aws_s3_bucket.site.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "site" {
  bucket = aws_s3_bucket.site.id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "site" {
  bucket = aws_s3_bucket.site.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_cloudfront_origin_access_control" "site" {
  name                              = "${var.bucket_name}-oac"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_cloudfront_function" "route_rewrite" {
  name    = "${var.bucket_name}-route-rewrite"
  runtime = "cloudfront-js-2.0"
  comment = "Extensionless static-export route rewrite + apex/www redirect"
  publish = true
  code = templatefile("${path.module}/cloudfront-function.js.tftpl", {
    www_domain  = var.www_domain
    apex_domain = var.apex_domain
  })
}

data "aws_cloudfront_cache_policy" "caching_optimized" {
  name = "Managed-CachingOptimized"
}

# The default policy for this distribution. HTML is not content-hashed by
# Next.js static export, unlike _next/static/*, so a long TTL means a stale
# page can survive a deploy for the managed policy's full default (~24h).
#
# This was originally attached to an ordered behaviour matching "*.html",
# with CachingOptimized left as the default — which looked right and served
# almost no real traffic. CloudFront selects a cache behaviour by matching
# the path pattern against the URI *as the browser requested it*, before any
# viewer-request function runs (AWS: "Modifying the path in a viewer request
# function does not change which Cache Behavior will actually service the
# request"). This export uses trailingSlash: false, so a visitor asks for
# "/pricing" and the function below rewrites it to "/pricing.html"
# afterwards. "/pricing" never matched "*.html", so every page anyone
# actually requested was served under the 24-hour policy. Confirmed against
# the live distribution, which had exactly that arrangement.
#
# Short by default is also the safer shape on its own terms: anything new
# that falls through gets a cache that is merely less efficient rather than
# a cache that is wrong.
resource "aws_cloudfront_cache_policy" "html_short_ttl" {
  name        = "${var.bucket_name}-html-short-ttl"
  min_ttl     = 0
  default_ttl = var.html_cache_ttl_seconds
  max_ttl     = var.html_cache_ttl_seconds * 5

  parameters_in_cache_key_and_forwarded_to_origin {
    cookies_config {
      cookie_behavior = "none"
    }
    headers_config {
      header_behavior = "none"
    }
    query_strings_config {
      query_string_behavior = "none"
    }
    enable_accept_encoding_brotli = true
    enable_accept_encoding_gzip   = true
  }
}

resource "aws_cloudfront_response_headers_policy" "security_headers" {
  name = "${var.bucket_name}-security-headers"

  security_headers_config {
    content_type_options {
      override = true
    }

    frame_options {
      frame_option = "DENY"
      override     = true
    }

    referrer_policy {
      referrer_policy = "strict-origin-when-cross-origin"
      override        = true
    }

    xss_protection {
      protection = true
      mode_block = true
      override   = true
    }

    dynamic "strict_transport_security" {
      for_each = var.enable_hsts ? [1] : []
      content {
        access_control_max_age_sec = 31536000
        include_subdomains         = true
        preload                    = false # revisit once HSTS has run cleanly for a while — preload is effectively irreversible.
        override                   = true
      }
    }

    content_security_policy {
      # script-src 'unsafe-inline' is gated behind var.allow_inline_scripts
      # (default false, strict) — confirmed live via real Phase 7 slice 11
      # browser testing that Next.js's static-export output ships required
      # inline hydration scripts that a bare 'self' blocks, breaking client
      # hydration on every page, not just one. Never 'unsafe-eval' here —
      # Next.js's own docs confirm eval is dev-only, never needed in prod.
      content_security_policy = join("; ", compact([
        "default-src 'self'",
        var.allow_inline_scripts ? "script-src 'self' 'unsafe-inline'" : "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data:",
        "font-src 'self'",
        var.api_origin != "" ? "connect-src 'self' ${var.api_origin}" : "connect-src 'self'",
        "frame-ancestors 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "object-src 'none'",
      ]))
      override = true
    }
  }

  custom_headers_config {
    items {
      header   = "Permissions-Policy"
      value    = "camera=(), microphone=(), geolocation=(), interest-cohort=()"
      override = true
    }
  }
}

resource "aws_cloudfront_distribution" "site" {
  enabled             = true
  is_ipv6_enabled     = true
  default_root_object = "index.html"
  price_class         = var.price_class
  aliases             = var.domain_aliases
  tags                = var.tags

  origin {
    domain_name              = aws_s3_bucket.site.bucket_regional_domain_name
    origin_id                = aws_s3_bucket.site.id
    origin_access_control_id = aws_cloudfront_origin_access_control.site.id
  }

  default_cache_behavior {
    allowed_methods            = ["GET", "HEAD"]
    cached_methods             = ["GET", "HEAD"]
    target_origin_id           = aws_s3_bucket.site.id
    viewer_protocol_policy     = "redirect-to-https"
    compress                   = true
    cache_policy_id            = aws_cloudfront_cache_policy.html_short_ttl.id
    response_headers_policy_id = aws_cloudfront_response_headers_policy.security_headers.id

    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.route_rewrite.arn
    }
  }

  # The one thing that genuinely earns a long TTL. Next.js puts a content
  # hash in every filename under this prefix, so the URL changes whenever the
  # bytes do and a year-long cache can never serve a stale one. This is also
  # where the bandwidth is, so caching it hard is most of the benefit the
  # long-TTL policy was there for in the first place.
  #
  # Unlike the "*.html" behaviour this replaces, the pattern matches the URI
  # the browser actually sends: these are real file paths in the HTML, never
  # rewritten by the function.
  ordered_cache_behavior {
    path_pattern               = "/_next/static/*"
    allowed_methods            = ["GET", "HEAD"]
    cached_methods             = ["GET", "HEAD"]
    target_origin_id           = aws_s3_bucket.site.id
    viewer_protocol_policy     = "redirect-to-https"
    compress                   = true
    cache_policy_id            = data.aws_cloudfront_cache_policy.caching_optimized.id
    response_headers_policy_id = aws_cloudfront_response_headers_policy.security_headers.id

    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.route_rewrite.arn
    }
  }

  # Private OAC bucket returns 403 (no ListBucket permission granted) for a
  # missing key, not 404 — both must map to the same not-found page, or a
  # missing route would render as an unstyled raw AWS error instead of the
  # app's real 404.
  custom_error_response {
    error_code         = 403
    response_code      = 404
    response_page_path = "/404.html"
  }

  custom_error_response {
    error_code         = 404
    response_code      = 404
    response_page_path = "/404.html"
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = length(var.domain_aliases) == 0
    acm_certificate_arn            = length(var.domain_aliases) == 0 ? null : var.acm_certificate_arn
    ssl_support_method             = length(var.domain_aliases) == 0 ? null : "sni-only"
    minimum_protocol_version       = length(var.domain_aliases) == 0 ? null : "TLSv1.2_2021"
  }

  lifecycle {
    # Aliases without a certificate is a plan that succeeds and an apply that
    # fails, which is the worst shape a mistake can take here.
    #
    # With domain_aliases set and acm_certificate_arn null, the block above
    # renders cloudfront_default_certificate = false and no certificate at
    # all. Terraform is satisfied; CloudFront refuses it. Caught during the
    # pre-deployment gate by reading a plan that looked clean, and it matters
    # because a founder with one production deployment would have spent it
    # discovering this.
    #
    # An empty string is checked as well as null: a tfvars line left as ""
    # while somebody waits for a certificate to be issued is the likely way
    # to arrive here.
    precondition {
      condition = length(var.domain_aliases) == 0 || (
        var.acm_certificate_arn != null && var.acm_certificate_arn != ""
      )
      error_message = "domain_aliases is set, so this distribution needs acm_certificate_arn. A certificate must already be issued in us-east-1 and cover every alias. Leave domain_aliases empty to serve on the CloudFront default domain instead."
    }
  }
}

data "aws_iam_policy_document" "site_oac_read" {
  statement {
    sid     = "AllowCloudFrontServicePrincipalReadOnly"
    effect  = "Allow"
    actions = ["s3:GetObject"]

    resources = ["${aws_s3_bucket.site.arn}/*"]

    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.site.arn]
    }
  }
}

resource "aws_s3_bucket_policy" "site" {
  bucket = aws_s3_bucket.site.id
  policy = data.aws_iam_policy_document.site_oac_read.json
}
