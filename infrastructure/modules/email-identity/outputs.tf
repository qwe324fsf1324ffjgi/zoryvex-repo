output "configuration_set_name" {
  value = aws_ses_configuration_set.this.name
}

output "domain_identity_arn" {
  value = aws_ses_domain_identity.this.arn
}

output "verification_token" {
  description = "TXT record value for the domain identity itself."
  value       = aws_ses_domain_identity.this.verification_token
}

output "dkim_tokens" {
  description = "Three CNAME record names/values, one per DKIM token."
  value       = aws_ses_domain_dkim.this.dkim_tokens
}

# One row per record the exact Vercel-compatible table needs for the SES
# half of Stage A: one TXT (domain verification), three CNAMEs (DKIM), one
# MX + one TXT (MAIL FROM / SPF).
output "dns_records" {
  value = concat(
    [
      {
        type  = "TXT"
        name  = "_amazonses.${var.domain_name}"
        value = aws_ses_domain_identity.this.verification_token
      }
    ],
    [
      for token in aws_ses_domain_dkim.this.dkim_tokens : {
        type  = "CNAME"
        name  = "${token}._domainkey.${var.domain_name}"
        value = "${token}.dkim.amazonses.com"
      }
    ],
    [
      {
        type  = "MX"
        name  = var.mail_from_subdomain
        value = "10 feedback-smtp.${data.aws_region.current.region}.amazonses.com"
      },
      {
        type  = "TXT"
        name  = var.mail_from_subdomain
        value = "v=spf1 include:amazonses.com ~all"
      },
      {
        # Cautious launch DMARC, per Prompt 5: monitor-only (p=none) with
        # reports to the founder's own address, not an enforcing policy —
        # tighten to p=quarantine/p=reject only after reviewing real
        # aggregate reports and confirming SPF/DKIM alignment is clean.
        type  = "TXT"
        name  = "_dmarc.${var.domain_name}"
        value = "v=DMARC1; p=none; rua=mailto:no-reply@${var.domain_name}; adkim=s; aspf=s"
      }
    ]
  )
}
