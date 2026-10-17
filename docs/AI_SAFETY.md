# AI Safety

Governs any model invocation (Bedrock or otherwise) anywhere in Zoryvex. Binding alongside `CLAUDE.md`'s
AI rule: "AI may summarize/explain, never make the final hiring call, infer protected traits, score faces,
or silently reject."

## Purpose

The only sanctioned uses of a model in this product are: (1) summarizing/explaining a candidate's evidence
for an employer, and (2) ranking/suggesting candidate-role matches to surface for human review. Nothing
else is in scope without a founder decision to change this document first.

## Prohibited inputs

- Candidate photographs or any biometric signal (no face scoring, ever — hard boundary, not a tunable
  threshold).
- Name, address, or any field used as a proxy to infer a protected characteristic (race, gender, age,
  religion, disability, etc.).
- Anything on the "never logged" denylist in `docs/PRIVACY_AND_RETENTION.md` — a prompt is a form of
  logging risk (provider-side retention) and follows the same redaction rule.

## Prohibited outputs / uses

- No output is ever applied as a state change (hire, reject, rank-and-auto-advance, auto-unlock contact
  info) without an explicit human action in between. See `docs/THREAT_MODEL.md` "AI-generated content used
  as if it were a decision."
- No silent rejection: if a candidate is filtered out of a result set, that must be traceable to an
  explicit, reviewable rule (e.g. "did not opt into this track"), never an opaque model decision with no
  stated reason.
- No silent disqualification either. Graded practical tasks are scored by deterministic code rather
  than a model, so they sit outside this document's model rules, but the same duty applies: a
  submission that fails is told every requirement it missed and why each one matters. Some checks
  disqualify outright, and because a disqualified submission can still sit at or above the pass mark,
  the response names the check that ended it rather than reporting a score that would read as a pass.
  Every attempt is appealable against a published rubric, which is the point of the rubric being code.
- No output is treated as executable — a model response is data to render, never a command, file path, or
  query fragment interpolated directly into a repository call (mirrors the typed-error/validated-input
  pattern in `services/api/src/validation`).

## Human control

- Every AI-touched surface has a human-in-the-loop action that is the actual state-changing step (the
  employer clicks "shortlist," not the model). This is enforced architecturally: `services/api`'s domain
  layer has no code path where a model response alone triggers a DynamoDB write to an entitlement, match
  status, or contact-unlock field.
- The `aiMatching` feature flag (`packages/config`) defaults to `false`. Enabling it is a deliberate,
  reviewable change, not an implicit side effect of another feature shipping.

## Explainability

Any AI summary or ranking shown to an employer states, in product copy, that it is AI-generated and what
it is and is not (e.g. "AI-generated summary of the evidence below — verify before deciding," not
presented as a verified fact or a score with unstated meaning).

## Evaluation and monitoring

- Before `aiMatching` is turned on for any employer, its outputs are evaluated against the prohibited-input
  and prohibited-output rules above using a fixed, synthetic (never real candidate) test set — no live
  candidate data is used to develop or tune prompts. As of Phase 7 slice 6, this is implemented as
  `services/api/tests/bedrock-explain-service.test.ts`'s grounding/citation/prompt-injection/schema-validity/
  timeout/throttling suite (`aws-sdk-client-mock`-level, run in CI on every PR) — it proves the code-level
  enforcement (allow-listed evidence-ID citation filtering, mechanical rejection of ungrounded/malformed
  output) deterministically. It does not yet include a live-model qualitative-accuracy evaluation against
  Bedrock itself, since `aiMatching` stays `false` and the model is never actually invoked this phase — see
  `docs/RISK_REGISTER.md`.
- Once enabled, invocation volume and cost are monitored the same way as every other AWS spend line (see
  `docs/COST_GUARDRAILS.md`) — Bedrock is on-demand only, never provisioned throughput, per the existing
  architecture boundary.

## Rollback

Because `aiMatching` is a feature flag, not a structural dependency, rollback is: set the flag to `false`.
No data migration is required because no AI output is ever the only copy of a fact — every AI-touched value
is a suggestion layered on top of data that exists independently (see `docs/DATA_MODEL.md`).

For that to be true in practice, the flag has to gate **reading** AI output, not only generating it. A
2026-08-27 audit found it did not: only `handlers/matches/explain.ts` consulted the flag, so a `Match`
written while AI was on kept serving its `aiExplanation` from `GET /roles/{roleId}/matches` indefinitely
after the flag went off — including after `scripts/emergency-cost-lockdown.mjs` forced it off during an
incident, which is exactly when the rollback needs to bite. `matching-service.ts`'s `redactAiOutput` now
strips the field from every match response while the flag is off. It redacts rather than deletes, so
turning the flag back on restores what was there and the "no data migration" promise above still holds.

Grounding has the same shape of trap. A stored explanation names evidence IDs in its prose, so it is only
meaningful about the evidence set it was written from. Recompute refreshes `matchedEvidenceIds`, and a
candidate can edit, hide, or delete a single evidence item without any match being touched. A preserved
explanation would then describe evidence the match no longer contains, so recompute drops `aiExplanation`
whenever the matched evidence set changes, and keeps it only when the set is identical.
