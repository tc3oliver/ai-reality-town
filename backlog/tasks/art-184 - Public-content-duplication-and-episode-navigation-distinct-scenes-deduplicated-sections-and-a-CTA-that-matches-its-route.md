---
id: ART-184
title: >-
  Public content duplication and episode navigation: distinct scenes,
  deduplicated sections, and a CTA that matches its route
status: In Review
assignee:
  - '@claude'
created_date: '2026-09-15 12:20'
updated_date: '2026-09-15 13:09'
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

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implementation complete; npm run check green (4592 passed / 4623 total, build OK).

Root cause, measured rather than assumed. The served liveState for mistwood carried 20 recentEvents with THREE distinct summary strings — one repeated 7 times, another 7, the third 6. Five key scenes were built from 15 distinct event ids and those same three sentences.

1. Duplicate scenes. convex/editorial/episode.ts now collapses sources whose publicSummary is byte-identical BEFORE the round-robin that deals them into buckets. Merging rather than dropping: each collapsed entry keeps every event id and every public fact id its duplicates named, and the episode-level sourceEventIds, relationship changes, questions, arcs and characters are still derived from the full ordered list. So what the episode COVERS is unchanged; only how many times it says one thing. A blank or null summary is never collapsed — two events that both said nothing publicly are not the same event, and collapsing on absence would silently shrink a quiet day.

2. The primer restating itself. onboardingSummary.ts skips the 場景 clause when the scene summary and the lead event describe the same development. Containment in both directions, not equality: a scene summary is assembled by joining the summaries of the events it covers, so it CONTAINS the lead sentence rather than equalling it, and an equality check would have missed every observed case.

3. 最新大事 reprinting 近期大事. Fixed on the home page, in homeRoute.ts and Homepage.tsx, not on the server. The header is suppressed with the paragraph, because a labelled section with nothing under it reads as missing content.

4. The episode CTA. The link was always CORRECT — episodeNumber and worldDay come from one episode record (onboardingSummaryFunctions.ts:256-258) and the destination heads itself 「第 N 集 · 世界日 M」 (EpisodeDetail.tsx:162). The defect was only that a reader clicking 「第 3 集」 landed on a URL ending in /2 with nothing to explain it. The label now names both numbers, so the address is predictable before the click. This is narrower than the task description claimed and is recorded as such rather than being written up as a fixed broken link.

TWO ATTEMPTS WERE WRONG AND ARE RECORDED RATHER THAN QUIETLY DROPPED:

- I first removed the 近期大事 clause from summaryText entirely, reasoning that structured.majorEvent carries the same string and every surface renders it in a section of its own. The ART-75 newcomer acceptance suite failed immediately: AC#1 requires the composed text ALONE to tell a first-time reader what is happening. Reverted, and the reasoning is now recorded in the code so nobody repeats it.
- I then applied the same suppression to the live overlay via storyOverlayModel.ts. FR-O007 AC#1 requires latestMajorEvent to be answerable from the overlay payload, and its test failed. Reverted. The overlay duplication was never directly observed, unlike the home page one, so suppressing it there was a guess against an acceptance criterion.

Fault injections — four, all bit by name on the first attempt:

- Stop collapsing duplicate summaries: FAILED BY NAME, 2 cases including the distinct-count assertion.
- Let the primer restate its lead event: FAILED BY NAME, 2 cases.
- Print the duplicated 最新大事 section again: FAILED BY NAME.
- Revert the CTA label to the number that is not in the URL: FAILED BY NAME.

New tests: convex/publicRead/publicNarrativeDuplication.test.ts (11) and src/components/public/homepagePresentation.dom.test.tsx (3). The duplication tests assert the DISTINCT COUNT against the input rather than merely scene 1 != scene 2, because the weaker assertion passes on a page that says one thing five ways.
<!-- SECTION:NOTES:END -->
