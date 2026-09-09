---
id: ART-174
title: Carry an administrator Episode withhold to the episode index
status: Done
assignee:
  - '@claude'
created_date: '2026-09-09 19:14'
updated_date: '2026-09-09 20:04'
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
- [x] #1 A day whose current publication record is withheld or superseded is absent from the published episode index, title and headline included
- [x] #2 A day with no publication record at all is still indexed, so a world predating FR-K004 does not lose its episode list
- [x] #3 An administrator decision rebuilds the index in the same transaction as the episode read model, so the two cannot disagree
- [x] #4 The exclusion costs a bounded number of reads that does not grow with the number of world days indexed
- [x] #5 A fault injection proves it: removing the publication filter turns a named test red
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

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
An administrator Episode withhold now reaches the episode index. ART-171 withdrew `episode:<day>` and left `episodes:<world>` listing the same day's title and headline — both LLM-written episode text — because `rebuildEpisodeIndexProjection` filtered on `dailyEpisodes.status` (the safety verdict) and had never consulted the publication record. Harmless until ART-171, and only by accident.

AC#1 — `drops a withheld world day, title and headline included`, plus `drops the withheld day from the arc and character filters as well`: a withheld day that still contributed an arc id would announce itself through the shape of the filter list.
AC#2 — `keeps indexing a day that has no publication record at all`; silence is not a refusal, here as in the Episode read model.
AC#3 — `lists the day while it is publishable, and drops it once it is withheld` and `brings it back when the administrator resumes the day`, both over the REAL handlers.
AC#4 — the exclusions come from `publicationRecords.by_world_and_status`, one indexed sweep per non-servable status, not a lookup per indexed day.
AC#5 — three injections, each turning a named test red: the builder gate removed, the wiring ignoring `isCurrent`, and the command no longer rebuilding the index.

Found a second defect while proving the first. The initial injection did NOT redden the command tests; chasing that turned up `baseTables` seeding rows without `_id`, so `advancePublication`'s patch-by-id landed on whatever row came first and turned the Episode row `withheld` by accident. Three ART-171 tests had been passing for that reason rather than the one they claimed. The code was right; the evidence was not. With `_id`s seeded, ART-171's own injection now reddens the two tests it should have.

Verification: `npm run check` exit 0 (4377 passed, 31 skipped, 251 suites); `npm run e2e` 124 passed; PR #271 merged.
<!-- SECTION:FINAL_SUMMARY:END -->
