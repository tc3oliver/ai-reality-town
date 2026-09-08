---
id: ART-166
title: Correct the FR-M002 evaluator evidence the ninety-day audit found wrong
status: In Progress
assignee:
  - '@claude'
created_date: '2026-09-08 18:18'
updated_date: '2026-09-08 18:48'
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
- [x] #1 getStoryQualityMetrics excludes the not-yet-due world day from the coverage denominator with a reason, and agrees with the long-run harness on the same evidence.
- [x] #2 A provider failure's stable code reaches the operational-quality reason dimensions, so two different failures are two entries rather than one constant.
- [x] #3 The FR-K002 Model Trace reports what was measured, and omits what was not, rather than reporting zero.
- [x] #4 No finding code is published that the stored evidence cannot produce.
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

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Reproduce first, RED before any fix:
   - a new handler-level suite (convex/operations/worldQualityFunctions.test.ts) drives getStoryQualityMetrics._handler with a fake db, following the ART-128 pattern dynamicViewMetricsFunctions.test.ts established. Seed two world days of accepted events, release only the earlier one, and assert the newest day is EXCLUDED with a reason. Today it is charged as uncovered.
   - the same suite chains recordAuthoringAttempt._handler into getOperationalQualityMetrics._handler over one shared fake db, and asserts two different provider failure codes become two reason entries. Today they collapse to one invented SCENE_ATTEMPT_FAILED.
2. Fix 1: the query derives the world's latest accepted day from the row it already reads and passes pendingWorldDays. completedWorldDaysOf's docblock already ASSERTS this; the assertion becomes true.
3. Fix 2: llmTraceDraftValidator and LlmTraceDraft gain an optional errorCode, normalised as a stable machine CODE (bounded uppercase identifier) so the trace whitelist still cannot carry a message; recordAuthoringAttempt writes it; getOperationalQualityMetrics reads it instead of hardcoding null.
4. Fix 3: inputTokens, outputTokens and latencyMs become optional in the same contract, and recordAuthoringAttempt omits them rather than asserting zero. Every reader of llmTraces is checked - traces.ts, proposalReviewStore.ts, dynamicViewMetricsFunctions.ts - and none defaults a missing field to 0.
5. Fix 4: EXCLUSION_WITHOUT_REASON is dropped from the declared finding codes, because buildCoverageExclusion's floor is strictly stronger than any check the evaluator can make, so no stored row can produce it. The fail-closed BEHAVIOUR is kept: an exclusion the write boundary would refuse is not honoured, the event stays in the denominator, and if uncited it is reported under HIGH_IMPORTANCE_EVENT_UNCOVERED, which stored evidence can produce. The docblock says plainly that the old claim was wrong and names where the guard actually lives.
6. Fault-inject each fix in turn, name the test that goes red, restore. Then typecheck, the focused suites, and the full check gate.
7. Update docs/world-quality-metrics.md, docs/llm-tracing.md and docs/proposed-event-review.md.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## What was wrong

Four defects, each a number an operator reads whose source was wrong, missing or invented. Two were contradicted by a docblock asserting the opposite.

1. `getStoryQualityMetrics` never passed `pendingWorldDays`. `toWorldDay` defaults to the world's latest accepted day, and `completedWorldDaysOf` admits a day only once the world has moved PAST it - so the day the window ends on is by construction the one day with no Episode yet. Every default operator read charged that day's high-importance events as uncovered, emitted a severe HIGH_IMPORTANCE_EVENT_UNCOVERED per event and a WORLD_DAY_UNPUBLISHED, and reported a recap_coverage below its own 0.95 target. The long-run harness passed the exclusion, so the ninety-day gate and the console gave two answers to the same Section 16.2 question - while `completedWorldDaysOf`'s docblock said the query already did this.
2. `recordAuthoringAttempt` accepted an `errorCode` and discarded it. No column, and the read hardcoded null, so both reason dimensions carried one substituted constant each (SCENE_OUTPUT_INVALID, SCENE_ATTEMPT_FAILED). The distinction lost is the one FR-M004 acts on.
3. The same writer booked literal zeros for inputTokens, outputTokens and latencyMs. Harmless to the rates, which never read them, but the FR-K002 Model Trace panel renders them: before ART-90 the table was empty and it showed null; after, it showed a real call as 0 tokens and 0 ms.
4. EXCLUSION_WITHOUT_REASON was a declared finding code no stored row could produce, because `buildCoverageExclusion` refuses any reason below MIN_EXCLUSION_REASON_LENGTH after trimming - strictly stronger than 'not blank'.

