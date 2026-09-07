---
id: ART-164
title: Close the live editorial and recap pipeline gaps
status: Done
assignee: []
created_date: '2026-09-07 14:47'
updated_date: '2026-09-07 19:08'
labels:
  - prd-1.0
  - epic-g
milestone: m-0
dependencies: []
priority: high
type: bug
ordinal: 164000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Requirement IDs

FR-G002, FR-G003, FR-G004 (live-runtime closure of work delivered by ART-34, ART-35, ART-66).

## Problem / Context

An audit of the editorial and onboarding chain against the running world-day pipeline found three
capabilities that are implemented, unit-tested, and unreachable from production. Each was verified
by grepping every caller outside the defining module and its own test.

1. **Three-level recap formats and the Machine Summary are never produced (ART-66, FR-G003).**
   `convex/recaps/recapFormats.ts` exports `buildDeepRecap`, `buildMachineSummary` and
   `validateRecapFormats`. Nothing calls any of them — the only imports anywhere are of the
   incidental helpers `countChineseCharacters` and `deriveFactId`. There is no table storing recap
   formats, so Quick / Standard / Deep / Machine Summary do not exist for any episode a running
   world produces.

2. **The recap coverage and spoiler gate never runs (ART-35, FR-G004).**
   `convex/recaps/coverageValidationFunctions.ts` registers `getEpisodeCoverageReport` and
   `validateEpisodeCoverageGate`; both have zero production callers, and the pure module is
   imported only by the long-run harness as an after-the-fact report. So nothing checks, at
   publication time, that a high-importance Accepted Event was covered or explicitly excluded with
   a reason, that a major public relationship change or an arc turning point was mentioned, or that
   an unreleased secret leaked into public copy.

3. **The recap pyramid drives two of its five levels (ART-34, FR-G002).**
   `RECAP_TYPES` is `['scene', 'episode', 'arc', 'season', 'viewer_context']`. The post-commit
   pipeline's `deriveRecapRequests` emits only `episode` and `viewer_context`, and
   `RecapRequest.recapType` is narrowed to those two, so `scene`, `arc` and `season` summaries are
   never generated for any world.

Episode generation, the Current Situation onboarding summary and the Recommended Entry
reassessment ARE correctly wired and are not part of this task's problem statement; the audit
confirmed each has a live caller in `postCommitLive.ts`.

## Goal

Make the whole chain — Accepted Events → Episode → Recap Pyramid → Current Situation →
Recommended Entry → Safety/Publication → Public Read Model — complete automatically in the normal
world-day pipeline, with the coverage and spoiler gate actually gating.

## Scope

- Produce and persist Quick / Standard / Deep / Machine Summary for every daily episode, from the
  live post-commit path. The Machine Summary must carry What Changed, Why It Happened, Who Is
  Affected, New Questions, Resolved Questions, Required Prior Facts and Story Arc Progress.
- Run the coverage and spoiler gate before publication, and refuse to publish on a violation
  rather than reporting it after the fact.
- Drive the missing recap tiers so the pyramid is maintained end to end, keeping the incremental
  previous-summary-plus-delta contract and source-event provenance.

## Out of Scope

Arc heat scoring (ART-32), recap/spoiler quality evaluators (ART-89), any new public surface not
required to serve the above, production deployment, and any change that bypasses Canon, safety,
idempotency or publication controls.

## Schema Impact

A table for per-episode recap formats. `recapSnapshots`, `dailyEpisodes` and `publicationRecords`
already exist and are unchanged in shape.

## API Impact

Internal only. New `PostCommitLivePort` members for the recap-format and coverage-gate boundaries.

## Security Impact

Strengthened: the spoiler gate becomes an enforced precondition of publication rather than an
unused report, so an unreleased secret or a private relationship change reaching public copy
becomes a refusal instead of a leak.

## Validation Commands

npm run check; npm run e2e; ART60_LONG_RUN=1 npm run test:longrun; plus the editorial pipeline,
recap provenance and onboarding public-read gates added by this task.

## Test Requirements

Integration coverage proving each artifact is produced by the live post-commit path rather than by
a helper called from a test, and fourteen named fault injections, each of which must compile,
execute, and redden a named test.

## Documentation Impact

`docs/incremental-recap-pyramid.md`, `docs/episode-share-formats.md`,
`docs/recap-coverage-validation.md`, `docs/post-commit-pipeline.md`, PRD traceability.

## Definition of Done

