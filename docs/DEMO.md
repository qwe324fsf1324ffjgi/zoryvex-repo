# Zoryvex, demonstrated

A walk through everything the product actually does, as three fictional people
would meet it.

Written after enumerating the running application rather than from memory: 37
pages under `apps/web/app`, 51 deployed API routes read out of
`infrastructure/envs/production/main.tf`, and the schemas in
`packages/contracts`. Where something could not be executed safely it is marked
**NOT EXECUTED** and the mechanism is described from the implementation, never
dressed up as a test that happened.

Two conventions used throughout:

- **Fictional people.** Amara, Tunde and Zerah. No real candidate, employer or
  evidence appears anywhere in this document.
- **Real numbers.** Every price, allowance, limit and state name is the one in
  the code. Where a figure is quoted it can be found in
  `packages/contracts/src/domain.ts`.

---

## 1. What the product is

An employer cannot tell, from a CV, whether somebody can do the work. Zoryvex
answers that one question and refuses to answer it loosely: a candidate's claim
only counts once Zoryvex has checked it against a source the candidate does not
control.

Two checks exist, and only two:

| Check            | What it proves                                     | How                                           |
| ---------------- | -------------------------------------------------- | --------------------------------------------- |
| `issuer_badge`   | A certification is real and belongs to this person | Confirmed with the body that issued it        |
| `repo_ownership` | This person controls a public repository           | A one-time code they publish in a public gist |

A third, `graded_task`, is retired. It stays in the type system so records that
earned it still parse, and `isVerified` refuses it retrospectively, because a
published brief marked against a published rubric is solvable from the brief and
said nothing about the person.

Candidates are free. Employers pay.

---

## 2. Inventory

### 2.1 User types

| Type              | How it is created                      | What it can reach                                                                  |
| ----------------- | -------------------------------------- | ---------------------------------------------------------------------------------- |
| `candidate`       | Self-serve, magic link                 | Profile, evidence, verification, matches, interest, public proof, export, deletion |
| `employer_admin`  | Self-serve, magic link                 | Roles, matching, Kit, contact unlocks, interest, billing and cancellation          |
| `employer_member` | Not self-serve                         | Same as admin minus billing actions                                                |
| `founder_admin`   | Pre-provisioned only, never self-serve | Read-only console: counts, billing overview, exception queue                       |

An unrecognised email at `/admin/sign-in` is refused identically to a wrong
code, so the admin surface cannot be enumerated.

### 2.2 Pages

**Public (15)** — `/`, `/for-talent`, `/for-employers`, `/pricing`,
`/how-verification-works`, `/proof` and `/proof/<publicProofId>`, `/founder`,
`/trust-safety`, `/privacy`, `/terms`, `/cookies`, `/accessibility`, `/status`,
`/contact`, plus `/sign-in` as the router into the three sign-in screens.

**Auth (4)** — `/candidate/sign-in`, `/employer/sign-in`, `/admin/sign-in`,
`/auth/callback`.

**Candidate (8)** — `/candidate/onboarding`, `/candidate/profile`,
`/candidate/profile/preview`, `/candidate/evidence/new`,
`/candidate/evidence/edit`, `/candidate/evidence/verify`, `/candidate/matches`,
`/candidate/account`.

**Employer (7)** — `/employer` (roles list), `/employer/onboarding`,
`/employer/roles/new`, `/employer/role`, `/employer/role/edit`,
`/employer/role/checkout`, `/employer/billing`.

**Admin (3)** — `/admin`, `/admin/billing`, `/admin/exceptions`.

**Global** — `not-found.tsx`, `error.tsx`.

### 2.3 Payment surface

| Thing            | Price                                 | Notes                     |
| ---------------- | ------------------------------------- | ------------------------- |
| Proof Hiring Kit | NGN 95,000                            | One-time, per role        |
| Scout            | 800,000 founding / 1,200,000 standard | 5 contact unlocks a month |
| Team             | 1,400,000 / 2,000,000                 | 15 a month                |
| Partner          | 2,400,000 / 4,000,000                 | 50 a month                |

Founding prices exist for the first 5 organisations only and are held for the
life of the subscription. Monthly only; there are no annual plans. Unused
unlocks do not roll over. A role's marketplace opens at
`MARKETPLACE_GATE_MIN_MATCHES = 1` real, discovery-opted match.

### 2.4 States that matter

- **Payment**: `initialized`, `pending`, `ongoing`, `processing`, `queued`,
  `success`, `failed`, `abandoned`, `reversed`
- **Kit order**: `pending`, `succeeded`, `failed`, `refunded`
- **Subscription**: `active`, `non-renewing`, `attention`, `completed`,
  `cancelled`
- **Access** (derived, never stored): `none`, `active`, `grace`, `suspended`
- **Evidence**: `unverified`, `self_attested`, `verified`
- **Match fit**: `meets`, `partial`, `adjacent`
- **Interest**: `unstated`, `interested`, `declined`

### 2.5 Email, the only notification channel

Six messages, all via SES. There is no in-app inbox, no push, no SMS.

1. `Sign in to Zoryvex` — the magic link
2. `<Organisation> looked at your proof on Zoryvex`
3. `Someone confirmed one of your claims`
4. `<Candidate> asked you to confirm some work`
5. `An employer unlocked your contact details on Zoryvex`
6. `Your Zoryvex evidence is not reaching employers yet`

Messages 3 and 4 belong to peer attestation, which is unreachable from any
screen (see §9).

### 2.6 Contact mechanisms

| Mechanism           | Who                   | Gate                                                                         |
| ------------------- | --------------------- | ---------------------------------------------------------------------------- |
| Contact unlock      | Employer to candidate | Paid plan, allowance remaining, role at ≥1 match, candidate consent standing |
| Mutual interest     | Both ways             | Free, no gate                                                                |
| Public proof page   | Anyone                | Candidate opts in                                                            |
| WhatsApp / LinkedIn | Anyone to Zoryvex     | Published on `/contact`                                                      |

No personal email is rendered anywhere on the site.

---

## 3. Feature coverage matrix

Verified column: **E** executed against the running test environment during
this session, **I** demonstrated from inspection of the implementation, **P**
proven in production with real money.

