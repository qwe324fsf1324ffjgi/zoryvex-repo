# Interview preparation

Every answer here is grounded in something real in this repository. None of it
is a script to perform; it is what is actually true, organised so you can find
it under pressure.

---

## The four questions that decide the outcome

Everything else is padding around these.

### 1. "Walk me through the architecture."

Draw it. Talk while you draw.

> Static Next.js export in a private S3 bucket, served through CloudFront with
> origin access control, so the bucket is never public. The browser calls an
> API Gateway HTTP API. 51 routes, 44 of them behind a Lambda authorizer that
> looks up an opaque server-side session. 55 Lambda functions, one per route.
> One DynamoDB table, on-demand, three GSIs. Evidence files in a private
> versioned bucket. Secrets and feature flags in Parameter Store. SES for
> email. Paystack for payments, with an EventBridge schedule running hourly
> reconciliation. Terraform owns all of it.

**Then, before they ask, say what you left out:**

> No NAT Gateway, no ECS, no RDS, no provisioned concurrency, no always-on
> compute of any kind. Everything scales to zero. That was a cost decision
> made deliberately, and I can tell you what each one would have bought.

**Why:** naming the absent services proves the architecture was chosen rather
than assembled from a tutorial. Most candidates only describe what is present.

### 2. "Why not Cognito?"

Expect this. It is the obvious challenge.

> Cognito would have been faster to stand up. What it costs is control over
> the part of the product that matters most.
>
> I wanted opaque server-side sessions, so signing out actually revokes
> something rather than waiting for a token to expire. I wanted single-use
> codes consumed by a conditional write, so a replay cannot succeed. I wanted
> a `__Host-` prefixed cookie, Secure, HttpOnly, SameSite=Lax, with CSRF
> defended by exact origin matching and a session-bound token. And I wanted
> the response to be identical whether or not the account exists, so the
> endpoint isn't an account-enumeration oracle.
>
> All of that is reachable with Cognito and none of it is the default. I'd
> have been configuring around it rather than with it.
>
> The honest cost: I own the session store, the rate limiting, and the
> recovery path. That's real work Cognito would have done.

**Why:** the last paragraph is the answer. Naming what your decision cost is
what distinguishes a decision from a preference.

### 3. "Tell me about something that went wrong."

Use the demo build. It is your best story because it is your worst moment.

> I shipped the demo build to production.
>
> The frontend is a static export and the API base URL is a build-time
> variable. Built without it, the app silently falls back to browser-local
> fakes. Every page returns 200. Nothing is obviously broken. Nobody can sign
> in and nothing calls the API.
>
> Two guards went in. The release script reads the API URL from Terraform
> output and refuses to build if it is missing or not https. And it asserts
> against the built pages before uploading, refusing if a demo marker is
> present.
>
> Then I found the second-order problem, which is the part I'd actually want
> you to hear. My own troubleshooting document told you to grep the page HTML
> for the API URL. It's compiled into a JavaScript chunk, so that check
> returns nothing on a perfectly correct build. My verification procedure
> produced false alarms. I fixed the document too.

**Why:** most candidates stop at the fix. Auditing your own fix and finding it
defective is a different level of answer.

### 4. "How do you make decisions with incomplete information?"

Use the payment investigation.

> Eleven live payment attempts, zero successes. Every instinct says the
> integration is broken and you start rewriting it.
>
> I went to the provider's gateway data instead. Eight attempts had
> `log.attempts = 0`, meaning no card was ever entered; people opened checkout
> and closed the tab. The other three showed "Test Bank visa credit". Those
> were Paystack *test* cards presented to a *live* account, and the live
> account correctly refused them.
>
> There was no defect. The correct action was to change nothing, which is
> harder than it sounds when the number on the dashboard is zero out of
> eleven.
>
> What I did do was verify the thing I actually could: forged webhook rejected
> 401, correctly signed event accepted, a replay of that event deduplicated,
> and I confirmed the dedupe row in the table.
>
> The path from a successful payment to a granted entitlement still has never
> executed in production. I write that down as unverified rather than assume
> it works, because it's tested and it isn't proven.

**Why:** the last paragraph is the whole interview. Someone who distinguishes
*tested* from *proven in production*, unprompted, is signalling exactly what a
senior role needs.

---

## Technical questions, with honest answers

### "How does the single-table design work?"

> Partition key and sort key with entity-prefixed values, three GSIs for the
> access patterns that don't fit the main key. Every access pattern is written
> down in the data model doc before the code exists.
>
> The rule I enforced: no `Scan`, anywhere. The repository interfaces only
> expose `Query`, `GetItem`, and conditional writes, so a scan isn't something
> you have to remember not to do. It isn't reachable.

### "How do you handle idempotency?"

> Three different places, three different mechanisms.
>
> Payment initiation takes an `Idempotency-Key` header, and the attempt plus
> the key are written in a single transaction so there's no window.
>
> Webhooks dedupe on a SHA-256 of the raw request body, not the event id,
> because providers reuse ids more than you'd like. The marker is written
> before any effect, so a duplicate returns `duplicate: true` and does
> nothing.
>
> Entitlement grants use conditional writes, so exactly-once holds even if
> both the webhook and reconciliation arrive at the same moment.

