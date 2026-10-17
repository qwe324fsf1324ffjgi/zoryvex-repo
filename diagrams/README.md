# Diagrams

Every diagram below was drawn from the implementation, not from intent. Where
a path has never executed in production it is marked in the diagram itself,
because a diagram that hides that is worse than no diagram.

Mermaid renders natively on GitHub.

---

## 1. Architecture

```mermaid
graph TB
    U[Person in a browser] -->|HTTPS| CF[CloudFront<br/>TLS, security headers]
    CF -->|OAC, bucket stays private| S3[S3 site bucket]
    U -->|HTTPS + session cookie| AG[API Gateway HTTP API]
    AG --> AUTH{Lambda authorizer<br/>44 of 51 routes}
    AUTH -->|allow| L[55 Lambdas<br/>one per route]
    AUTH -->|deny| R401[401]
    AG -->|7 public routes| L
    L --> DDB[(DynamoDB<br/>single table)]
    L --> SSM[Parameter Store<br/>secrets + flags]
    L --> SES[SES]
    L --> EV[S3 evidence<br/>private, versioned]
    L -->|HMAC verified| PS[Paystack]
    L --> GH[GitHub API]
    SCH[EventBridge Scheduler<br/>hourly] --> REC[billing-reconciliation]
    REC --> PS
    REC --> DDB
    L --> CW[CloudWatch<br/>26 alarms]
    CW --> SNS[SNS to founder email]
```

## 2. Candidate journey

```mermaid
graph TD
    A[Landing] --> B[Sign in with email]
    B --> C{Account exists?}
    C -->|No| D[Created silently]
    C -->|Yes| E[Same flow]
    D --> F[Pick one launch track]
    E --> F
    F --> G[Profile]
    G --> H[File a claim<br/>4 lines + source type]
    H --> I{Source checkable?}
    I -->|certification| J[Confirm with issuer]
    I -->|github| K[Gist nonce + repo read]
    I -->|project/writeup/other| L[No check available<br/>said at the form]
    J --> M[Verified]
    K --> M
    M --> N{Reachable?<br/>phone + portfolio}
    N -->|No| O[Not shown to employers<br/>panel says what is missing]
    N -->|Yes| P{Discovery on?}
    P -->|No| O
    P -->|Yes| Q[Findable]
    Q --> R[Employer says yes]
    R --> S[Email + Matches badge]
    S --> T[Candidate answers]
    T --> U[Mutual]
    U --> V[Employer unlocks contact<br/>candidate is emailed]
```

## 3. Employer journey

```mermaid
graph TD
    A[Sign in] --> B[Organisation name]
    B --> C[Create a role]
    C --> D[Recompute matches]
    D --> E[Shortlist<br/>Candidate a1b2c3, no name]
    E --> F[Read the proof — free]
    F --> G{Subscribed?}
    G -->|No| H[Source address withheld<br/>repo identity stripped]
    G -->|Yes| I[Source address released]
    E --> J[Click I am interested]
    J --> K{Subscribed?}
    K -->|No| L[403 + what a subscription buys<br/>nothing written]
    K -->|Yes| M[Interest recorded<br/>candidate emailed]
    M --> N{Candidate said yes?}
    N -->|Yes| O{Role has 5+ matches?}
    O -->|Yes| P[Unlock contact<br/>spends allowance]
    P --> Q[Name, email, + given channels]
```

## 4. Authentication

```mermaid
sequenceDiagram
    participant U as User
    participant W as Web
    participant A as API
    participant D as DynamoDB
    participant S as SES

    U->>W: enter email
    W->>A: POST /auth/request-code
    A->>A: rate limit 5/email, 20/IP per 15m
    A->>D: store keyed hash, TTL
    A->>S: email the code
    A-->>W: generic response<br/>(same whether account exists)
    U->>W: enter code
    W->>A: POST /auth/consume-code
    A->>D: conditional single-use consume
    alt valid
        A->>D: create session
        A-->>W: __Host- cookie, Secure HttpOnly SameSite=Lax
    else invalid or replayed
        A-->>W: generic failure
    end
```

## 5. GitHub verification

```mermaid
sequenceDiagram
    participant C as Candidate
    participant A as API
    participant G as GitHub

    C->>A: verify/begin
    A-->>C: one-time nonce
    C->>G: publish nonce in a PUBLIC gist
    C->>A: verify (gist URL + repo URL)
    A->>G: read gist
    Note over A,G: 60 req/hr unauthenticated<br/>token parameter is EMPTY
    A->>A: nonce matches? proves the login
    A->>G: read repo + contributors
    A->>A: public? not a fork? not empty?<br/>commits credited?
    alt all pass
        A-->>C: verified, ref = owner/repo
    else upstream 403/429
        A-->>C: GitHub unavailable<br/>NEVER a failed check
    end
```

## 6. Payment — and what has never run