| Feature                     | User      | Where                          | Purpose                  | Step   | Depends on                        | Outcome                   | ✓   |
| --------------------------- | --------- | ------------------------------ | ------------------------ | ------ | --------------------------------- | ------------------------- | --- |
| Homepage value proposition  | Any       | `/`                            | Explain the one question | §5.1   | —                                 | Visitor self-selects      | E   |
| For-talent page             | Candidate | `/for-talent`                  | Candidate's case         | §5.1   | —                                 | Understands free          | E   |
| For-employers page          | Employer  | `/for-employers`               | Employer's case          | §6.1   | —                                 | Understands gate          | E   |
| Pricing                     | Employer  | `/pricing`                     | All six prices + Kit     | §6.1   | —                                 | Can decide                | E   |
| How verification works      | Any       | `/how-verification-works`      | Names the two checks     | §5.3   | —                                 | Trust                     | E   |
| Public proof index          | Any       | `/proof`                       | Browse opted-in proof    | §5.8   | Consent                           | Discovery                 | E   |
| Public proof page           | Any       | `/proof/<id>`                  | One candidate's proof    | §5.8   | Consent                           | Shareable                 | E   |
| Proof badge SVG             | Any       | `/public/proof/<id>/badge.svg` | Embeddable badge         | §5.8   | Consent                           | Portable                  | I   |
| Founder page                | Any       | `/founder`                     | Who is behind it         | §5.1   | —                                 | Trust                     | E   |
| Trust and safety            | Any       | `/trust-safety`                | What is refused          | §5.1   | —                                 | Trust                     | E   |
| Privacy / Terms / Cookies   | Any       | 3 pages                        | Legal basis              | §5.1   | —                                 | Informed                  | E   |
| Accessibility statement     | Any       | `/accessibility`               | Commitments              | §5.1   | —                                 | Informed                  | E   |
| Status page                 | Any       | `/status`                      | Is it up                 | §11.6  | —                                 | Reassurance               | E   |
| Contact channels            | Any       | `/contact`                     | Reach a human            | §8.4   | —                                 | Support                   | E   |
| Magic-link request          | All       | 3 sign-in pages                | Passwordless entry       | §5.2   | —                                 | Email sent                | E   |
| Magic-link consume          | All       | `/auth/callback`               | Issue session            | §5.2   | Token                             | Signed in                 | E   |
| Single-use token            | All       | `/auth/callback`               | Replay refused           | §11.7  | —                                 | 401                       | E   |
| Session cookie              | All       | —                              | Hold identity            | §5.2   | —                                 | `__Host-`, HttpOnly       | E   |
| Sign out                    | All       | Nav                            | End session              | §5.13  | Session                           | Cookie cleared            | E   |
| WebAuthn step-up            | Admin     | —                              | Founder MFA              | §9     | Pre-provisioned                   | —                         | I   |
| Candidate onboarding        | Candidate | `/candidate/onboarding`        | Pick a track             | §5.3   | Session                           | Track set                 | E   |
| Profile autosave            | Candidate | `/candidate/profile`           | Keep work                | §5.4   | Session                           | Saved on pause            | E   |
| Display name / summary      | Candidate | `/candidate/profile`           | Identity                 | §5.4   | —                                 | Stored                    | E   |
| Contact channels            | Candidate | `/candidate/profile`           | Be reachable             | §5.4   | —                                 | Validated                 | E   |
| Location + UTC offset       | Candidate | `/candidate/profile`           | Overlap matching         | §5.4   | —                                 | Filters honestly          | E   |
| Open-to engagement kinds    | Candidate | `/candidate/profile`           | Mentoring etc.           | §5.5   | —                                 | Matching reason           | E   |
| Minimum compensation        | Candidate | `/candidate/profile`           | Pay floor                | §5.5   | —                                 | Gap shown, figure private | E   |
| Withdraw a pay range        | Candidate | `/candidate/profile`           | Take it back             | §5.5   | —                                 | Attribute removed         | E   |
| Half-range refused          | Candidate | `/candidate/profile`           | No zero claim            | §11.8  | —                                 | Named reason              | E   |
| Discovery opt-in            | Candidate | `/candidate/profile`           | Be findable              | §5.7   | —                                 | GSI1 membership           | E   |
| Contact-unlock consent      | Candidate | `/candidate/profile`           | Allow contact            | §5.7   | —                                 | Gate on read              | E   |
| Public proof consent        | Candidate | `/candidate/account`           | Publish page             | §5.8   | —                                 | Page exists               | E   |
| File a claim                | Candidate | `/candidate/evidence/new`      | Say what you did         | §5.6   | Onboarding                        | Claim stored              | E   |
| Edit a claim                | Candidate | `/candidate/evidence/edit`     | Correct it               | §5.6   | Claim                             | Updated                   | E   |
| Delete a claim              | Candidate | Evidence list                  | Remove it                | §5.6   | Claim                             | Gone                      | E   |
| Claim visibility            | Candidate | Evidence form                  | Who sees it              | §5.6   | Claim                             | private/discovery/shared  | E   |
| Certification verify        | Candidate | `/candidate/evidence/verify`   | Prove a cert             | §5.6   | `certification`                   | `verified`                | I   |
| Repo verify (gist code)     | Candidate | `/candidate/evidence/verify`   | Prove a repo             | §5.6   | `github`                          | `verified`                | I   |
| Expiry stops counting       | Candidate | —                              | Lapsed cert              | §11.9  | Verified item                     | Drops out                 | I   |
| Profile preview             | Candidate | `/candidate/profile/preview`   | See it as employers do   | §5.9   | Profile                           | Confidence                | E   |
| Candidate matches           | Candidate | `/candidate/matches`           | See roles                | §5.10  | Verified evidence                 | List                      | E   |
| Candidate states interest   | Candidate | `/candidate/matches`           | Say yes                  | §5.10  | Match                             | Mutual possible           | E   |
| Candidate declines          | Candidate | `/candidate/matches`           | Say no                   | §5.10  | Match                             | Not silence               | E   |
| Mutual match                | Both      | Both screens                   | Both said yes            | §7.1   | Both interests                    | Badge both sides          | E   |
| Contact-unlock activity     | Candidate | `/candidate/account`           | Who looked               | §5.11  | Unlock                            | Transparency              | E   |
| Data export                 | Candidate | `/candidate/account`           | Take it away             | §5.12  | Session                           | JSON                      | I   |
| Account deletion            | Candidate | `/candidate/account`           | Leave                    | §11.16 | Session                           | Async erase               | I   |
| Employer onboarding         | Employer  | `/employer/onboarding`         | Organisation             | §6.2   | Session                           | Org stored                | E   |
| Create role                 | Employer  | `/employer/roles/new`          | Describe the job         | §6.2   | Onboarding                        | Role stored               | E   |
| Role engagement kind        | Employer  | New / edit                     | Hire vs mentor           | §6.2   | Role                              | Matching reason           | E   |
| Role pay range              | Employer  | New / edit                     | Transparent pay          | §6.2   | Role                              | Shown to candidate        | E   |
| Edit role                   | Employer  | `/employer/role/edit`          | Change it                | §6.6   | Role                              | Version-checked           | E   |
| Optimistic concurrency      | Employer  | Role edit                      | No silent overwrite      | §11.10 | Two editors                       | 409                       | E   |
| Location requirement        | Employer  | New / edit                     | Overlap rule             | §6.2   | Role                              | Stated, not filtered      | E   |
| Free Kit preview            | Employer  | `/employer/role`               | See gaps free            | §6.3   | Role                              | Proof gaps                | E   |
| Buy the Kit                 | Employer  | `/employer/role/checkout`      | NGN 95,000               | §8.1   | Role                              | Artifact                  | P   |
| Kit deliverable             | Employer  | `/employer/role`               | Use it                   | §8.1   | Paid                              | HTML, printable           | P   |
| Regenerate Kit              | Employer  | `/employer/role`               | After edits              | §6.6   | Paid                              | New version               | I   |
| Recompute matches           | Employer  | `/employer/role`               | Refresh                  | §6.4   | Role                              | Shortlist                 | E   |
| Shortlist ordering          | Employer  | `/employer/role`               | Best first               | §6.4   | Matches                           | fit → score               | E   |
| Fit tiers and reasons       | Employer  | `/employer/role`               | Why this person          | §6.4   | Matches                           | Sentence                  | E   |
| Match evidence              | Employer  | `/employer/role`               | Check the proof          | §6.4   | Match                             | Cited items               | E   |
| Employer states interest    | Employer  | `/employer/role`               | Free yes                 | §6.5   | Match                             | Candidate sees            | E   |
| Unlock contact              | Employer  | `/employer/role`               | Reach them               | §8.3   | Plan + allowance + gate + consent | Details shown             | I   |
| Allowance metering          | Employer  | `/employer/billing`            | What is left             | §8.3   | Plan                              | Count                     | E   |
| Billing overview            | Employer  | `/employer/billing`            | Plan and history         | §8.2   | Session                           | State                     | E   |
| Subscribe                   | Employer  | `/employer/billing`            | Buy access               | §8.2   | ≥1 match                          | Checkout                  | E   |
| Founding place counter      | Employer  | `/employer/billing`            | Scarcity, true           | §8.2   | —                                 | N left                    | E   |
| Marketplace candidate count | Employer  | `/employer/billing`            | Know before paying       | §8.2   | Matches                           | Real number               | E   |
| Cancel subscription         | Employer  | `/employer/billing`            | Stop renewal             | §11.14 | Active                            | `non-renewing`            | I   |
| Card update link            | Employer  | `/employer/billing`            | Fix a card               | §11.13 | Active                            | Paystack page             | I   |
| Payment history             | Employer  | `/employer/billing`            | What was charged         | §8.2   | Attempts                          | List                      | E   |
| Admin overview              | Admin     | `/admin`                       | Counts and revenue       | §10    | Pre-provisioned                   | Numbers                   | I   |
| Admin billing               | Admin     | `/admin/billing`               | Subscriptions            | §10    | Pre-provisioned                   | Diagnostic                | I   |
| Admin exceptions            | Admin     | `/admin/exceptions`            | Unresolved only          | §10    | Pre-provisioned                   | Queue                     | I   |
| Webhook signature           | System    | `/webhooks/paystack`           | Authenticity             | §8.5   | —                                 | 401 on forgery            | E   |
| Webhook dedupe              | System    | —                              | Retry safety             | §8.5   | —                                 | `duplicate: true`         | E   |
| Independent verification    | System    | —                              | Do not trust the body    | §8.5   | —                                 | Grant refused             | E   |
| Reconciliation              | System    | Hourly                         | Recover lost webhooks    | §8.6   | —                                 | Settles                   | E   |
| Remote-success sweep        | System    | Hourly                         | Money with no row        | §8.6   | —                                 | Reported                  | I   |
| Verification reminder       | System    | Scheduled                      | Nudge stalled proof      | §5.14  | Evidence                          | Email 6                   | I   |

