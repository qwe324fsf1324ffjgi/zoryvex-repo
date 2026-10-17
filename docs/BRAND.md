# Brand

What Zoryvex stands for, what it stands against, and the rules that keep both true.

This is a working document, not a mood board. Every line below has to survive the same test the
product does: is it true of what the code actually does today? A brand whose entire thesis is
"don't take anybody's word for it" cannot make a claim about itself that nobody could check.

## The one rule that outranks the rest

**Nothing here works by persuasion against the reader's interest.**

Belonging that is engineered rather than earned is a dark pattern with better copy, and
`docs/COMMERCIAL_RUNBOOK.md` already forbids dark patterns outright. It is also, specifically for
this product, self-defeating: the one thing Zoryvex sells is that it does not ask you to take a
claim on faith. A brand built by manufacturing faith would be the first counter-example to its own
pitch, and the first employer to notice would be right.

So the loyalty this document is trying to produce comes from one place only: the product keeps
saying true things, including the inconvenient ones, until a person notices that it always does.
That is slower than a trick and it is the only version that survives contact with a customer.

Everything below is built on something already in the code. Where a section names a behaviour, the
file that implements it is cited.

## The enemy

**"Trust me."**

Not a person. A sentence, and the whole system built on it: a document where the person being
assessed writes their own assessment, read by somebody with no way to check it, in a market where
everybody knows this and does it anyway.

It qualifies as an enemy worth naming because:

- **Everyone recognises it.** Every hiring manager has read a CV and thought "I have no idea if any
  of this is true." Every honest candidate has written one and felt the same.
- **Nobody defends it.** There is no lobby for the unverified CV. It persists because checking is
  work, not because anybody believes in it.
- **It is a behaviour, not a group.** It is what the system asks people to do. Candidates are not
  the enemy — they are the ones offering to be checked, and a brand that made them the villain
  would be both wrong and commercially suicidal, since half the marketplace is them.
- **It decides things.** "Would this survive a check?" answers most product questions on its own.

The answer, in two words: **check it.**

That is not a slogan bolted on. It is `services/api/src/domain/matching-service.ts`:

```
const VERIFICATION_WEIGHT = { verified: 1, self_attested: 0, unverified: 0 };
```

Zero, not a lower number. That file's own comment says why: "A weaker weight does not make an
unchecked claim honest, it just prices it." Partial credit for a self-report is the enemy wearing a
rosette.

### Us and them, stated fairly

- **Us:** people who would rather be checked than believed. Candidates who submit work to
  verification. Employers who would rather see four proven people than four hundred applications.
- **Them:** not people. The practice of hiring on assertion, and every tool that automates that
  practice faster.

The line is drawn so that anybody can cross it, in either direction, by changing what they do. A
brand line that a person cannot cross is a slur.

## The words

Naming is claiming. These are the words this product owns and uses consistently. Generic
alternatives are listed so they can be recognised and avoided.

| Our word     | What it means, exactly                                                                                   | Not                                     |
| ------------ | -------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| **claim**    | Something a candidate says they did. Not yet checked. Scores zero.                                       | "experience", "skill", "background"     |
| **proof**    | A claim that passed an autonomous check against a source the candidate does not control. Carries a date. | "verified badge", "credential"          |
| **check**    | The act of confirming a claim against that source. Re-runnable by a machine.                             | "review", "screening", "assessment"     |
| **lapse**    | What a proof does when the credential behind it expires. It stops counting the same day.                 | "expire" (fine), "renew" (implies ours) |
| **the mark** | The dated symbol a proof carries.                                                                        | "badge", "verified tick"                |

The verbs matter as much as the nouns. Candidates **file** a claim and **earn** a proof. Zoryvex
**checks**. Nobody **awards** anything, because an award is a judgement and a check is not.

### Lines that are true, and are worth repeating

Use these; do not invent new ones without checking them against the code.

- **"Trust me is not a credential."**
- **"Every proof has a date on it."** — `EvidenceSchema.verifiedAt`, `verificationExpiresAt`.
- **"We check, then we say."** — nothing reaches an employer until `isVerified` passes.
- **"Not even our own word."** — the employer-facing proof view names the issuer and links to the
  source, so an employer can check the checker.
- **"A claim scores nothing. That is the whole product."**

### Lines that are forbidden

Beyond `CLAUDE.md`'s AI-cliché list, these are specifically off-limits here because they are the
enemy's grammar:

- Anything asking the reader to trust, believe, or feel confident. Show the check instead.
- Any superlative about the platform ("the most rigorous", "the gold standard"). Unverifiable, by
  definition, and therefore a "trust me".
- Any number without a source ("hire 3x faster"). `docs/COMMERCIAL_RUNBOOK.md` already gates
  "high demand" and "low competition" behind evidence thresholds; the same rule applies to every
  other figure.

