---
id: ART-193
title: >-
  Adjacent inline elements run together, and a separator prints with nothing
  after it
status: Done
assignee: []
created_date: '2026-09-15 15:32'
updated_date: '2026-09-15 16:51'
labels: []
dependencies: []
priority: high
ordinal: 190000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Read off the rendered page against deterministic fixture data, not from the source:

- Episode, 關連角色: 「蘇美珍在地圖上查看」 — the character's name and the map link with nothing between them.
- Character, 主要關係: 「高文睿信任 · 強度 10共同修復水車」 — three separate spans, one string.
- Character, 近期大事: 「[日 3 中午] 眾人見證休戰簽署。本日故事」 — the event and its link.
- Home, 進行中的場景: 「磨坊對質兩派在磨坊為停工的水車爭執。」 — a scene title and its summary, which reads as one strange sentence.
- Home, 投票後續追蹤: 「全鎮停電。第 7 天 · 傍晚依據:事件本身的投票識別碼」 — summary, world time and provenance, all joined.
- Relationship graph: 「(強度 30) ,最近變化於世界日 7」 — a space BEFORE the comma, from a JSX line break inside a text node.

One root cause. JSX collapses the newline between two sibling elements to nothing, so markup an author laid out across three lines renders as one unbroken string. It is invisible in review precisely because the source looks spaced out. The graph case is the same mechanism inverted: a line break INSIDE a text run becomes a space, and the line happened to break before a comma.

A seventh case is the mirror image and belongs with them: the timeline renders 「[日 3 中午 · ]」 when an entry carries no eventType, printing the separator and then nothing. A published payload is unvalidated JSON, so an absent field is a real state.

Scope: src/components/public/EpisodeDetail.tsx, CharacterPage.tsx, Homepage.tsx, TimelineView.tsx, RelationshipGraphView.tsx, src/components/vote/VoteConsequencePanel.tsx.

Fix the composition, not the strings: a separator that is printed unconditionally beside an optional value is the same defect as no separator at all.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 No public surface renders two adjacent values with no separator between them
- [x] #2 A separator is never printed when the value beside it is absent
- [x] #3 Punctuation carries no space before it
- [x] #4 A test asserts the RENDERED text of the composed rows, not the presence of the pieces
- [x] #5 Fault injection: removing a separator fails a NAMED test
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
Found by reading the RENDERED page against fixture data and by looking at screenshots, not by reading source. That is the point: JSX collapses the newline between two siblings to nothing, so markup laid out across three lines renders as one unbroken string, and the source looks correct while the page does not.

## The first attempt was insufficient and is worth recording

I first used the ml-2 margin class this codebase already uses between a row label and its detail. It fixes the screen and NOT the text: a margin is not a character, so textContent — which is what a screen reader gets — stayed concatenated, and the new tests failed. The rows now carry a real separator character as well as the margin.

## The fifth case is the mirror image

The timeline rendered 「[日 3 中午 · ]」 for an entry with no eventType. A published payload is unvalidated JSON on the client, so an absent field is a real state, and a separator printed beside a missing value is the same defect as no separator at all. The line is composed in timelineRoute.ts now, where every part is dropped WITH its separator, and where it can be asserted rather than eyeballed.

The graph case is the same mechanism inverted: a line break INSIDE a text run becomes a space, and that line happened to break immediately before a comma.

## Fault injection — four, all bit

1. Character row separators removed — failed by name.
2. Scene summary separator removed — failed by name.
3. Timeline prints the separator unconditionally — three named failures.
4. The graph comma gets its space back — failed by name.

The tests assert the composed row rendered text rather than the presence of its pieces. A test that checked that the name is there and the reason is there passed throughout the defect.
<!-- SECTION:NOTES:END -->