### "What happens if the webhook never arrives?"

> Reconciliation runs hourly on an EventBridge schedule and asks Paystack
> directly about pending attempts. So the worst case is an hour of delay, not
> a lost payment.
>
> It also ages out abandoned checkouts after 30 minutes, which is how those
> eight attempts resolved themselves.

### "How do you keep costs down?"

> Reserved concurrency on all 55 functions, which is the real ceiling. Without
> it one runaway loop consumes the account's whole concurrency pool and the
> bill follows.
>
> On-demand DynamoDB, nothing always-on, no NAT Gateway. Feature flags read
> per invocation and never cached, so the emergency brake is a parameter write
> rather than a deploy. It takes effect on the next request.
>
> One sharp edge I'd tell anyone copying this: the flags live in one JSON
> document, and a partial write deletes the keys it omits. That cost us four
> days of flag drift before we understood it.

### "What would break first at scale?"

Answer honestly. This is a test of self-knowledge.

> GitHub rate limiting, and it isn't close. Unauthenticated GitHub is 60
> requests an hour per egress IP. One verification spends three, so that's
> about 20 verifications an hour across the entire platform, sharing one
> Lambda egress address.
>
> The token parameter is currently empty in both environments, so every call
> today is unauthenticated. It isn't biting at present volume and it's a wall
> the moment candidates arrive. It's written down as a known gap rather than
> discovered later.
>
> Second would be SES reputation. Bounces above 5% risk account-level
> suspension, which is why tests address the mailbox simulator rather than
> real domains.

### "What's the weakest part of the system?"

> Rollback has never been exercised. The script says so in its own header. The
> mechanism is simple and its target is provably correct, but the first real
> use will be during an incident, which is the worst possible time to find a
> flaw.
>
> Second weakest: there's no re-check for a repository that's made private
> after it was verified. A proof can outlive its own truth.

---

## Product questions

### "How do you decide what to remove?"

> The test is whether the feature makes a claim the product can't support.
>
> File upload: we could scan a file and confirm it isn't malware. We could
> never confirm the thing inside it was true. Showing it as evidence was a
> claim we couldn't back.
>
> Peer confirmation: the candidate picks the peer. A check where the subject
> chooses the checker is a reference, not verification.
>
> Graded tasks: a language model could solve the brief. The mark said nothing
> about the person while ranking above a certification genuinely bound to
> their name.
>
> All three shipped. All three are gone. The product is smaller and every
> claim it makes now survives scrutiny.

### "How do you price?"

> Founding Scout at 800,000 naira a month up to Partner at 2,400,000, for the
> first five organisations only, and they keep that price for the life of the
> subscription. Standard pricing runs 1,200,000 to 4,000,000.
>
> The constraint that shaped it is external and I'd want you to know I worked
> within it rather than around it. Paystack's Starter Business tier has an
> 8,000,000 lifetime collection limit, account-wide. So 4,000,000 is the most
> any single charge can be and still leave room for its own renewal. When the
> price floor was raised, I compressed the ladder rather than scaling it,
> because scaling would have put the top tier above the entire account limit.
>
> Lifting that ceiling requires a registered business, which is a separate
> decision I don't have authority over.

### "Who is this for?"

> Four kinds of work: cloud engineering, DevOps and platform, cloud security
> and DevSecOps, MLOps. That's all we check.
>
> Narrow because verification only means something where a source is
> reachable, and those are the ones where it is. A platform that claims to
> verify everything verifies nothing in particular.

---

## The questions to ask them

Ask three. These signal what you are actually assessing.

1. "When something breaks in production, who finds out first and how?"
2. "What's the last decision the team reversed, and what prompted it?"
3. "How do you tell whether something you shipped worked?"
4. "What would I be wrong about in my first month?"
5. "What's the part of this codebase nobody wants to touch?"

Question 3 is the strongest. Most teams cannot answer it, and their difficulty
answering tells you more than the answer would.

---

## Things not to say

| Do not say | Because |
| --- | --- |
| "I built this myself" without the qualifier | Position B. It will not survive |
| "We have users" / "customers are seeing…" | There are none. It is checkable |
| "It's fully tested" | The payment success path has never run in production |
| "I'm passionate about…" | Signals that nothing was said |
| "That's a great question" | Filler, and it reads as filler |
| Anything about a competitor | Never lands well, always remembered |
| A number you cannot source | You sell verification. It is the one unforgivable slip |

---

## The night before

Re-read three things. Nothing else.

1. `docs/adr/0005-graded-tasks-retired-as-verification.md` — your best story
2. `docs/production-audit/FAILURE_MATRIX.md` — what you know breaks
3. `docs/production-audit/PRODUCTION_VERIFICATION.md` §7 — what you have not
   verified and why

The third one is the most important. Knowing precisely what you have *not*
proven, and saying so without being asked, is the single most senior thing you
can do in an interview.
