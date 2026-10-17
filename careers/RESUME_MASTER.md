# Résumé — master content

This is the source of truth. The DOCX and PDF are generated from it by
`careers/build_resume.py`.

**Every `[PLACEHOLDER]` must be replaced with something true before sending.**

## ATS rules this document follows

Applicant tracking systems parse plain, linear documents. The generated files
therefore have:

- One column. No tables, no text boxes, no headers or footers, no sidebars
- No images, no icons, no logos, no charts
- Standard fonts only (Helvetica/Arial equivalents)
- Section headings from the conventional vocabulary: Summary, Experience,
  Skills, Education, Certifications
- Dates as `MMM YYYY` on the same line as the role
- Bullets as plain hyphens
- Contact details as plain text in the body, never in a header

Anything prettier than this parses worse. That is the trade, and for a first
filter the trade is worth making.

---

## Header

```
[FULL NAME]
[CITY, COUNTRY] · [EMAIL] · [PHONE] · linkedin.com/in/[HANDLE] · github.com/[HANDLE]
```

---

## Summary

> Technical product owner. Specified, architected and shipped Zoryvex, a live
> proof-first hiring platform on AWS serverless: 55 Lambda functions, 51 API
> routes, single-table DynamoDB, Terraform-managed infrastructure, live
> payments. Built and operated solo. Decisions documented in six architecture
> decision records, including two that removed shipped features because they
> could not be verified honestly.

Three sentences. No adjectives about myself. Every noun is checkable.

---

## Experience

### Founder and Technical Product Owner · Zoryvex · Aug 2026 – Present

- Specified and shipped a live hiring platform verifying candidate claims
  against third-party sources: 55 AWS Lambda functions across 51 API routes,
  44 behind a fail-closed authorizer, backed by single-table DynamoDB
- Directed all architecture decisions and recorded them in six ADRs, including
  rejecting Amazon Cognito for passwordless email auth with opaque server-side
  sessions, and choosing static export on CloudFront with origin access
  control over any always-on compute
- Retired a shipped verification method after determining a language model
  could pass it from the published brief, accepting reduced product scope for
  a defensible claim
- Removed two further evidence paths, file upload and peer confirmation, on
  the principle that a source the candidate controls or selects is not
  independent verification
- Integrated Paystack with HMAC-SHA512 webhook verification, payload-hash
  deduplication and hourly reconciliation; proved forgery rejection, signature
  acceptance and replay deduplication against the live account
- Diagnosed eleven consecutive live payment failures to gateway evidence:
  eight abandonments and three test cards presented to a live account.
  Concluded no product defect and changed nothing
- Built deployment safety after shipping a demo build to production: the
  release process now refuses to build without an https API URL from Terraform
  output, refuses to upload if a demo marker is present, and smoke-tests the
  deployed commit
- Enforced cost control by design: reserved concurrency on all 55 functions,
  on-demand DynamoDB, no NAT Gateway, no always-on compute, feature flags read
  per invocation for sub-minute mitigation without a deploy
- Established data-minimisation boundaries: stated minimum pay never leaves
  the candidate record, contact details released only after mutual interest
  and an entitlement check, AI inputs exclude all contact and protected fields

### [PREVIOUS ROLE TITLE] · [COMPANY] · [MMM YYYY – MMM YYYY]

- [PLACEHOLDER: an achievement with a number in it]
- [PLACEHOLDER: an achievement showing ownership]
- [PLACEHOLDER: an achievement showing collaboration]

### [EARLIER ROLE TITLE] · [COMPANY] · [MMM YYYY – MMM YYYY]

- [PLACEHOLDER]
- [PLACEHOLDER]

---

## Skills

```
Cloud and infrastructure: AWS Lambda, API Gateway, DynamoDB, S3, CloudFront,
  SES, EventBridge, CloudWatch, Parameter Store, IAM, ACM, Terraform
Product: technical specification, architecture decision records, trade-off
  analysis, pricing strategy, privacy and data-minimisation design
Engineering practice: serverless architecture, single-table design,
  idempotency, webhook verification, feature flags, CI/CD, incident response
Payments: Paystack integration, webhook signature verification, reconciliation
Stack: TypeScript, Next.js, Node.js, GitHub Actions
```

Plain comma-separated lists. ATS keyword matching works on exact terms, so the
service names are spelled as the job posting will spell them.

---

## Education

```
[DEGREE] · [INSTITUTION] · [YEAR]
```

---

## Certifications

```
[PLACEHOLDER — list only certifications you hold and can verify with the issuer]
```

If there are none, **delete this section**. Do not write "in progress" unless
the exam is booked.

---

## The one-line rule

Every bullet answers: what did you do, and how would someone check it.

If a bullet cannot survive "how do I verify that", it does not belong on a CV
written by someone who sells verification.

---

## What is deliberately absent

- No "passionate about", "results-driven", "proven track record"
- No skill-level bars or percentages. Nobody is 87% at Terraform
- No photograph. It parses as nothing and invites bias
- No "references available on request". Assumed
- No objective statement. The summary does that job better
- No claim of writing the code. See `ROLE_ANALYSIS.md`, Position A
