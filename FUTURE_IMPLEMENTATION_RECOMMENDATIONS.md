# Future implementation recommendations

Everything worth building next, ranked by expected harm avoided or value
created, not by how easy it is.

**Nothing here has been implemented.** This pass changed no application code.
Each item is a proposal awaiting a decision.

---

## How this is ranked

Three questions, in order:

1. What does it cost if this is never done?
2. What breaks if it is done badly?
3. Does it make an existing claim true, or make a new claim?

Items that make an **existing** claim true rank above items that add
capability. A product selling verification cannot afford a gap between what it
says and what it does.

---

# Tier 1 — Do these before anything else

## 1.1 Prove the payment success path

**Cost of not doing it:** unknown, and that is the problem. The path from
`charge.success` to entitlement to delivery has never executed in production.
It is tested. It is not proven.

**The recommendation:** one real purchase with a real card. Not a test card,
which the live account correctly refuses, and which is what produced three of
the eleven failed attempts.

**Verify afterwards:**

1. The transaction is `success` in the Paystack dashboard
2. A dedupe row exists at `WEBHOOK#body:<sha256>` / `EVENT`
3. The entitlement row exists and `grantsMarketplaceAccess` returns true
4. The Kit artifact is retrievable, or the marketplace opens
5. Replay the same event and confirm `duplicate: true` with no second grant

**Effort:** one hour. **Risk:** one real charge, refundable.

This is the single highest-value hour available anywhere in this document.

## 1.2 Exercise rollback, deliberately, on a calm day

**Cost of not doing it:** the first real use happens during an incident.

`scripts/rollback.mjs` carries its own admission: *reviewed, never yet
exercised against a real deployment.*

**The recommendation:** deploy a trivial, visible, harmless change to
production. Roll it back. Confirm `/health` reports the rollback target.
Record what actually happened, including anything the script did not handle.

**Effort:** two hours. **Risk:** genuinely present, which is exactly why it
should happen when nothing else is wrong.

## 1.3 Put a value in the GitHub token parameter

**Cost of not doing it:** a hard wall at roughly 20 verifications per hour
platform-wide, on a shared Lambda egress IP.

The parameter exists in both environments and is empty, so every call today is
unauthenticated at 60 requests/hour per IP. One verification spends three.

**The recommendation:** a fine-grained personal access token with **no scopes
at all**. Public repository and gist reads need no permissions; the token
raises the rate limit to 5,000/hour and grants nothing.

**Effort:** fifteen minutes, one parameter write, no deploy. The Lambdas
already read it.

**Do not** grant `repo`. If that token leaked it would be a serious incident,
and it buys nothing.

## 1.4 Resolve the `verificationReminders` flag

**Cost of not doing it:** the flag is `true` in production and no function or
schedule exists. Inert today. The moment such a function is deployed, it
begins emailing real candidates with no deliberate decision having been made.

**The recommendation:** set the flag `false` until the function exists and has
been reviewed. A flag that is on for something that does not exist is a
loaded weapon with no trigger attached.

**Effort:** one parameter write. Remember to write all five keys.

---

# Tier 2 — Do these before real volume

## 2.1 Re-check verified repositories

A repository verified public can be made private, deleted, or transferred the
next day. Nothing re-checks it. A proof can outlive its own truth.

**Recommendation:** a scheduled job re-reading verified repository claims on a
rolling basis, say every 30 days. On failure, do **not** mark the claim false.
Mark it *stale* and tell the candidate. The distinction matters: GitHub having
a bad day and a candidate hiding their work must not look the same.

**Effort:** a day. **Risk:** medium. Getting the stale-versus-failed
distinction wrong would punish honest candidates for an upstream outage.

## 2.2 Automatic Terraform drift detection

Nothing detects drift. `terraform plan -detailed-exitcode` is currently `0`,
but that was verified by hand.

**Recommendation:** a scheduled read-only plan that alerts on exit code `2`.
**Plan only. Never apply.** An automatic apply on drift is how a manual
emergency fix gets silently reverted at 3am.

**Effort:** half a day.

## 2.3 A registration kill-switch

Sign-in and registration are one flow, so there is no way to stop new accounts
without locking out existing users. The takedown manual records this as
NOT IMPLEMENTED rather than improvising around it.

**Recommendation:** a flag that refuses account *creation* while allowing
sign-in to known accounts. Needed for a legal hold, a wind-down, or an abuse
incident.

**Effort:** a day, touching the auth path. **Risk:** high, because the auth
path is the most security-sensitive code in the product. Do not do this
casually.

## 2.4 Tighten the CSP

`script-src` includes `'unsafe-inline'`, which is a real weakening. It is
there because the Next.js static export emits inline bootstrap script.

**Recommendation:** investigate nonce or hash-based CSP for the emitted inline
scripts. It may not be achievable with a static export, in which case record
that finding rather than leaving the question open.

**Effort:** unknown until investigated. **Value:** moderate. Honest.

---

# Tier 3 — Product, once there are users

## 3.1 Delete what is already dead

Three things exist in the codebase, unreachable from any screen:

- The upload, scan and download pipeline, plus its S3 bucket and GuardDuty
  malware protection
- The three peer-verification endpoints
- The graded-task catalogue (ADR 0005 records its deletion as outstanding)

Dead code that is still deployed is still attack surface, still cost, and
still something a future reader has to understand before changing anything.

**Recommendation:** delete, in a reviewed plan, with the destroy count read
carefully. This is a `terraform destroy` of specific resources and is
currently `NOT AUTHORIZED BY FOUNDER`.

## 3.2 Candidate-side proof of freshness

Employers currently cannot tell whether a claim was verified yesterday or a
year ago. Showing the verification date, plainly, costs nothing and makes the
evidence more honest.

## 3.3 More issuers

Currently AWS, Google Cloud, the Linux Foundation and IBM. Each additional
issuer that publishes a holder-bound verification address widens the product
without weakening it.

**Do not** add an issuer that cannot be checked. That is the one change that
would break the product's entire argument.

---

# Tier 4 — Explicitly not recommended

Recording these matters as much as the recommendations, because each will look
attractive at some point.

| Idea | Why not |
| --- | --- |
| Accept uploaded files as evidence again | Removed on principle. It would restore the product's largest dishonest surface |
| Restore peer confirmation | Same. The candidate picks the peer |
| Turn on `aiMatching` | Off until the evaluation gate passes. A model deciding is the thing the product argues against |
| An automatic production deploy from `main` | The deliberate act is the safety mechanism |
| Automatic infrastructure rollback | Blindly reverting live infra state turns a bad deploy into an outage |
| Paid referrals | Forbidden by the commercial runbook. It corrupts the signal the product sells |
| Annual plans | Fixed product decision |
| Any Microsoft or Azure certification | Cannot be verified by anyone. Offering it would be a lie |
| Auto-cancelling subscriptions during a wind-down | A commercial and possibly legal decision, not a technical one |

---

## If only three things are done

1. **Make one real payment** (1.1). It closes the largest unverified gap in
   the entire system, and takes an hour.
2. **Exercise rollback** (1.2). It converts your recovery plan from a
   hypothesis into a procedure.
3. **Set the GitHub token** (1.3). Fifteen minutes, no deploy, removes the
   nearest hard wall.

Everything else can wait for evidence of need. These three cannot, because
each one is a claim the system currently makes that has never been tested.
