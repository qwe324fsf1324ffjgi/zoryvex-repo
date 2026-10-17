# Recruiter and hiring-manager messages

Short, specific, and honest about the one-month timeline rather than hoping
nobody notices it.

**Before sending anything here, read `ROLE_ANALYSIS.md`.** Every message takes
Position A: you directed and operate the system. None claims you wrote the
code.

---

## The problem these messages solve

Your strongest evidence is also your most suspicious-looking: a complete
production platform built in one month by one person. A recruiter's first
instinct will be that it is exaggerated.

So every message does the same thing: **give them something to check.** The
system is live at a public URL. That converts scepticism into a ten-second
verification, which is the entire argument of the product you built.

---

## 1 · Cold message to a hiring manager · Technical PM

> Hi [name],
>
> You're hiring a [role]. Rather than describe myself, here's something you can
> check: zoryvex.space is a hiring platform I specified, architected and
> operate. 55 Lambda functions, 51 API routes, single-table DynamoDB,
> Terraform-managed, live payments. Solo, over the past month.
>
> The decisions are documented. The one I'd point at: we shipped a verification
> method where candidates were marked against a published rubric, and I removed
> it after working out a language model could pass it from the brief alone. It
> made the product smaller and the claim defensible.
>
> I'm a product owner, not a hands-on engineer, and I'd rather say that up
> front than have it surface in round three.
>
> If that's the kind of judgment you're hiring for, I'd like fifteen minutes.
>
> [name]

**Why the third paragraph is there:** volunteering the limitation is the most
persuasive sentence in the message. It also removes the only way this can go
badly later.

---

## 2 · Reply to an inbound recruiter

> Hi [name], thanks for reaching out.
>
> Quick context so you can judge fit before we spend a call on it.
>
> I spent the last month building and shipping Zoryvex, live at zoryvex.space.
> A proof-first hiring platform on AWS serverless. I specified the
> architecture, made the trade-offs, and operate it. I'm a technical product
> owner rather than a hands-on engineer, so I'm a strong fit for TPM, founding
> PM, or solutions architecture, and a poor fit for a senior engineering role.
>
> If [role] is in the first group I'm interested. If it's in the second, I'd
> rather tell you now than waste your client's time.
>
> [name]

---

## 3 · Short LinkedIn connection note

> Hi [name] — I built and operate zoryvex.space, a proof-first hiring platform
> on AWS. Solo, 55 Lambdas, live payments. Interested in [role type] work and
> happy to be judged on the running system rather than the CV.

Under 300 characters, which is the actual limit.

---

## 4 · Replying to "tell me about yourself"

> I spent the last month building a hiring platform that verifies what
> candidates claim. It's live, it takes payments, and I built and run it
> alone.
>
> What I'd actually want you to know is the kind of decision I made along the
> way. We had a verification method that marked candidates against a published
> rubric. I worked out a language model could solve it from the brief, so the
> mark said nothing about the person. I removed it, and the product got
> smaller and more honest.
>
> I'm a product owner. I direct architecture and make the trade-offs. I don't
> claim to be the one writing the code, and for a company selling verification
> that distinction mattered more than usual.

Three paragraphs: what you did, how you think, what you are not. Under sixty
seconds.

---

## 5 · Answering "one month isn't very long"

Do not deflect. This is a fair question.

> It isn't, and I'd ask the same thing.
>
> What a month bought was depth on a narrow thing rather than breadth. I can
> tell you why there's no NAT Gateway, why sessions are opaque and
> server-side instead of Cognito, why the webhook dedupes on a hash of the raw
> body rather than the event id, and what each of those cost.
>
> What it didn't buy is scale experience. There's no traffic to speak of and
> no team. If the role needs someone who has run something at volume with
> people, I'm not that person yet.
>
> If it needs someone who can take a problem from nothing to live and defend
> every decision, that's exactly what the month demonstrates.

---

## 6 · Answering "why are you looking if you have a startup"

Answer truthfully. Pick the one that is actually true.

**If you want both:**

> I'm not winding it down. It's live, it's cheap to run, and I'll keep
> operating it. What it doesn't have yet is revenue, and I'd rather work
> somewhere I learn at speed than stretch runway by working alone.

**If you are open to stopping:**

> Honestly, I built it to find out whether I could and to learn what shipping
> something real requires. I found out. Whether it becomes a business depends
> on whether anyone pays, and that's not settled. Either way it taught me more
> than the last year did.

**Do not say** "I'm looking for a new challenge."

---

## 7 · Follow-up after an interview

> Hi [name],
>
> Thanks for the time today.
>
> One thing I under-answered: you asked how I'd handle [X] at scale, and I
> gave you the version that works at my scale. The honest answer is that
> [specific thing] would break first, at roughly [point], and [approach] is
> what I'd reach for.
>
> Not trying to relitigate it. It was a good question and my first answer was
> thinner than it should have been.
>
> [name]

**Why this works:** volunteering that you answered something poorly is rare
and it is read as the thing they were actually testing for.

---

## Rules

| Rule | Reason |
| --- | --- |
| Always give something checkable | It is the argument of the product you built |
| Never claim you wrote the code | It will not survive round three |
| Volunteer the limitation before they find it | It is the most credible sentence available |
| Never send the same message twice | Two is persistence, three is pressure |
| No "I'm passionate about" | It is the phrase that signals nothing was said |
| Under 150 words unless answering a question | Long cold messages are not read |
| Name the specific role and company | A message that could go to anyone reads like it did |
