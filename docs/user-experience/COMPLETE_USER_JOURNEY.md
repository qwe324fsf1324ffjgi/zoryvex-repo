# The complete user journey

Zoryvex as a real person experiences it, traced through the actual code on
2026-09-14.

Every claim here was read out of the repository or observed against live
production. Where a step could not be proven, it says **NOT VERIFIED** and
explains why, rather than describing what the code intends.

---

## How to read this

Each workflow answers the same questions, because those are the ones that
decide whether somebody succeeds or quietly gives up:

**See → Click → Happens → Backend → If it fails → If they leave → If they
refresh → If they repeat it.**

---

# PART ONE — THE CANDIDATE

## 1. Landing

**Sees:** `zoryvex.space`. A marketing page, served as static files from S3
behind CloudFront. Nav: For Talent, For Employers, How Verification Works,
Pricing, Trust & Safety, Founder, Contact, Sign in.

**Backend:** none. No API call happens on a marketing page.

**On a phone:** verified at 375px against live production — no horizontal
overflow, a Menu disclosure replaces the nav row.

## 2. Registration and sign-in — the same thing

There is no separate registration. **Signing in with an email that has no
account creates one.** There is no password anywhere in this product.

**Sees:** `/candidate/sign-in`, one Email field.

**Clicks:** "Send sign-in code".

**Backend:** `POST /auth/request-code`, unauthenticated by necessity.

Verified limits, read from `auth-service.ts`:

| Limit | Value |
| --- | --- |
| Codes per email | 5 per 15 minutes |
| Codes per IP | 20 per 15 minutes |

**Then:** a 6-character code arrives by email via SES. The response is
deliberately identical whether or not the address is known — that is what
stops the form being used to discover who has an account.

**Clicks:** "Verify and sign in" → `POST /auth/consume-code`.

**Session:** a cookie named `__Host-zoryvex_session`, `Secure`, `HttpOnly`,
`SameSite=Lax`, `Path=/`. The `__Host-` prefix means the browser refuses it
unless it is secure, host-only and path-root — it cannot be set by a
subdomain.

**Session lifetime, verified:**

| Role | Idle | Absolute |
| --- | --- | --- |
| candidate | 1 year | 1 year |
| employer_admin / employer_member | 1 year | 1 year |
| **founder_admin** | **30 minutes** | **12 hours** |

The admin account is deliberately short-lived. Ordinary users are not asked
to sign in repeatedly.

**If it fails:** a wrong or expired code returns a generic failure. The token
is single-use through a conditional write, so a replayed code fails even if
it was valid a second earlier.

**If they leave mid-flow:** the code expires on its own. Nothing is stranded.

**If they refresh:** the code step is re-rendered. The code already emailed
stays valid until it expires.

## 3. Onboarding — pick one track

**Sees:** "Pick one launch track" with four options: Cloud engineering,
DevOps/platform, Cloud-security/DevSecOps, MLOps/ML platform.

**Why one:** matching runs per track. A person open to everything would match
nothing well.

**Backend:** `PATCH /candidates/me` sets `launchTrack` and
`onboardingComplete`. Completing it redirects to the profile; arriving again
afterwards redirects away.

## 4. The profile, and the panel that tells them where they stand

`/candidate/profile` is the screen a candidate returns to. At its top is a
status panel that computes, live, **why they are or are not findable**.

Its states, read from `ThresholdPanel.tsx`:

| State | What it says | Next step offered |
| --- | --- | --- |
| No claims at all | "Employers cannot see you yet" | File your first claim |
| Claims filed, none checked | "You are at the door" | Submit a specific claim to be checked |
| Only proof has lapsed | "Your proof has lapsed" | Check that specific claim again |
| Only proof is private | "Your only proof is private" | Open your claims |
| Proofs exist, discovery off | "N proofs, and nobody can see them" | (toggle is on the page) |
| **Missing phone and/or portfolio** | "Employers cannot reach you yet" | (fields are on the page) |
| All clear | "You are in, on N proofs" | Open your matches |

That last-but-one state is new as of 2026-09-14: a candidate is only findable
if an employer could act on the result — a phone number and one link to their
work, either a website or LinkedIn.

The "you are in" message also names **where employer interest arrives**:
under Matches, with an email. That sentence exists because a candidate has no
other reason to guess that a second screen is where answers appear.

## 5. Filing a claim

**Sees:** a four-line form — what you did, where, what you personally did,
what changed — plus a source type.

**The source type decides everything downstream.** Verified from
`VERIFICATION_METHOD_FOR_SOURCE`:

