---
id: ART-164
title: Close the live editorial and recap pipeline gaps
status: In Progress
assignee: []
created_date: '2026-09-07 14:47'
updated_date: '2026-09-07 14:48'
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
