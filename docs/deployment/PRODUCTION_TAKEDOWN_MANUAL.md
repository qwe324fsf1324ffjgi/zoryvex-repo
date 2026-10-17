# Taking Zoryvex down

Three levels, from reversible to permanent. Read the level you need and stop
there.

**Nothing in this document has been executed.** It describes what each action
would do.

---

## The three words, and why they are different

| Word | Meaning | Reversible? |
| --- | --- | --- |
| **DISABLE** | Turn a capability off. Resources and data stay. | Yes, in seconds |
| **DELETE** | Remove specific data or objects. Infrastructure stays. | Only from backups |
| **DESTROY** | Tear down infrastructure. | **No** |

Confusing these is how an incident becomes an extinction event. A cost scare
needs DISABLE. It almost never needs DESTROY.

---

# LEVEL 1 — Emergency user-facing shutdown

**Use when:** something is actively harming users and you need it stopped
now.

**Preserves:** everything. All data, all infrastructure, all payments
history.

**Reversible:** completely, in seconds.

## 1.1 Turn off the risky capabilities

There is a purpose-built script:

```bash
node scripts/emergency-cost-lockdown.mjs
```
🔴 **CHANGES LIVE FEATURE FLAGS.**

It writes feature flags off in Parameter Store. Lambdas read flags on **every
invocation** and never cache them, so this takes effect on the next request
with no deploy.

> **Known sharp edge, verified in this repository:** the script writes a
> *partial* document and does **not** restore flags on the way back. Restoring
> means writing the **complete** document by hand — a partial `put-parameter`
> deletes the keys it omits, and that is the recorded cause of a real
> four-day drift incident in 2026-08.

## 1.2 What each flag stops

| Flag `false` | Stops |
| --- | --- |
| `payments` | All Kit purchases and subscription checkouts |
| `contactUnlocks` | All contact disclosure, including already-unlocked reads |
| `aiMatching` | Bedrock explanation path |
| `publicDiscovery` | Public discovery surfaces |
| `verificationReminders` | Reminder emails |

## 1.3 Verify it took effect

```bash
aws ssm get-parameter --name "/zoryvex/production/feature-flags" \
  --profile <profile> --region eu-west-1 --query "Parameter.Value" --output text
```
🟢 SAFE READ-ONLY.

## 1.4 Harder stop — take the site offline

If the application itself must be unreachable, the least destructive option
is to point the domain away at the registrar, or disable the CloudFront
distribution.

> **Do not delete the S3 bucket to take the site down.** That destroys the
> artifact and the bucket name, and bucket names are globally unique — you may
> not get it back.

## Reversing Level 1

Write the **complete** five-key flag document back:

```bash
aws ssm put-parameter --name "/zoryvex/production/feature-flags" \
  --type String --overwrite \
  --value '{"aiMatching":false,"contactUnlocks":true,"payments":true,"publicDiscovery":false,"verificationReminders":true}' \
  --profile <profile> --region eu-west-1
```
🔴 CHANGES LIVE FLAGS. Every key must be present.

---

# LEVEL 2 — Commercial shutdown

**Use when:** you are stopping trading but keeping the platform alive —
winding down, pausing to rebuild, or a legal hold.

**Preserves:** all data, all infrastructure, all existing access.

## 2.1 Stop taking money

Set `payments: false` (Level 1 method). Checkout then refuses with
"currently unavailable. Nothing has been charged."

## 2.2 Stop new subscriptions at the provider

In the Paystack dashboard, you can stop new subscriptions. **Existing
subscriptions keep billing until cancelled individually.**

> Cancelling somebody's subscription is a commercial and possibly legal
> decision. It is not a technical one. Do not do it to tidy up.

## 2.3 Honour what people already bought

This matters legally and reputationally:

- A Kit already paid for is **owned**. `KITARTIFACT` records stay readable.
- A subscription paid to the end of its period is **paid for**. `deriveAccess`
  already honours a `non-renewing` subscription until `currentPeriodEnd`.

Setting `payments: false` does **not** revoke existing entitlement, which is
the correct behaviour.

## 2.4 Stop new registrations

There is **no dedicated registration kill-switch** in this implementation.
Sign-in and registration are the same flow. Disabling it would lock out
existing users too.