## The ritual

A ritual is a formal sequence a person performs, recognises, and can teach to somebody else. This
one is already in the schema; it had simply never been named.

**Four lines and a check.**

1. **Claim** — what you did, in one line.
2. **Context** — where, and what state it was in.
3. **Actions** — what you personally did. Not the team.
4. **Outcome** — what changed, measurably.
5. **Submit it to be checked.**

Those are the exact fields of `EvidenceSchema` (`claim`, `context`, `actions`, `outcome`) plus
`services/api/src/domain/verification-service.ts`. The form has always asked for them. What was
missing was saying that this is a discipline with a name, rather than four inputs.

Why it works as a ritual rather than a form:

- **It is hard in a specific way.** Separating what you did from what the team did is the moment
  people find out whether they have a story. That difficulty is the point, not friction to remove.
- **It is transferable.** A candidate who has done it four times writes their next one better, and
  can explain the shape to somebody else in one sentence.
- **It ends in a verdict that is not ours.** The check runs against an issuer, a repository, or a
  deterministic rubric — never a Zoryvex opinion. The candidate is not being judged by us.

## The threshold

**A claim gets you a profile. A proof gets you into the marketplace.**

This already exists and has never been said out loud.
`recomputeMatchesForRole` writes no match at all for a candidate with no verified evidence
supporting any requirement — not a match scored zero, no match. So a candidate with an account, a
full profile, and nothing checked is invisible to every employer, and nothing on their screen told
them that.

Making the door visible is the change. The profile now says where a person stands and what the next
step is, in those terms: outside, at the door, or in.

The threshold is real in both directions:

- You cannot buy it. There is no plan that makes an unchecked claim count.
- You cannot argue your way past it. There is deliberately no "an admin said so" verification
  method — `VerificationMethodSchema` has three values and all three are machine re-runnable.
- You can lose it. A lapsed credential stops counting the day it lapses, and the marketplace list
  follows.

An entry requirement that can be waived is not a threshold; it is a queue.

## The logo, and why it stays out of the way

The wordmark is typographic: "Zoryvex", heavy weight, tight tracking, no icon beside it
(`apps/web/src/components/ui/Wordmark.tsx`). That is a decision, not an omission, and it holds for
one reason: **the symbol that matters in this product is the one candidates earn.** A company logo
sitting next to the proof mark on every screen would compete with it, and the mark means something
precisely because only a proof carries it. Nothing is gained by the company wearing its customers'
badge.

The app icon (`apps/web/app/icon.svg`) is where a symbol is genuinely needed, because a favicon
cannot be a word. It is a Z drawn as three straight strokes with square ends, warm-white on ink.
The proof mark is built from the same geometry: straight strokes, square caps, no curves, one
emerald. They are the same hand, which is why they sit together without either explaining itself.

If an ornamental logo is ever wanted, that is a founder decision and should be taken as one. It
should not be added because a brand section looked empty without it: an ornament that means nothing
is exactly the generic detail this document exists to keep out.

## The mark

Every proof carries one, and it says three things: that it was checked, when, and until when.

The design decision that makes it ours: **it has a date on it.** Verification badges conventionally
imply permanence, which is a lie about how credentials work. A mark that dates itself is unusual,
mildly uncomfortable, and correct — and it is the visual form of `isVerified`, which re-checks the
expiry against the clock on every read.

- Rendered by `apps/web/src/components/ui/ProofMark.tsx`.
- Ink on warm, one emerald stroke, square with a hairline border. It belongs to the existing
  restrained system (`apps/web/app/globals.css`) rather than introducing a second one.
- The lapsed state is not hidden. A mark whose credential has expired renders as lapsed, plainly,
  because concealing it would be the first "trust me" in the product.

A shareable, public form of the mark — one a candidate could put on a profile elsewhere, resolving
to a page anybody can check — is the obvious next step and is deliberately **not built yet**. It
needs the `publicDiscovery` flag, a public page, and a consent decision, and shipping a badge that
links to nothing would be a badge you can screenshot, which is the enemy again.

## Prophecy

The brief asked for a declaration about the future, earned once everything else holds.

It does not hold, and cannot, and that is the answer rather than an evasion.

A brand whose single claim is "don't take a claim on trust" cannot make an unverifiable statement
about the future without refuting itself in the same breath. `CLAUDE.md` says the same thing in
operational terms: never let a copy pass introduce a claim that outruns reality, and
`PHASE 10 COMMERCIAL GO` requires every gate independently evidenced, because "ambition is not a
legal PASS".

So the strongest confident thing this brand can say is not a prediction. It is a standing offer:

> **Check it. We will show you exactly what we checked, who we checked it with, and when it stops
> being true.**

That is a claim with a test attached, which is the only kind this product is allowed to make. It
also happens to be the harder promise to keep, and therefore the one worth more.
