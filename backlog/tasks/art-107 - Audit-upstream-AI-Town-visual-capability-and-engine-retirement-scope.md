---
id: ART-107
title: Audit upstream AI Town visual capability and engine retirement scope
status: To Do
assignee: []
created_date: '2026-08-04 15:57'
labels:
  - prd-2.0
  - v2-a
  - epic-n
dependencies: []
priority: high
type: feature
ordinal: 107000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**Requirement ID:** FR-N001 (PRD 2.0 §12 Epic N)

**Problem / Context:** PRD 2.0 requires reusing the inherited a16z AI Town PixiJS rendering stack rather than rebuilding a renderer, and requires retiring the a16z server-side simulation engine (PRD 2.0 §10.3). No current inventory exists of which visual assets/components are reusable, which are dead, and which server-side capabilities fall inside the retirement scope.

**Goal:** Produce an authoritative, verified inventory of reusable visual capability and an explicit retirement list, so every downstream V2 task builds on evidence rather than assumption.

**Scope:**
- Inventory PixiJS renderer files (PixiGame, PixiStaticMap, Character, PixiViewport), pixi.js / @pixi/react / pixi-viewport versions.
- Inventory tilemap data (data/gentle.js), tileset assets, collision/objmap layers.
- Inventory character spritesheets (data/spritesheets/f1-f8, p1-p3, player) and their animation definitions.
- Inventory viewport drag/pan/zoom and click-to-select behaviour.
- Enumerate every client-triggerable Convex mutation/action reachable from the game UI, with file:line.
- Enumerate a16z server-side engine entry points (convex/aiTown/*, convex/agent/*, aiTown/main:runStep, crons) and mark each against the PRD 2.0 §10.3 retirement list.
- Actually boot the existing game view; record why the current public pages do not use the dynamic renderer.

**Out of Scope:** Any code change to renderer, engine, or projection. This task is documentation + evidence only.

**Dependencies:** None (entry point of the V2 graph).

**Schema Impact:** None.

**API Impact:** None.

**Security Impact:** Identifies the write-path surface that FR-N002/FR-O009 must prove closed; no behaviour change.

**Test Requirements:** No automated tests (audit deliverable). Evidence must include a booted-renderer screenshot or equivalent runtime observation.

**Validation Commands:**
- `npm run check`
- Manual: boot dev server, load the game route, capture evidence.

**Documentation Impact:** New `docs/upstream-visual-capability-audit.md`; referenced by PRD 2.0 FR-N001.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A code and asset inventory is produced covering renderer, tilemap, spritesheets, animations, viewport and pathfinding
- [ ] #2 Every inventoried item is marked reusable-as-is, needs-modification, dead, or must-not-be-public
- [ ] #3 The existing renderer is actually booted and observed, not inferred from source alone
- [ ] #4 The reason the current public pages do not use the dynamic renderer is documented
- [ ] #5 A minimal restoration path to a rendering public view is documented
- [ ] #6 Every a16z server-side capability is classified against the PRD 2.0 section 10.3 retirement list
- [ ] #7 Every client-triggerable Convex mutation or action reachable from the game UI is listed with file and line
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