```mermaid
graph TD
    A[Employer clicks pay] --> B[POST with Idempotency-Key]
    B --> C[Attempt written + key, one transaction]
    C --> D[Paystack initialize]
    D --> E[Redirect to Paystack]
    E --> F{Outcome}
    F -->|abandoned<br/>8 live| G[Reconciliation ages out]
    F -->|declined<br/>3 live, all TEST CARDS| H[failed; fresh reference on retry]
    F -->|success<br/>0 live| I[charge.success webhook]
    I --> J{HMAC valid?}
    J -->|No| K[401, nothing written]
    J -->|Yes| L[Dedupe marker written first]
    L --> M{Already seen?}
    M -->|Yes| N[duplicate true, no effect]
    M -->|No| O[Grant entitlement exactly once]
    O --> P[Deliver Kit / open marketplace]

    style I fill:#ffe6e6
    style O fill:#ffe6e6
    style P fill:#ffe6e6
```

> Red = **never executed in production.** Verified: webhook URL configured,
> signature verification works with the live key, dedupe works. Unverified:
> everything downstream of a real `charge.success`.

## 7. Employer interest → candidate notification

```mermaid
graph TD
    A[Employer clicks interested] --> B{Owns the role?}
    B -->|No| C[404 — never 'needs subscription'<br/>that would confirm the role exists]
    B -->|Yes| D{Subscribed?}
    D -->|No| E[403, nothing written, no notice]
    D -->|Yes| F[Read previous state]
    F --> G[Write interest + audit event]
    G --> H{Was it already yes?}
    H -->|Yes| I[No email — not a second decision]
    H -->|No| J{Notified in last 24h?}
    J -->|Yes| K[Suppressed]
    J -->|No| L{Still discovery opted-in?}
    L -->|No| M[No email]
    L -->|Yes| N[Send email]
    N -->|fails| O[Audit row: nobody was told<br/>interest still recorded]
    N -->|ok| P[Candidate sees Matches badge]
```

## 8. Contact unlock

```mermaid
graph TD
    A[Unlock contact] --> B{contactUnlocks flag on?}
    B -->|No| C[Paused, allowance not spent]
    B -->|Yes| D{Owns role and match exists?}
    D -->|No| E[404]
    D -->|Yes| F{Role has 5+ matches?}
    F -->|No| G[Gate not met]
    F -->|Yes| H{Candidate consented?}
    H -->|No| I[Refused]
    H -->|Yes| J{Marketplace access?}
    J -->|No| K[403]
    J -->|Yes| L[Atomic allowance increment]
    L -->|over limit| M[Refused, nothing spent]
    L -->|ok| N[Release name, email + given channels]
    N --> O[Email the candidate]
```

## 9. CI/CD

```mermaid
graph LR
    A[git push main] --> B[changed-paths]
    B -->|docs only| Z[skip]
    B --> C[validate]
    C --> D[e2e Playwright]
    D --> E[deploy-test]
    E --> F[TEST live]
    F -.->|no automatic path| G[PRODUCTION]
    H[scripts/release.mjs<br/>two confirmations, by hand] --> G

    style G fill:#ffe6e6
```

> **There is no production deploy job.** A push to `main` cannot reach
> production.

## 10. Deployment safety

```mermaid
graph TD
    A[release.mjs] --> B[Build Lambda bundles]
    B --> C[Read API URL from Terraform output]
    C --> D{Missing or not https?}
    D -->|Yes| E[REFUSE TO BUILD]
    D -->|No| F[Build site against that URL]
    F --> G{Demo marker in built pages?}
    G -->|Yes| H[REFUSE TO UPLOAD]
    G -->|No| I[Sync to S3]
    I --> J[Smoke test the deployed commit]
    J -->|mismatch| K[Roll back app code]
    J -->|match| L[Update last-good-commit]
```

## 11. Rollback

```mermaid
graph TD
    A[Something is wrong] --> B{Money moving wrongly?}
    B -->|Yes| C[payments false — seconds, no deploy]
    B -->|No| D{Code or config?}
    D -->|Config| E[Write the COMPLETE flag document]
    D -->|Code| F[rollback.mjs to last-good-commit]
    F --> G[Verify /health shows the target]
    D -->|Infrastructure| H[New reviewed plan — never automatic]
    I[(Database)] -.->|does not roll back| J[PITR to a NEW table]
    K[(Payments taken)] -.->|do not roll back| L[Refund: success to reversed]
```

## 12. Data flow and privacy boundaries

```mermaid
graph LR
    C[Candidate] -->|files| E[Evidence]
    E -->|verified only| M[Matching]
    M --> SH[Shortlist]
    SH -->|free| PR[What was checked]
    SH -->|subscription| SRC[Source address]
    SH -->|subscription + allowance<br/>+ consent + 5 matches| CT[Contact]

    X[Candidate's stated minimum pay] -.->|NEVER| SH
    Y[Peer verifier email] -.->|NEVER, domain only| SH
    Z[Anything marked private] -.->|NEVER| SH

    style X fill:#ffe6e6
    style Y fill:#ffe6e6
    style Z fill:#ffe6e6
```
