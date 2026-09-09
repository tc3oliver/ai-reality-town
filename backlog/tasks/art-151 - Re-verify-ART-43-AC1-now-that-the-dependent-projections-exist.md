---
id: ART-151
title: Re-verify ART-43 AC#1 now that the dependent projections exist
status: Done
assignee:
  - '@claude'
created_date: '2026-08-29 05:41'
updated_date: '2026-09-09 14:30'
labels:
  - prd-1.0
  - epic-i
dependencies: []
priority: medium
type: chore
ordinal: 151000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
ART-43 (Privacy-safe public character pages) closed with AC#1 unchecked because several of the required fields had no source projection at the time. AC#1 requires the character page to expose name/image, age/occupation, public background, current state, public goal, primary relationships, recent major events, arcs, viewer-known secrets, and dramatic-irony facts. Since then ART-44 (scoped relationship graph), the arc read models and arc primer, and the episode/timeline projections have all landed, so the missing sources may now exist. This task is to check each of the eleven fields against what is actually published today, deliver whatever is now deliverable, and record the remainder with the specific missing source rather than leaving the criterion silently unchecked.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Each of the eleven AC#1 fields is individually assessed against a published read model and the result recorded
- [x] #2 Fields whose source now exists are exposed on the public character page
- [x] #3 Any field still unavailable is documented with the named missing source and the task that would provide it
- [x] #4 ART-43 AC#1 is either checked with evidence or replaced by an explicit scoped follow-up
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

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Read FR-I005 from the PRD and enumerate its ten public fields verbatim, rather than trusting the task summary.
2. Assess each field against what is actually published today, naming the read model and the file.
3. Deliver every field whose source now exists, reusing the published projection rather than adding one.
4. For 所屬 Arc, move the live card's private membership helper to clientPublic so both surfaces answer with one function instead of two.
5. Record the two fields that still have no source, name what would supply them, and open a scoped follow-up; leave ART-43 AC#1 unchecked.
6. Fault injections, npm run check, npm run e2e.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Closed after PR merged; npm run check and npm run e2e green on the merged branch.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Re-checked ART-43 AC#1's ten FR-I005 fields against what is actually published today. Four became deliverable and one had been deliverable all along: 圖像 (CharacterSprite over the same visual binding the map uses), 目前狀態's LOCATION (currentLocationId had been in the payload since ART-43 and was simply never rendered), 所屬 Arc (the published Live projection, through the same characterCurrentArcs the live card calls — the rule moved to clientPublic so the two surfaces cannot drift), and 主要關係 (the published FR-I007 graph for the current world day, with its scope stated on the page so an empty list is not read as 'none'). AC#1 is left UNCHECKED deliberately: 觀眾已知秘密 and 角色不知道但觀眾知道的資訊 have no published source anywhere — nothing joins a secret to the published event that revealed it, and nothing computes a character's knowledge gap. Marking it done with eight of ten would make the criterion say something untrue, so they are owned by the scoped follow-up ART-169 and recorded field-by-field in docs/public-character-page.md. Verified: 5 injections each turning a named test red; npm run check exit 0 (4183 passed, 243 suites); npm run e2e 88 passed; PR #257 merged.
<!-- SECTION:FINAL_SUMMARY:END -->
