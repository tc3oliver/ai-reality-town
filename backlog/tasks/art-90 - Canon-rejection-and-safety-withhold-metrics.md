---
id: ART-90
title: Canon rejection and safety-withhold metrics
status: Done
assignee:
  - '@claude'
created_date: '2026-08-02 16:20'
updated_date: '2026-09-08 16:51'
labels:
  - prd-1.0
  - epic-o
milestone: m-0
dependencies:
  - ART-15
  - ART-55
  - ART-57
documentation:
  - backlog/docs/prd/ai-reality-town-prd-1.0/doc-1 - AI-Reality-Town-PRD-1.0.md
priority: medium
type: feature
ordinal: 90000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Requirement IDs
FR-M002 operational metrics

Problem / Context
PRD 1.0 needs this independently reviewable delivery unit to close a verified ownership or scope gap.

Goal
Compute Canon Rejection Rate and Safety Withhold Rate with stable reason dimensions.

Scope
Compute Canon Rejection Rate and Safety Withhold Rate with stable reason dimensions.

Out of Scope
Adjacent capabilities assigned to other tasks and production deployment.

Dependencies
ART-15, ART-55, ART-57

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
- [x] #1 Rates define numerators, denominators, time windows, and reason codes.
- [x] #2 Metrics link to validation or safety results without exposing secrets.
- [x] #3 Retries and duplicate runs do not inflate counts.
- [x] #4 Section 16.2: Runtime-validated structured model output succeeds for at least 98% of measured outputs, with the measurement window and denominator recorded.
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
Two structural gaps closed before any metric could be honest: (1) rejections were never persisted per proposal — commitProposedEvent throws and writes nothing, worldDayRuns is patched per attempt, scheduledSlots.errorCode is cleared on retry, and worldDayCheckpoints holds ONE code for a stage that may have judged a dozen proposals because both stages throw on the first failure; (2) a scene that exhausted its authoring attempts wrote no row at all, so a structured-output rate over sceneSimulationRuns read 100% by construction. Also: convex/observability/traces.ts recordTrace was a registered internalMutation with ZERO production callers, so llmTraces was empty in every world and two readers (dynamicViewMetricsFunctions' trace count, the FR-K002 proposal review's model trace) always found nothing.
Delivered: canonValidationOutcomes table + convex/simulation/validationOutcome.ts (both validation stages now judge every proposal and record each verdict BEFORE throwing on the first rejection — the commit path is unchanged, only the verdicts survive); convex/simulation/qualityEvidenceFunctions.ts (recordProposalValidations, recordAuthoringAttempt — the latter writes llmTraces, closing the zero-caller gap, with parsed->passed/succeeded, output_rejected->rejected/failed, provider_failed->not_run/failed); an onAttempt seam through simulateWholeScene so every semantic attempt is recorded whatever its outcome; convex/quality/operationalQuality.ts (canon_rejection_rate, safety_withhold_rate, structured_output_success_rate >=0.98, scene_classification_coverage, operational_health composite, plus reason dimensions as stable codes only); operator query getOperationalQualityMetrics (world.inspect); LongRunFindings.operationalQuality + operationalBreakdown.
The structured-output denominator EXCLUDES attempts that never received a response (timeout, refused credential, exhausted route chain, budget refusal), with the count and reason published: counting them would report a network outage as a model that cannot follow a schema.
Live evidence: npm run test:live-structure (ART90_LIVE_STRUCTURE=1) makes 8 real structured calls through the live provider chain, scores them with the same evaluator, prints the denominator and exclusions, and FAILS if the measured rate misses 98%. The fixed-seed rate is 1.0 BY CONSTRUCTION (the deterministic author never fails) and is asserted as wiring evidence, not as a model measurement; the metric's ability to fall is proven on fixtures and on the live path.

Fault injections (each compiled, ran, reddened named tests, restored byte-identically): (a) structured-output denominator counts unanswered attempts -> 5 failed/33 incl. 'divides parsed attempts by attempts that GOT an answer' and 'leaves the rate unmeasured through a total outage'; (b) allow_with_warning counted as withheld -> 1 failed/25; (c) the (idempotencyKey, stage) dedupe made per-row unique -> 1 failed/25; (d) a schema refusal reported as provider_failed -> 3 failed/8 incl. 'falls below 0.98 once a real run answered with output the schema refused'. Each caught by the test written for it and by nothing unrelated.
Verification: npm run check -> 238 suites, 4037 passed, exit 0. npm run test:longrun -> 17/17 over 30 world days; 898 proposals judged with 0 rejected, 449 scenes classified with 0 withheld, 449 attempts all parsed. npm run e2e -> 88 passed.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Delivered Canon Rejection Rate, Safety Withhold Rate and §16.2's structured-output success rate (convex/quality/operationalQuality.ts), each with an explicit numerator, denominator, window and stable reason dimensions, read through the operator-gated getOperationalQualityMetrics and reported by the long-run harness. None was answerable before: rejections were never persisted per proposal, an exhausted authoring attempt wrote no row at all, and the llmTraces writer had zero callers so the table was empty in every world. ART-90 adds a per-proposal validation record written by both stages before they throw, a per-attempt trace through the previously dead writer, and a structured-output denominator that excludes attempts which never received a response. Honest about the fixture: the deterministic author never fails, so its 100% is wiring evidence rather than a model measurement, and npm run test:live-structure measures the real gateway against the 98% target and fails if it misses. Verified: 42 new tests, 4 fault injections red-then-green, npm run check 4037 passed, 30-day gate 17/17, e2e 88 passed.
<!-- SECTION:FINAL_SUMMARY:END -->
