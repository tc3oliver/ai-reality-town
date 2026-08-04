---
id: ART-118
title: 'Render the live 2D map with viewport pan, zoom and camera navigation'
status: To Do
assignee: []
created_date: '2026-08-04 15:58'
updated_date: '2026-08-04 16:13'
labels:
  - prd-2.0
  - v2-f
  - epic-o
dependencies:
  - ART-113
  - ART-115
priority: high
type: feature
ordinal: 118000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**Requirement ID:** FR-O001, FR-O005 (PRD 2.0 §12 Epic O)

**Problem / Context:** `/live` currently renders a text-only page. PRD 2.0 requires a draggable, zoomable 2D map and forbids substituting a text location list or static screenshot, while keeping every interaction confined to client view state.

**Goal:** A live map surface with full camera navigation that cannot influence the world.

**Scope:**
- Mount the read-only renderer with the Mistwood map on `/live`.
- Drag/pan, zoom, click-to-focus a character, click-to-focus an active scene, return to town view.
- Optional auto-follow of the current primary scene, disableable.
- WebGL-unavailable path falling back to Canvas or an informational view.
- Reduced Motion support for camera transitions.

**Out of Scope:** Character motion rendering (FR-O002); scene visualization content (FR-O003); overlay content (FR-O007); full degradation ladder (FR-O010).

**Dependencies:** FR-N002 read-only shell; FR-N003 public dynamic projection.

**Schema Impact:** None.

**API Impact:** Consumes the public dynamic projection only.

**Security Impact:** All camera operations must be pure client view state and send no character control payload.

**Test Requirements:** E2E tests for pan, zoom, focus and return-to-town; a test asserting no network mutation results from camera interaction; Reduced Motion behaviour test.

**Validation Commands:**
- `npm run check`
- Browser E2E for `/live` map load and camera controls.

**Documentation Impact:** Live view navigation documentation.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 /live renders a draggable and zoomable 2D map on desktop and mobile
- [ ] #2 Main map layers, collision areas and the character layer display correctly
- [ ] #3 Viewers can pan, zoom, focus a character, focus an active scene and return to the town view
- [ ] #4 No camera or navigation operation sends any character control command
- [ ] #5 Auto-follow of the primary scene can be turned off
- [ ] #6 Camera transitions respect Reduced Motion and never cause runaway zoom
- [ ] #7 A Canvas or informational fallback is provided when WebGL is unavailable
- [ ] #8 The public live route is reachable at the PRD 2.0 path and any legacy hash route redirects to it without losing the world identifier
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