Project-level Backlog Definition of Done applies; include verification evidence and merged PR.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Every daily episode the live post-commit path produces also persists Quick, Standard and Deep recaps and a Machine Summary; the Machine Summary carries What Changed, Why It Happened, Who Is Affected, New Questions, Resolved Questions, Required Prior Facts and Story Arc Progress.
- [ ] #2 The coverage and spoiler gate runs before publication on the live path: a high-importance Accepted Event that is neither covered nor explicitly excluded with a reason, or an unreleased secret or private relationship change in public copy, blocks publication rather than being reported afterwards.
- [ ] #3 The recap pyramid is maintained at every level it declares (scene, episode, arc, season, viewer context), each update built from the previous summary plus delta events rather than a full-history scan, and every level retains source event provenance.
- [ ] #4 Recap and episode generation never write Canon, and a retry produces no duplicate episode, recap snapshot or recap format row.
- [ ] #5 publishEnabled=false still produces editorial artifacts but freezes the Public Read Model, and a withheld episode is never re-published by an onboarding refresh.
- [ ] #6 Fourteen named fault injections each compile, execute and redden a named test; no injection run reports Tests: 0 total.
- [ ] #7 The deterministic 30-day simulation asserts episode/world-day consistency, high-importance recap coverage, Current Situation served only from a precomputed artifact, a Recommended Entry for every major active arc, no onboarding reference to unpublished or withheld content, and zero provider calls on the public read path.
- [ ] #8 PRD traceability links FR-G002/G003/G004 to doc-1 and the merged implementation evidence.
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
## Audit method

Same as ART-163: for every registered Convex function and every exported builder in `convex/recaps`,
`convex/editorial` and the `convex/publicRead` onboarding modules, grep every caller outside the
defining module and its own test. Three capabilities came back with none.

## What IS correctly wired (verified, not assumed)

- **Episode generation** — `generateAcceptedEventEpisode` is bound to `port.generateEpisode` and
  called from the post-commit episode stage, once per completed world day, keyed by world day.
- **Current Situation** — `rebuildOnboardingSummary` is bound and called; it reads
  `storyArcRecommendedEntries` and builds the structured summary (major event, characters, facts,
  question, recommended episode, scene). Public read serves the stored read model.
- **Recommended Entry** — `reassessMajorActiveArcEntries` is bound to `port.reassessArcEntries` and
  called from the publication stage.
- **Publication lifecycle and the publishEnabled freeze** — ART-51 plus ART-162, both wired.

These are not part of this task's problem statement and must not be re-implemented.

## The three gaps

1. **Recap formats never produced (FR-G003).** `recapFormats.ts` exports `buildMachineSummary`,
   `buildDeepRecap` and `validateRecapFormats`; nothing calls them, and no table stores their
   output. Note there is deliberately no `buildQuickRecap`/`buildStandardRecap` — the Quick
   (80–150 中文字) and Standard (400–800 中文字) texts have to be COMPOSED, and composing them
   deterministically inside those bands from a day's accepted events, on both a thin day and a
   busy one, is the real work here rather than the plumbing.
2. **Coverage and spoiler gate never runs (FR-G004).** Both registered functions have zero callers;
   the pure module is imported only by the long-run harness as an after-the-fact report. It must
   become a precondition of publication, so a violation refuses rather than reports.
3. **Pyramid drives 2 of 5 levels (FR-G002).** `deriveRecapRequests` emits `episode` and
   `viewer_context` only, and `RecapRequest.recapType` is narrowed to those two, so `scene`, `arc`
   and `season` summaries exist for no world.

## Sequence

1. Recap formats: composer + schema table + Convex function + port member + episode-stage call,
   with truncation published rather than silent.
2. Coverage gate: assemble its input from the day's accepted events, run it in the safety stage
   ahead of publication, and make a violation a withhold reason.
3. Pyramid: widen `RecapRequest` and emit scene/arc/season targets with their own cursors, keeping
   the previous-summary-plus-delta contract.
4. Integration gates, 14 injections, 30-day assertions, docs.

Commit before every injection; the 30-day gate takes ~10 minutes per run and must be re-run after
any change to the pipeline.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Root cause

Three capabilities were implemented, unit-tested, registered as Convex functions, and called by
nothing in production. Verified by grepping every caller of each registered function and exported
builder outside its defining module and its own test.

1. **FR-G003 recap formats never produced.** `buildDeepRecap`, `buildMachineSummary` and
   `validateRecapFormats` had zero callers and no table stored their output. There was also no
   builder at all for the Quick (80–150 中文字) and Standard (400–800 中文字) texts — the module
   validated bands nothing could produce.
2. **FR-G004 coverage and spoiler gate never ran.** Both registered functions had zero production
   callers; the pure module was imported only by the long-run harness as an after-the-fact report.
   `validate` was a bare lifecycle step, so an episode omitting a high-importance event, or leaking
   an unreleased secret, walked to `ready` unchallenged.
