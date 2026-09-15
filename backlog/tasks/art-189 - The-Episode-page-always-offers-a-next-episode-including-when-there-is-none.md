---
id: ART-189
title: 'The Episode page always offers a next episode, including when there is none'
status: To Do
assignee: []
created_date: '2026-09-15 14:11'
labels: []
dependencies: []
priority: medium
ordinal: 187000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
EpisodeDetail.tsx:298 renders 下一集(第 N 日) unconditionally, with nextDay = worldDay + 1 and no upper bound. The previous-episode button IS bounded (disabled when prevDay < 1), so the asymmetry is not a design decision anyone stated — it is a missing bound.

On the newest episode the button is enabled, reads 「下一集(第 5 日)」, and navigating lands on 「找不到此故事(可能尚未發布)。」 A viewer at the end of the published run is told there is more and then told it does not exist. That is a navigation-correctness defect, not a cosmetic one: the control asserts something about the world that the destination immediately contradicts.

The labels are also wrong about what they count. Both buttons say 集 (episode) and then name a 日 (world day); the header one line above distinguishes the two correctly as 「第 N 集 · 世界日 M」, and ART-184 already established that conflating them is what made the recommended-episode link surprising.

The bound needs the published episode index, episodes:<worldId> — the same read EpisodeList already makes, and an allowlisted public read that triggers no generation. It carries every published worldDay, so both ends can be bounded by what exists rather than by arithmetic.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 下一集 is unavailable when no later episode is published, and the unavailability is stated rather than left as a dead control
- [ ] #2 上一集 is bounded by what is published rather than by worldDay > 1, so a gap at the start of the run does not produce a dead control either
- [ ] #3 Both controls name what they navigate by, consistently with the 第 N 集 · 世界日 M header above them
- [ ] #4 A deterministic test drives the last published episode and fails by name if the control is offered
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