| Source | Check available |
| --- | --- |
| `certification` | Confirmed with the issuing body |
| `github` | Repository ownership proven |
| `project` / `writeup` / `other` | **None** |

The form says so at the moment of choosing, not after the work is typed. The
default selection is one of the uncheckable three, and the form warns about
exactly that.

**Backend:** `POST /candidates/me/evidence`.

**If they leave:** the claim is saved as filed-but-unchecked. Nothing is
lost, and the panel above says what remains.

## 6. Verification

Two real mechanisms. Both are re-runnable against a source the candidate does
not control, which is the whole product argument.

### Certification

Confirmed with the issuer. Stored as an assertion id; the employer-facing
address is rebuilt from that reference rather than from a URL the candidate
supplied — a stored link would be the field an attacker most wants control
of.

### GitHub repository ownership

1. `POST /candidates/me/evidence/{id}/verify/begin` issues a one-time nonce.
2. The candidate publishes that nonce in a **public gist**.
3. `POST /candidates/me/evidence/{id}/verify` reads the gist, proves the
   account, then reads the repository.

Checked: the account controls the gist, the repo is public, not a fork, not
empty, and commits are credited to that login.

**Failure messages are specific.** A missing repository says "Check the link,
and make sure the repository is public." A truncated gist fails closed rather
than guessing.

**Rate limit, measured against the live API:** unauthenticated GitHub allows
**60 requests/hour per IP** and one verification spends three. A token
parameter exists in both environments but **holds no value**, so every call
is currently unauthenticated. A 403/429 is surfaced as "GitHub unavailable",
never as a failed check — telling somebody their real work did not verify
because of a quota would be both wrong and a good way to lose them.

**Private repositories are not supported**, deliberately. `repo_ownership`
tells employers the evidence was *"found in a source the candidate does not
control"*, which is false for a private repo where history and author dates
are freely rewritable.

## 7. Expiry

Verification is a claim about a moment. `isVerified` re-checks the expiry
against the clock **on every read**, so a credential that lapsed yesterday
stops counting today without any job running. An unreadable expiry fails
closed.

## 8. Privacy controls

Three independent switches, and conflating them is the usual mistake:

| Control | Governs |
| --- | --- |
| `visibility` per claim | private / visible to matched employers |
| `discoveryOptIn` | whether matching reaches them at all |
| `contactUnlockConsent` | whether contact may ever be released |

A candidate can be findable and still refuse contact. Both are re-read at the
moment of disclosure, not trusted from an older record.

## 9. Matching

Runs when an employer recomputes. Deterministic, no model, fixed weights.
Unverified evidence scores **zero** — not reduced, zero.

Nobody is excluded from a shortlist any more: a candidate outside the
location requirement, or whose proof backs none of the written must-haves,
still appears, marked `partial` or `adjacent`, with a sentence saying why.

As of 2026-09-14, matching **skips candidates who are not reachable** (no
phone, or no portfolio link).

## 10. Employer interest — where it arrives

This is the question most likely to lose somebody, so it is answered in three
places.

**What happens:** an employer says yes → the match row changes → an email is
sent → the candidate answers under **Matches**.

**The email**, verified from `interest-service.ts`, carries the organisation
name and the role, links to `/candidate/matches`, says plainly that an answer
is wanted, and says that answering shares **no** contact details. It carries
**no way to reach the employer** — a test asserts the employer's address never
travels in it.

**When it does not send:**

| Condition | Behaviour |
| --- | --- |
| Employer says "not interested" | No email. Rejection is not news a candidate needs. |
| Employer already said yes | No second email. |
| Same employer, same candidate, within 24h | Suppressed. |
| Candidate has left discovery | No email — re-read at send time. |
| Send fails | Interest is still recorded; an audit row flags that nobody was told. |

**In the app:** a role where the employer said yes and the candidate has not
answered is badged **"Interested · needs your answer"**, visually distinct
from every other row.

**If they never log in:** they still have the email, and the role stays on
the Matches page indefinitely. Nothing expires.

## 11. Answering

**Clicks:** "I am interested" or "Not for me" →
`POST /candidates/me/matches/{roleId}/interest`.

Changeable at any time. Submitting the same answer twice is not an error.
Both sides saying yes shows "You both said yes".

A candidate **cannot** write the employer's side — a test proves that
attempt returns 403.

## 12. Contact

The candidate never gives contact details to an employer directly. The
employer unlocks them, and **the candidate is emailed when that happens**.

## 13. Public proof page

Opt-in. The URL carries an unguessable minted id that is **deleted on
opt-out**, which breaks every link that ever existed. It carries what was
checked and by whom, and **no source address**.

