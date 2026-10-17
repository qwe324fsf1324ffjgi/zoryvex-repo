# ADR 0004: Multi-cloud tracks — relabel before renaming, and write tasks before either

Status: Accepted (founder decision, 2026-09-03)
Date: 2026-09-03

## The decision this asks for

The founder's instruction on 2026-09-02 was: "Ensure it's not only AWS talent that could be found,
consider azure, gcp etc."

This drafts what that costs, having prototyped one Azure and one GCP graded task and measured the
blast radius of the obvious change. The recommendation is deliberately smaller than the request
looks, and the ordering matters more than the rename.

## What the prototypes proved

Two tasks were written and are graded correctly by the existing machinery:

- `task_scoped_identity_azure_v1` — a managed identity scoped to one storage container
- `task_scoped_identity_gcp_v1` — a service account scoped to one bucket

Neither required a change to any parser, selector, schema, or route.

**The grader was never AWS-specific.** `parseHcl` and `findResources` filter HCL blocks by type and
label, and have never known which provider a resource belongs to. Everything AWS-shaped lives in the
task definitions.

**The capability layer already handles it.** `least_privilege_access` was named for what a person
does rather than for IAM, so an Azure or GCP task testing it is offered to exactly the tracks that
already need that capability. Three of the four tracks now offer both prototypes with no new track
and no branching in selection code.

**The rubric pattern generalises, and got simpler.** GCP was chosen as the second provider precisely
because its access model differs most: there is no scope attribute, because the scope is the resource
type. On Azure the scope check needed a regex over an expression; on GCP it is two calls to
`findResources`. All three tasks have identical shape — same capability, same check count, same pass
margin.

The three failure modes are the same three on every provider, wearing different names:

| Failure        | AWS                | Azure               | GCP                       |
| -------------- | ------------------ | ------------------- | ------------------------- |
| Too broad      | wildcard action    | Contributor / Owner | roles/editor, roles/owner |
| Too wide       | `Resource = "*"`   | subscription scope  | project-level binding     |
| Long-lived key | (n/a on that task) | storage account key | service account key       |

**Thirty tasks per cloud is one design problem repeated, not thirty separate ones.**

## What is actually in the way

Only one of the four track values is vendor-named. `devops_platform`, `cloud_security` and `mlops`
are already neutral. The problem is `aws_cloud` and its label "AWS cloud".

Measured, rather than assumed:

- The raw value **never appears in user-visible text or in any URL**. Every surface renders it through
  `LAUNCH_TRACK_LABELS`.
- Six items in the TEST table carry a `launchTrack` at all (five `aws_cloud`, one `devops_platform`).
- It **is** in the public OpenAPI enum, so it is part of the API contract.
- 103 files reference the string, overwhelmingly task definitions and tests.

## Two options, and they are not the same size

### Option A — change the label only

`LAUNCH_TRACK_LABELS.aws_cloud` becomes something like "Cloud platform". The stored identifier stays
`aws_cloud`.

- No stored data touched, in any environment.
- No API contract change; no consumer breaks.
- Users immediately see a vendor-neutral track.
- Cost: one line, plus a copy review of the surfaces that describe the track in prose.
- Downside: the internal identifier stays misleading to anyone reading the code.

### Option B — rename the identifier

`aws_cloud` becomes `cloud_platform` everywhere.

- Breaking change to the OpenAPI enum. Any consumer sending the old value is rejected.
- Requires dual-accept on the way in and a backfill of stored rows, or a release where both values
  are valid. Six rows in TEST is trivial; the pattern is what costs, not the count.
- Touches 103 files, mostly mechanical.
- Buys nothing a user can see, because no user ever sees the identifier.

## Recommendation

**Do neither yet. Write the tasks first.**

The `aws_cloud` track currently offers 27 tasks, of which 2 are non-AWS. Relabelling it "Cloud
platform" today would put a claim on the product that the content does not support: a candidate
choosing "Cloud platform" would find 25 of 27 tasks are AWS-specific. CLAUDE.md's standing rule is
that every claim must stay true to what is actually built, and this would break it in the most
visible place a candidate looks.

