---
id: ART-178
title: >-
  Replace the assertions that cannot fail, and the comments that assert the
  opposite of their code
status: In Progress
assignee:
  - '@claude'
created_date: '2026-09-09 22:11'
updated_date: '2026-09-09 22:42'
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
- [x] #1 Every function reference the post-commit pipeline dispatches is proven to resolve, and the set is exhaustive so a new one cannot be added unchecked
- [x] #2 The two pre-generation safety gates are asserted behaviourally rather than by scanning source text
- [x] #3 The analytics thresholds are pinned to the literals the published documentation states
- [x] #4 No comment in the touched files states the opposite of what its code does, and the closure record states the soak length it actually ran
- [x] #5 A fault injection proves the dispatch guard: renaming any dispatched export turns a named test red
- [x] #6 The dynamic-view metric registry classifies each metric by its true reason, and a named owner that has finished fails the build
- [x] #7 The benchmark record does not mark a criterion satisfied by a run shorter than the criterion names
- [x] #8 The Live rebuild returns the bounded episode-scan exhaustion its own docblock claims it reports
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

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Six findings, all of the same shape: a claim in this repository that nothing could falsify.

## 1. The post-commit pipeline dispatched to unverified strings

`postCommitLiveFunctions.ts` binds every stage 11–21 capability through an untyped `internalFunctionRef('module/path:name')`. The TypeScript generic proves the module has an export of that name; it does not prove the STRING points at it, so renaming an export or moving a module compiles cleanly and deploys as `Could not find function` on the first accepted event. The sibling live-world-day driver has had this guard since ART-159; this one had none. 34 tests now resolve every path, exhaustively, with a vacuity floor and an assertion that none of them is a PUBLIC function.

## 2. Two safety assertions read source text instead of behaviour

`preGeneration.test.ts` pinned the adapter's gate by grepping for a function name. Both are behavioural now, driving a `fetch` spy.

**Reported rather than counted:** the adapter gates TWICE — `structuredChat` screens the messages and `request` screens the serialised body. Removing either alone leaves the refusal intact; only removing both turns the test red. The test says so, because a reader who assumed it isolates one call would draw the wrong conclusion. Same situation ART-170 documented for the run-store clear.

## 3. Analytics thresholds could drift from their published spec in silence

Every threshold fixture in `metrics.test.ts` is built from the constants imported from the module under test. Setting `THREE_MINUTES_MS` to thirty minutes left that suite green while `docs/product-analytics.md` went on publishing `durationMs > 180000` — **verified by injection**. `metricsSpec.test.ts` parses the document's own §16.1 table and compares it row by row.

Honestly bounded: the eight targets were ALREADY pinned as transcribed literals. What nothing caught was the numerator rules — the duration threshold, the two day offsets, the one inverted direction — and doc/code disagreement in either direction.

## 4. Two metrics told an operator that shipped features do not exist

`degradationModeUsage` and `replayPlaySkipCounts` were `pending_feature`, owned by ART-127 and ART-121. Both tasks are Done, both features run, and `LiveMapPage.tsx` emits their events. The ops console's reason string said "The FR-O010 degradation ladder does not exist yet."

They are `client_external` now, owner `null`, measured by ART-47 exactly as the first two are — only a browser can see which rung a viewer sat on. All four reasons now say where the number IS measured, so 未量測 never reads as 不存在.

The old test pinned owners as a literal list, which is why this drifted: **a list notices the owner changing, never the owner finishing**, and finishing is what makes the entry false. The gate now reads the Backlog file behind every named owner and refuses a `Done` one, with the reader itself proved non-vacuous.

## 5. AC#7 was recorded as passed by a two-minute run of an eight-hour criterion

`docs/benchmarks/dynamic-view-latest.md` showed `AC#7 … ✅` from `npm run bench`'s default 2-minute soak — 1/240th of the criterion. The slope was measured correctly; the label was false, and §6.1 of the closure record repeated it as「Desktop passes everything」.

`soakVerdict` now carries `settlesCriterion`; `pass` still means "the heap did not grow", because turning it false for a clean short run would be the opposite lie. The record renders ⚠️ with the shortfall, lists the run as `run_too_short`, and counts 15/17 instead of 16/18. A results file predating the field reads as unsettled, not settled. `bench/record.test.ts` is new: that file is the one piece of performance evidence in this repository no test read.

## 6. A truncation flag computed and dropped, under two docblocks claiming it was reported

`publishedEpisodeScanExhausted` in `rebuildLiveProjection` — found by the gate's own lint warning. "No day has been narrated" and "eight `ready` days in a row carry no body" are different facts; the public payload renders both as `publishedEpisodeStatus: 'none'`. It is in the mutation's result now, beside the other operator-facing counts.

**None of that result had ever been asserted** — not `withheldSceneCount`, not `withheldEventCount`, not `dynamicCharacterCount`. The new tests run the REAL handler, which only one harness in the repository does.

## Injections

| Injection | Test that went red |
| --- | --- |
| `rebuildLiveProjection` renamed, string left | `publicRead/liveStateFunctions:rebuildLiveProjection is exported by the module it names` |
| `chatCompletion`'s gate removed | `chatCompletion refuses prohibited content before it can reach the network` |
| constraint prepend removed | `prepends the non-user-editable constraint to what the adapter actually sends` |
| `THREE_MINUTES_MS` → 30 minutes | `scopes 停留超過 3 分鐘 to the published 180000 ms` (old suite stayed green) |
| `next_day_return` target → 0.25 | `next_day_return matches its published name and target` |
| renderer ceiling → floor | `holds the renderer error rate at the published 2% ceiling, inverted` |
| a metric dropped from the doc table | `parses all eight rows…` (+1) |
| `settlesCriterion` forced true | `a soak shorter than the criterion measures the slope and settles nothing` |
| report renders a pass mark regardless | `marks AC#7 settled only when the soak ran the full length…` (+1) |
| a metric names `ART-121` again | `never names an owning task that has already finished` (+1) |
| ops console claims the feature is unbuilt | `tells an operator where an unmeasured metric IS measured…` |
| scan flag hard-coded false | `says so when the bounded scan gave up rather than finding nothing` |
| scan bound compared with `> 0` | `does not say so for a world that simply has no episodes yet` |

## Evidence

- `npm run check` — exit 0, **4459 passed, 31 skipped**
- `npm run e2e` — **124 passed**
<!-- SECTION:NOTES:END -->
