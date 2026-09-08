---
id: ART-166
title: Correct the FR-M002 evaluator evidence the ninety-day audit found wrong
status: To Do
assignee: []
created_date: '2026-09-08 18:18'
labels:
  - prd-1.0
  - epic-p
dependencies:
  - ART-89
  - ART-90
priority: high
ordinal: 166000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Requirement IDs
FR-M002, PRD Section 16.2

Problem / Context
The ART-73 acceptance audit found four defects in the evidence the FR-M002 evaluators read. Each is a published number whose source is wrong, missing, or invented, and two contradict a docblock that asserts the opposite.

1. getStoryQualityMetrics never passes pendingWorldDays. The window defaults to the world's latest accepted day, and that day's Episode is by construction not due yet, so every default call counts its high-importance events as uncovered, emits a severe HIGH_IMPORTANCE_EVENT_UNCOVERED per event, emits WORLD_DAY_UNPUBLISHED, and depresses recap_coverage against its 0.95 target. The long-run harness passes the exclusion and the operator query does not, so the ninety-day gate and the console disagree about the headline Section 16.2 number - while storyQuality's own docblock says they get the same numbers.

2. recordAuthoringAttempt accepts an errorCode and discards it. The llmTraces table has no column for it and the read hardcodes null, so the published structuredOutputReasons and providerFailureReasons dimensions have exactly one invented constant each. The distinction being lost is the one the live driver argues is load-bearing: LLM_HTTP_RETRYABLE, LLM_FREE_ROUTES_EXHAUSTED and LLM_CONFIG_MISSING call for different operator responses.

3. recordAuthoringAttempt writes literal zeros for inputTokens, outputTokens and latencyMs. Sound for the rate metrics, which never read them - but llmTraces has a second consumer, the FR-K002 proposal-review Model Trace panel, which showed null before ART-90 and now shows a call that really happened as 0 tokens and 0 ms. A null is honest; a zero is a measurement.

4. EXCLUSION_WITHOUT_REASON is a published finding code that cannot fire, because buildCoverageExclusion is the only writer and refuses a reason shorter than MIN_EXCLUSION_REASON_LENGTH.

Goal
Every published metric, reason dimension and finding code is either produced by real evidence or is not published.

Scope
The evidence writers and readers named above, and the tests that can tell the difference.

Out of Scope
Evaluator definitions, thresholds, weights, the publication gate, and any change to what the metrics mean.

Schema Impact
llmTraces gains an optional errorCode, and its accounting fields become optional so an attempt row can omit what it did not measure.

Security Impact
None. Error codes are stable identifiers and carry no payload.

Validation Commands
npm run check; npm test -- --runTestsByPath convex/quality/storyQuality.test.ts; npm test -- --runTestsByPath convex/quality/operationalQuality.test.ts

Test Requirements
A test must show the operator query excluding the not-yet-due day with a reason rather than counting it uncovered, and a test must show two different provider failures producing two distinct reason entries. Both must fail against today's behaviour first.

Documentation Impact
The docblocks that assert the opposite of their own functions must be corrected, not silently replaced.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 getStoryQualityMetrics excludes the not-yet-due world day from the coverage denominator with a reason, and agrees with the long-run harness on the same evidence.
- [ ] #2 A provider failure's stable code reaches the operational-quality reason dimensions, so two different failures are two entries rather than one constant.
- [ ] #3 The FR-K002 Model Trace reports what was measured, and omits what was not, rather than reporting zero.
- [ ] #4 No finding code is published that the stored evidence cannot produce.
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 All acceptance criteria are satisfied
- [ ] #2 Relevant automated tests are added or updated
- [ ] #3 Typecheck passes
- [ ] #4 Lint passes
- [ ] #5 Relevant tests pass
- [ ] #6 Build passes when applicable
- [ ] #7 No known regression is introduced
- [ ] #8 No secret or credential is committed
- [ ] #9 Documentation is updated
- [ ] #10 PRD traceability is updated when applicable
- [ ] #11 Implementation notes are complete
- [ ] #12 Final summary includes verification evidence
- [ ] #13 Changes are committed and pushed
- [ ] #14 Pull request is merged or explicitly blocked
<!-- DOD:END -->