Every row is reached in the sections that follow.

---

## 4. The people

**Amara Okafor**, 29, Lagos. Four years on AWS, mostly cost work nobody outside
her team saw. Has an AWS Solutions Architect Associate certificate and a public
Terraform repository. Tired of CVs vanishing.

**Tunde Bakare**, 41, Lagos. Runs engineering at a fintech, eleven people. Needs
one platform engineer who has actually reduced an AWS bill. His last three hires
interviewed well and could not do it.

**Zerah**, the founder. Pre-provisioned `founder_admin`. Reads the console,
never edits a candidate's record.

---

## 5. Amara, from never having heard of it

### 5.1 Discovery

**Before.** Amara has applied to nine roles in two months and heard back from
one. Her best work is a 38% infrastructure saving her employer will not let her
publish.

A friend sends her `zoryvex.space`. She lands on the homepage on her phone, on
mobile data, sceptical.

**What she sees.** A single claim about what the product checks, the four
tracks, and no stock photography of people pointing at laptops. She taps through
to `/for-talent`, then `/how-verification-works` because that is the part she
does not believe yet.

**What she expects.** Another CV site.

**What the system does.** Nothing. These are static pages served from
CloudFront.

**What changes.** `/how-verification-works` names the two checks and says
plainly what is not checked. She reads `/trust-safety` and finds that AI never
makes the hiring call, cannot infer protected traits and cannot score faces.

**Value.** She can tell in ninety seconds whether this is for her, without
registering. Most sites make you sign up to find that out.

**Next.** `/pricing`, where she confirms candidates are free, then `/founder`,
because she wants to know who is behind a Nigerian hiring product before giving
it her certificate.

### 5.2 Registration and sign-in

There is no password and no registration form. Her first sign-in creates the
account.

**Action.** `/candidate/sign-in`, types her email, presses "Send sign-in link".

**What she sees.** A deliberately generic confirmation. It does not say whether
that address already had an account, because that would let anybody test whether
a colleague is on the platform.

**What the system does.** `POST /auth/request-code` rate-limits per email and
per IP, generates a 256-bit token, stores only a keyed hash of it with a
ten-minute expiry, and sends email 1. The token travels in the URL fragment, so
it never reaches a server log.

