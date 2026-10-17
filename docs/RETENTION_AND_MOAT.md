# Why an employer would pay in month two

Written 2026-09-07, in answer to a founder question: _"once someone subscribes
they can copy all the contacts and information of the candidates and all of a
sudden they won't need to subscribe."_

The worry is correct and it is the oldest failure mode in this category. A
directory that sells access to a list gets paid once, because a list can be
copied in an afternoon and a copied list does not stop working. Every job
board and lead-generation product has died of this.

This document states what already defends against it in the code today, what
does not, and the one change worth making. It does not describe anything that
is built unless it is built, and it names the parts that are not.

## The defence that does not work, and is not going to be built

Stopping the copying. Disabling text selection, watermarking, blocking
right-click, chunking results to slow down scraping, hiding data behind
images. All of it is defeated by a screenshot and a person with a keyboard,
all of it punishes the honest customer hardest, and CLAUDE.md rules out dark
patterns outright.

There is also a straightforward fairness point. An employer who paid to unlock
a contact has bought that contact. Taking it back, or making it deliberately
awkward to keep, would be selling something and then interfering with it.

So the answer is not to make the data harder to take. It is that the thing
worth paying for is not the data.

## What already defends this, verifiably

### 1. A proof is a fact about a moment, and the moment passes

`isVerified` in `services/api/src/domain/matching-service.ts` refuses an
expired verification. A certification carries the issuer's own expiry and stops
counting when it lapses. This is enforced in the matching path, not decoration:
an expired proof stops reaching employers.

This is the whole argument. An exported spreadsheet records who was verified on
the day it was exported. It cannot record who is verified today, and it has no
way to find out. The employer holding a September export holds a claim about
September.

### 2. Contact unlocks are metered per period, server-side

The real allowance is a period-keyed ledger in `match-repository.ts`, not an
all-time count. An employer cannot unlock the whole marketplace in week one and
leave. They can take what a month's allowance buys.

Note the local-adapter counter in `apps/web/src/lib/entitlements.ts` is an
all-time count and says so in its own comment. That is the demo walkthrough,
not the billing behaviour.

### 3. Supply is continuous, not a fixed set

Candidates verify over time. A snapshot captures the people who had finished
verifying by the export date, and nobody who finished after it.

## What is missing

The three facts above are true in the code and largely invisible in the
product. Specifically:

- `ProofMark` renders "checked" and "lapses" dates and is the only place decay
  is visible. There is no view anywhere that answers "what has changed on this
  role since I last looked", which is the question a returning employer
  actually has.
- Nothing tells an employer when a candidate they unlocked gains new verified
  evidence, or when a proof they relied on lapses. Both are events the system
  already knows about and does not report.

That gap is the real retention problem. Not that the data can be copied, but
that the product never demonstrates the copy is going stale.

## The recommendation

One change, not a programme: **make decay legible on the employer's own
screens**, before building any notification system.

An employer looking at a shortlist should be able to see that three of the
eight proofs they are relying on lapse within ninety days, without being sent
anything. That is a truthful statement built entirely from
`verificationExpiresAt`, which is already stored and already enforced. It needs
no new data, no new emails, no new infrastructure, and no scheduled job.

It is also the honest version of the pitch. The reason to stay subscribed is
not that Zoryvex is withholding something. It is that a proof has a shelf life
and the export does not know it.

### What is deliberately not recommended yet

Emailing employers about candidate changes is the obvious next step and should
wait. CLAUDE.md gates any recurring marketplace push behind five real
opted-in matches, and that gate has not been met. Building a notification
system before there is anything to notify anybody about would produce an empty
drip campaign, which is the thing the commercial runbook exists to prevent.

Rewards, referral credits and retention discounts are all out of scope here for
the same reason: none of them addresses why month two is worth paying for.

## What this does not solve

An employer who wants exactly one hire, gets it in month one, and leaves is not
churning because of a data leak. They are a satisfied customer with a
non-recurring need, and no amount of product work converts them into a
subscription. The Kit exists for that shape of buyer and is priced as a
one-time purchase for exactly that reason.

Being honest about which customers are genuinely recurring is more useful than
a retention feature aimed at the ones who are not.
