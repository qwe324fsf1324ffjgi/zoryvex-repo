# Loop / Goal Runbook

Plain-English first, exact commands second. This file is what a session reads before using `/goal` or `/loop`, and what it reads to recover after any interruption.

## In baby-simple language

- `/goal` is for doing a whole numbered phase of work in one guided run, checking itself as it goes.
- `/loop` is only ever allowed here for *watching* something finish (like a GitHub Actions run) — never for building or changing things repeatedly.
- There is a hard cap of 12 total `/goal` turns per phase, and 6 checks per polling loop. When the cap is hit, work stops and waits for the founder, it does not push through.
- If the exact same thing fails twice in a row, the session stops and says so instead of trying a third time.
- If a check is flaky (sometimes passes, sometimes fails) it gets marked `FLAKY - NOT PASSED` — never quietly retried until green.

## Exact Universal phase goal command

```
/goal Execute Prompt <N> of the preserved Zoryvex numbered manual exactly as written, respecting CLAUDE.md and .zoryvex/state.json. Stop at the phase's exact approved pass phrase, one HUMAN ACTION REQUIRED block, or 12 cumulative turns — whichever comes first. Save a checkpoint to .zoryvex/state.json before ending each turn.
```

## Exact polling-only loop command (read-only job watching only)

```
/loop Check the status of <specific GitHub Actions run or AWS job already authorized by the active phase> read-only, at most 6 times, and stop on any terminal status (success, failure, cancelled) or after 6 checks — whichever comes first. Do not take any action other than checking status.
```

## Limits (authoritative; `.zoryvex/state.json` cumulative counters override Claude's own native per-session counter, which resets on resume)

- Goal-turn limit: **12 cumulative turns** per phase, tracked in `state.json.cumulativeGoalTurnCount`.
- Polling-check limit: **6 checks** per loop, tracked per invocation, not cumulative across phases.
- Consecutive identical-failure limit: **2** — the 3rd identical attempt never happens automatically; the session stops with `REPEATED FAILURE STOP`.
- Flaky test rule: run an intermittent test **3** controlled times; any unexplained failure among those 3 is `FLAKY - NOT PASSED` — never masked by a retry, a skip, a weaker assertion, or a longer timeout.

## Preflight matrix (what must be re-checked before writing, every phase and every resume)

Resolved working directory · repository identity · expected branch/upstream · merge state (no unresolved rebase/merge/cherry-pick) · last good commit · intentional working-tree changes (nothing unexplained) · locked dependency state · required configuration names present · baseline test evidence. Never continue from detached HEAD, an unresolved Git operation, an unexplained deletion, or the wrong project.

## Forbidden Git actions (always, not just during a loop)

`git reset --hard`, `git clean -fd`, force push, history rewriting, bulk deletion, or an unplanned broad refactor. Always scan for secrets and inspect every deletion/rename before a commit.

## Emergency stop triggers

- `REPEATED FAILURE STOP` — same error/approach failed twice.
- `FLAKY - NOT PASSED` — a test failed unexplainably in a 3-run check.
- `LOOP LIMIT REACHED` — 12 cumulative goal turns hit.
- `USAGE PAUSED - RESUME SAME PHASE` — Claude Pro shared usage limit paused the session; this is not a failure, checkpoint and resume later, never switch to an API key or another account without explicit founder approval.
- Any secret detected in a diff about to be committed — stop, do not commit, report the file (not the value).
- Any unexplained deletion/rename found during preflight — stop, do not proceed, report what was found.
- A `HUMAN ACTION REQUIRED` block — always clears the current goal (see below) and is, by itself, a terminal condition for the active `/goal` run.

## Interruption / in-flight process verification

Before repeating or changing any command, check `state.json.lastCommandResult` and `state.json.inFlightProcessesOrJobs` for anything left running or ambiguous from a prior turn. An interrupted external job (GitHub Actions run, AWS operation) must be identified and its actual current status checked read-only before deciding whether to re-run it — never assume a prior attempt failed just because the session was interrupted.

## Context recovery

If context becomes unreliable mid-phase: stop forward work, persist verified state to `state.json`, clear the active goal, compact/resume the session, then run the Universal resume prompt below, and only continue once it reports `RESUME CHECK PASSED`.

```
Universal resume prompt: Read .zoryvex/state.json and CLAUDE.md. Re-run the preflight matrix above against live state (not the file's memory of it). Report any mismatch. If everything matches, output RESUME CHECK PASSED and state the next safe action from state.json; otherwise output the specific mismatch and stop.
```

## Usage-pause procedure

Claude Pro usage is shared across Claude and Claude Code. A pause is not a failed phase: save the checkpoint, output `USAGE PAUSED - RESUME SAME PHASE`, and resume the identical phase after reset. Never switch to `ANTHROPIC_API_KEY`, Console usage credits, or a different account to work around a pause without explicit founder approval first.

## Human actions clear the goal

Any `HUMAN ACTION REQUIRED` block ends the current `/goal` run. It is not "paused mid-goal" — the founder's reply of `done` starts a fresh, explicit continuation, not an automatic resumption.

## Commercial addendum

The full v4.5 Commercial Optimization Addendum is recorded verbatim in [[docs/COMMERCIAL_RUNBOOK]] (kept separate from this file so the loop/goal mechanics above stay easy to scan). The acceptance-and-stop conditions in that addendum apply at every phase listed there in addition to the mechanics on this page.
