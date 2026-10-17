# ADR 0005: Graded tasks are retired as a verification method

Status: Accepted (founder decision, 2026-09-06)
Date: 2026-09-06

## The instruction

The founder, 2026-09-05:

> I feel like those small tasks for evidence that requires creating your terraform code can be
> easily surpassed by using ai. Copy the task and paste in ai that provide answers, I don't like
> that. If it cannot be solved remove it. Anybody can just put anything and have an approved
> evidence do something about if you can remove it. Make sure every verification make sense

The instruction is conditional: fix it, or remove it. What follows is the finding on whether it
could be fixed, and what removing it actually cost.

## The finding

It cannot be honestly fixed at this shape.

A graded task publishes a brief, publishes the rubric it will be marked against, and scores a
static file the candidate uploads. Nothing observes the person. A candidate pastes the brief into
a language model, pastes the answer back, and holds a credential saying a machine checked their
skill.

The only anti-copying defence in the design was a per-candidate token embedded in the brief, which
the rubric requires to appear in the submission. That stops one candidate submitting another
candidate's answer. It does nothing about this, because each candidate's own brief carries their
own token and the model reproduces it.

The fixes that would work are not available. Proctoring is a different product. Timing proves
nothing when the model answers in seconds. Requiring the candidate to deploy the infrastructure
to a real cloud account and inspecting the live result would be a genuine check, and would mean
handling other people's cloud credentials, which is not something to build here.

Worse than the gap itself was where it sat in the hierarchy. `EVIDENCE_STRENGTH_LEVELS` ranked a
passed graded task at `skill_demonstrated` and `outcome_verified`, both **above**
`knowledge_assessed`, where a certification confirmed with its issuer sits. So the least reliable
signal on the platform outranked the one cryptographically bound to the candidate's own verified
email address. An employer sorting a shortlist saw the inversion and had no way to know.

## The decision

Graded tasks are no longer a route to verified evidence.

- No claim type maps to `graded_task` in `VERIFICATION_METHOD_FOR_SOURCE`, and the type excludes
  it, so a future edit reintroducing one does not compile.
- `isVerified` refuses the method outright. This applies **retrospectively**: items verified this
  way before the decision stop counting too. Applying it only to people who had not got there yet
  would have been a grandfather clause on a claim we no longer believe.
- `evidenceStrength` attains no level above `claimed` for the method, and says why in the basis
  rather than letting a level silently disappear from a candidate's own profile.
- Capability matching is removed. It credited a requirement in full when a passed task tested the
  matching capability, and it was the strongest support the platform had while the check meant
  something. A rationale reading "supported by a graded task this candidate passed" would now be
  selling an employer a result the platform does not stand behind.

## What is deliberately kept

The `graded_task` value stays in `VerificationMethodSchema`. Evidence verified that way still
parses, still appears on the candidate's own profile, and still reads honestly. Removing the enum
value would corrupt stored records to tidy up a decision, which is the wrong trade.

`graded-task-service.ts`, its 52-task catalogue and its tests are left in place, unreachable from
verification. Deleting a subsystem of that size is a bulk change of exactly the kind CLAUDE.md
warns against, the code is inert, and the deletion is worth doing on its own terms rather than
folded into a behaviour change. It is recorded here as outstanding rather than left to be
discovered.

Attempt history is kept and still shown. A candidate who submitted attempts has a record of what
happened, and hiding it now would be rewriting their history rather than ours.

## What this costs

Candidates with no certification and no public repository lose their route to verified evidence.
That is a real loss and it is the point: the alternative was a route that anybody could pass
without doing the work, which is worth less than nothing to an employer paying for proof, and
actively harmful to the candidates who did do the work.

Two methods remain, and both resist a language model. A Credly badge is bound to the holder's
email by a salted hash we recompute against the address the candidate proved at sign-in. Repository
ownership is proven by publishing a one-time nonce from the account, then reading commit history
that a model cannot retroactively create.

## Relationship to ADR 0004

ADR 0004 sequenced multi-cloud work around writing more graded tasks before relabelling the
`aws_cloud` track. That sequencing is void: the tasks it was ordering no longer verify anything.

The underlying instruction it served — "Ensure it's not only AWS talent that could be found" — is
now met by a different route. Certification verification covers AWS, Google Cloud, the Kubernetes
exams set by the Linux Foundation, and HashiCorp, each checked against the issuer that actually
signs the credential. See the 2026-09-06 work on `issuer-badge.ts`.

Microsoft is absent and cannot be added. Microsoft stopped issuing certification badges through
Credly in 2024, and Azure certifications now live only in Microsoft Learn, which offers a
shareable transcript for a person to read rather than a credential bound to the holder's address.
There is nothing there to check autonomously, and the product says so rather than pretending
otherwise.
