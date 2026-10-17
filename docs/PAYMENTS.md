# Payments (Paystack)

What this system actually does with money, and what a person still has to do by hand.

Every Paystack behaviour asserted here was read from Paystack's own current documentation on
2026-09-01, not from memory. The pages are listed under "Where these facts come from" at the end.
No live Paystack object, plan, checkout or key is touched by this document; Paystack KYC and
dashboard values remain founder-private per `CLAUDE.md`.

## The four Paystack facts that shape everything else

These are not incidental. Each one is the reason a specific piece of this system exists, and
getting any of them wrong is how a billing integration loses money quietly.

**1. Paystack sends a webhook for successful transactions only.** Its own words: "we currently send
webhook events for just successful transactions." There is no `charge.failed` event and no
`charge.abandoned` event. A card declined at the hosted checkout, and a buyer who closes the tab,
both produce complete silence.

_Consequence:_ a `PaymentAttempt` row is written **before** Paystack is contacted, and an hourly
reconciliation job (`services/api/handlers/jobs/billing-reconciliation-worker.ts`) asks Paystack
directly about every attempt that never reached an outcome. Without both, an abandoned checkout
would leave no trace anywhere.

**2. There is no unique event id in a webhook body.** `data.id` exists on `charge.success` and the
dispute events. It does not exist on `subscription.create`, `subscription.disable`,
`subscription.not_renew`, `invoice.create`, `invoice.update` or `invoice.payment_failed`, and
`subscription.expiring_cards` delivers `data` as an array.

_Consequence:_ idempotency is keyed on a SHA-256 of the raw request body, which is exactly what
Paystack redelivers on a retry. The previous implementation keyed on `data.id` and would have
thrown "missing data.id" and answered 500 for every subscription event, which Paystack would then
have retried every three minutes for four attempts and hourly for the next seventy-two hours.

**3. A failed subscription charge is not retried.** Paystack: "If a subscription charge fails, we
don't retry it." The subscription moves to status `attention` and the next attempt is the next
payment date, a month later.

_Consequence:_ a seven-day grace window (`PAYMENT_FAILURE_GRACE_DAYS`). Cutting access the instant a
charge fails punishes an employer whose card expired over a weekend; leaving it for the full month
gives a month of the product away and calls it dunning.

**4. A renewal charge carries a reference Paystack generated, not ours.** The `charge.success` for
a recurring debit has a reference like `9cfbae6e-bbf3-5b41-8aef-d72c1a17650g`, which cannot be
parsed back to an employer.

_Consequence:_ two pointer items, `SUBCODE#<subscription_code>` and `CUSCODE#<customer_code>`, both
mapping to an employer id. Without them the honest description of a renewal would be "money arrived
and we do not know whose it is."

## Three statuses, deliberately not one

| Question                              | Field                | Values                                                                                  |
| ------------------------------------- | -------------------- | --------------------------------------------------------------------------------------- |
| Did this one charge go through?       | `PaymentStatus`      | initialized, pending, ongoing, processing, queued, success, failed, abandoned, reversed |
| What does Paystack intend to do next? | `SubscriptionStatus` | active, non-renewing, attention, completed, cancelled                                   |
| What may the employer do right now?   | `AccessState`        | none, active, grace, suspended                                                          |

They change for different reasons and at different moments. A subscription sits at `attention` for
a whole month after one failed renewal; treating that as "not paying" locks out a customer, and
treating it as "paying" gives away a month. Collapsing the three into one field is how billing
systems end up doing both.

`AccessState` is derived on every read (`services/api/src/domain/billing-state.ts`), never stored. A
stored one would need something to wake up and change it the moment a grace window closed, and that
something's failure mode is silently serving paid access to somebody who stopped paying eleven days
ago.

## What happens, end to end

### Buying the Kit (one-time)

1. `POST /roles/{roleId}/kit-orders` creates a pending `KitOrder` and calls
   `POST /transaction/initialize`. Reference: `<roleId>.<kitOrderId>`.
