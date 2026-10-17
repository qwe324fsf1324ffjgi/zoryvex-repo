# Zoryvex Product Spec (launch scope)

## Product order and prices (preserve exactly)

1. **Employer diagnostic** — free. Short role diagnostic → a proof-gap snapshot. No candidate profiles required. This is the primary top-of-funnel and the employer's first value ([[docs/CUSTOMER_DEVOTION]]).
2. **Proof Hiring Kit** — one-time, **NGN 95,000**. The primary first revenue product.
3. **Founding Scout** — **NGN 800,000/month**.
4. **Founding Team** — **NGN 1,400,000/month**.
5. **Founding Partner** — **NGN 2,400,000/month**.

Monthly marketplace checkout stays **disabled** until the organization has at least one saved role with **at least one real, current, discovery-opted matching profile**, and contact details then open **per role**, on the roles that have them. This is a hard gate, not a soft nudge, and it is enforced server-side in `subscription-service.ts` and `contact-unlock-service.ts` rather than by the browser.

The threshold was **five** until 2026-09-02, when the founder lowered it to one so an employer with a single verified match can buy if they want to. The honesty requirement moved rather than disappeared: the true match count is carried on the quote and stated at checkout, so nobody pays without being told how thin the marketplace is. `MARKETPLACE_GATE_MIN_MATCHES` in `packages/contracts` is the single source of that number, and its own comment records that removing the disclosure means putting the gate back to five.

One rather than zero, deliberately. A marketplace with one person in it is a thin product an informed buyer may still want, because the Kit and the verification work regardless of marketplace size. A marketplace with nobody in it is not a product, and selling it would be the refund this gate exists to prevent.

Separately, and **not** changed by that decision: `CLAUDE.md` and `docs/COMMERCIAL_RUNBOOK.md` still bar any recurring marketplace *promotion* for a saved role until five real opted-in matches exist. That is a restraint on what may be advertised, not on what an informed buyer may choose to buy, and the two numbers differ on purpose. Do not reconcile them by changing one to match the other.

The wording used to say "the saved role" for both halves, which could not be implemented as written: a subscription belongs to an organization and a match count belongs to a role. That ambiguity is why for a long time only the second half existed — `unlockContact` refused below the threshold and `startSubscriptionCheckout` never looked. An organization could therefore be sold marketplace access while every role it owned was below the line, which is the exact outcome this rule exists to prevent, and a refund rather than a sale. Both halves are now enforced server-side (`services/api/src/domain/subscription-service.ts` and `contact-unlock-service.ts`), and one eligible role is enough to subscribe because one is enough to use.

## Checkout requirements (every paid surface)

Before any charge, show: concrete deliverables, exact limits, final price, seller disclosure, and cancellation/refund behavior, plus one clear next action. Never a fake testimonial, counter, urgency, guarantee, hidden fee, forced trial, or obstructed cancellation.

Disclosure line, exact wording, shown before every paid redirect and on support:

> Payments are securely processed by Paystack under our business name, Abba's Solutions.

## Voluntary Support (`voluntary_support_v1`)

