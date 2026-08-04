---
id: ART-111
title: Define Character Visual Binding with palette variants for twelve characters
status: To Do
assignee: []
created_date: '2026-08-04 15:57'
updated_date: '2026-08-04 16:00'
labels:
  - prd-2.0
  - v2-b
  - epic-n
dependencies:
  - ART-107
priority: high
type: feature
ordinal: 111000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**Requirement ID:** FR-N004 (PRD 2.0 §12 Epic N, decision §24.23)

**Problem / Context:** Mistwood has exactly twelve seeded characters (`convex/canon/mistwoodSeed.ts`) but the inherited art only provides eight character spritesheets (f1–f8). PRD 2.0 §6 forbids introducing external assets or image generation in v1, and §24.23 forbids applying a single tint across a whole sprite (which would recolour skin, hair and clothing together).

**Goal:** Give all twelve characters a stable, visually distinguishable identity using the existing sprites plus clothing/hair palette variants plus a fixed nameplate.

**Scope:**
- Define `CharacterVisualBinding`: `characterId`, `runtimeId`, `spriteKey`, `paletteVariant`, `nameplate`, `portraitFrame`, plus `status` and `version`.
- Assign the eight original sprites to eight characters; author clothing/hair palette variants for the remaining four.
- Implement palette-variant rendering that recolours only designated palette ranges, never the whole sprite.
- Import validation rejecting unknown characterIds or spriteKeys.
- Deterministic assignment so appearance never changes across redeploys.

**Out of Scope:** New external art or generated images; animation state machine (FR-O002); character card UI (FR-O006).

**Dependencies:** FR-N001 audit (spritesheet inventory).

**Schema Impact:** New `CharacterVisualBinding` persisted shape (PRD 2.0 §14.1), versioned and auditable.

**API Impact:** Feeds the public projection `spriteKey`/appearance fields; contains no private data.

**Security Impact:** Nameplate and portrait are public; must expose no private goal, secret or memory.

**Test Requirements:** Unit tests for binding validation, deterministic assignment stability, and that palette variants alter only designated ranges (not a whole-sprite tint).

**Validation Commands:**
- `npm run check`

**Documentation Impact:** Character visual binding reference listing all twelve assignments.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 All twelve Mistwood characters have a stable and visually distinguishable visual binding
- [ ] #2 Appearance does not change randomly across redeploys
- [ ] #3 The same character uses the same visual identity on the map, character card and Episode surfaces
- [ ] #4 Palette variants recolour only designated palette ranges and never apply a single tint to the whole sprite
- [ ] #5 No external asset library or image generation model is introduced
- [ ] #6 Import validation rejects unknown characterIds and unknown spriteKeys
- [ ] #7 Bindings are versioned and auditable
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