2. The employer pays on Paystack's hosted page.
3. `charge.success` arrives. The handler calls `GET /transaction/verify/:reference` independently
   and compares status, reference, currency and amount before granting anything.
4. A conditional status transition (`pending` → `succeeded`) grants the entitlement and generates
   the Kit exactly once, however many times the event is delivered.

### Buying a subscription (recurring)

1. `POST /billing/subscription` writes a `PaymentAttempt` (status `initialized`), then calls
   `POST /transaction/initialize` **with a `plan` code**, which is what makes Paystack create a
   subscription rather than take one payment. Reference: `sub.<employerId>.<attemptId>`.
   An `Idempotency-Key` header is required.
2. The employer pays. Paystack sends `charge.success` and `subscription.create`.
3. `charge.success` marks the attempt paid after an independent verify, and writes the
   customer-code pointer.
4. `subscription.create` is the only event carrying `email_token`, which is required to cancel.
   It stores the subscription, claims a founding place if the price tier was founding, and sets the
   entitlement.
5. Each cycle: `invoice.create` three days ahead, then `charge.success` or
   `invoice.payment_failed`, then `invoice.update` with the final outcome.

### Cancelling

`POST /billing/cancel` calls `POST /subscription/disable` with the code and the email token, and
only updates the local record once Paystack confirms. The order is the guarantee: if the local
record moved first and Paystack refused, the employer would read "cancelled" while the charges
continued.

Paystack's disable is not an immediate termination. It sends `subscription.not_renew` now and
`subscription.disable` on the next payment date, so the paid period is still served. The UI says
exactly that, with the date.

### Changing plan

Paystack cannot prorate and cannot move an existing subscription to a different plan. What it
supports is `POST /subscription/disable` (which lets the current period finish) and
`POST /subscription` with a `start_date`, which Paystack's own documentation names as the way "to
switch a customer to a different plan".

So a plan change is: cancel, then subscribe to the new plan. Both directions take effect at the end
of the paid period. Making an upgrade immediate would mean charging a full new period on top of one
already paid for, with no mechanism to credit the remainder — a worse deal dressed up as a faster
one.

### Refunds and disputes

Neither is automated. `refund.processed` marks the payment `reversed` and alerts; paid access is
**not** removed automatically, because a partial refund is often a service credit and stripping
access for one would punish the customer twice. `charge.dispute.*` never touches state at all: a
dispute is a claim that needs a person to answer it with evidence.

## Reconciliation

`rate(1 hour)`, gated on the same `payments` flag as the checkout.

- **Ours to theirs.** Every `PaymentAttempt` still open and older than 30 minutes is verified
  against Paystack. A confirmed success is granted through the same conditional writes the webhook
  uses, so it cannot be granted twice. A confirmed failure or abandonment is settled. Anything
  Paystack still calls in-flight is mirrored and only aged out to `abandoned` after 24 hours.
- **Theirs to ours.** Paystack's successful transactions in the last 48 hours are checked for any
  that have no record here at all.
- Anything unexplained is an alert to the founder's SNS topic, never a silent correction.

The open-payments list is a sparse projection on the existing GSI2, holding only unsettled
attempts, so a quiet hour costs one query that returns nothing.

## Money never moves on a browser's word

- Access is granted only by a verified webhook or by reconciliation. The Paystack callback URL is
  treated as a hint that it is worth asking again.
- Every claimed success is confirmed with a second, server-to-server `GET /transaction/verify`, and
  the amount, currency and reference must all match what was expected.
- The secret key is read from Parameter Store SecureString at request time, never cached across a
  founder replacement, never logged (`services/api/src/lib/billing-log.ts` redacts by key name and
  scrubs `sk_`/`pk_` patterns out of any string), never returned to a caller.
- No card number, expiry or security code is collected by, posted to, or logged in this product.
  Card updates go to Paystack's own hosted page.
- The subscription `email_token` is stored (it is the only way to cancel) and is stripped from every
  API response, including the founder's diagnostic.