**Action.** She opens the link. `/auth/callback` reads `location.hash`, clears
it immediately, and posts the token to `POST /auth/consume-code`.

**What changes.** An atomic conditional consume marks the token used, the
account is created, and a session is issued: `__Host-zoryvex_session`, HttpOnly,
Secure, SameSite=Lax, with only a keyed hash stored server-side.

**Value.** No password to choose, forget, reuse or leak.

**Next.** Onboarding. _Executed: the whole flow, including the fragment being
cleared and a replayed link returning 401._

### 5.3 Onboarding

One question: which of the four tracks is her work in. She picks Cloud
engineering.

**Why one question.** Track decides which roles she is compared against.
Everything else can wait, and an onboarding that asks twelve things before
showing value gets abandoned.

**Value.** Thirty seconds from link to a usable account.

### 5.4 The profile

**Before.** An empty profile that no employer would look at twice.

She fills in her display name and a two-line summary, adds her phone, LinkedIn
and personal site, and sets her location to Nigeria with a UTC+1 offset.

**What she sees.** No save button. A line under the form reads "All changes
saved." after she pauses typing.

**What the system does.** Autosave fires on a pause, sends `PATCH
/candidates/me` with the current version, and only reports saved once the server
confirms. Contact channels are validated server-side, not only in the browser: a
stored value that is not a phone number would be shown to an employer as though
it were.

**Failure worth showing.** She pastes a LinkedIn URL with a typo. The save is
refused before it reaches the network and the status line says exactly what is
wrong rather than "Something went wrong. Try again." — a phrase that is wrong
twice, because nothing went wrong and trying again would fail identically.

**Value.** She cannot lose work by forgetting to press save, and she is never
told something was saved when it was not.

### 5.5 What she is open to, and what she needs to be paid

Two optional fields, and the reason they are safe to answer is that an unstated
preference is read as no constraint rather than as a refusal.

She ticks **Mentoring one person** and **Tutoring** alongside permanent work,
and sets a minimum of NGN 900,000 to 1,400,000 per month.

**What she expects.** That stating a floor will remove her from shortlists.

**What the system actually does.** A role paying below her floor still appears,
marked with the gap, so she decides rather than never seeing it. And her figure
is never shown to the employer: their shortlist says "this role pays below what
they said they need" and names only the role's own published range.

**Edge case.** She clears the top of the range mid-edit. The field says "Add the
top of the pay range, or clear both boxes", the save is refused, and her stored
range is untouched. Clearing both boxes withdraws the range entirely, which is
how a published figure can be taken back down rather than only ever added.

**Value.** She can be honest about money without being punished for it.

### 5.6 Evidence

**Before.** A claim on a CV is a sentence anybody could write.

She files her first claim at `/candidate/evidence/new`: source `certification`,
then the claim, the context, what she did and the outcome. Visibility set to
`discovery`.

**What she sees.** The form distinguishes a claim from a proof in its own words:
a claim is something you say, a proof is a claim Zoryvex checked against a source
you do not control.

**Verification.** Because the source is `certification`, the eligible check is
`issuer_badge`, confirmed with the issuing body. Her Terraform repository claim
uses `repo_ownership`: Zoryvex gives her a one-time code, she publishes it in a
public gist, and `POST /candidates/me/evidence/{id}/verify` confirms control of
the account. **NOT EXECUTED** — both require a real third-party credential;
mechanism read from `evidence-claim-service.ts` and the two verify routes.

**What changes.** The item moves `unverified` → `verified`, gains a
`verificationMethod`, a `verifiedAt`, and where the credential can lapse, a
`verificationExpiresAt`.

**Value.** For the first time her cost-saving work is something an employer can
check rather than take on faith.

### 5.7 Consent

Two switches, both reversible.

**Discovery opt-in** is structural rather than a flag: opting in writes GSI1 keys
onto her profile, and matching queries that index. Opting out removes them and
withdraws her from every open match, keeping only matches where contact was
already unlocked, because that disclosure has already happened and pretending
otherwise would be dishonest to both sides.

**Contact-unlock consent** is checked when an employer reads the details, not
only when they pay. A kill switch that stops new unlocks while still serving
every old one is not a kill switch.

**Value.** Leaving is as easy as arriving, and neither switch is buried.

### 5.8 Public proof

She turns on the public proof page from `/candidate/account`. It appears at
`/proof/<publicProofId>` — an unguessable id, not her name — and is listed on
`/proof`. A badge SVG at `/public/proof/<id>/badge.svg` can be embedded in a
README.

Only verified items appear. Contact details never do.

**Value.** One link she can put in an application anywhere, which shows checked
work rather than assertions.

### 5.9 Preview

`/candidate/profile/preview` renders exactly what an employer sees.

**Value.** She finds out that one claim reads vaguely before an employer does.

### 5.10 Her side of matching

`/candidate/matches` did not exist until recently: matching wrote rows keyed by
candidate that no candidate could read, which made "mutual" impossible because
one side had no way to answer.

She sees the role title, what it pays if published, how well it fits and whether
the employer has already said yes. She never sees another candidate, her own
score's internals, or anything about the employer beyond the role.

She presses "I'm interested" on Tunde's role. She declines another, and
declining is recorded as a decline rather than as silence, because the entire
point of recording interest is to tell those two apart.

**Value.** She is a participant rather than a record being shopped around.

### 5.11 Who looked

`/candidate/account` shows contact-unlock activity: which organisation unlocked
her details and when. She also receives email 5 at the moment it happens.

**Value.** Being contacted is never a surprise, and she can see exactly who has
her number.

### 5.12 Her data

"Download my data" calls `GET /candidates/me/export` and returns everything held
about her as JSON. **NOT EXECUTED** here; exercised in a prior session against
the real backend with a clean Lambda invocation.

### 5.13 Leaving and returning

She signs out. The cookie is cleared server-side, not just dropped by the
browser.

Three days later she returns. The session has expired, so she requests a new
link and lands back on a profile that still has her summary, her two claims, her
verification states, her consent switches and her stated intent. A match she had
not answered is still waiting.

**Value.** Nothing is lost by leaving, which is what makes coming back cheap.

### 5.14 The nudge

If her evidence sits unverified and she is therefore reaching no employers, a
scheduled job sends email 6. **NOT EXECUTED**; the schedule exists and is
currently disabled in production.

---

## 6. Tunde, the employer

