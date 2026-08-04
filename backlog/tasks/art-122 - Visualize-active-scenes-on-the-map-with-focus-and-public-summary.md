---
id: ART-122
title: Visualize active scenes on the map with focus and public summary
status: To Do
assignee: []
created_date: '2026-08-04 15:58'
updated_date: '2026-08-04 16:13'
labels:
  - prd-2.0
  - v2-f
  - epic-o
dependencies:
  - ART-118
priority: high
type: feature
ordinal: 122000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**Requirement ID:** FR-O003 (PRD 2.0 §12 Epic O)

**Problem / Context:** Viewers need to see immediately where the important thing is happening. Active scenes exist in the public read model but have no spatial representation.

**Goal:** Active scenes are identifiable on the map, summarised publicly, and focusable.

**Scope:**
- Mark active scene locations on the map.
- Show scene title, public summary, participating characters and related story arc.
- Clicking a scene focuses the camera on the relevant location.
- Transition finished scenes into recent events or an Episode entry point.
- Publish `ActiveScenePresentation` (PRD 2.0 §14.6).

**Out of Scope:** Dialogue bubbles (FR-O004); overlay layout (FR-O007); publication/safety gating implementation (FR-P004).

**Dependencies:** FR-O001 live map.

**Schema Impact:** New `ActiveScenePresentation` shape (PRD 2.0 §14.6).

**API Impact:** Active scene fields within the public dynamic projection.

**Security Impact:** Private or unpublished scenes must never surface.

**Test Requirements:** Tests that unpublished scenes are excluded, that focus targets the correct location, and that ended scenes transition to a recent-event or Episode entry.

**Validation Commands:**
- `npm run check`
- Browser E2E: clicking an active scene focuses and shows its summary.

**Documentation Impact:** Active scene presentation documentation.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Active scene locations are identifiable on the map
- [ ] #2 Scene title, public summary, participating characters and story arc are shown
- [ ] #3 Clicking a scene focuses the camera on the relevant location
- [ ] #4 Private or unpublished scenes are never shown
- [ ] #5 Ended scenes become a recent event or an Episode entry point
- [ ] #6 Active scene presentation resolves locationId, participant characterIds and arcIds by tracing sourceEventIds back to accepted events, because the existing liveState LiveScene shape carries none of them
- [ ] #7 A scene is presentable during the current world day before the daily episode reaches ready status, so the map is not sceneless for most of the day
- [ ] #8 When no scene qualifies as current, the map degrades to the most recent completed scene rather than showing nothing
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
