# ADR 0006: Only the checks Zoryvex runs itself

Status: Accepted (founder decision, 2026-09-09)
Date: 2026-09-09

## The instructions

The founder, 2026-09-09, in one message:

> implement the gist hub make sure it's working, remove upload file feature, remove ask someone to
> confirm this

Three instructions that look unrelated and are not. Read together they finish the argument ADR 0005
started.

## What was removed, and why it is one decision

Zoryvex sells one distinction: what a person says about their work, against what a source they do
not control confirms. Every screen in the product is built on it, and the marketing page states it
in the first paragraph.

Two routes on the evidence page failed that test.

**Uploading a file.** A candidate chose the file. They could have written it that morning. The
pipeline behind it is careful work: a presigned POST straight to S3, a quarantine prefix, GuardDuty
malware scanning, promotion to an accepted key only once clean. All of that establishes that the
bytes are safe to serve. None of it establishes anything about the person, and it never moved a
claim to `verified`. It sat on the page looking like progress.

**Asking a colleague to confirm.** One step removed and the same problem: the candidate picks who
to ask. The implementation was honest about this. The confirmation was stored as the verifier's
words, shown with their organisation's domain and never their address, and labelled to the employer
as "Their words, not a check Zoryvex ran". That labelling was correct, and it is also the admission:
a thing the product has to caption every time it appears is a thing the product cannot stand behind.

Removing both leaves exactly the two checks Zoryvex performs itself, against a record somebody else
keeps:

- a certification confirmed with the body that issued it, bound to the address proven at sign-in
- control of a public repository, proven by a one-time code published in a public gist, then commit
  history read from GitHub

## The third instruction is the reason the first two are safe

"Implement the gist hub make sure it's working" is not a separate task. It is the load-bearing one.
Removing two routes narrows supply to candidates who hold a certification or own a public
repository, and that is only acceptable if the repository route actually works.

It was already implemented. What it had never had was a test against GitHub itself. Every existing
test handed the verifier a payload we wrote, which proves the logic and proves nothing about whether
GitHub still returns `public`, `owner.login`, `files[].content`, `files[].truncated`, `fork`, `size`
and `contributions` in the shape the code reads. A field GitHub renames fails no mocked test and
every real candidate.

`services/api/tests/github-verification-live.test.ts` now makes real calls and asserts on real
answers: the gist payload shape, the login proven from a code present in the body, the refusal when
it is absent, a real public repository verified with its contributor count, the refusal when the
proven account does not own it, a 404 returning null rather than throwing, and both URL forms GitHub
hands a candidate. Six tests, run with `ZORYVEX_LIVE_GITHUB=1 npm run test:live-github`, passing on
2026-09-09.

It is opt-in rather than part of `validate:all`, deliberately. CI must not go red because GitHub had
an outage or the runner's IP is over the anonymous sixty-an-hour limit. Neither is a fact about this
code, and a test that reports them as one teaches people to ignore it.

## What this costs

A candidate with no certification and no public repository now has no route to verified evidence at
all. ADR 0005 already accepted that cost when graded tasks went; this removes the two consolation
routes that were still on the page, so the cost is now the whole cost and it is visible.

They can still file claims. The product says plainly what that is worth: not checkable, it will not
reach employers as a proof, and here is what would get checked. That is a narrower product and an
honest one, and it is the same trade ADR 0005 made.

## What stays, and what is not authorized

`peer_verified` stays in the evidence strength ladder. Records already carrying it earned it under
the rules in force when they were made, and deleting the level would rewrite their history to tidy
an enum. Nothing new can attain it.

The upload/scan/download pipeline, the three peer endpoints, and their handlers remain in the
codebase and are unreachable from any screen. Deleting the evidence S3 bucket, its GuardDuty malware
protection, the EventBridge rule and queue that drive promotion, and the peer and upload API routes
is a Terraform **destroy**. Under CLAUDE.md that needs a plan, a diff, a tested rollback and explicit
founder approval, so it is `NOT AUTHORIZED BY FOUNDER` and recorded here rather than done quietly.
This is the same treatment ADR 0005 gave the graded-task catalogue, whose deletion is also still
outstanding. When approval comes, the three should go together in one reviewed destroy.