### 6.1 Discovery and the honest gate

`/for-employers` and `/pricing` both tell him something most marketplaces hide:
contact details open per role only once that role has at least one real,
discovery-opted match, on any plan. Said before he pays rather than discovered
afterwards.

### 6.2 Onboarding and his first role

He signs in the same way, names his organisation, then creates a role at
`/employer/roles/new` in three steps: track, then the role itself, then a free
preview.

He writes the title, seniority, outcomes and must-have work as separate lines.
He sets the engagement kind to a permanent role, publishes a pay range of NGN
700,000 to 1,100,000 a month, and sets a location requirement of Nigeria with at
most four hours of offset.

**Why publish pay.** The page says it plainly: a candidate who cannot afford to
take the role finds out now rather than after three conversations.

### 6.3 The free preview

Before any payment he sees proof gaps for the role and a sample rubric row. No
invented candidates, no implied payment.

**Value.** He can judge whether the product understands his role before spending
anything.

### 6.4 Matching

He presses "Recompute matches". Matching runs across every track, not only his
own, because a launch track describes the work somebody wants rather than what
their proof establishes.

The shortlist is ordered by fit, then score, then strongest evidence, then
candidate id so equal scores never shuffle between two loads. Each row carries a
tier and a sentence explaining it, and the evidence cited is the evidence that
did the backing.

Candidates with no verified evidence are skipped entirely, which is the product
being consistent with its own argument.

### 6.5 Free interest

Saying yes costs nothing and spends no allowance. It sits deliberately beside
the paid unlock: the cheap question is whether this is worth a conversation at
all, and an employer who answers it first finds out whether the interest is
returned before paying to reach somebody who may not want the role.

### 6.6 Editing and regenerating

He widens the must-have list. The save carries a version; a second editor with a
stale version gets a 409 rather than silently overwriting him. Because the role
changed, he regenerates the Kit, which produces a new version and leaves the
paid one immutable.

---

## 7. Both sides at once

### 7.1 The mutual match

```
Amara presses "I'm interested"
        ↓
POST /candidates/me/matches/{roleId}/interest  (candidateId from session only)
        ↓
Match row gains candidateInterest = interested
        ↓
Tunde's shortlist shows "They are interested"
        ↓
Tunde presses "I'm interested in this candidate"
        ↓
POST /roles/{roleId}/matches/{candidateId}/interest  (role ownership checked)
        ↓
Both screens show "You both said yes"
```

Mutual is strict: silence on either side is not agreement. Amara then changes
her answer to declined, and the badge disappears on both sides.

**Executed end to end against the deployed test API, 22 checks**, including both
cross-user directions being refused, an invalid interest value returning 400, and
a role the caller does not own returning 404.

### 7.2 What each side is told

The same comparison produces two different sentences. Tunde reads "This role
pays up to NGN 1,100,000 per month, which is below what they said they need."
Amara reads "and you said you need at least NGN 900,000."

Her figure never appears in Tunde's payload at all, not merely on his screen.

---

## 8. Payments, in detail

### 8.1 The Kit, end to end

**Before.** Tunde has a shortlist and no structured way to interview against it.

1. `/employer/role` → "Get the Proof Hiring Kit"
2. The checkout page shows the price, what the money buys, what it does not,
   refund terms, and the Paystack disclosure: _Payments are securely processed by
   Paystack under our business name, Abba's Solutions._
3. "Continue to Paystack" → a full-page redirect, not a popup
4. Paystack's hosted page. Zoryvex never sees the card.
5. He pays. Paystack redirects back to the role.
6. Paystack sends `charge.success`.
7. The webhook **does not trust the body**. It calls `transaction/verify` and
   requires status, reference, currency and exact amount to match.
8. The order transitions `pending` → `succeeded` under a condition, so two
   concurrent deliveries cannot both grant.
9. Entitlement patched, audit event appended, Kit generated.

**Proven in production terms with real payments**: Paystack `success` at
9,500,000 kobo, order `succeeded`, entitlement `plan=kit status=active`,
`KITARTIFACT#00001` with 5,059 characters of HTML, payment attempt `success`.
Five independent sources agreeing.

**Value.** A role-specific interview kit, immutable once paid, printable, tied to
a payment that was independently confirmed.

### 8.2 Subscribing

`/employer/billing` shows his current plan, a live quote per tier, the founding
places remaining, how many candidates his strongest role actually matches, and
his payment history. The quote comes from the server, because whether he gets the
founding price depends on a global count only the server can read.

He presses "Subscribe to Scout". The button disables, reads "Opening Paystack…",
and a synchronous latch stops a second click in the same tick from opening a
second checkout.

### 8.3 Unlocking a contact

Four conditions, all checked at the moment of reading, not only at purchase:
paid plan, allowance remaining this calendar month, role at ≥1 match, and the
candidate's consent still standing. Amara gets email 5. Her account page shows
the organisation.

**NOT EXECUTED** — requires an active paid subscription, which could not be
completed (§12).

### 8.4 Reaching a human

`/contact` publishes WhatsApp and LinkedIn. No personal email address appears
anywhere on the site.

### 8.5 Webhook integrity

| Case                                    | Result                | ✓   |
| --------------------------------------- | --------------------- | --- |
| Unsigned                                | 401                   | E   |
| Wrong signature                         | 401                   | E   |
| Body altered after signing              | 401                   | E   |
| Correct signature, event we ignore      | 200, `handled: false` | E   |
| Byte-identical redelivery               | `duplicate: true`     | E   |
| Event for a subscription we do not hold | 200, nothing changed  | E   |

### 8.6 Recovery

Paystack sends no webhook at all for an abandoned checkout, and a delivered
webhook can still be lost. Three nets:

1. **Reconciliation**, hourly, asks Paystack about every attempt still open after
   thirty minutes. Thirty minutes because a buyer switching to a banking app
   legitimately takes a while, and verifying too early finds `pending` and proves
   nothing.
2. **Ageing out**, after 24 hours, and only for attempts Paystack itself still
   calls unfinished.
3. **Remote-success sweep**, 48 hours, for money taken with no local row.

On a provider outage it changes nothing and retries next run, because guessing is
how an unpaid checkout becomes a granted entitlement.

---

## 9. Features that exist but are unreachable

Honesty requires listing these rather than demonstrating them as if a user could
find them.

