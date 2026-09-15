---
id: ART-189
title: 'The Episode page always offers a next episode, including when there is none'
status: In Progress
assignee: []
created_date: '2026-09-15 14:11'
updated_date: '2026-09-15 15:48'
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

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Neighbours come from the published index episodes:<worldId>, not from arithmetic. That answers both halves at once: the end of the run, which was the reported defect, and a HOLE in the middle of it, which arithmetic cannot get right either — a day the safety gate withheld, or one the editorial pipeline has not reached, is a published run with a gap, and worldDay + 1 walks straight into it.

An absent neighbour renders a stated absence, not a disabled button. A disabled control still tells a viewer there is something there.

Both controls named a 日 while calling it a 集, two lines below a header that distinguishes them correctly. ART-184 already established that conflating the two is what made the recommended-episode link surprising. A test pins that the episode number is not derived from the day: in the fixture, day 5 is episode 2 because day 4 published nothing.

## The fixture gap this exposed

The fixture registered NO episode:<worldDay> model, so every browser visit to #episode/mistwood/<day> rendered 「找不到此故事」 and this P0 public surface had no browser coverage of any kind. Its recap depths, its related lists and its navigation were exercised only through EpisodeDetailView in jsdom. FIXTURE_EPISODE_DAYS is now [3, 5, 7], shared by the index and the per-day detail so the two cannot drift, with days 4 and 6 as deliberate holes.

## Fault injection — four, three bit first time

1. Next computed by arithmetic — six named failures.
2. Next offered unconditionally in the component — reported 'Tests: 10 passed, 10 total' against a 16-test baseline. The substitution broke the DOM suite's JSX so it never loaded, which in a filtered summary is indistinguishable from a clean pass. Re-run as the original defect expressed in the new code (fabricating a next by arithmetic when none is published) it failed three tests by name.
3. The control names only the world day again — failed by name.
4. Nearest-published replaced by furthest — failed by name.

## Handed to another task

Running the new browser spec showed that FOLLOWING 下一集 changes the address bar and not the page. That is not this task's defect — PublicRoute never subscribed to hashchange, so no public link navigated at all. Raised as ART-192. This spec asserts the control's LABEL and leaves following it to that task, so each PR's tests pass on their own branch.
<!-- SECTION:NOTES:END -->
