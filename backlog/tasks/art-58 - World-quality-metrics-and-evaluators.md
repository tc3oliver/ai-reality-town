---
id: ART-58
title: Continuity and Canon quality metrics
status: Done
assignee:
  - '@claude'
created_date: '2026-08-02 15:33'
updated_date: '2026-09-08 11:32'
labels:
  - prd-1.0
  - epic-o
milestone: m-0
dependencies:
  - ART-57
  - ART-15
  - ART-17
documentation:
  - backlog/docs/prd/ai-reality-town-prd-1.0/doc-1 - AI-Reality-Town-PRD-1.0.md
priority: medium
type: feature
ordinal: 58000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Requirement IDs
FR-M002 continuity metrics; Section 16.2 Canon targets

Problem / Context
This task is a single reviewable PR within PRD 1.0 and owns only the capability stated below.

Goal
Compute Continuity Score and report Canon conflict, replay, secret-leak, deceased-character, and location-conflict quality targets.

Scope
Compute Continuity Score and report Canon conflict, replay, secret-leak, deceased-character, and location-conflict quality targets.

Out of Scope
Narrative, story/editorial, rejection-rate, safety-rate evaluators, and production deployment.

Dependencies
ART-57, ART-15, ART-17

Schema Impact
Versioned LLM trace, budget, degradation, evaluator, metric-definition, aggregate, and reason-dimension records named by the task.

API Impact
Authorized observability/configuration queries and internal accounting/evaluation interfaces.

Security Impact
Metrics and traces redact secrets, resist duplicate counting, and cannot become or mutate Canon.

Validation Commands
npm run check; run the focused validation introduced by this task and record the exact command and result.

Test Requirements
Deterministic fixtures verify calculation, thresholds, aggregation, duplicate-run handling, and source traceability.

Documentation Impact
Update the relevant domain, API, operations, test, and PRD traceability documentation.

Definition of Done
Project Backlog Definition of Done applies; verification evidence and merged PR are required.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 FR-M002: Continuity Score is calculated with documented inputs and version.
- [x] #2 World-quality reporting exposes severe Canon conflicts, replay consistency, unsourced secret leaks, invalid deceased-character appearances, and location conflicts.
- [x] #3 Metrics trace to validation, replay, and accepted-event evidence without becoming Canon.
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
1. Audit (done): every ART-58 target exists only as report fields in convex/operations/longRunHarness.ts (test-only); no Continuity Score, no severity ladder, no operator query, no evaluator contract; revalidateAcceptedLog replays from emptyProjection (location checks vacuous); listValidationFailures has zero callers and reads a table the live path never writes.
2. Lift the metric primitive (MetricObservation/observe) from convex/analytics/metrics.ts into convex/shared/metricObservation.ts; analytics imports it. One definition of 'no observations != zero'.
3. New pure module convex/quality (policy: mayDependOn canon/editorial/shared; added to canonWriteBoundary.forbiddenModules so an evaluator cannot name a write symbol): evaluator.ts = the shared evaluator contract ART-88/89/90 reuse (versioned definition, evidence refs, findings, composite score, digest); continuity.ts = CONTINUITY_EVALUATOR v1: per-day fold from a stated origin (genesis / initial / previous daily snapshot) with independent structural+canon revalidation, sequence density, idempotency uniqueness, deceased appearance, location conflict (post-event participant location vs event location; double movement per slot), replay determinism + snapshot link (projectionIntegrityHash), unsourced secret leak (secret content or private fact value in published text with no cited public source); summarizeContinuity folds day reports into MetricObservations + weighted Continuity Score.
4. Operator query convex/operations/continuityMetricsFunctions.ts (world.inspect, index-scoped reads, SCAN_LIMIT surfaced, one publicFunctionSurface entry + MODULES map in publicReadOnlyGuarantee.test.ts). Payload carries ids/codes/counts only.
5. Harness: bind the real createDailySnapshot through InMemorySnapshotRecoveryStore (replacing the stub) and run the same evaluator over the run (LongRunFindings.continuity); fix revalidateAcceptedLog to replay from the seeded baseline.
6. Remove the zero-caller listValidationFailures; correct docs/canon-continuity.md; write docs/world-quality-metrics.md; update closure matrices.
7. Tests + fault injections (>=8): severity map gutted, replay hash ignored, dead participant check removed, location check removed, secret needle length bypass, denominator 0 -> 0%, snapshot seq mismatch ignored, forbiddenModules dropped, operator gate removed; each must compile and redden a named test.
8. npm run check, npm run e2e, PR, auto-merge, close.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented: convex/shared/metricObservation.ts (metric primitive lifted from analytics), convex/quality/evaluator.ts (shared FR-M002 evaluator contract: versioned definition, evidence refs, findings, composite score, digest), convex/quality/continuity.ts (Continuity evaluator v1: independent re-validation from a stated fold origin, sequence/idempotency, deceased appearance, location conflict incl. seed placement, replay determinism + daily-snapshot link, unsourced secret/private-fact leak), convex/operations/worldQualityFunctions.ts (getContinuityQualityMetrics, world.inspect, bounded index reads), convex/canon/ruleContextReader.ts (single reader shared by commit and the query; CanonRuleContext gains initialCharacterLocations). Policy: new quality module, in canonWriteBoundary.forbiddenModules; one publicFunctionSurface entry.
Harness gaps found by the audit and fixed here: (1) seededCanonStore had no initial snapshot, so every commit and the revalidation validated against emptyProjection and the location/capacity rules were vacuous for the whole 30-day evidence; (2) persistDailySnapshot was a stub citing ART-99 as known-broken although ART-99 was Done, so stage 20 never ran — now the real createDailySnapshot over a CanonBackedSnapshotStore; (3) replay.equal compared two full replays of the same list (could not fail) — liveDigest is now an incrementally carried projection; (4) characterPersonas were absent from the harness rule context so the persona gate was inert. With all four fixed the 7-day seed still commits 104 events with zero findings: 7/7 days snapshot-consistent, 14 publications, 0 leaks, Continuity Score 1.0.
Removed convex/simulation/queries.ts listValidationFailures (zero callers; read simulationRuns, a table only the Phase-0 foundation workflow writes). Corrected CLAUDE.md §8 (live path binds the real adapter since ART-159; fake is an explicit mode).

