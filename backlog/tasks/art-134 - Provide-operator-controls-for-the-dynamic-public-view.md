---
id: ART-134
title: Provide operator controls for the dynamic public view
status: In Progress
assignee:
  - '@claude'
created_date: '2026-08-04 15:59'
updated_date: '2026-08-24 18:38'
labels:
  - prd-2.0
  - v2-i
  - epic-q
dependencies:
  - ART-133
priority: medium
type: feature
ordinal: 134000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**Requirement ID:** FR-Q002 (PRD 2.0 §12 Epic Q) — P1

**Problem / Context:** Operators need to intervene in the public visual layer (pause updates, hide a character or scene, rebuild the projection) without touching Canon or bypassing the correction workflow.

**Goal:** Operator control over the public visual layer only, with Canon integrity preserved.

**Scope:**
- Pause public runtime updates.
- Force use of the last valid snapshot.
- Hide the public visual for an individual character or scene.
- Inspect binding and synchronization errors.
- Rebuild the public dynamic projection.

**Out of Scope:** Canon corrections (PRD 1.0, delivered); emergency stop (PRD 1.0, delivered).

**Dependencies:** FR-Q001 observability.

**Schema Impact:** Operator control state for the dynamic layer.

**API Impact:** Authenticated operator endpoints only.

**Security Impact:** Must reuse the existing operator authorization and audit path; must not permit Canon event modification or bypass of the correction workflow.

**Test Requirements:** Authorization tests, tests that controls cannot modify Canon events, and audit-trail tests.

**Validation Commands:**
- `npm run check`

**Documentation Impact:** Operator runbook additions for the dynamic layer.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Operators can pause public runtime updates
- [x] #2 Operators can force use of the last valid snapshot
- [x] #3 Operators can hide the public visual for an individual character or scene
- [x] #4 Operators can inspect binding and synchronization errors
- [x] #5 Operators can rebuild the public dynamic projection
- [x] #6 Operator controls cannot modify Canon events
- [x] #7 Operator controls cannot bypass the correction workflow
- [x] #8 All operator actions reuse the existing authorization and audit path
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
- [ ] #13 Changes are committed and pushed
- [ ] #14 Pull request is merged or explicitly blocked
<!-- DOD:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Verification (2026-08-25)

`npm run check` green (156 suites, 2437 passed, 5 pre-existing skips, build OK).
`npm run e2e` green (66 tests, desktop + Pixel 5).

### Fault injection — and the two that were NOT caught, which is the finding

1. Releases stop working (`if (!entry.engaged) continue` disabled) -> 4 failures. Caught.
2. `recordAudit` wrapped in `if (false)`, so no command audits -> **0 failures.** The whole
   structural suite passed, because it checked that the symbol was REFERENCED and the reference
   was still there.
3. `applyDynamicViewControls(...)` replaced with `derived.projection`, so hidden characters stay
   on the public map -> **0 failures**, for the same reason: the import line still named it.

Both gaps were in the EVIDENCE, not the product code, and evidence that looks like it proves
something while proving nothing is worse than no evidence. Fixed:

- Added `dynamicViewControlFunctions.test.ts`, which runs the real registered handlers against
  a fake context and asserts what was actually written. Re-running injection 2 now fails 5.
- The build-time check now strips every `import` statement before looking for the identifier.
  Re-running injection 3 now fails 1.

All three restored and re-verified green (2437 passed).

### Two existing guards refused this branch, both correctly

- `operatorAuthorization.test.ts` enumerates every capability by name; the five new ones had to
  be added deliberately.
- `publicReadOnlyGuarantee.test.ts` banned `characterId` as a declared argument on ANY public
  function, because that is the shape of a player-control API. `setCharacterVisualHidden`
  legitimately needs one. The ban is now absolute for ANONYMOUS functions, PLUS a new test
  requiring that anything declaring `characterId` is operator-gated. That is a narrowing, not a
  relaxation: the alternative was exempting one function by name, and a by-name exemption is how
  an exhaustive guard stops being exhaustive.

### AC#4 was already delivered

`inspectDynamicViewMetrics` (ART-133) already derives the binding and synchronisation errors as
`server_measured`, behind the same operator gate. Recorded as met-by-ART-133 rather than
rebuilt: calling it from here and re-exporting would give the console two places to read the
same numbers from, and that ends with one reporting a different figure for the same world.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Five operator controls over the public dynamic view, plus a read-only inspection, all through
the console's existing gate and audit path rather than a second mechanism.

The ledger is APPEND-ONLY and the effective state is replayed from it — a release is a row, never
a deletion. An operator control decides what the public can see, so the question asked afterwards
is never only "is it hidden now" but "who hid it, when, why, and what did they release"; a
mutable flag answers the first and destroys the rest. Same shape `safetyStatusOverrides` chose,
and deliberately kept SEPARATE from it: that table records what a classifier refused, this
records what an operator pulled, and merging them would let a release here silently un-withhold
something safety refused.

Applied at BUILD time, not read time, because a read-time filter would leave the hidden character
in the stored payload and FR-O010's last-known-good would keep serving it — the hidden thing
coming back from the mechanism designed to keep the page alive. The pure model lives in
`convex/shared` because `publicRead` may not depend on `operations`, and the alternative was two
implementations of "what is hidden" that diverge by leaving something on screen while the console
reports it hidden.

AC#6/#7 are structural: the pure model imports nothing at all, and the wiring reaches no Canon
path, no correction function, and no second write target. The rebuild is the least powerful thing
that satisfies AC#5 — a read of Canon as it stands, then a write to the read-model store, exactly
what the post-commit orchestrator already does. Rebuilding while paused is refused rather than
silently performed.

Verified: `npm run check` green (156 suites, 2437 passed, build OK) and `npm run e2e` green (66
tests). Three fault injections — and two of them initially passed, which is the most useful thing
this task found: a source scan for `recordAudit` survives wrapping the call in `if (false)`, and a
scan for `applyDynamicViewControls` survives deleting the call because the import remains. Both
were fixed with a behavioural suite and by stripping imports before checking; re-running the
injections now fails 5 and 1. Docs: `docs/dynamic-view-operator-controls.md`; FR-Q002 matrix row
updated.
<!-- SECTION:FINAL_SUMMARY:END -->
