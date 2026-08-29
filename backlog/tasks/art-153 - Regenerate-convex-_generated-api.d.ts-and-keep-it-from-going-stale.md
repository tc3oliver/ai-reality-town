---
id: ART-153
title: Regenerate convex/_generated/api.d.ts and keep it from going stale
status: To Do
assignee: []
created_date: '2026-08-29 05:42'
labels: []
dependencies: []
priority: medium
type: chore
ordinal: 153000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
convex/_generated/api.d.ts was last generated on 2026-08-10 and is missing every module added since, including publicRead/conversationState (ART-123) and publicRead/voteConsequenceProjection (ART-46). Nothing currently breaks because the architecture gate does not read it and internalFunctionRef resolves by string path, but the file is checked in and is now actively misleading to anyone who trusts it, and any future code that does use the generated api object will silently miss those modules. Regenerate it and add a check so a PR that adds a Convex module without regenerating fails rather than merging.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The generated API types include every Convex module present in the tree
- [ ] #2 CI fails when the checked-in generated types do not match what regeneration would produce
- [ ] #3 The check does not require a Convex deployment or network access to run
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
