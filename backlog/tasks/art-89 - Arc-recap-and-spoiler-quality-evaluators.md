---
id: ART-89
title: Arc recap and spoiler quality evaluators
status: Done
assignee:
  - '@claude'
created_date: '2026-08-02 16:20'
updated_date: '2026-09-08 16:11'
labels:
  - prd-1.0
  - epic-o
milestone: m-0
dependencies:
  - ART-32
  - ART-35
  - ART-57
documentation:
  - backlog/docs/prd/ai-reality-town-prd-1.0/doc-1 - AI-Reality-Town-PRD-1.0.md
priority: medium
type: feature
ordinal: 89000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Requirement IDs
FR-M002 story editorial metrics

Problem / Context
PRD 1.0 needs this independently reviewable delivery unit to close a verified ownership or scope gap.

Goal
Compute Arc Progress, Arc Stagnation, Recap Coverage, and Spoiler Violation metrics.

Scope
Compute Arc Progress, Arc Stagnation, Recap Coverage, and Spoiler Violation metrics.

Out of Scope
Adjacent capabilities assigned to other tasks and production deployment.

Dependencies
ART-32, ART-35, ART-57

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
- [x] #1 Metrics derive from accepted events, arc state, and published summaries.
- [x] #2 Results identify exact omitted or violating sources.
- [x] #3 Operator queries expose components and evaluator version.
- [x] #4 Section 16.2: At least 95% of high-importance Accepted Events are covered by a published recap or carry an explicit, reviewable exclusion reason.
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
1. Audit (done): validateRecapCoverage runs live per episode and persists episodeCoverageReports, but nothing aggregates it into a ratio and the §16.2 95% clause is measured by nothing. `declaredExclusions` is a fully implemented type with NO storage and NO writer, so COVERAGE_EXCLUSION_UNJUSTIFIED is unreachable and the 'or carries an explicit, reviewable exclusion reason' half of §16.2 is satisfied by nothing. A ratio over stored episodes alone reads 100% by construction (episode.ts throws EPISODE_IMPORTANT_EVENT_MISSING at generation), so the denominator must be accepted events read independently from Canon by index. Every arc/recap read function is internalQuery — no operator can see any of it. Two stagnation thresholds exist and a metric must name which. Three 'what published content accounts for' records exist; pick one and justify.
2. Storage for the missing half: new table coverageExclusions (schemaVersion, worldId, worldDay, eventId, reason, operatorId, createdAt; by_world_and_day, by_world_and_event), append-only, one row per (world, event). Writer: operator mutation declareRecapExclusion gated on the EXISTING 'safety.override' capability — reused rather than minted, and the argument is that reusing a strictly MORE privileged capability (admin, the highest-consequence publication decision) cannot escalate anyone: an operator who may un-withhold content the classifier refused is by construction trusted to say an event may stay out of a recap. Minting would be a decision about the role model for a strictly smaller action.
3. convex/quality/storyQuality.ts — STORY_QUALITY_EVALUATOR v1 over accepted events + arc state + published summaries: recap_coverage (numerator = high-importance accepted events cited by a RELEASABLE published episode or carrying a declared exclusion; denominator = high-importance accepted events in the window; target 0.95 atLeast), spoiler_violation_rate (published contents whose persisted coverage report carries a spoiler-category finding / contents examined; target 0 atMost), arc_progress_rate, arc_stagnation_rate (target 0), arc_resolution_rate, plus a composite story_health score. Findings name the exact omitted event ids and violating source ids and carry no prose.
4. Operator query getStoryQualityMetrics (world.inspect) in worldQualityFunctions.ts + surface entry; harness LongRunFindings.storyQuality driven by the same evaluator.
5. Remove validateEpisodeCoverageGate (zero callers; it both decides and mutates the publication lifecycle, which ART-164 separated).
6. Fault injections >=6: exclusion accepted with an empty reason; denominator taken from episodes instead of Canon; a withheld episode counted as covering; spoiler findings filtered to the wrong category; stagnation measured against the wrong threshold; the operator gate removed.
7. docs/world-quality-metrics.md + docs/recap-coverage-validation.md (correct the stale claim that validateEpisodeCoverageGate is the live gate) + closure matrices; npm run check, test:longrun, e2e; PR, auto-merge, close.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Defect found and fixed at root: a world day was treated as COMPLETE the moment one accepted event carried the final time slot. The post-commit pipeline runs once per accepted event, so the first event of a day's final slot marked the day complete, the episode stage assembled that day's Episode, and Episodes are idempotent per day — the rest of that slot reached no Episode, no recap and no publication, for every day of every world. Nothing failed because the coverage gate obliges an Episode to cite the events of its own day AS THE EPISODE SAW THEM. Measured: 14 of 96 high-importance Accepted Events permanently uncovered over 7 days, §16.2 coverage 85.4%. Fix: completedWorldDaysOf now means 'the world has moved past this day' (day < latestWorldDay); the daily snapshot, which may only be taken while its day is still the latest, keeps the old condition under its own name latestWorldDayFinalSlotStarted on PostCommitWorldState. Two stages were asking different questions through one flag.
Delivered: coverageExclusions table + convex/recaps/coverageExclusions.ts + operator mutation declareRecapExclusion (reuses safety.override — admin, strictly more privileged than the action, so reuse cannot escalate) — declaredExclusions had a type and a check since ART-35 with no storage and no writer, so COVERAGE_EXCLUSION_UNJUSTIFIED was unreachable and §16.2's exclusion clause was satisfied by nothing. convex/quality/storyQuality.ts (STORY_QUALITY_EVALUATOR v1: recap_coverage >=0.95 over Canon's high-importance events, spoiler_violation_rate, arc_progress_rate, arc_stagnation_rate, arc_resolution_evidence, story_health composite). Operator query getStoryQualityMetrics (world.inspect). LongRunFindings.storyQuality. Removed validateEpisodeCoverageGate (zero callers; it both decided and advanced the publication lifecycle, which ART-164 separated).
Measured after the fix, 7-day seed: recap coverage 81/81 = 100% with the newest day's 15 events excluded as not-yet-due, spoiler 0/6, arc progress 3/3, stagnation 0/3, resolution 3/3, story health 1.0.