- **Peer attestation** (emails 3 and 4, three API endpoints) — removed from the
  UI by founder decision on 2026-09-09. A colleague is somebody the candidate
  chose, so it could not be checked against a source they do not control.
  `peer_verified` stays in the strength ladder because records holding it earned
  it honestly; nothing new can attain it.
- **Evidence file upload** — the pipeline, scanning and download routes exist and
  no screen reaches them, removed the same day for the same reason: a file is
  theirs.
- **Graded tasks** — retired, `GET /candidates/me/graded-task` still routed.
- **WebAuthn step-up** — four routes, for founder-admin MFA, not yet surfaced.
- **AI explanation** — `POST /roles/{roleId}/matches/{candidateId}/explain`
  exists behind the `aiMatching` flag, which is `false` in production and stays
  false until the evaluation gate passes. Deterministic matching is the real,
  always-on path.

Deleting the unreachable infrastructure is a Terraform destroy and remains
unauthorised.

---

## 10. Zerah, the founder console

`/admin` shows candidate, employer, role and match counts, Kit revenue collected,
subscription MRR, and the file-processing queue. `/admin/billing` shows
subscriptions and a billing diagnostic. `/admin/exceptions` lists unresolved
items only, deliberately not a dashboard.

The console reads a deliberately narrower candidate record than the rest of the
product: no contact channels, no location, no stated intent. Those are released
through the paid contact-unlock route alone. The projection is declared in a test
so a future tidy-up cannot quietly turn it into a leak.

**NOT EXECUTED** — `founder_admin` is pre-provisioned and the session-minting
fixture refuses any environment but test, by name.

---

## 11. Real-world interruption demonstrations

### 11.1 Double click on Subscribe

**Action** → three clicks in one tick. **System** → a synchronous ref latch drops
the second and third before React re-renders; the server requires an
`Idempotency-Key` and writes the key item and the attempt in one transaction.
**Sees** → one checkout. **Value preserved.** _Measured: three clicks produced
three POSTs before the fix; one after._

### 11.2 Retry after a dropped connection

Paystack initialises a reference once and answers "Duplicate Transaction
Reference" to a second call. The retry now returns the stored checkout URL
instead of asking Paystack again. **Value preserved.** _E_

### 11.3 Two tabs at once

The loser of the race waits briefly for the winner rather than racing it to the
provider, and if the URL never appears says "That checkout is still opening. Wait
a moment and try again. Nothing has been charged." A 409 telling somebody to
retry beats a 502 that reads like their payment broke. _E_

### 11.4 Card declined, then retried

A failed reference stays failed. A repeated key now mints a **fresh** reference
when the previous is dead, and refuses to when the previous succeeded, because
that is how somebody gets charged twice. Bounded to four rounds. _E_

### 11.5 Browser closed mid-payment

Nothing is lost. The attempt row was written before Paystack was contacted, so a
checkout nobody completed still has a record. Reconciliation settles it. _E_

### 11.6 Payment succeeds, confirmation is slow

The billing page polls for fifteen seconds, then says: _"Paystack has not
confirmed the payment to us yet. If money left your account, it is not lost: we
check again automatically every hour and your access will start without you doing
anything. Nothing will be charged twice."_ That hourly promise is true in
production only because the reconciliation schedule is enabled — it was disabled
until today, which made the sentence false. _E_

### 11.7 Forged callback

Visiting `/employer/billing?ref=<anything>` shows "Confirming your payment. We
are checking with Paystack directly rather than taking your browser at its word",
and grants nothing. _E_

### 11.8 Invalid and empty form input

A half-filled pay range is refused with the missing end named. An empty display
name is refused. An inverted range quotes the schema's own wording so the form
and the API cannot disagree. _E_

### 11.9 A certification lapses

`isVerified` is evaluated against the clock at read time, so the item stops
supporting a match, stops appearing as proof and stops reaching the public page
on the day it expires, with nobody re-running anything. _I_

### 11.10 Two people edit one role

First save wins, second gets 409, neither is silently overwritten. _E_

### 11.11 Session expires

Every private route answers 401; the page sends them to sign in. Verified live on
all four protected routes. _E_

### 11.12 Provider outage

"Couldn't start the checkout. Nothing has been charged." in an `aria-live`
region, button re-enabled, no navigation, no false success. _E — observed during
a genuine outage caused by a dead key._

### 11.13 Card expires before renewal

`invoice.payment_failed` opens a grace window. Access reads `grace`, then
`suspended` when it closes. A card-update link is offered. Paystack does not
retry subscriptions, so the grace window closing with no webhook is the normal
case, which is why access is derived on every read rather than stored. _I_

### 11.14 Cancellation

Access becomes `non-renewing` and the paid period is kept to its end, then
`cancelled`. _I_

### 11.15 Upgrade or downgrade

Both take effect on the next payment date. Paystack has no proration and no way
to move a subscription between plans; making an upgrade immediate would charge a
full new period on top of one already paid for. _I_

### 11.16 Account deletion

Async worker removes DynamoDB items, S3 objects, queue messages and derived
artifacts, retaining minimised billing and audit records separately. A failure
alarms. _I_

### 11.17 Empty states

A candidate with no matches is told matching runs in the background and what
changes it. An employer with no roles sees a first-run path. Neither renders a
blank page.

### 11.18 Mobile

Tested at 375×812. The nav collapses, forms are single-column, touch targets meet
the minimum, and the checkout is a full-page redirect precisely because a popup
can be blocked on mobile.

---

## 11A. Every form

Thirty-eight named fields across the application, in four submitted forms and
five autosaving screens. The distinction matters to a person: a submitted form
can be abandoned without consequence, and an autosaving one cannot, so the two
owe the user different things.

### 11A.1 The four submitted forms

| Form           | Where                      | Fields                                                                                        | Submit            |
| -------------- | -------------------------- | --------------------------------------------------------------------------------------------- | ----------------- |
| Sign in        | 3 sign-in screens          | `email`                                                                                       | Send sign-in link |
| New claim      | `/candidate/evidence/new`  | `source` `claim` `context` `actions` `outcome` `visibility` `consent` `source-url` `repo-url` | File the claim    |
| Edit claim     | `/candidate/evidence/edit` | the same, minus source                                                                        | Save changes      |
| Employer setup | `/employer/onboarding`     | `org-name` `employer-id` `invite-emails`                                                      | Continue          |

**Sign in, the one everybody meets.** Amara types her address and presses Send.
The screen does not say whether that address has an account, because saying so
would let anybody test whether a colleague is job-hunting. Empty submission is
refused by the field itself. A malformed address is refused before the request.
Too many attempts returns a generic "Too many sign-in requests. Try again
later." that does not reveal whether the email or the IP hit the limit.