Fault injections (each compiled, ran, reddened the named test, then restored byte-identical): (a) SEVERE_CANON_CODES emptied -> 'reports a severe Canon code with the validation reference it came from' red (2 failed/28); (b) deceased check gated off -> 'flags a later event whose participant was dead at its start' red (1/28); (c) snapshot.projectionHash ignored -> 'flags a snapshot whose projection hash the fold does not reproduce' red (1/28); (d) observeRate returns 0 on denominator 0 -> 8 tests red across quality suites incl. 'reports every metric as unmeasured, and nothing as 0%'; (e) operator gate removed from getContinuityQualityMetrics -> publicReadOnlyGuarantee 'every operator-gated query refuses an unauthenticated caller too' red; (f) 'quality' dropped from canonWriteBoundary.forbiddenModules -> architecture test 'the quality evaluators are inside the Canon write boundary' red (43 pass/1 fail); (g) seeded initial snapshot dropped from the harness -> 'validates the run against the seeded baseline, not an empty projection' red. Defect found by the test pass and fixed: evaluateContinuityDay threw on a within-day sequence gap (the reducer raises SEQUENCE_GAP); the fold is now guarded and reports REPLAY_FOLD_FAILED. One injection first produced 'Tests: 0 total' (a type error) and was rewritten rather than counted.
Verification: npm run check -> 231 suites, 3870 passed, exit 0. npm run test:longrun -> 17/17 over 30 world days (704 s), 449 accepted events, continuity 30/30 days snapshot-consistent, zero findings. npm run e2e -> 88 passed. check:architecture clean (20 modules).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Delivered the FR-M002 evaluator pattern (convex/quality/evaluator.ts, shared metric primitive in convex/shared/metricObservation.ts) and the Continuity evaluator v1: Continuity Score (weighted, renormalised, null when unmeasured) plus 嚴重 Canon 衝突, Event Replay 一致率, 無來源秘密洩漏, 死者不合理出場, 角色位置衝突 as rates with published numerators/denominators and evidence refs (ids/codes only). Operator query getContinuityQualityMetrics (world.inspect). convex/quality is inside canonWriteBoundary.forbiddenModules. The long-run harness now seeds the initial snapshot, runs the real daily snapshot stage, carries an incremental projection for replay equality, carries persona anchors, and runs the same evaluator (LongRunFindings.continuity). Verified: 46 new unit tests, 7 fault injections red-then-green, npm run check 3870 passed, 30-day gate 17/17 with 30/30 days snapshot-consistent and zero findings, e2e 88 passed.
<!-- SECTION:FINAL_SUMMARY:END -->
