---
id: ART-187
title: Public pages name the entities they link to instead of printing their ids
status: In Progress
assignee: []
created_date: '2026-09-15 14:11'
updated_date: '2026-09-15 14:43'
labels: []
dependencies: []
priority: high
ordinal: 185000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Four public pages render an internal identifier where a reader expects a name. Each one is a link whose visible text is the slug it points at.

- EpisodeDetail.tsx:229 lists 關連角色 as he-jun, zhao-ming, and line 238 gives the map link beside it the accessible name 「在地圖上查看 he-jun」. Line 254 lists 關連故事線 as arc ids.
- CharacterPage.tsx:231 lists 主要關係 by the other person's id. The relationship graph page, reading the SAME published graph, resolves those names through character:<id> and renders 何俊 — so the two surfaces disagree about the same edge.
- ArcDetailPage.tsx:159 renders 「起始事件:mistwood#event#74」. That is a Canon event key, not content, and there is no reading of it that helps a viewer. Line 162's 最近轉折 falls back to the same key when the turning point carries no summary.
- characterRoute.ts:324 falls back to the raw arcId as an arc's title, and :427 falls back to the raw locationId as 所在地.
- The TimelineView and EpisodeList filter dropdowns are built by namedOptions(), which only dedupes: every option in 故事線 and 角色 is a slug.

The names are published. RelationshipGraphView already establishes the pattern for resolving a bounded node set — useQueries over character:<id>, memoised on the id list — and arc:<arcId> carries a title the same way. liveState carries displayName for every character in the world and title for every active arc, and the pages that need many names at once can read it in one query they are already allowed to make.

Scope: src/components/public/EpisodeDetail.tsx, CharacterPage.tsx, characterRoute.ts, ArcDetailPage.tsx, arcRoute.ts, TimelineView.tsx, timelineRoute.ts, EpisodeList.tsx, episodeListRoute.ts.

Out of scope: the live map and text live view (ART-186), enum labels (their own task), and the language of the authored seed.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 關連角色 and 關連故事線 on the Episode page render names and titles, and the 在地圖上查看 accessible name does too
- [ ] #2 主要關係 on the character page names the other person, and names them identically to the relationship graph page for the same edge
- [ ] #3 No public page renders a Canon event key; 起始事件 renders the event's public summary or states plainly that none is published
- [ ] #4 所在地 and an arc's title never fall back to a raw id
- [ ] #5 The timeline and episode-list filter options are named, and filtering still selects on the underlying id
- [ ] #6 Deterministic tests fail by name when any of these resolutions is removed
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