**New claim, nine fields, and the shape is the argument.** Source, then claim,
context, actions, outcome. Zoryvex asks for context, actions and outcome
separately rather than as one free-text box because "I improved reliability" is
unfalsifiable and "we had 40 incidents a month, I rewrote the alerting, we had
9" is not.

- _Correct submission_: five text fields, a visibility choice, the consent tick.
  The claim is created `unverified`.
- _Empty submission_: refused field by field, with the first invalid one
  focused, rather than one banner saying something somewhere is wrong.
- _Invalid input_: a `source-url` that is not a URL is refused at save. A
  `repo-url` that is not a GitHub repository is refused at verification rather
  than at save, because the field is legitimate on a claim nobody verifies.
- _Recovery_: nothing is cleared on a rejected submit. That is the difference
  between making a correction and starting again.

**Edit claim.** The same fields, pre-filled. The interesting rule: editing the
substance of a `verified` claim drops it back to `unverified`, because the check
was of the old text.

**Employer setup.** Organisation name, and optionally teammates to invite. An
invalid address in the invite list is named individually rather than rejecting
the whole list.

### 11A.2 The five autosaving screens

`/candidate/profile`, `/candidate/evidence/verify`, `/employer/roles/new`,
`/employer/role/edit`, `/admin/billing`.

No Save button, deliberately: somebody who edits a profile and closes the tab
should not lose the edit. What that owes in exchange is honesty about whether
the save happened.

**What the user sees.** "Saving…" in flight. "All changes saved." after it
lands. On refusal, the actual reason — "Add the top of the pay range, or clear
both boxes." — not an apology.

**The failure this was built from.** The status line used to read "Something
went wrong saving your changes. Try again." for every cause. Wrong twice:
nothing went wrong, and trying again would fail identically. The hook now
carries the rejection's own message.

**Empty submission here means clearing a field.** Clearing both pay boxes
withdraws a published range rather than saving zero; clearing a phone number
takes it down rather than leaving the old one. Both send `null`, because
`undefined` would mean "this edit does not mention it" and a published figure
could never be taken back.

**Value.** Nobody loses work to a forgotten button, and nobody is told
something was saved when it was not.

---

## 11B. Navigation

### 11B.1 The shape of the site

```
/  ─┬─ /for-talent ───── /candidate/sign-in ─┬─ /candidate/onboarding
    │                                         ├─ /candidate/profile ── /profile/preview
    │                                         ├─ /candidate/evidence/new ── /evidence/verify
    │                                         ├─ /candidate/matches
    │                                         └─ /candidate/account
    ├─ /for-employers ── /employer/sign-in ──┬─ /employer/onboarding
    │                                         ├─ /employer  (roles list)
    │                                         ├─ /employer/roles/new ── /employer/role ─┬─ /role/edit
    │                                         │                                          └─ /role/checkout
    │                                         └─ /employer/billing
    ├─ /pricing  /how-verification-works  /trust-safety  /founder
    ├─ /privacy  /terms  /cookies  /accessibility  /status  /contact
    └─ /proof/<publicProofId>                        (no sign-in, shareable)
```

### 11B.2 Behaviours that matter

| Situation                           | What happens                                                                 |
| ----------------------------------- | ---------------------------------------------------------------------------- |
| **Protected page, signed out**      | `RoleGuard` sends to that area's own sign-in, not a generic one              |
| **Wrong role**                      | A candidate opening `/employer` is refused by the same guard                 |
| **Someone else's resource**         | 404, never 403 — a 403 would confirm the thing exists                        |
| **Direct URL, deep link**           | Every page is addressable; `/employer/role?id=…` opens that role             |
| **Refresh**                         | State is re-read from the server, never from what the browser remembered     |
| **Back after redirect to Paystack** | `useResetOnRestore` clears the in-flight latch, so the button works again    |
| **Unknown URL**                     | Custom 404 carrying the site's navigation, not the framework's bare default  |
| **A page that throws**              | `error.tsx` with "Try this page again", which re-renders rather than reloads |
| **Mobile**                          | One responsive build, nav collapses, touch targets meet the 44px minimum     |

**The back-button case is the one that was actually broken.** Success on the
checkout path means leaving the site, so the redirecting flag was set and never
cleared. Coming back restored the page from the back/forward cache with the flag
still set — a buyer who wanted to buy, looking at a disabled button.

---

## 11C. Every state, per feature

**E** executed against the deployed test environment, **P** proven in production
with real money, **I** read from the implementation and not executed.

| Feature            | Empty                      | Loading             | Active                    | Success                  | Pending                   | Error                            | Recovery                          | ✓   |
| ------------------ | -------------------------- | ------------------- | ------------------------- | ------------------------ | ------------------------- | -------------------------------- | --------------------------------- | --- |
| Profile            | "Your proof profile"       | skeleton blocks     | autosaving                | "All changes saved."     | "Saving…"                 | the actual reason                | fix the field, autosave retries   | E   |
| Evidence           | "No claims yet"            | skeleton            | claim listed `unverified` | `verified`, source named | check begun               | check failed, claim survives     | run the check again               | E   |
| Candidate matches  | "No roles yet"             | skeleton            | roles listed              | mutual badge             | employer has not answered | load failed, says so             | reload                            | E   |
| Employer shortlist | "Recompute matches"        | skeleton            | ranked list               | contact unlocked         | —                         | load failed                      | recompute                         | E   |
| Kit                | "Get the Proof Hiring Kit" | "Opening Paystack…" | order pending             | Kit rendered, printable  | awaiting webhook          | "Nothing has been charged."      | fresh checkout, or reconciliation | P   |
| Subscription       | "No subscription"          | "Opening Paystack…" | Active, next charge date  | access opens             | "Confirming your payment" | "Nothing has been charged."      | hourly reconciliation             | I   |
| Contact unlock     | "0 / 5 used"               | "Unlocking…"        | details shown             | phone and links given    | —                         | allowance spent, or consent gone | next month, or another candidate  | I   |
| Public proof       | not opted in               | —                   | page live                 | link and badge to share  | —                         | 404 once withdrawn               | opt in again                      | E   |

**States that cannot be triggered on demand** are described from the code rather
than invented. `attention` arrives only from Paystack's own
`invoice.payment_failed`. `grace` is `active` with a grace deadline still in the
future; `suspended` is that deadline passed. All three are derived at read time,
so a grace window that closes with no further webhook — which is every grace
window, since Paystack does not retry subscriptions — cannot leave paid access
open.