## What changed

- `convex/operations/worldQualityFunctions.ts`: passes `pendingWorldDays` derived from the world's latest accepted event (not the requested window, so an earlier `toWorldDay` still measures that day in full), and reads `row.errorCode ?? null` instead of hardcoding null.
- `convex/observability/schema.ts` + `llmTrace.ts`: `errorCode` optional, normalised by ERROR_CODE_PATTERN (upper case, digits, underscores, 64 chars) - deliberately narrower than the id pattern, because anything admitting lower case or punctuation would admit a provider's error message. `inputTokens`/`outputTokens`/`latencyMs` optional; the normaliser does not default them.
- `convex/simulation/qualityEvidenceFunctions.ts`: writes the code, omits the three unobserved fields, and now builds its row through `normalizeLlmTraceDraft` - the docblock had claimed the whitelist normaliser guarded this writer since ART-90 while it inserted straight into the table.
- `convex/quality/storyQuality.ts`: EXCLUSION_WITHOUT_REASON withdrawn; the fail-closed behaviour kept under HIGH_IMPORTANCE_EVENT_UNCOVERED, which names the operator who declared the unusable exclusion. Dropping the branch outright would have been the dangerous edit - a bare `exclusion !== undefined` lets a blank reason silently shrink the denominator.
- Docs: world-quality-metrics.md, llm-tracing.md, proposed-event-review.md, both PRD matrices.

## RED first

`npm test -- --runTestsByPath convex/operations/worldQualityFunctions.test.ts` against the pre-fix code: Tests: 8 failed, 2 passed, 10 total. Coverage read 0.5 with two HIGH_IMPORTANCE_EVENT_UNCOVERED findings on the newest day; providerFailureReasons read [{ SCENE_ATTEMPT_FAILED, 2 }] for two different codes; the trace row's inputTokens read 0.

## Fault injection (each restored afterwards)

| Injection | Named test that went red | Counts |
| --- | --- | --- |
| drop `pendingWorldDays` from the query | 'excludes the newest accepted day from the coverage denominator with a reason' | 4 failed, 6 passed, 10 total |
| reader back to `errorCode: null` | 'keeps two different provider failure codes apart in the reason dimension' | 3 failed, 7 passed, 10 total |
| writer drops `errorCode` | 'keeps two different provider failure codes apart in the reason dimension' | 3 failed, 7 passed, 10 total |
| writer books zeros again | 'books no token count and no latency it never observed' | 1 failed, 9 passed, 10 total |
| FR-K002 reader defaults absent fields to 0 | 'omits the unmeasured accounting fields rather than reporting them as 0' | 1 failed, 18 passed, 19 total |
| lower the exclusion floor to zero | 'refuses to honour an exclusion whose reason is empty, and keeps the event counted' (+3) | 4 failed, 41 passed, 45 total |
| re-declare EXCLUSION_WITHOUT_REASON | 'declares no finding code the stored evidence cannot produce' (+1) | 2 failed, 43 passed, 45 total |

The last injection first produced `Tests: 0 total` - a compile error, not a named failure. The producibility fixture was retyped with `satisfies Partial<...>` so exhaustiveness is asserted at runtime and the guard fails as a red test, per CLAUDE.md section 9.

## Commands

npm run typecheck; npm run check:architecture; npm test -- --runTestsByPath convex/operations/worldQualityFunctions.test.ts; npm test -- --runTestsByPath convex/quality/storyQuality.test.ts; npm test -- --runTestsByPath convex/operations/proposalReviewStore.test.ts; npm test -- --runTestsByPath convex/observability/llmTrace.test.ts; npm run check

npm run check exit 0 - Tests: 14 skipped, 4172 passed, 4186 total; Test Suites: 2 skipped, 243 passed, 243 of 245 total.
<!-- SECTION:NOTES:END -->
