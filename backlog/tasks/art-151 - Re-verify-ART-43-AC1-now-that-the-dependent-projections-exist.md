---
id: ART-151
title: Re-verify ART-43 AC#1 now that the dependent projections exist
status: In Progress
assignee:
  - '@claude'
created_date: '2026-08-29 05:41'
updated_date: '2026-09-09 11:48'
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
- [ ] #1 Each of the eleven AC#1 fields is individually assessed against a published read model and the result recorded
- [ ] #2 Fields whose source now exists are exposed on the public character page
- [ ] #3 Any field still unavailable is documented with the named missing source and the task that would provide it
- [ ] #4 ART-43 AC#1 is either checked with evidence or replaced by an explicit scoped follow-up
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

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Read FR-I005 from the PRD and enumerate its ten public fields verbatim, rather than trusting the task summary.
2. Assess each field against what is actually published today, naming the read model and the file.
3. Deliver every field whose source now exists, reusing the published projection rather than adding one.
4. For 所屬 Arc, move the live card's private membership helper to clientPublic so both surfaces answer with one function instead of two.
5. Record the two fields that still have no source, name what would supply them, and open a scoped follow-up; leave ART-43 AC#1 unchecked.
6. Fault injections, npm run check, npm run e2e.
<!-- SECTION:PLAN:END -->