**NOT IMPLEMENTED** — recorded rather than improvised. See
`FUTURE_IMPLEMENTATION_RECOMMENDATIONS.md`.

## 2.5 Tell people

Not optional if you have paying customers. The status page exists at
`/status`.

---

# LEVEL 3 — Complete infrastructure retirement

**Use when:** Zoryvex is ending permanently.

**This is irreversible.** Work top to bottom. Do not skip the export step.

## 3.1 Export everything first

🟢 All read-only. Do this **before** anything else.

**The database:**
```bash
aws dynamodb scan --table-name zoryvex-production-core \
  --profile <profile> --region eu-west-1 --output json > zoryvex-production-export.json
```

**Point-in-time backup:**
```bash
aws dynamodb create-backup --table-name zoryvex-production-core \
  --backup-name zoryvex-final-$(date +%Y%m%d) --profile <profile> --region eu-west-1
```
🔴 Creates a backup. Costs a little. Worth far more than it costs.

**Evidence files:**
```bash
aws s3 sync s3://zoryvex-production-evidence-<account> ./evidence-export \
  --profile <profile>
```

**Terraform state:**
```bash
aws s3 cp s3://zoryvex-terraform-state-<account>/production/terraform.tfstate \
  ./terraform.tfstate.final --profile <profile>
```

**Store these somewhere that is not the account you are about to close.**

## 3.2 Obligations before deletion

Candidate evidence is personal data. Retention and deletion duties are set
out in `docs/PRIVACY_AND_RETENTION.md`.

> Legal and regulatory filings are **NOT AUTHORIZED** to be performed here.
> Anything involving a regulator is the founder's own action.

## 3.3 Payments — first, and separately

Before touching infrastructure:

1. Cancel every active subscription in Paystack
2. Settle outstanding payouts
3. Resolve open disputes
4. Export transaction history

> **Destroying the webhook endpoint while subscriptions are live means
> Paystack keeps charging cards and nothing records it.** Customers are billed
> for a service that no longer exists. Do payments first.

## 3.4 DNS

Remove the records pointing at CloudFront and API Gateway.

> Do this **last** among the reversible steps and **first** among the
> user-visible ones. Once DNS is gone the site is unreachable even though
> everything still exists — which is a safe, reversible state to sit in while
> you confirm nothing was missed.

## 3.5 The infrastructure

```bash
cd infrastructure/envs/production
terraform destroy
```
🔴🔴🔴 **DESTROYS EVERYTHING TERRAFORM MANAGES IN PRODUCTION.**

> **DO NOT RUN WITHOUT EXPLICIT AUTHORIZATION.**
>
> This removes the DynamoDB table and all data in it, both S3 buckets and
> their contents, all 55 Lambdas, API Gateway, CloudFront, the certificates,
> the alarms, the scheduler, and every IAM role.
>
> There is no undo. Your export from 3.1 becomes the only copy.

Terraform prints the plan and requires you to type `yes`. **Read the destroy
count before typing it.**

## 3.6 Order for the remaining roots

```
production  →  test  →  test-secrets  →  foundation  →  bootstrap
```

`bootstrap` holds the state bucket. Destroying it first orphans every other
root and leaves resources nobody can manage.

## 3.7 What Terraform will not remove

Check these by hand afterwards:

| Item | Why it survives |
| --- | --- |
| CloudWatch log groups | Sometimes retained past function deletion |
| DynamoDB backups | Deliberately independent |
| S3 object versions | Versioning keeps prior versions |
| Route 53 / registrar records | Not managed by Terraform here |
| Paystack account | External |
| GitHub repository | External |
| IAM Identity Center users | Account-level |

## 3.8 Close the AWS account

Only after confirming nothing still bills. AWS keeps a closed account
recoverable for a limited window, then it is permanent.

---

# Decision guide

| Situation | Level |
| --- | --- |
| Costs spiking | **1** — flags off |
| Security incident | **1** — flags off, then investigate |
| Payment bug charging wrongly | **1** — `payments: false` |
| Pausing the business | **2** |
| Winding down, keeping data | **2** + DNS removal |
| Shutting down permanently | **3**, after export |

**When unsure, choose the lower number.** Level 1 is reversible in seconds.
Level 3 is not reversible at all.