So the ordering is:

1. **Write non-AWS tasks until the track is honestly multi-cloud.** The prototypes suggest roughly a
   day each and no architectural work. A reasonable bar is that each capability the track claims has
   at least one task per major provider.
2. **Then Option A**, the label change, which becomes true at that point and costs almost nothing.
3. **Option B only if something forces it** — an external API consumer, or contributor confusion that
   is measurably costing time. It is internal hygiene, and it can be done at any point afterwards
   without the user noticing.

## What this does not decide

Whether Zoryvex should verify Azure and GCP talent at all is a product question about where the
demand is, and this draft takes no position on it. It only establishes that if the answer is yes, the
cost is task authorship rather than architecture, and that the rename everyone expects to be the hard
part is the cheap part and probably unnecessary.

## Status of the prototypes

Both are committed, graded by the full test suite, and deployed to TEST, filed under
`track: 'aws_cloud'` with the limitation recorded in each task's own comment. They are real tasks a
candidate can be offered today, not scaffolding.

The draft said they should be removed if this ADR were rejected. It was accepted on 2026-09-03, so
they stay, and they are now the first two of the set that step 1 asks for rather than a pair of
orphans.

## Step 1 status: complete for every track (2026-09-05)

The bar this ADR set for step 1 was that "each capability the track claims has at least one task per
major provider." For `aws_cloud` that is now met, measured rather than asserted:

| Capability                   | Providers       |
| ---------------------------- | --------------- |
| `least_privilege_access`     | AWS, Azure, GCP |
| `network_isolation`          | AWS, Azure, GCP |
| `observability_and_alerting` | AWS, Azure, GCP |
| `failure_handling`           | AWS, Azure, GCP |
| `durability_and_recovery`    | AWS, Azure, GCP |
| `cost_control`               | AWS, Azure, GCP |

Ten tasks were written to close this, in five same-capability pairs, taking the catalogue from 32 to 42. `aws_cloud` now offers 37 tasks: 25 AWS, 6 Azure, 6 GCP.

Because availability is by capability and not by track, the other three tracks gained from the same
work without a task being written for them: `devops_platform` and `cloud_security` are at 3 of 5
capabilities at full parity, `mlops` at 4 of 6.

### What the prototypes claimed, and whether it held

The draft above predicted the grader would need no changes. It needed two small additions and no
structural ones: an ISO 8601 duration reader, because Azure states windows and locks as `PT5M` and
`PT30S` rather than as numbers, and a two-resource-type reader for Azure consumption budgets, which
are different resources at resource-group and subscription scope. No parser, selector, schema or
route changed, which was the substantive claim.

The stronger claim also held, and is now visible in the rubrics rather than only argued: the same
failure genuinely does wear a different name on each provider. The clearest case is alerting.
CloudWatch's `treat_missing_data` and GCP's `evaluation_missing_data` are the same trap with the same
default and the same consequence, an error-rate alert that stays silent through a total outage
because a dead service reports no errors. A candidate who understands that on one cloud has something
transferable rather than a memorised attribute name.

What did not generalise is more interesting than what did. Each provider has a distinctive wrong
answer the other two cannot offer:

| Provider | The mistake that is specific to it                                                                                                                                              |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Azure    | Protections that do not layer. Blob soft delete does not cover the container, and neither survives the account, whose guard is a management lock rather than a storage setting. |
| GCP      | Features that work exactly as documented and destroy data. `authorized_networks = 0.0.0.0/0`, and a lifecycle `Delete` rule whose `with_state` defaults to ANY.                 |
| AWS      | Absent by default. No dead-letter queue, no versioning, nothing until you build it.                                                                                             |

Two GCP checks are graded `disqualifying` on the existing rule that the flag is for harm a candidate
writes in rather than omits. Both have legitimate narrow uses, and both have a test proving the narrow
use still passes, so neither feature is graded as always-wrong.

### Step 2 is now unblocked, and is a founder decision