## 14. Export, deletion, logout

- Export: `GET /candidates/me/export`
- Deletion: `POST /candidates/me/delete`
- Sign out: revokes the **server-side** session, not just the browser copy

## 15. Account recovery

There is nothing to recover. No password exists. Access to the email address
is access to the account — which is also the honest security boundary.

---

# PART TWO — THE EMPLOYER

## 16. Registration, sign-in, onboarding

Identical email-code flow. Onboarding captures the organisation name, which
is what candidates later see in an interest email.

## 17. Creating a role

`/employer/roles/new`. Launch track, title, seniority, outcomes, must-have
work, optional location requirement, optional pay range, engagement kind.

The launch track **cannot be changed by editing** — a test enforces it,
because changing it would silently invalidate every match already computed.

## 18. Discovery and matching

"Recompute" runs matching and reports the shape of the result: how many
candidates the location requirement is stretching, and how many the written
requirements are talking past.

**Candidates are identified only as `Candidate (a1b2c3)` until contact is
unlocked.** The name is not shown before.

## 19. Reading the proof

Each match expands to show, per claim: what was claimed, how it was checked,
what the check does and does not establish, when it was checked, when it
lapses, and what the candidate is open to.

**Free**, to any employer who owns the role — deliberately. An employer who
cannot judge the proof has no reason to pay for the contact.

**Paid:** the independent source address (Credly/GitHub). Without a
subscription it is withheld **and** the repository identity is stripped from
the surrounding prose, because `owner/repo` is the address with the host
removed.

## 20. Interest — now a paid action

As of 2026-09-14, saying "I'm interested" requires an active subscription.

**Unpaid:** a `403`, and a card naming what a subscription buys with a link
to the plans. Nothing is written; the candidate is told nothing.

**Withdrawing a yes is not gated** — deliberately. A lapsed subscription must
not trap a candidate in an interest that is no longer real.

## 21. Payment

Two separate products:

| Product | Price | What it buys |
| --- | --- | --- |
| **Proof Hiring Kit** | NGN 95,000 one-time, per role | Six generated deliverables. `CONTACT_UNLOCK_ALLOWANCE.kit = 0` — no marketplace access. |
| **Subscription** | Monthly | Marketplace access |

Verified live against the Paystack account — all six plan objects exist and
every amount matches the contract exactly:

| Plan | Founding | Standard | Unlocks/month |
| --- | --- | --- | --- |
| Scout | 800,000 | 1,200,000 | 5 |
| Team | 1,400,000 | 2,000,000 | 15 |
| Partner | 2,400,000 | 4,000,000 | 50 |

**Payment lifecycle:** checkout is initialised server-side with an
idempotency key, the employer is redirected to Paystack, and entitlement is
granted **only** on a signature-valid webhook or by reconciliation. The
browser never decides that money moved.

**Reconciliation** runs hourly as the safety net and has been the only thing
that has ever updated a production payment.

## 22. Contact unlock

Requires, in order: role ownership, a real match, the role having at least
**5** discovery-opted matches, the candidate's contact consent, marketplace
access, and remaining allowance. The allowance increment is atomic, so two
concurrent unlocks cannot both pass the limit.

**Returns:** display name and email always; phone, LinkedIn and website each
only if the candidate provided them — **absent rather than blank**, so the
employer can tell "did not provide" from "empty".

## 23. Payment states

| State | Behaviour |
| --- | --- |
| Success | Webhook grants entitlement exactly once |
| Failed | Recorded; a fresh reference is issued on retry |
| Abandoned | Reconciliation ages it out |
| Duplicate click | Idempotency key returns the same attempt |
| Duplicate webhook | Deduped — **verified in production** |
| Delayed webhook | Reconciliation catches it within the hour |
| Cancelled | Paid period honoured, then access ends |
| Failed renewal | Grace window, then suspended |
| Refund/reversal | `success → reversed` is the one non-terminal transition |

---

# PART THREE — WHAT IS NOT PROVEN

Stated plainly.

- **No payment has ever succeeded in production.** 11 attempts: 8 abandoned
  before a card was entered, 3 refused because they used a **Paystack test
  card against the live account**. No product defect in any of them — but
  `charge.success → entitlement → delivery` has never executed with real
  money.
- **No authenticated production workflow was exercised.** Doing so requires
  synthetic accounts in the live table.
- **No live GitHub verification round-trip.** Needs a real gist from a real
  account.
- **Email delivery to a real candidate in production.** Wiring verified; SES
  delivery proven only in test via the mailbox simulator.