## Plan mapping

Paystack Plans carry one amount and one interval each, so founding and standard are different Plan
objects. That is also what keeps the founding promise honest: a founding subscriber stays attached
to a Plan whose amount cannot drift when the standard price is raised.

| Product             | Price               | Paystack object                   |
| ------------------- | ------------------- | --------------------------------- |
| Employer diagnostic | Free                | None                              |
| Proof Hiring Kit    | NGN 95,000 one-time | One-time transaction, not a plan  |
| Founding Scout      | NGN 300,000/month   | Plan · `scout_founding_monthly`   |
| Founding Team       | NGN 800,000/month   | Plan · `team_founding_monthly`    |
| Founding Partner    | NGN 1,800,000/month | Plan · `partner_founding_monthly` |
| Scout               | NGN 500,000/month   | Plan · `scout_standard_monthly`   |
| Team                | NGN 1,400,000/month | Plan · `team_standard_monthly`    |
| Partner             | NGN 4,000,000/month | Plan · `partner_standard_monthly` |

The right-hand column is the **plan key**. `/zoryvex/<env>/paystack/plan-codes` is a JSON object
mapping each key to the `PLN_...` code Paystack returns when the Plan is created.

Plan codes are not in this repository on purpose: the codes in test mode and live mode are
different strings for the same product, and a committed code would be a live/test mix-up waiting
for the switchover. The parameter starts as `{}`, and until it is filled in, `quoteSubscription`
reports every plan as unavailable and the checkout refuses rather than taking a one-off payment
against no plan.

Annual billing is modelled end to end (`BillingInterval`, the plan-key shape, the state machine)
and is **not offered**: `CLAUDE.md` fixes the prices as monthly with no annual plans, and no annual
amount has ever been founder-approved. `assertOfferedInterval` refuses at the one place money
moves, rather than a number being invented.
Turning it on is a founder-approved price plus one entry in `OFFERED_BILLING_INTERVALS`.

The 25-organization founding cap is enforced by application logic against the
`PLATFORM`/`FOUNDING_PLACES` ledger, never by relying on Paystack to know about it.

## What a person still has to do

None of this can be done by Terraform or by code. Each is logged in `docs/MANUAL_ACTIONS.md` when
it is issued.

1. **Create the six Plan objects.** Six plans is six chances to type an amount wrong in a
   dashboard, and a wrong amount on a Plan bills the wrong number every month for the life of every
   subscription attached to it. So there is a script:

   ```
   npm run paystack:plans -- test --dry-run     # shows exactly what it would create
   PAYSTACK_TEST_SECRET_KEY=sk_test_... npm run paystack:plans -- test
   ```

   It reads the amounts out of `packages/contracts` rather than carrying its own copy, refuses to
   run against anything but an `sk_test_` key, creates only what is missing, and refuses to reuse a
   plan whose amount or interval does not match. Running it twice is safe.

2. **Write the plan codes into Parameter Store.** The script prints the exact
   `aws ssm put-parameter` command, with the complete JSON object, once all six exist. It must be
   the complete object: a partial `put-parameter` deletes the keys it omits.
3. **Set the webhook URL** in the Paystack dashboard to the deployed
   `POST /webhooks/paystack` route. Paystack has one webhook URL per mode, so test and live are set
   separately. **Test mode is already set** to `https://test-api.zoryvex.space/webhooks/paystack`,
   confirmed from the dashboard on 2026-09-01.
4. **Confirm the feature flags.** `payments` must be `true` for any of this to run; the
   reconciliation job checks the same flag.
5. **Enable the production reconciliation schedule** at commercial go-live. It ships disabled.

## Test mode to live mode

The environment is decided entirely by which secret key is configured. There is no code branch on
environment anywhere in this codebase, which is the right design and is exactly why it needs a
second opinion.