CLAUDE.md holds the label until the track's tasks are honestly multi-cloud. The ordering condition
this ADR set is satisfied, so the gate is open — but opening it is not the same as walking through it,
and the number worth stating plainly is that 25 of the 37 tasks `aws_cloud` offers are still AWS.
Every capability is covered on all three providers, which is what the bar asked for; the catalogue is
not evenly split, which the bar did not ask for.

Whether "Cloud platform" is an honest name for that is a judgment about a user-visible claim, so it
belongs to the founder rather than to whoever finishes the tasks. Nothing in this session changed the
label or the identifier.

### Extended past the `aws_cloud` track, to all four (2026-09-05, same day)

The section above closed step 1 for `aws_cloud` alone, which is all the label
question needs. The work then continued to the other three tracks, because the
founder's original instruction was about finding non-AWS talent rather than
about one track's name, and stopping at the track whose label was blocked would
have served the ADR rather than the request.

Ten pairs in total, twenty tasks, catalogue 32 to 52. **Every capability on
every track now has a task on all three providers:**

| Track             | Offers | AWS | Azure | GCP | Capabilities at full parity |
| ----------------- | ------ | --- | ----- | --- | --------------------------- |
| `aws_cloud`       | 37     | 25  | 6     | 6   | 6 of 6                      |
| `devops_platform` | 30     | 20  | 5     | 5   | 5 of 5                      |
| `cloud_security`  | 28     | 18  | 5     | 5   | 5 of 5                      |
| `mlops`           | 33     | 21  | 6     | 6   | 6 of 6                      |

The five later capabilities kept producing the same finding as the first five.
Each provider has a characteristic wrong answer, and it is never the same one:

- **`auditability`** — GCP's Data Access audit logs are off by default for
  every service except BigQuery and cannot be enabled retroactively, so the
  pipeline looks healthy and answers every question except the one asked after
  a leak. Azure's equivalent is a diagnostic setting with only a `metric` block:
  valid, deployed, charts, no entries.
- **`safe_release`** — the one capability where both providers fail identically.
  Container Apps and Cloud Run both split traffic with an explicit block and
  both default it to everything-to-newest. The dangerous configuration is
  written down rather than defaulted into silence, which is why it survives
  review.
- **`data_protection`** — Azure will let a key be purged and the data under it
  become permanently unreadable; purge protection is the stop. GCP has largely
  closed that at the API, so the risk moves into Terraform, where a destroy or
  a refactor parts a key from its data and `prevent_destroy` stops the plan
  rather than the API.
- **`supply_chain_integrity`** — Azure's `admin_enabled` is one line that
  creates a shared push credential for the whole registry. GCP's is the
  opposite: a Binary Authorization policy set to `ALWAYS_ALLOW` is the absence
  of the control with a resource in the plan and a line in a compliance
  document, which is worse than not having it because the claim outlives the
  check.
- **`reproducible_data_path`** — the only two tasks in the set that refuse a
  version tag and require a digest, deliberately different from the rollout
  pair that accepts `api:1.4.2`. A rollout asks whether one build is healthy
  and a tag answers that; a result defended a year later asks what actually
  ran, and a tag is a promise where a digest is arithmetic.

### What the guards caught, which is the part worth keeping

Three separate mechanisms refused a silent change, and each one was right:

1. **The pinned task count** caught all twenty additions.
2. **The check-id collision guard**, widened from MLOps to all four tracks,
   found three collisions. Two were cross-provider ids that were inaccurate
   rather than duplicated work; one was two Azure tasks sharing a trivial
   `storage_account` id, which is the case the guard exists for.
3. **Three ordering tests** caught the additions changing which task
   `devops_platform` and `mlops` _lead with_. Declaration order is offer order,
   and the first task a candidate reads had silently become an Azure one.
   Nobody decided that, so the new tasks now sit at the end of `GRADED_TASKS`
   and every track keeps the opening it had.

None of these was found by reading the diff. All three were found by tests that
existed to hold a property somebody had thought about earlier.
