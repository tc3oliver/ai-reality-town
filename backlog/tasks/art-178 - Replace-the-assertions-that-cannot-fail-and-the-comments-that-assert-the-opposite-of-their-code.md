---
id: ART-178
title: >-
  Replace the assertions that cannot fail, and the comments that assert the
  opposite of their code
status: In Progress
assignee:
  - '@claude'
created_date: '2026-09-09 22:11'
updated_date: '2026-09-09 22:34'
labels:
  - prd-2.0
  - epic-q
dependencies: []
priority: medium
ordinal: 177000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Five findings from the ART-138 audit sweep for tests that cannot fail and docs that outrun the code. Each is small; together they are the difference between evidence and the appearance of it.

**1. The post-commit pipeline has no dispatch-path guard.** `convex/operations/postCommitLiveFunctions.ts` binds every stage 11-21 capability — the safety gate, the publication transition, every read-model rebuild — through untyped `internalFunctionRef("module/path:name")` strings. Nothing checks that any of them resolves. The sibling driver DOES have that guard (`convex/simulation/providers/liveWorldDayWiring.test.ts`), and its absence here would surface as a runtime `Could not find function` on a deployment rather than in CI. CLAUDE.md §9: the pipeline is not failure-isolated upstream of `rebuildLiveProjection`, so a bad path there stops a safety withhold from propagating. All paths resolve today; the guard is what is missing.

**2. A safety gate is pinned by source text, on a function with no callers.** `convex/safety/preGeneration.test.ts` asserts `convex/util/llm.ts` CONTAINS the gate call. `chatCompletion` has zero production callers — the only symbols imported from that module anywhere are `detectMismatchedLLMProvider` and `EMBEDDING_DIMENSION` — so the test certifies an unreachable path while reading as coverage of the live LLM route.

**3. The adapter gate is pinned by `toContain` where the same string appears in a comment.** `openAICompatible.ts`s carve-out block names `PRE_GENERATION_PROVIDER_CONSTRAINT` a hundred lines above the call site, so deleting the call leaves the scan green — the exact shape ART-169 hit. The adapter suite already injects a fake `fetch` on every case, so a behavioural assertion is nearly free: send a prohibited prompt and assert `fetch` was never called.

**4. Analytics metric definitions can drift from their published spec in silence.** Every threshold fixture in `convex/analytics/metrics.test.ts` is built from the constants imported from the module under test, which is also what the implementation compares against. Set `THREE_MINUTES_MS` to thirty minutes and the suite stays green while `docs/product-analytics.md` goes on publishing `durationMs > 180000`.

**5. Three comments assert the opposite of their own code.** `postCommitLiveFunctions.readMeasurement.test.ts` still says "AC#1 — KNOWN RED" and lists three growers above a test that now passes literally. `convex/publicRead/dynamicViewMetrics.ts` still marks two metrics `provenance: "pending_feature"` owned by ART-127 and ART-121, both Done. And `docs/prd-2.0-closure-record.md` §6.1 omits that the benchmark AC#7 soak ran two minutes against a required eight hours.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Every function reference the post-commit pipeline dispatches is proven to resolve, and the set is exhaustive so a new one cannot be added unchecked
- [ ] #2 The two pre-generation safety gates are asserted behaviourally rather than by scanning source text
- [ ] #3 The analytics thresholds are pinned to the literals the published documentation states
- [ ] #4 No comment in the touched files states the opposite of what its code does, and the closure record states the soak length it actually ran
- [ ] #5 A fault injection proves the dispatch guard: renaming any dispatched export turns a named test red
- [ ] #6 The dynamic-view metric registry classifies each metric by its true reason, and a named owner that has finished fails the build
- [ ] #7 The benchmark record does not mark a criterion satisfied by a run shorter than the criterion names
- [ ] #8 The Live rebuild returns the bounded episode-scan exhaustion its own docblock claims it reports
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