**The account is live-approved**, confirmed from the dashboard on 2026-09-01, so a working
`sk_live_` key exists and can be pasted anywhere a key is asked for. The most expensive mistake
available in this system is that key ending up in the TEST environment's parameter, where every
automated test, every demo walkthrough and every reconciliation run would quietly move real money.

Three things stop it:

- Each environment declares the prefix its key must have (`PAYSTACK_KEY_PREFIX`, `sk_test_` in
  test and `sk_live_` in production). `getPaystackSecretKey` refuses a key that does not match,
  so the wrong key stops every payment in that environment rather than making a real one. The
  error names the prefixes and never the key.
- `scripts/paystack-create-plans.mjs` and `scripts/paystack-test-plan.mjs` both refuse to run
  against anything not prefixed `sk_test_`. Live plans are created deliberately, by hand, at
  go-live.
- `scripts/scan-secrets.mjs` and the pre-tool-use hook keep a key out of the repository at all.

The switchover, in order:

1. Paystack account is live-approved (founder-private KYC, never handled here).
2. Create the six Plan objects again **in live mode**. They get different `PLN_` codes.
3. Write the live plan codes to `/zoryvex/production/paystack/plan-codes`.
4. Write the live secret key to `/zoryvex/production/paystack/secret-key` (SecureString).
   Production already declares `PAYSTACK_KEY_PREFIX = "sk_live_"`, so a test key written here is
   refused rather than used.
5. Set the live-mode webhook URL in the Paystack dashboard to production's
   `POST /webhooks/paystack`.
6. Enable the production `billing-reconciliation` schedule.
7. Set `payments: true` in `/zoryvex/production/feature-flags`, writing the complete document —
   a partial `put-parameter` deletes the keys it omits, which is the recorded cause of the
   2026-08-18 drift.
8. Verify with one real, small transaction and check it appears in the founder's billing
   diagnostic with `inSync: true`.

Live-mode plan and checkout creation stays out of scope until `PHASE 10 COMMERCIAL GO` is
independently evidenced per `CLAUDE.md`. Until then the platform runs in
`PHASE 10 SAFE-SHELL GO` neutral status only.

## Alerts a person will actually receive

All to the SNS topic that reaches the founder's email.

- A subscription renewal failed, with the bank's reason and the date access ends.
- A payment was recovered by reconciliation, which also means webhook delivery is broken.
- Paystack reports a successful payment with no record in this system.
- A verification mismatch: the webhook claimed success and an independent verify did not confirm it.
- A charge or subscription for a customer this system does not recognize.
- A dispute was logged, reminded, or resolved.
- A refund was processed.
- Founding places went over the cap.
- A subscription arrived without its `email_token`, so cancellation will not work for it.
- A webhook failed and its idempotency marker could not be cleared, so Paystack's retry will be
  ignored.

## Disclosure

The exact line "Payments are securely processed by Paystack under our business name, Abbas
Solution." is shown before every paid redirect and on the support page. This is a fixed `CLAUDE.md`
requirement, not a configurable string, and `docs/ACCEPTANCE_CRITERIA.md` has the corresponding
test.

## Where these facts come from

Read 2026-09-01 from Paystack's own documentation:

- Webhooks: the complete event list, HMAC-SHA512 over the raw body in `x-paystack-signature`, the
  three source IP addresses (52.31.139.75, 52.49.173.169, 52.214.14.220), and the retry schedule
  (live: every 3 minutes for 4 attempts then hourly for 72 hours; test: hourly for 10 hours, 30
  second timeout).
- Subscriptions: plan creation, the two ways to create a subscription, the five subscription
  statuses, "subscriptions aren't retried", the event sequence per billing cycle, the
  `email_token` requirement, and the hosted card-update link.
- Verify Payments: the eight transaction statuses, and "we currently send webhook events for just
  successful transactions".
- Transaction API: `initialize` parameters (including that a reference may contain only
  alphanumerics and `-`, `.`, `=`), `verify`, and `GET /transaction` with its status filter.
- Plan API and Subscription API: exact endpoint paths, parameters and response shapes.
