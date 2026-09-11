---
id: ART-181
title: A rules-only slot leaves the prior attempt's failed world-day run standing
status: Done
assignee: []
created_date: '2026-09-11 19:30'
updated_date: '2026-09-11 20:00'
labels: []
dependencies: []
type: bug
ordinal: 179000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
When the FR-M004 ladder has dropped to rung 4 or 5, `prepareQueuedWorldDaySlot` routes the slot to `runRulesOnlySlot` (`convex/simulation/worldDayLiveFunctions.ts:495`) instead of `executeSlot`. That is correct — a rules-only slot has nothing to author, and routing it through the action would put an empty network call between the same two mutations.

What it also does is skip the **run store** entirely. `executeSlot` passes `createConvexWorldDayRunStore(ctx.db, now)` to `executeWorldDay`, which creates and settles a `worldDayRuns` row keyed on `worldDayRunId(slot)`. `runRulesOnlySlot` writes `scheduledSlots` (via `completeScheduledSlotRef` / `failScheduledSlotRef`) and nothing else.

The run id is derived from the slot identity, so a retry reuses it — and the sequence that produces the inconsistency is the ladder’s own designed recovery, not an exotic one:

1. A slot is authored and fails; `failRun` leaves `worldDayRuns` at `status: "failed"` with the provider’s `failureStage` / `errorCode` / `errorMessage`.
2. `FAILURES_BEFORE_ESCALATION` is reached and `advanceDegradation` moves the world to `rules_only`.
3. The slot is retried. `policy.rulesOnly` is now true, so `runRulesOnlySlot` runs, commits its deterministic events and completes the slot.
4. `scheduledSlots` says `completed`. `worldDayRuns` still says `failed`, with a provider error code, for the same (world, day, slot).

This is the same symptom ART-150 fixed for the authored path — a successful run carrying a prior attempt’s failure — and ART-150’s fix cannot reach it, because that fix made the run-store CONTRACT clear the failure fields on completion and this path never calls the store at all.

Readers of the stale row: `inspectRun` (`worldDayOrchestrationFunctions.ts`), the proposal-review surface (`proposalReviewStore.ts:168`, which maps `worldDayRuns.errorCode` + `failureStage` to a rejection reason), and `runsForSlot` in the operations console.

**Not affected, checked rather than assumed:** `cancelUncommittedScene` cannot be tricked into cancelling committed Canon by this. `decideSlotCancellation` refuses on `slot.committedEventId` and on `slot.status === "completed"` before it ever looks at the runs, and `runRulesOnlySlot` sets both.

Scope: settle the EXISTING run record when a rules-only slot finishes. Do not create one where none exists — a `worldDayRuns` row means a world-day run executed the ten-stage pipeline, and minting one for a rules-only slot would be a new false claim in place of a stale one.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A slot that fails while authoring and then succeeds at rung 4 or 5 leaves no run record claiming the slot failed
- [x] #2 The prior attempt's failure stays visible as attempt history rather than being erased, exactly as ART-150 requires of the authored path
- [x] #3 A rules-only slot in a world that never authored one creates no world-day run record
- [x] #4 A rules-only slot that itself fails records that failure rather than leaving a stale success
- [x] #5 A fault injection proves it: removing the run-store settlement turns a named test red
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 All acceptance criteria are satisfied
- [x] #2 Relevant automated tests are added or updated
- [x] #3 Typecheck passes
- [x] #4 Lint passes
- [x] #5 Relevant tests pass
- [x] #6 Build passes when applicable
- [x] #7 No known regression is introduced
- [x] #8 No secret or credential is committed
- [x] #9 Documentation is updated
- [x] #10 PRD traceability is updated when applicable
- [x] #11 Implementation notes are complete
- [x] #12 Final summary includes verification evidence
- [x] #13 Changes are committed and pushed
- [x] #14 Pull request is merged or explicitly blocked
<!-- DOD:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Settle the existing worldDayRuns record inside runRulesOnlySlot via createConvexWorldDayRunStore: completeRun on success, failRun at commit_accepted_events on refusal. Create nothing; never move a completed run.
2. Mirror it in longRunHarness.ts, which keeps its own MemoryWorldDayRunStore for the authored branch and would otherwise reproduce the defect inside the 30/90-day evidence.
3. Tests driving the real prepareQueuedWorldDaySlot handler against an in-memory database.
4. Fault injections on every branch; npm run check; npm run e2e.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## The fix

`runRulesOnlySlot` now calls `settleRunRecordForRulesOnlySlot` after settling the slot:
`completeRun(runId, committedEventIds)` on success, `failRun(runId, 'commit_accepted_events', …)` on
a refusal. `completeRun` clears the failure fields for free — that is ART-150's `CLEARED_RUN_FAILURE`
contract, and the Convex adapter's `db.patch` removes a field patched to `undefined`.

Two refusals, both deliberate and both tested:

- **It never creates a record.** A `worldDayRuns` row asserts that a world-day run executed the ten
  stages. A rules-only slot did not, and minting one would replace a stale claim with a false one
  for every reader — `inspectRun`, the console's `runsForSlot`, the proposal-review view.