- **Not** a Paystack Plan, **not** a subscription, **not** an entitlement. One-time, variable-amount NGN only.
- Preset amounts: NGN 5,000 / 20,000 / 50,000 / 100,000, plus a custom integer amount NGN 1,000–500,000.
- No amount preselected by default.
- Zoryvex absorbs the Paystack fee (the user's chosen amount is what gets recorded as support).
- Shown only after the user has already received obvious value, at most once per 90 days, dismissible, and the dismissal must persist permanently (not just for the session).
- Never shown during error states, a failed payment, cancellation, abuse handling, account/data deletion, or a help/support flow.
- A successful support payment creates **only** a verified thank-you record, plus an optional, separate, opt-in recognition consent.
- Support **never** changes: features, ranking, verification status, search placement, Kit contents, unlock state, founding status, service priority, governance rights, or hiring access. This must be true in the data model, not just in copy.
- Support/refunds/disputes are included in the Paystack settlement headroom and reconciliation checks.

Support headline and boundary copy (exact):

> Help keep proof-first hiring independent.

Explain: support is optional, creates no feature or advantage, and does not make Zoryvex a charity.

Post-payment confirmation copy (exact):

> Thank you for supporting Zoryvex. Your support helps fund reliability, accessibility, and fair evidence-first tools. It did not change your features, ranking, verification, or hiring access. A Paystack confirmation is the payment record.

## Paystack launch caps and fee reference (verified 2026-08-15, Starter Business; warning thresholds revised 2026-08-25)

Starter Business currently stops collecting at NGN 8,000,000 lifetime — Paystack itself enforces this hard
limit on its side; Zoryvex does not duplicate it as an automatic checkout stop. Per the founder's binding
Paystack-scope amendment (2026-08-25), NGN 6,000,000 (75% of the current NGN 8,000,000 limit) is the first
**warning** threshold on the private founder/admin collection-limit indicator, not a collection cutoff:
Normal below 75%, "Approaching limit" 75-89.99%, "High warning" 90-94.99%, "Critical warning" 95-99.99%,
"Limit reached" at 100% or on a provider decline caused by the limit. Zoryvex must never implement a control
that stops, throttles, or pretends to change Paystack's own limit — only the founder can act on the provider
side, via a founder-only "Open Paystack Dashboard" link that performs no mutation. Recheck the NGN 8,000,000
figure against fresh Paystack evidence (or a later founder instruction) before this indicator ships, since it
is not itself something Zoryvex can query and confirm live without an approved read-only Paystack endpoint.

Fee reference (rates checked 2026-08-04 — must be rechecked immediately before live activation, since displayed subscription prices do not auto-adjust to fee changes):

| SKU | Customer pays | Local fee | ≈ Local settlement | Intl (Mastercard/Visa/Verve) fee | ≈ Intl settlement |
|---|---|---|---|---|---|
| Proof Hiring Kit | NGN 95,000 | NGN 1,525 | NGN 93,475 | NGN 3,805 | NGN 91,195 |
| Scout (founding) | NGN 800,000 | NGN 2,000 (capped) | NGN 798,000 | NGN 31,300 | NGN 768,700 |
| Team (founding) | NGN 1,400,000 | NGN 2,000 (capped) | NGN 1,398,000 | NGN 54,700 | NGN 1,345,300 |
| Partner (founding) | NGN 2,400,000 | NGN 2,000 (capped) | NGN 2,398,000 | NGN 93,700 | NGN 2,306,300 |
| Scout (standard) | NGN 1,200,000 | NGN 2,000 (capped) | NGN 1,198,000 | NGN 46,900 | NGN 1,153,100 |
| Team (standard) | NGN 2,000,000 | NGN 2,000 (capped) | NGN 1,998,000 | NGN 78,100 | NGN 1,921,900 |
| Partner (standard) | NGN 4,000,000 | NGN 2,000 (capped) | NGN 3,998,000 | NGN 156,100 | NGN 3,843,900 |

Recomputed 2026-09-04, when every subscription price doubled. The Kit row is unchanged and
reproduces exactly. The local fee is on its NGN 2,000 cap for every subscription row, so doubling a
price doubles what settles almost exactly; the international fee has no cap and scales with the
price, which is why the Partner (standard) international row is now larger than most of the other
prices.

### Charges that fit inside the Starter Business limit

How many charges of one SKU fit inside NGN 8,000,000, computed in
`scripts/lib/paystack-fees.mjs` and checked by `npm run fees:check`. Each row is that SKU
sold on its own; in reality every sale shares the one limit, so a mixed month reaches the
ceiling sooner than any single row suggests.

| SKU | Customer pays | Charges before the Starter limit |
|---|---|---|
| Proof Hiring Kit | NGN 95,000 | 84 |
| Scout (founding) | NGN 800,000 | 10 |
| Scout (standard) | NGN 1,200,000 | 6 |
| Team (founding) | NGN 1,400,000 | 5 |
| Team (standard) | NGN 2,000,000 | 4 |
| Partner (founding) | NGN 2,400,000 | 3 |
| Partner (standard) | NGN 4,000,000 | 2 |

The row that matters is standard Partner, and it is the reason that price moved twice on
2026-09-04. At NGN 5,000,000 exactly one charge fitted, so the tier could be sold once and
then failed its first renewal. The doubling took it to NGN 10,000,000, where the count was
**zero** - a single charge larger than the entire NGN 8,000,000 lifetime limit, so it could
not take a first payment at all. It came down to NGN 4,000,000, which is the highest price
at which a renewal still fits: two charges rather than one. Every figure above it leaves
room for the first payment and none for the second.

That is a real improvement and not a solution. Two charges is two months. The ceiling is
account-wide and lifetime, so it is shared with every Kit sale and every other subscription,
and any Partner subscription still ends against it well inside a year. The account can only
ever collect NGN 8,000,000 in total, which at current prices is about twenty-six months of a
single founding Scout, ten of a founding Team, or four of a founding Partner.

Paystack does not retry a failed subscription charge and sends no webhook for one, so
nothing arrives to say it happened. Removing the ceiling means a Paystack Registered
Business, which requires CAC registration and is recorded as `NOT AUTHORIZED BY FOUNDER`.
Until that changes, standard Partner may be sold at most once to at most one organization,
and should be quoted with that in mind. Recorded as open in docs/RISK_REGISTER.md.

International American Express is listed separately by Paystack at 4.5% and is not advertised or relied upon unless explicitly enabled for this business — recheck its fee treatment before accepting it.

International payments stay enabled only while Paystack has approved them for this business; no USD domiciliary account at launch.

## Status

This is a specification, not an implementation. No Paystack plan, product, or checkout URL has been created as part of this binding turn.
