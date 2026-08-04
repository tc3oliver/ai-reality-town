---
id: ART-113
title: Build the read-only Pixi world shell
status: To Do
assignee: []
created_date: '2026-08-04 15:58'
updated_date: '2026-08-04 16:01'
labels:
  - prd-2.0
  - v2-c
  - epic-n
dependencies:
  - ART-112
  - ART-109
priority: high
type: feature
ordinal: 113000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**Requirement ID:** FR-N002 (PRD 2.0 §12 Epic N)

**Problem / Context:** The inherited game client is interactive: it mounts a world heartbeat, offers player controls, and can send world input. The public Dynamic Viewing surface must reuse its rendering while being structurally incapable of writing to the world.

**Goal:** A read-only renderer component tree that renders map and characters and has no write path, with a clear code boundary from the interactive game components.

**Scope:**
- Read-only renderer component tree reusing tilemap and sprite rendering.
- No world heartbeat mount.
- No join/move/chat/interact/accept/reject/leave calls.
- No player control buttons.
- Map clicks never set a character destination.
- Explicit module boundary separating read-only components from interactive ones, enforceable by the existing module-boundary tooling.

**Out of Scope:** Motion data production (FR-N010/FR-N003); live page composition (FR-O001); the end-to-end zero-mutation security proof (FR-O009).

**Dependencies:** a16z engine retirement; FR-N009 Mistwood map.

**Schema Impact:** None.

**API Impact:** Consumes only public read queries.

**Security Impact:** Structural removal of the client write surface; server-side enforcement remains owned by FR-O009.

**Test Requirements:** Tests asserting the read-only tree issues no mutation and mounts no heartbeat; module-boundary test asserting read-only components do not import interactive/write modules.

**Validation Commands:**
- `npm run check`

**Documentation Impact:** Architecture note describing the read-only renderer boundary.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The read-only renderer renders the Mistwood map and character sprites
- [ ] #2 No world heartbeat is mounted by the read-only tree
- [ ] #3 No join, move, chat, interact, accept, reject or leave action is reachable
- [ ] #4 No player control buttons are rendered
- [ ] #5 Map clicks cannot change any character destination
- [ ] #6 A clear enforced module boundary separates read-only components from interactive game components
- [ ] #7 An automated test proves public viewing produces no database mutation
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
