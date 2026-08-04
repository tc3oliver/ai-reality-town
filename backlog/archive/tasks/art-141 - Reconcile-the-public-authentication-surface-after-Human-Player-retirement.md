---
id: ART-141
title: Reconcile the public authentication surface after Human Player retirement
status: To Do
assignee: []
created_date: '2026-08-04 16:16'
updated_date: '2026-08-04 16:17'
labels:
  - prd-2.0
  - v2-c
  - epic-p
dependencies:
  - ART-112
priority: high
type: feature
ordinal: 141000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**Requirement ID:** PRD 2.0 §10.3 (engine retirement), UX2-003 (viewers may only watch and navigate)

**Problem / Context:** ART-105 re-enabled the login UI to activate Clerk operator authentication. That UI still carries inherited a16z framing: `src/App.tsx` renders "Log in to join the town and the conversation!" and an Interact button, and the help modal explains walking around, talking to agents and joining the simulation. Once ART-112 retires Human Player and world input, all of that becomes false — it promises viewers a control capability PRD 2.0 explicitly forbids.

Login itself must stay: it is the entry point for the operator console and for the future authenticated-viewer follows feature (ART-71, P2).

**Goal:** The public authentication surface honestly reflects a watch-only product, without removing the operator login path.

**Scope:**
- Remove or rewrite copy promising joining, controlling or chatting with characters.
- Remove the Interact affordance from the public surface.
- Rewrite the help content to describe watching, navigating, character cards, scenes, episodes and replay.
- Keep the Clerk login entry point and the operator authorization path working.
- Ensure an authenticated viewer gains no world-control capability.

**Out of Scope:** Authenticated viewer follows and progress (ART-71, carried forward); operator console features (PRD 1.0, delivered).

**Dependencies:** ART-112 (engine retirement).

**Schema Impact:** None.

**API Impact:** None.

**Security Impact:** Confirms that authentication grants no world-write capability on the public surface.

**Test Requirements:** Tests asserting no join, interact or control affordance is reachable authenticated or unauthenticated, and that the operator authorization path still resolves.

**Validation Commands:**
- `npm run check`
- Manual: sign in and confirm operator authorization still resolves while no world-control affordance appears.

**Documentation Impact:** Update public experience documentation for the watch-only model.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 No public copy promises joining, controlling or chatting with characters
- [ ] #2 The Interact affordance is removed from the public surface
- [ ] #3 Help content describes watching, navigating, character cards, scenes, episodes and replay
- [ ] #4 The Clerk login entry point and the operator authorization path continue to work
- [ ] #5 An authenticated viewer gains no world-control capability
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
