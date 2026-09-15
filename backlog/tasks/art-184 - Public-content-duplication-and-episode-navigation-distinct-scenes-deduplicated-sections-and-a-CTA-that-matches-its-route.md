---
id: ART-184
title: >-
  Public content duplication and episode navigation: distinct scenes,
  deduplicated sections, and a CTA that matches its route
status: To Do
assignee: []
created_date: '2026-09-15 12:20'
labels: []
dependencies: []
priority: critical
ordinal: 182000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The public pages show the same sentence over and over, and the episode call to action sends the viewer to a number other than the one it displays. Measured against the served liveState for mistwood on 2026-09-15.

The duplication is severe and measurable:

- The served payload carries 20 recentEvents with only THREE distinct summary strings. One sentence is repeated 7 times, another 7 times, the third 6 times.
- The five activeScenes draw on 15 distinct event ids but only those same 3 sentences, so Key scene 1 through Key scene 5 are permutations of one another. Key scene 2 contains the mistwood-square sentence twice within itself.
- The home page then shows the mistwood-mill sentence three times on one screen: once inside 近期大事, again later in the same paragraph, and again under 最新大事.

Root cause, two layers:

1. An event summary is derived only from location, participants and goals (convex/simulation/worldDayLive.ts:750 and the summary built from it). None of those change between ticks, so the same scene at a later time produces a byte-identical string. Distinct event ids therefore carry indistinguishable text.
2. convex/editorial/episode.ts:105-113 round-robins ordered events into buckets and joins each bucket with a space, with no dedup. Identical summaries in one bucket are concatenated verbatim.
3. convex/publicRead/onboardingSummary.ts:85-90 composes majorEvent and scene into one string without checking whether they are the same content.

Separately, an episode navigation mismatch: src/components/public/homeRoute.ts:210 builds the CTA href from recommendedEpisode.worldDay while the label renders recommendedEpisode.episodeNumber. The episode route is keyed by worldDay (src/components/public/EpisodeDetail.tsx:57), so the link resolves correctly, but the viewer clicks 從第 3 集開始認識這個世界 and lands on a URL ending in /2. The displayed number and the route target must agree.

Depends on ART-183 only for the text itself; the dedup and navigation rules are independent and this task should stay reviewable on its own.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Two key scenes of the same episode never carry identical or near-identical summary text
- [ ] #2 A single key scene never repeats the same sentence within itself
- [ ] #3 近期大事 does not present the same underlying event more than once
- [ ] #4 最新大事 and the other home page sections have a stated presentation rule for referencing the same event, and do not simply repeat the same text
- [ ] #5 Events that would otherwise produce byte-identical public text are distinguishable to a viewer, or are deliberately collapsed by a stated rule rather than emitted repeatedly
- [ ] #6 The episode CTA displays a number that matches the route it navigates to; a label reading 第 3 集 does not resolve to a URL ending in /2
- [ ] #7 Deterministic regression tests reproduce the duplication from fixture input and assert it is gone, with no reliance on production data
- [ ] #8 A test asserts the distinct-summary count for a fixture world, so a regression to three distinct strings across twenty events fails by name
- [ ] #9 A fault injection is performed for the dedup guarantee and for the CTA route agreement: each is broken, a NAMED test is shown failing, and each is restored
- [ ] #10 npm run check passes
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
