# Acceptance Criteria

Given/When/Then tests for every MVP behavior fixed in `CLAUDE.md` and `docs/PRODUCT_SPEC.md`. Written
ahead of full implementation, same pattern as `docs/THREAT_MODEL.md` — these are the test targets each
later build phase must satisfy, not a description of what already exists. Phase 3 implements none of the
product behaviors below; it only proves the tooling (lint/typecheck/test/build gates) that will enforce
them once written.

## Employer diagnostic (free, top-of-funnel)

- **Given** an employer with no saved role and no candidate profiles in the system
  **When** they start the diagnostic
  **Then** they can complete it and receive a proof-gap snapshot without being asked to create a
  candidate profile or being shown a paid CTA.

## Proof Hiring Kit checkout (NGN 95,000, one-time)

- **Given** an employer on the Kit checkout screen
  **When** the page renders, before any redirect to Paystack
  **Then** it shows the concrete deliverables, exact limits, final price (NGN 95,000), the Paystack
  disclosure line exactly as fixed in `CLAUDE.md`, and cancellation/refund behavior.
- **Given** the checkout screen has rendered
  **When** an automated accessibility/content test inspects it
  **Then** it contains no fabricated testimonial, counter, urgency countdown, guarantee, forced trial, or
  cancellation flow requiring contact outside the product.

## Founding tier subscriptions (Scout/Team/Partner)

- **Given** fewer than 25 organizations have subscribed to a founding tier
  **When** a new employer subscribes
  **Then** the price charged is exactly the fixed founding price (300,000 / 800,000 / 1,800,000
  NGN/month) with no annual plan offered.
- **Given** 5 organizations already hold a founding-tier subscription
  **When** a 6th employer attempts to subscribe
  **Then** the founding price is not offered and the standard price is (Scout 500,000 / Team 1,400,000 /
  Partner 4,000,000 NGN/month). This parenthetical previously said successor pricing was "a separate,
  not-yet-authorized decision"; it was authorized on 2026-08-27 and has been raised three times since,
  most recently on 2026-09-04 when every price doubled. The figures are deliberately restated here
  rather than referenced: a criterion that says "the standard price" cannot fail when the standard
  price is wrong. The place count is restated for the same reason - it was reduced from 25 to 5 on
  2026-09-02 and this criterion still said 25.

## Marketplace checkout gate

- **Given** a saved role has fewer than 5 real, current, discovery-opted matching candidate profiles
  **When** the employer views that role
  **Then** no paid marketplace checkout CTA is shown, regardless of how many total candidates exist
  platform-wide.
- **Given** a saved role reaches exactly 5 real, current, discovery-opted matching profiles
  **When** the employer views that role
  **Then** the marketplace checkout CTA becomes available.

## AI matching and hiring decisions

- **Given** the AI matching feature is enabled for a role
  **When** it produces a candidate ranking or summary
  **Then** the employer's own explicit accept/reject action is what changes hiring status — the system
  never auto-rejects or auto-advances a candidate on the AI's output alone.
- **Given** any AI-generated summary or score
  **When** it is inspected for the inputs it used
  **Then** it does not use protected-trait signals (e.g. inferred from name, photo, or address) and does
  not perform face scoring.

## Payments (Paystack)

- **Given** any surface that redirects to a paid Paystack checkout
  **When** the page renders, before the redirect
  **Then** the exact disclosure line ("Payments are securely processed by Paystack under our business
  name, Abba's Solutions.") is visible, and the same line is present on the support page.
- **Given** a Paystack webhook event arrives
  **When** it is processed
  **Then** its signature is verified before any entitlement change, and re-delivering the same event
  (same event id) does not double-apply the entitlement (see `docs/PAYMENTS.md`).

## Privacy and consent

- **Given** a candidate has not opted into discovery
  **When** any employer-facing search or matching view is generated
  **Then** that candidate never appears in it (see `docs/PRIVACY_AND_RETENTION.md`).
- **Given** a candidate revokes consent or requests deletion
  **When** the request is processed
  **Then** their evidence and profile are removed within the retention/deletion window documented in
  `docs/PRIVACY_AND_RETENTION.md`, not merely hidden from view.

## Foundation gates (this phase's actual scope)

- **Given** the committed `package-lock.json`
  **When** `npm ci` runs in a clean environment
  **Then** it succeeds with no manual dependency resolution.
- **Given** `apps/web` is built
  **When** the output directory is inspected
  **Then** it contains `index.html` and no server runtime directory (`scripts/assert-static-export.mjs`).
- **Given** a feature flag is absent from Parameter Store
  **When** `packages/config`'s `FeatureFlagsSchema` parses an empty object
  **Then** every flag (`payments`, `aiMatching`, `publicDiscovery`, `contactUnlocks`) defaults to `false`.