Fault injections (each compiled, ran, reddened a named test, restored and md5-verified): (a) a refused publication counts as covering -> 'counts an episode that never reached an audience as covering nothing' red (4 failed/43); (b) a blank exclusion reason honoured -> the blank-reason table cases red; (c) pending days folded into the denominator -> 'excludes the pending day's events rather than charging them as uncovered' red; (d) reconcileCoverageExclusion always deduplicates -> 'refuses a second, different reason for an already-excluded event' red; (G) completedWorldDaysOf admits the latest day again -> 6 postCommitWorldState agreement tests red; (H) the snapshot stage reads completedWorldDays again -> longRunHarness 'passes every clean Section 19.3 check' and the ART-58 baseline test red (the daily snapshot disappears entirely, so replay_consistency loses its denominator).
Verification: npm run check -> 235 suites, 3994 passed, exit 0. npm run test:longrun -> 17/17 over 30 world days, 29 episodes for 30 days (the newest day's is due on day 30's first commit), recap coverage meets >=95% over the due days, zero spoiler violations. npm run e2e -> 88 passed.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Delivered the Story-quality evaluator v1 (convex/quality/storyQuality.ts): Recap Coverage against §16.2's 95% clause measured over Canon's high-importance accepted events, Spoiler Violation from the persisted FR-G004 verdicts, and Arc Progress / Stagnation / Resolution, read through the operator-gated getStoryQualityMetrics and reported by the long-run harness. Supplied the half of §16.2 that had no implementation: coverageExclusions plus declareRecapExclusion, so 'or carries an explicit, reviewable exclusion reason' is storage and a writer rather than an unreachable check. Found and fixed the defect the metric existed to reveal: a world day counted as complete when its final slot BEGAN, so every day's Episode was built from a partial slot and the rest was never published — 14 of 96 high-importance events uncovered and coverage at 85.4%. A day is now over when the world has moved past it, and the daily snapshot keeps the old condition under its own name. Verified: 62 new tests, 6 fault injections red-then-green, npm run check 3994 passed, 30-day gate 17/17 with coverage 100% of the due events, e2e 88 passed.
<!-- SECTION:FINAL_SUMMARY:END -->