3. **FR-G002 pyramid drove 2 of 5 levels.** `deriveRecapRequests` emitted `episode` and
   `viewer_context` only. The long-run harness recorded this accurately and passed for as long as
   `scene`, `arc` and `season` were dead.

Episode generation, the Current Situation onboarding summary and the Recommended Entry
reassessment were already correctly wired and were not re-implemented.

## What was built

- `recapComposition.ts` — whole-sentence-unit composition of the Quick and Standard recaps.
  Character-level trimming would hit a band exactly and is also how a sentence gets published
  saying the opposite of what happened, so the composer never cuts inside a sentence: no reversed
  meaning, no half entity, no dangling provenance. Below the floor it refuses with the
  measurement; above the ceiling it drops whole units and records which events they carried.
- `episodeRecapFormats` + `episodeCoverageReports` tables, both with the artifact recording
  refusals rather than leaving them as absences.
- `runEpisodeCoverageGate` — the gate as the live pipeline runs it, wired as the precondition of
  `validate`.
- `RecapSourceScope` — the selective source contract that made the arc tier expressible, plus
  `scene`/`arc`/`season` targets, per-target cursors and `recapCursorOf`.
- `fakeSceneNarrator` rewritten in zh-Hant.

## Two design decisions worth keeping

**The gate returns its verdict instead of throwing, and performs no transition.** Stage 19 is not
failure-isolated, so a throw aborts `rebuildLiveProjection` and `rebuildOnboardingSummary` — a
coverage refusal would stop a *safety* withhold from reaching the public surface. And a verdict
function that advanced the lifecycle as a side effect would give the pipeline two owners of it.
A refusal therefore leaves the publication at `generated`, whose only legal action is `validate`,
so it cannot reach `published` by any route without needing a rule that says so.

**Cursors are loaded per target.** `PostCommitWorldState.recapCursors` was populated by a
`.collect()` of every recap snapshot in the world on every event. With per-slot and per-arc targets
that would grow with days times slots, so this change removes an unbounded per-event read rather
than adding to one.

## Fault injections

Fourteen run, each compiled, executed, and reddened a named test, then restored. Four survived on
first run and are the most useful findings:

- Replacing the bound validator with `{ releasable: true }` left everything green — the tests
  proved the gate was *called*, not that it *decided*. Fixed by inducing a real provenance
  violation through the live path.
- Removing the selective out-of-scope check left everything green — the model suite had no
  coverage of the sparse path at all.
- Breaking the cursor to resume from a snapshot's newest match instead of the range it examined
  left everything green. The two rules coincide for almost every live snapshot, so no pipeline test
  can distinguish them; `recapCursorOf` was extracted and tested on the diverging case.
- Stubbing out `port.generateRecapFormats` left everything green — nothing asserted the live path
  produced the formats, which is the very defect class this task exists to fix.

Injections into `*Functions.ts` modules cannot redden anything: their handler bodies need a Convex
deployment and never execute under jest. That is a pre-existing limit of the test strategy, not
something this task introduced, and the in-memory ports bind the REAL pure functions so the
decisions themselves are exercised.

## Fixture migration

`fakeSceneNarrator` wrote English while FR-G003 states its contract in 中文字, so every
deterministic day measured zero and every episode was refused. The fixture changed; no band moved,
`countChineseCharacters` is unchanged, and `RECAP_POOL_BELOW_MINIMUM` is kept — it now proves the
validator is right.

Sizing the scene took three corrections, each found by a test. Too short and a day composed under
400. Spelling out every participant's stance overran `MAX_PUBLIC_SUMMARY_LENGTH`, and the clamp cut
the tail where the outcome lives, so two scenes at one location truncated to the same text — the
distinct-scene count FELL, 46 to 41, as the sentence got longer. Ordering outcome-first and
dropping the participant roll-call took it to 91 of 104. Then a ~98 中文字 scene made a 69 中文字
headline and a 109 中文字 one-line summary, and no whole-sentence pair fits in 150. The bands pull
in opposite directions and the fixture has to satisfy both; it is now one scene-level sentence of
about 45 中文字.

## Verification

- `npm run check` — 3742 passed, 224 suites, exit 0.
- `npm run e2e` — 82 passed.
- `ART60_LONG_RUN=1 npm run test:longrun` — 16/16, including 100% world-day completion, replay
  equality, the FR-F003 major-arc band at every checkpoint, arcs advancing and closing, exactly one
  episode per world day, and all five recap types present.

## Not done

`DISTINCT_SCENE_TEXTS` is now per-run-length (7 -> 91, 30 -> 171) because the author's output space
is no longer saturated at seven days. FINDING 2 is improved but not fixed: the author is still a
template and the duplication is still its ceiling.
<!-- SECTION:NOTES:END -->
