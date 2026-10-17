# LinkedIn profile

Copy-ready. Replace every `[PLACEHOLDER]` with something true first.

---

## Headline

220 characters. It is the only thing most people read.

**Primary:**

> Technical product owner · Built and operate zoryvex.space, a proof-first
> hiring platform on AWS serverless · 55 Lambdas, live payments, solo

**If targeting solutions architecture:**

> AWS serverless architecture · Designed and operate a live platform: 55
> Lambdas, API Gateway, single-table DynamoDB, Terraform · Product owner

**Do not use:**

> "Founder | Builder | Passionate about technology 🚀"

It says nothing and the pipes are a tell.

---

## About

First two lines appear before "see more". They have to carry it alone.

> I built a hiring platform that checks what candidates claim, instead of
> reading what they wrote. It's live at zoryvex.space and you can look at it
> right now.
>
> Zoryvex verifies two things against sources the candidate doesn't control: a
> certification confirmed with the body that issued it, and control of a
> public repository proven by a one-time code only that account could publish.
> Everything else on a profile is labelled unchecked, because it is.
>
> I specified the architecture, made the trade-offs, and operate it. 55 Lambda
> functions across 51 API routes, 44 behind a fail-closed authorizer,
> single-table DynamoDB, static export on CloudFront, Terraform-managed, live
> Paystack integration with signature verification and hourly reconciliation.
> Built alone over a month.
>
> The decisions I'm most willing to be judged on are the removals. We shipped
> a verification method that marked candidates against a published rubric, and
> I took it out once I worked out a language model could pass it from the
> brief. I removed file upload as evidence, because a file you upload is a
> file you control. I removed peer confirmation, because you pick the peer.
> Each made the product smaller and its claims defensible.
>
> I'm a product owner, not a hands-on engineer. I direct architecture and own
> the trade-offs. Given what the product sells, that distinction seemed worth
> stating rather than blurring.
>
> Looking for: technical product management in developer tools or platform,
> founding product roles, or AWS solutions architecture.
>
> [EMAIL]

---

## Experience entry

**Title:** Founder and Technical Product Owner
**Company:** Zoryvex
**Dates:** Aug 2026 – Present
**Location:** [CITY, COUNTRY] · Remote

> Proof-first hiring platform. Live at zoryvex.space.
>
> • Specified and shipped a production AWS serverless platform: 55 Lambda
> functions, 51 API routes (44 behind a fail-closed authorizer), single-table
> DynamoDB, CloudFront with origin access control, 74 Terraform files across
> 14 reusable modules
> • Recorded every architecture decision in ADRs, including rejecting Amazon
> Cognito for passwordless email auth with opaque server-side sessions
> • Retired a shipped verification method after determining a language model
> could pass it from the published brief
> • Removed file-upload and peer-confirmation evidence paths on the principle
> that a source the candidate controls or selects is not independent
> • Integrated Paystack with HMAC-SHA512 webhook verification, payload-hash
> deduplication and hourly reconciliation; proved forgery rejection, signature
> acceptance and replay deduplication against the live account
> • Diagnosed eleven consecutive live payment failures to gateway evidence and
> correctly concluded there was no product defect
> • Enforced cost control by design: reserved concurrency on all 55 functions,
> no always-on compute, feature flags read per invocation for sub-minute
> mitigation without a deploy

---

## Skills, in order

LinkedIn weights the top three most.

1. Technical Product Management
2. AWS Lambda
3. Serverless Architecture
4. Amazon DynamoDB
5. Terraform
6. Amazon Web Services (AWS)
7. Product Strategy
8. API Design
9. Amazon API Gateway
10. System Architecture
11. TypeScript
12. Infrastructure as Code
13. CI/CD
14. Payment Systems
15. Technical Writing

**Do not add** skills you would not want to be asked about in round one.

---

## Featured

Three items, in this order:

1. **zoryvex.space** — the live product. Nothing beats a link that works
2. **An ADR**, published as an article. ADR 0005 is the strongest
3. **A short demo video** of the verification flow. Video 04 from
   `growth/VIDEO_04.md` works unchanged

---

## Photograph

One plain portrait, daylight, no styling. See
`growth/REAL_PHOTO_SHOT_LIST.md` number 31.

**Banner:** plain `warm-50` ground with one line of text, or nothing. Never a
stock skyline, never a code-on-black wallpaper.

---

## Posting

Use `growth/POSTS/LINKEDIN.md`. Two a week, maximum.

For a job search specifically, the highest-value posts are 2, 3, 4 and 10 —
the ones about removing things. They demonstrate judgment, which is the
quality that is hard to assess in an interview and easy to demonstrate in
writing.

---

## What not to do

- No "#OpenToWork" frame. It changes how recruiters price you
- No "I'm humbled to announce"
- No repost of a motivational graphic
- No engagement bait
- No skill endorsements traded with strangers
- No claim of writing the code
- No customer, user, or revenue figure. There are none
