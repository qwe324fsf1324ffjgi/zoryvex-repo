# DNS / ACM / SES Runbook — Two-Stage Workflow

`zoryvex.space` was registered with Vercel and Vercel DNS remains authoritative — Terraform never creates
a Route 53 hosted zone, and no Vercel _project_ is ever created (Vercel stays registrar/DNS only, see
`CLAUDE.md`). Every DNS record this project needs is created by hand in the Vercel dashboard, from an exact
table Terraform generates as output. This document is the plan a human follows; it authorizes nothing by
itself — each step below is only ever executed as a real `HUMAN ACTION REQUIRED` at the point a phase
actually needs it, never pre-emptively.

## Why two stages, not one

ACM certificates and SES need to prove domain ownership before they're usable — AWS gives you the DNS
records to add, but can't validate them until they exist and have propagated. Terraform can't `apply` a
distribution or API Gateway custom domain against an unvalidated certificate (the certificate ARN
Terraform would need doesn't behave as "ready" until AWS confirms validation), so the workflow has to
pause in the middle for a human to add records and for DNS/AWS to catch up. Splitting this into two
`terraform apply` runs — Stage A (request/create, never blocks) and Stage B (validate/attach, only after
Stage A's records are live) — keeps every individual `apply` fast and non-hanging, per Prompt 5's own
requirement ("Terraform must never guess or hard-code validation tokens").

## Stage A — request

Applies `infrastructure/envs/bootstrap` (SES domain identity/DKIM/MAIL FROM — an account-level singleton,
see `docs/ARCHITECTURE.md`) and `infrastructure/envs/{test,production}` with every `infrastructure/modules/
acm-cert` module call at its default `validate = false`. Nothing here waits on a DNS record existing.
Outputs: `infrastructure/modules/acm-cert`'s `validation_records`, plus
`infrastructure/envs/bootstrap`'s `ses_dns_records` output (module `email-identity`'s `dns_records`).

**HUMAN ACTION REQUIRED (Stage A, issued once Terraform has actually been applied — not yet)**

```
HUMAN ACTION REQUIRED
Why: ACM/SES need these DNS records to exist before certificates and email sending can be verified.
Click: vercel.com -> zoryvex.space project -> Domains -> DNS Records -> Add Record (repeat per row below)
Choose/type: exact rows from `terraform output` — one CNAME per ACM certificate SAN (4 certs: production
  CloudFront [apex+www], test CloudFront [test], production API [api], test API [test-api]), one TXT for
  SES domain verification, three CNAMEs for DKIM, one MX + one TXT for the MAIL FROM subdomain, one TXT for
  DMARC (p=none, monitor-only at launch)
Expected: every row shows in Vercel's DNS record list exactly as typed, no trailing dot mismatches
Reply: done
```

Then wait — DNS propagation and AWS's own validation polling both take real time (minutes to a few hours,
occasionally longer). Do not proceed to Stage B until `aws acm describe-certificate` (or the AWS Console)
shows `Status: ISSUED` for every certificate, and SES's identity verification status shows `Verified`.

## Stage B — attach

Re-applies the same environments with `validate = true` on every `acm-cert` module call — this adds
`aws_acm_certificate_validation`, which polls until AWS confirms validation (fast once the records are
actually live; this is the step that would hang if run during Stage A). Once validated, the
`validated_certificate_arn` output feeds:

- `infrastructure/modules/static-site`'s `acm_certificate_arn` (the **us-east-1** cert only — CloudFront
  certificates must be in `us-east-1` regardless of the application's primary region).
- `infrastructure/modules/api-gateway`'s `regional_acm_certificate_arn` (the **eu-west-1** cert — API
  Gateway regional custom domains use a same-region certificate, not us-east-1).

Also sets `domain_aliases`, `apex_domain`, `www_domain` (production only), `app_origin`/`www_app_origin`,
and `api_custom_domain_name` on the relevant environment, which is what turns on CORS/CSP for the real
origin and creates the CloudFront distribution's aliases + the API Gateway custom domain mapping.

**HUMAN ACTION REQUIRED (Stage B, issued once Stage A's certificates show ISSUED)**

```
HUMAN ACTION REQUIRED
Why: CloudFront/API Gateway now have real AWS targets; Vercel DNS must point the live hostnames at them.
Click: vercel.com -> zoryvex.space project -> Domains -> DNS Records -> Add Record (repeat per row below)
Choose/type: apex `@` as ALIAS -> production CloudFront distribution domain name (`terraform output
  site_distribution_domain_name`, production); `www` as CNAME -> the same production distribution domain
  name; `test` as CNAME -> the test CloudFront distribution domain name; `api` as CNAME -> production API
  Gateway custom-domain target (`terraform output api_custom_domain_target`, production); `test-api` as
  CNAME -> test API Gateway custom-domain target
Expected: dig/nslookup for zoryvex.space, www.zoryvex.space, test.zoryvex.space, api.zoryvex.space,
  test-api.zoryvex.space each resolve to an amazonaws.com / cloudfront.net target, never a bare IP address
Reply: done
```

After this, and only after a real HTTPS smoke test against the live apex domain passes cleanly, flip
`enable_hsts = true` on the production `static-site` module call in its own separate, reviewed change —
never bundled into the same apply that first turns on the alias, per Prompt 5: "HSTS only after HTTPS is
verified."

## Final DNS shape (Vercel-managed, never AWS-managed)

| Host       | Type  | Target                                              |
| ---------- | ----- | --------------------------------------------------- |
| `@` (apex) | ALIAS | Production CloudFront distribution domain name      |
| `www`      | CNAME | Same production CloudFront distribution domain name |
| `test`     | CNAME | Test CloudFront distribution domain name            |
| `api`      | CNAME | Production API Gateway custom-domain target         |
| `test-api` | CNAME | Test API Gateway custom-domain target               |

CloudFront accepts both the apex and `www` aliases (both are in `domain_aliases`/the certificate's SANs);
the `infrastructure/modules/static-site` CloudFront Function performs the actual `www` -> apex 301 redirect
at the edge, since Vercel DNS alone cannot express "redirect," only "point at."

## Never

- A Route 53 hosted zone, for any reason — Vercel remains the sole DNS authority.
- A Vercel _project_ (only DNS/registrar records are ever added in the Vercel dashboard).
- A CloudFront alias pointed at a bare IP address instead of the distribution's own domain name.
- Terraform guessing or hard-coding a validation token, DKIM token, or any other AWS-generated value — every
  value in the tables above comes only from a real `terraform output` after a real `apply`.
