---
id: ART-176
title: Gate the three public text surfaces that publish Canon text ungoverned
status: In Progress
assignee:
  - '@claude'
created_date: '2026-09-09 21:35'
updated_date: '2026-09-09 21:53'
labels:
  - prd-1.0
  - epic-p
dependencies: []
priority: high
ordinal: 175000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found by an ART-138 audit sweep that enumerated every `rebuild*`/`refresh*` mutation under `convex/publicRead/` and asked which of the two visibility gates each applies — the post-generation SAFETY classification (`readWithheldSceneLabels`) and the editorial PUBLICATION record. Three surfaces answer neither question fully, and each is verified by reading both sides.

**1. `onboarding:<world>` — has the safety gate, has no publication gate. This one is a regression ART-171 introduced.**
`convex/publicRead/onboardingSummaryFunctions.ts` picks `episodeRows.find((row) => row.episode)` — the newest Episode with a body — and publishes its key scene `title` and `summary`. It applies `redactWithheldNarration` against the withheld-scene set, and reads no `publicationRecords` row. `decideEpisodePublication` calls `refreshPublicTextModels`, which calls this rebuild, so an administrator `withhold` withdraws `episode:<day>` and **republishes that Episode narration onto the homepage and the ART-125 story overlay in the same transaction**. `dailyEpisodes.status` is no substitute: a publication withhold leaves it `ready` with the body intact.

**2. `primer:<arcId>` — no gate at all.**
`convex/publicRead/arcPrimerFunctions.ts` reads the turning-point event and publishes its `publicSummary` verbatim, twice (rendered text and structured). No `readWithheldSceneLabels`, no publication record — the last unguarded `publicSummary` consumer under `convex/publicRead/`. It is also absent from `convex/operations/publicTextModelRefresh.ts`, whose entire purpose is that list, so a safety override never re-derives it: a withheld Scene keeps narrating itself on the primer indefinitely.

Second defect in the same function: it `.collect()`s the whole accepted-event log (`by_world_and_sequence` bound only on `worldId`) on a per-commit path — the ART-100 hazard CLAUDE.md §9 names outright. The sibling `rebuildArcProjection` already fixed exactly this with point lookups on the arc classification sequence numbers.

**3. `arc:<arcId>` — no safety gate on the facts it publishes.**
`convex/publicRead/relationshipArcProjectionFunctions.ts` publishes `publicFactsIn(arcEvents)` as `knownClues` and `essentialBackstory` — LLM-authored `predicate`/`value` pairs — with no withheld-scene check, while `characterSourceFrom` skips precisely those `fact_created` changes for a withheld Scene. Two public surfaces disagree about whether a fact from a withheld Scene is showable.

Also `essentialBackstory: facts.slice(0, 5)` truncates with no published omission count, against CLAUDE.md §9 「Truncation is never silent」 — the sibling character page publishes its own omission counts.

Out of scope: the `relationship:<pairKey>` read model, which the same sweep found has no consumer at all. That is a cost question, not a correctness one.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 An administrator publication withhold removes the affected Episode narration from the onboarding summary, in the same transaction as the decision
- [x] #2 The arc primer publishes no accepted-event summary from a withheld Scene, and a safety override re-derives it
- [x] #3 The arc read model applies the same withheld-scene rule to published facts that the character projection applies
- [x] #4 The arc primer reads a bounded number of accepted events, and the bound does not grow with the world event count
- [x] #5 Truncated arc backstory publishes what it left out
- [x] #6 A fault injection proves each gate: removing any one of them turns a named test red
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
- [ ] #14 Pull request is merged or explicitly blocked
<!-- DOD:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## What each of the three was, verified by reading both sides

**`onboarding:<worldId>`** — the regression. It has the safety gate and no publication gate, and `decideEpisodePublication` calls `refreshPublicTextModels`, which calls it — so an administrator's withhold withdrew `episode:<day>` and republished that Episode's narration onto the homepage in the same transaction. ART-171 made this reachable; ART-174 fixed the index half and I missed this one.

**`primer:<arcId>`** — no gate at all, and the worst of the three because of WHEN it rebuilds. `rebuildArcPrimer` runs only for arcs a committed event moved, so a resolved arc is never rebuilt again; and it was absent from `publicTextModelRefresh.ts`, so no override reached it either. A Scene withheld after an arc resolved would have narrated itself there permanently. That is why it needed its own `refreshArcPrimers`, not just a filter.

**`arc:<arcId>`** — `knownClues`/`essentialBackstory` are `fact_created` values, which `characterSourceFrom` skips for a withheld Scene. Two surfaces, two answers.

## Decisions worth keeping

- **One join, not a third copy.** ART-174 had already written the "which days has an administrator withheld" read inline. Adding a second copy here is how `REPLAY_PUBLISHED_RECORD_STATUSES` and `heatScore` happened, so it moved to `withheldPublicationDays.ts` and the index was refactored onto it in the same change.
- **The non-servable set is DERIVED, not listed.** `PUBLICATION_STATUSES.filter((s) => !isViewerServablePublicationStatus(s))` — so a status added to the lifecycle lands on the withheld side by being forgotten. Listing them would have put a new status on the servable side by being forgotten, which is the wrong direction to fail in.
- **The primer's canon read was fixed alongside** because it was in the same function and was a §9 violation: a table-wide `.collect()` on a per-commit path. The narrowing has a real cost — a character named by some other event falls back to their id — and that is written down rather than discovered later.

## The test that did not exist

`arcPrimerFunctions.ts` had no wiring test at all; `arcPrimer.test.ts` covers only the pure builder. That is how it kept both defects. The new file asserts the gate, the override path, the no-provenance convention, the point-lookup bound (with a fake that records which sequence numbers were asked for, so a collect cannot masquerade as a lookup), and the id round-trip.

## Evidence

Five injections, each turning a named test red: the onboarding publication gate removed (2), the primer's withheld set emptied (3), the arc projection's withheld set emptied (1), the omission count zeroed (1), and the primer removed from the safety refresh list (1). `npm run check` exit 0 — 4401 passed, 31 skipped, 252 suites. `npm run e2e` — 124 passed.
<!-- SECTION:NOTES:END -->
