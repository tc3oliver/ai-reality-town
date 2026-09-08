---
id: ART-91
title: Safe model outage degradation workflow
status: Done
assignee:
  - '@claude'
created_date: '2026-08-02 16:20'
updated_date: '2026-09-08 17:41'
labels:
  - prd-1.0
  - epic-o
milestone: m-0
dependencies:
  - ART-18
  - ART-52
  - ART-59
  - ART-72
documentation:
  - backlog/docs/prd/ai-reality-town-prd-1.0/doc-1 - AI-Reality-Town-PRD-1.0.md
priority: medium
type: feature
ordinal: 91000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Requirement IDs
FR-M004

Problem / Context
PRD 1.0 needs this independently reviewable delivery unit to close a verified ownership or scope gap.

Goal
Implement the ordered degradation path while preserving mandatory invariants.

Scope
Implement the ordered degradation path while preserving mandatory invariants.

Out of Scope
Adjacent capabilities assigned to other tasks and production deployment.

Dependencies
ART-18, ART-52, ART-59, ART-72

Schema Impact
Versioned LLM trace, budget, degradation, evaluator, metric-definition, aggregate, and reason-dimension records named by the task.

API Impact
Authorized observability/configuration queries and internal accounting/evaluation interfaces.

Security Impact
Metrics and traces redact secrets, resist duplicate counting, and cannot become or mutate Canon.

Validation Commands
npm run check; run the task-focused automated or documented manual validation and record exact evidence.

Test Requirements
Tests or documented human evaluation cover every acceptance criterion and applicable negative, retry, and privacy cases.

Documentation Impact
Update relevant domain, API, operations, test, and PRD traceability documentation.

Definition of Done
Project Backlog Definition of Done applies; verification evidence and merged PR are required.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Use same-model retry, compatible model, fewer scenes, rules-only events, deferred summaries, then pause in order.
- [x] #2 Every transition is traceable and respects retry/token budgets.
- [x] #3 Canon Validation, Safety Validation, Idempotency, and Event Persistence are never bypassed.
- [x] #4 Public content remains available throughout degradation or pause.
- [x] #5 Section 16.3: During model or provider outage, the last valid public content remains available without requiring an LLM call.
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

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Delivered the full FR-M004 ladder, wired into the live runtime: convex/simulation/degradation.ts (pure state machine — six ordered rungs, one rung per decision, nextLevel total on the ordered list so no caller can request a jump; FAILURES_BEFORE_ESCALATION=2 so one bad minute cannot degrade a world; only provider-side codes escalate, a Canon rejection or safety refusal moves neither level nor counter; recovery is one rung per authored slot; paused recovers only by operator action and returns to rules_only, not normal), convex/simulation/rulesOnlyAuthor.ts (rung 4: deterministic PROPOSALS with derived idempotency keys, one public fact_created and nothing else), convex/simulation/degradationFunctions.ts + worldDegradationStates/worldDegradationTransitions (append-only, transition id derived from (worldId, worldDay, timeSlot, kind) so a retried slot re-reaches the same decision without walking the ladder), the rung-6 admission gate BEFORE the claim (so no lease is burned), degradedPlan (rung 2 finally switches to ART-52's fallbackModel — stored since ART-52 and switched to by nothing until now; rung 3 truncates the validated plan rather than re-planning), rung 5's DEFERRABLE_RECAP_TYPES (episode is never deferred: an unpublished day is exactly the coverage failure §16.2 measures; a skipped tier leaves its cursor untouched so the next healthy run covers the same range — the cursor IS the backfill), and the operator surface getDegradationStatus (world.inspect) + resumeDegradation (world.resume).
Defect found and fixed on the way: describeWorldDayError collapsed every error without a Canon-shaped .error into WORLD_DAY_STAGE_FAILED, so a provider outage, a timeout, an exhausted route chain and a budget refusal all reached scheduledSlots.errorCode as one generic string — an operator could not tell them apart and the ladder could not either. It now preserves any error's own stable code.
Honest limitation recorded: Canon does NOT refuse an invented memory on a rules-only event (a character_memory_formed is a legitimate state change), so 'rung 4 asserts nothing it cannot observe' is enforced by the author and its tests, not by Canon. Injection (f) confirmed this — the event still passed validation, and only the named absence tests caught it.
The fake narrator is unreachable by failure: sceneAuthorFor is a closed two-value mode with no default and no rung names it.

Fault injections (each compiled, ran, reddened named tests, restored and md5-verified): (a) nextLevel skips a rung -> 19 failed/52; (b) a Canon code added to DEGRADATION_TRIGGER_CODES -> 2 failed/53; (c) FAILURES_BEFORE_ESCALATION=1 -> 19 failed/52; (d) resumeFromPause returns to normal -> 1 failed/52; (e) paused admits simulation -> 3 failed/52; (f) the rules-only author invents a memory -> 2 failed/24 ('carries exactly one public fact_created and nothing else', 'forms no relationship, memory, knowledge or rumor state'); (g) episode added to DEFERRABLE_RECAP_TYPES -> 7 failed/12.
Verification: npm run check -> 242 suites, 4130 passed, exit 0. npm run test:longrun -> 17/17 over 30 world days. npm run e2e -> 88 passed. convex/operations/degradationIntegration.test.ts drives the REAL fixture under an injected total provider outage and proves AC#3/#4/#5: the public last-known-good payload is byte-identical through the outage, the ladder descends on outcomes the real pipeline produced (5 dead slots = 2 escalations, not 5), rules-only events pass validateEventStructure and validateCanon and commit through commitProposedEvent and dedupe on retry, and recovery climbs one rung per authored slot.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Delivered the FR-M004 ladder — same-model retry, compatible model, fewer scenes, rules-only events, deferred summaries, pause — as a pure state machine wired into the live runtime, with an append-only transition log, an operator status query and a resume path. Only provider-side failures escalate, two are needed per rung, and one authored slot recovers one rung; a paused world resumes to rules-only rather than to normal. Rung 4 proposes deterministic events that pass the same validation, idempotency and commit path as authored ones and assert nothing they cannot observe; rung 5 never defers the Episode, because an unpublished day is the coverage failure §16.2 measures. Fixed a real defect found on the way: every provider outage, timeout, exhausted route chain and budget refusal reached operators as one generic error code. Verified: 88 new unit tests plus a real-pipeline integration suite proving the public last-known-good content survives a total outage byte-identically, 7 fault injections red-then-green, npm run check 4131 passed, 30-day gate 17/17, e2e 88 passed.
<!-- SECTION:FINAL_SUMMARY:END -->