- **It never moves a completed run.** `patchRun` treats a completed run as terminal
  (`RUN_TERMINAL`), so attempting it would throw and take the slot down with it — and nothing about
  a completed run is stale anyway.

`worldDayCheckpoints` is untouched, which is what keeps ART-150 AC#2's per-attempt history.

## The harness carried the same defect

`longRunHarness.ts` has its own rung-4 branch (`commitRulesOnlySlot`) and its own
`MemoryWorldDayRunStore` for the authored branch, so it reproduced the disagreement inside the
evidence the 30- and 90-day gates rest on. `settleInheritedRunRecord` mirrors the production
function, including both refusals.

## Checked rather than assumed

`cancelUncommittedScene` cannot be tricked by this into cancelling committed Canon.
`decideSlotCancellation` refuses on `slot.committedEventId` and on `slot.status === 'completed'`
BEFORE it looks at the run rows, and `runRulesOnlySlot` sets both. The stale row is an operator
reporting defect, not a Canon-safety one, and saying which it is matters.

## Tests

`convex/simulation/rulesOnlyRunRecord.test.ts`, seven of them, driving the REAL
`prepareQueuedWorldDaySlot` handler against an in-memory database — the claim is what decides a
slot is rules-only, so asserting the settlement against `runRulesOnlySlot` in isolation would prove
a function nobody routed to.

The failing-slot case injects the refusal at the STORE (`insert('canonEvents')` throws) rather than
by inventing an invalid proposal, because the proposals this path derives are valid by construction
— a rules-only event asserts only what the world already implies. It is non-vacuous by
construction: had no proposal been derived, the injected refusal would never fire and the slot
would have completed.

## Fault injections — five, and two of them found weak tests before they found anything else

1. The settlement call removed from `runRulesOnlySlot` → `clears a prior attempt's failure when the
   rules-only retry succeeds` and `records a rules-only failure rather than leaving a stale success
   standing` red.
2. The production settlement made to CREATE a run when none exists → `creates no run record for a
   world that never authored one` and `keeps both refusals in both implementations` red.
3. The harness call replaced with `void settleInheritedRunRecord;` → **the first version of the
   harness test stayed green**, because it only asserted the name appeared in the file. Rewritten to
   require the awaited call with its arguments; the injection then bit.
4. The harness settlement made to create a run → **stayed green again**, because the regex that
   extracted the function body was anchored on a CALL and the call site appears first in the file,
   so it captured five lines of arguments instead of the body. Re-anchored on
   `async function settle…`; the injection then bit.
5. `Tests: 0 total` appeared once, from a `Lone quantifier brackets` regex error in the test file —
   caught by checking the total against the previous run rather than reading a grep-filtered pass.

The harness half is a SOURCE-level pin and says so in its own docblock. Driving the harness's
rules-only branch behaviourally means running its loop with a dead provider until the ladder
reaches rung 4 — minutes inside the 30-day gate, not a unit test. The behavioural half of the same
rule is the production test beside it, which drives the identical two refusals through the real
handler.

## Verification

`npm run check` exit 0 — 259 suites, 4520 passed / 31 skipped, build clean. `npm run e2e` 124
passed. The 30-day gate (`npm run test:longrun`) passed earlier in the same session: 17 passed, 7
skipped (the 90-day ones, which are separately gated).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
A rules-only slot (FR-M004 rung 4/5) wrote `scheduledSlots` and nothing else, so it left any
world-day run record it inherited untouched. `worldDayRunId` is derived from the slot identity, so
the ladder's own recovery produced the contradiction: a slot fails while authoring
(`worldDayRuns` → `failed`, with the provider's stage and code), the world drops to rung 4, the
retry succeeds here — and `scheduledSlots` then said `completed` while `worldDayRuns` said `failed`
for the same slot, for `inspectRun`, the operations console's `runsForSlot` and the proposal-review
surface that maps `errorCode` + `failureStage` to a rejection reason.

Same symptom ART-150 fixed for the authored path, and out of that fix's reach: ART-150 gave the
run-store CONTRACT one rule about the failure fields, and this path never called the store.

Now it settles the record it inherits — and refuses two things. It creates none (a run row asserts
a world-day run executed the ten stages; a rules-only slot did not), and it never moves a completed
run (`patchRun` treats one as terminal). `worldDayCheckpoints` is untouched, so ART-150 AC#2's
per-attempt history survives. The long-run harness carried the identical defect in its own rung-4
branch and now carries the identical rule.

**Verification.** `npm run check` exit 0 — 259 suites, 4520 passed / 31 skipped. `npm run e2e` 124
passed. Seven new tests drive the real `prepareQueuedWorldDaySlot` handler.

**Five fault injections. Two of them caught weak tests rather than weak code** — a source-level pin
that a `void` no-op satisfied, and a body-extracting regex anchored on a call site instead of the
definition. Both were rewritten until the injection bit, and both are recorded in the notes rather
than smoothed over. A `Tests: 0 total` also appeared once and was caught by comparing the total to
the previous run.
<!-- SECTION:FINAL_SUMMARY:END -->
