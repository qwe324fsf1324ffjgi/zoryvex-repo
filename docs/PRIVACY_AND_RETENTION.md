# Privacy and Retention

Design document, written ahead of implementation like `docs/THREAT_MODEL.md`. Scope: what personal data
Zoryvex holds, who can see it, how long, and how it leaves the system on request. This document does not
authorize any NDPC/DPIA filing or legal representation — see `CLAUDE.md` "Legal / government boundary";
those remain `NOT AUTHORIZED BY FOUNDER`.

## What is collected and why

- **Candidate**: profile (name, contact, launch track, evidence links), evidence artifacts (links/files
  proving hands-on work), discovery opt-in state. Collected only because it is what the proof-first hiring
  promise in `docs/PRODUCT_SPEC.md` requires — no field is collected "in case it's useful later."
  Candidates are never charged; see `CLAUDE.md` "candidates free."
- **Employer**: profile (organization, contact), saved roles, payment/entitlement state (never raw card
  data — Paystack holds that; see `docs/PAYMENTS.md`).
- **Nobody's protected traits are inferred.** AI matching never scores faces or infers protected
  characteristics from a name, photo, or address (see `docs/AI_SAFETY.md`).

## Consent and visibility

- A candidate's evidence and profile are **private by default**. They become visible to a given employer
  only in these cases: (a) the candidate explicitly applied/responded to that employer's role, or (b) the
  candidate opted into discovery for a launch track and that employer's saved role matched them
  (see `docs/DATA_MODEL.md` GSI1 — visibility is structural, not a filter that can be forgotten).
- Opt-in is a single per-candidate flag, not a per-track one (a candidate has exactly one `launchTrack`; the track argument to `setDiscoveryOptIn` is a GSI partition key), and is revocable at any time; revocation removes the candidate from discovery
  immediately (deleting the GSI1 item), not "on the next batch job."
- Employers never see a private field (raw contact details, unredacted evidence) before the candidate has
  taken an action that unlocks it — see `CLAUDE.md`'s `contactUnlocks` feature flag, default off.

## Data subject actions

| Action                              | What happens                                                                                                                                                                                                                                       |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Export                              | Candidate/employer can request their own data as a machine-readable export; the API reads only their own partition (`CANDIDATE#<id>` / `EMPLOYER#<id>`, see `docs/DATA_MODEL.md`) — never another user's.                                          |
| Deletion                            | Removes the profile item, all evidence items, and all discovery GSI items for that person; evidence objects are deleted from S3, not just unlinked. Deletion is irreversible and is itself logged (who requested it, when — not what was deleted). |
| Consent withdrawal (discovery only) | Removes only the GSI1 discovery item; profile and existing applications/matches are unaffected.                                                                                                                                                    |

## Retention

- **Evidence objects (S3)**: lifecycle-expired per `infrastructure/modules/evidence-storage`'s
  `retention_days` variable. Default posture: retained only as long as the candidate's discovery opt-in or
  an active application makes it relevant, deleted automatically after that — the exact number of days is
  a product decision for a later phase, not invented here.
- **Webhook dedupe records**: short-lived, only as long as needed to guarantee idempotency (see
  `docs/DATA_MODEL.md` `WEBHOOK#<id>` item) — not a permanent payment audit log by itself.
- **Audit/log retention**: structured logs never contain the redacted fields listed below; operational log
  retention is bounded by the CloudWatch log group retention setting (set at deploy time, not this phase).

## What is never logged

Per `CLAUDE.md`: tokens, email bodies, contact details, file contents, Paystack payloads, and candidate
evidence are never logged. Structured log fields are an explicit allowlist (event name, request ID, entity
type, timestamp, outcome/status code) — never an unstructured dump of the request/response body. A log
line that would need a field from the denylist above logs a redaction marker (`[redacted]`) instead of
omitting the field silently, so a reviewer can tell redaction happened rather than assuming the field never
existed.

## Relationship to other docs

Structural enforcement of the rules above lives in `docs/DATA_MODEL.md` (key design) and
`docs/THREAT_MODEL.md` (the "non-opted-in candidate appears in search" and "evidence retained past
lifetime" threats). This document is the source of the _policy_; those are where it becomes a _testable
mechanism_.