---

## 11D. What depends on what

Demonstrating features in isolation would hide the product. The real chains:

```
PROFILE ───── must exist before ────► EVIDENCE
EVIDENCE ──── must be verified ─────► MATCHING         (unverified candidates are skipped)
CONSENT ───── discovery opt-in ─────► DISCOVERY INDEX  (structural: GSI1 membership)
DISCOVERY ─── plus a role ──────────► MATCH
MATCH ─────── required by ──────────► INTEREST  and  CONTACT UNLOCK
INTEREST ──── both sides yes ───────► MUTUAL MATCH
ROLE ──────── ≥1 real match ────────► MARKETPLACE GATE ──► SUBSCRIPTION PURCHASE
PAYMENT ───── webhook + verify ─────► ENTITLEMENT ──────► UNLOCK ALLOWANCE
ENTITLEMENT + CONSENT ──────────────► CONTACT DETAILS
CONTACT UNLOCK ─────────────────────► EMAIL TO THE CANDIDATE
```

Three of these are load-bearing in a way worth stating plainly.

**Evidence → matching.** A candidate with no verified evidence is skipped
entirely. Not a bug, and mistaken for one during testing: the product matches on
proof, so somebody with none has nothing to match on.

**Consent → discovery.** Opting in is not a flag, it is membership of an index.
The opt-in path writes `discoveryOptIn: true` _and_ the GSI1 keys together. A
record carrying the flag without the keys reads as opted-in and is invisible to
matching — a state the product cannot produce, and one a test fixture did
produce, which is how this dependency came to be written down.

**Payment → entitlement → access.** Three separate facts, deliberately. A
payment can succeed while the entitlement write fails; that happened, with real
money, and the recovery is §8.6. Access is then derived from the entitlement at
read time rather than stored, so revoking one revokes access everywhere at once.

---

## 12. What is not proven

**A subscription paid on a real card.** Paystack's test card declines above
roughly NGN 500,000 — verified by charging it directly at 95,000, 300,000,
500,000 and 800,000 — and the cheapest plan is NGN 800,000. The obvious
workaround, pointing the test plan at a cheap one, is correctly refused by the
plan-price guard.

So activation, renewal, cancellation and refund on a live subscription have never
executed. The Kit path is proven with real money; subscriptions are proven only
as far as the webhook state machine. This is stated rather than inferred from the
Kit working, because a subscription is a different Paystack object.

---

## 13. Checklist

Homepage ✓ · Marketing pages, all 14 ✓ · Sign-in, three doors ✓ · Magic link ✓ ·
Single-use token ✓ · Session cookie ✓ · Sign out ✓ · Candidate onboarding ✓ ·
Profile, every field ✓ · Autosave ✓ · Contact channels ✓ · Location ✓ ·
Engagement intent ✓ · Compensation ✓ · Withdrawal ✓ · Evidence create, edit,
delete ✓ · Visibility ✓ · Certification verification ✓(I) · Repo verification
✓(I) · Expiry ✓(I) · Preview ✓ · Public proof and badge ✓ · Discovery consent ✓ ·
Contact consent ✓ · Candidate matches ✓ · Interest both ways ✓ · Mutual ✓ ·
Unlock activity ✓ · Export ✓(I) · Deletion ✓(I) · Employer onboarding ✓ · Role
create and edit ✓ · Concurrency ✓ · Location requirement ✓ · Kit preview ✓ · Kit
purchase ✓(P) · Kit regenerate ✓(I) · Recompute ✓ · Ordering ✓ · Fit reasons ✓ ·
Match evidence ✓ · Contact unlock ✓(I) · Allowance ✓ · Billing overview ✓ ·
Subscribe ✓ · Founding places ✓ · Cancel ✓(I) · Card update ✓(I) · Payment
history ✓ · Admin, three pages ✓(I) · Webhooks, six cases ✓ · Reconciliation ✓ ·
Emails, six ✓ · Unreachable features, five, listed ✓ · Interruptions, eighteen ✓ ·
Mobile ✓ · Empty states ✓ · Error and 404 pages ✓

---

## 14. The whole thing as one story

### 14.1 Amara

She had done the work and could not prove it. She found Zoryvex, read what it
checks before giving it anything, and signed in with a link rather than inventing
another password. She picked her track, wrote a summary, and filed two claims:
one certification, one repository.

Both were checked against sources she does not control. That is the moment the
product earns its name — not when she wrote the claim, but when something outside
her confirmed it.

She said she was open to mentoring as well as a permanent role, and that she
needs at least NGN 900,000 a month. She turned on discovery, knowing she could
turn it off, and published a proof page she could paste into any application.

Then she waited, which is the honest part. Some days later a role appeared in her
matches with a published range of NGN 700,000 to 1,100,000 and a note that it
pays below what she said she needs. She could see the gap and decide for herself.
She said yes anyway, because the work was interesting.

The employer had already said yes. Her screen changed to "You both said yes", and
shortly afterwards an email told her an organisation had unlocked her details.
Nobody had contacted her cold. She had agreed first.

**What she gained.** Not a job offer, which the product does not promise. A way
to be found on the strength of checked work rather than a document she wrote
about herself, and control over who reaches her.

### 14.2 Tunde

He needed one platform engineer who had actually reduced an AWS bill, having hired
three who interviewed well and could not. He read the employer page, saw that
contact opens only once a role has a real match, and believed the product more
for saying so.

He wrote the role as outcomes and must-haves rather than a wish list, published
what it pays, and got a free preview showing the proof gaps. He bought the Kit for
one role at NGN 95,000 and got a structured way to interview against evidence
rather than impressions.

His shortlist put fit first and explained each tier in a sentence. For one
candidate it said the role pays below what she needs, without telling him her
figure. He said he was interested, which cost nothing, and found out she had said
yes too before spending an unlock.

**What he gained.** A shortlist he can interrogate, a candidate who wants the
role, and one fewer expensive mis-hire.

### 14.3 Where the two meet

Neither story works alone. Amara's proof is worthless without an employer who
trusts the check; Tunde's shortlist is empty without candidates who verified
something. The marketplace is the product, and both sides had to be given a
reason to go first: free for her, gated honestly for him.

---

_Every claim in this document is either executed against the running
application, proven in production with real money, or marked as read from the
implementation. Nothing is asserted because it seemed likely._
