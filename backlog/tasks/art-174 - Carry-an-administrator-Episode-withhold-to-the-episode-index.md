---
id: ART-174
title: Carry an administrator Episode withhold to the episode index
status: In Progress
assignee:
  - '@claude'
created_date: '2026-09-09 19:14'
updated_date: '2026-09-09 19:23'
labels:
  - prd-1.0
  - epic-k
dependencies: []
priority: high
ordinal: 173000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Defect introduced by ART-171, found by the ART-138 audit sweep of which read-model builders apply which visibility gate.

`rebuildEpisodeIndexProjection` (`convex/publicRead/episodeIndexProjectionFunctions.ts`) filters on `dailyEpisodes.status` only — the SAFETY verdict recorded at generation. It has never consulted the editorial publication record, and until ART-171 that was harmless: the only path to a `withheld` record fired exactly when the episode row was not `ready`, so `isEligible` already excluded the day.

ART-171 gave an administrator an independent withhold. The consequence is a live leak: `decideEpisodePublication` withdraws `episode:<day>` and its fallbacks, while `episodes:<world>` goes on listing that day with its `title` and `headline` — both LLM-written episode text. An operator watches the detail page disappear and the index keep quoting it.

Fix: exclude a world day whose CURRENT publication record is not viewer-servable, using the one definition (`isViewerServablePublicationStatus` / `VIEWER_SERVABLE_PUBLICATION_STATUSES`). Read the exclusions from `publicationRecords.by_world_and_status` for `withheld` and `superseded` rather than one point read per indexed day — the index already collects every day in the world, and multiplying that by a per-day lookup is the pattern ART-100 removed from this pipeline.

`decideEpisodePublication` must rebuild the index in the same transaction as the decision, beside the episode read model it already rebuilds.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A day whose current publication record is withheld or superseded is absent from the published episode index, title and headline included
- [ ] #2 A day with no publication record at all is still indexed, so a world predating FR-K004 does not lose its episode list
- [ ] #3 An administrator decision rebuilds the index in the same transaction as the episode read model, so the two cannot disagree
- [ ] #4 The exclusion costs a bounded number of reads that does not grow with the number of world days indexed
- [ ] #5 A fault injection proves it: removing the publication filter turns a named test red
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
## The defect, and a second one found while proving it

`rebuildEpisodeIndexProjection` filtered on `dailyEpisodes.status` only — the SAFETY verdict recorded at generation — and never consulted the publication record. Harmless until ART-171, because the only path to a `withheld` record fired exactly when the row was not `ready`. The administrator withhold ART-171 added made it a live leak: `episode:<day>` was withdrawn while `episodes:<world>` went on listing the same day's `title` and `headline`.

Fix: a second gate in the pure builder, `withheldWorldDays`, REQUIRED rather than defaulted — the empty set is the fail-open value, and a caller that forgets it is the bug. The wiring derives it from `publicationRecords.by_world_and_status` for each non-servable status (derived from `VIEWER_SERVABLE_PUBLICATION_STATUSES`, not restated), one indexed sweep per status rather than a lookup per indexed day: this rebuild already collects every day in the world, and multiplying that is the pattern ART-100 removed from this pipeline.

Both in-memory harnesses derive the same set from their own publication records rather than passing an empty one, so the 30-day and 90-day runs model an index an administrator decision can actually reach.

## The second defect: three ART-171 tests passed for the wrong reason

`publicationControlFunctions.test.ts`'s `baseTables` seeded rows without `_id`. `advancePublication` patches by id, the memory `db.patch` searches every table for a matching `_id`, and `undefined === undefined` — so the patch landed on whatever row came first and rewrote it. The `dailyEpisodes` row was being turned `withheld` by accident, which excluded the day through the SAFETY filter while the gate under test did nothing at all.

That is how it was caught: the first injection against the new builder gate did NOT redden the command tests. Rather than report a four-for-four injection count, I chased why. With `_id`s seeded, both injections bite — the new one reddens `lists the day while it is publishable, and drops it once it is withheld` and `brings it back when the administrator resumes the day`, and ART-171's own injection reddens the two tests it should have reddened the first time.

## Evidence

Three injections, each turning a named test red: the builder gate removed (2 tests), the wiring ignoring `isCurrent` (1), and the command no longer rebuilding the index (3). `npm run check` exit 0 — 4377 passed, 31 skipped, 251 suites.
<!-- SECTION:NOTES:END -->
