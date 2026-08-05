---
id: ART-111
title: Define Character Visual Binding with palette variants for twelve characters
status: To Do
assignee: []
created_date: '2026-08-04 15:57'
updated_date: '2026-08-05 06:51'
labels:
  - prd-2.0
  - v2-b
  - epic-n
dependencies:
  - ART-107
  - ART-143
priority: high
type: feature
ordinal: 111000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**Requirement ID:** FR-N004 (PRD 2.0 §12 Epic N, decision §24.23)

**Problem / Context:** Mistwood has exactly twelve seeded characters (`convex/canon/mistwoodSeed.ts`) but the inherited art only provides eight character spritesheets (f1–f8). PRD 2.0 §6 forbids introducing external assets or image generation in v1, and §24.23 forbids applying a single tint across a whole sprite (which would recolour skin, hair and clothing together).

**Display name gap (review finding):** The seed's `name` field is a romanized English form (`Lin Yingxue`, `Gao Wenrui`, …), not the Traditional Chinese name implied by ART-106's zh-TW narration and the project's Traditional Chinese decision. ART-106 made generated narration zh-TW but never touched this field, and nothing in this task's original scope required a Chinese-language public display name. Without one, the map nameplate, character card, Episode byline and Story Arc references would each be free to pick a different label, or fall back to the English seed `name`, contradicting the single-language public product direction.

**Goal:** Give all twelve characters a stable, visually distinguishable identity using the existing sprites plus clothing/hair palette variants plus a fixed nameplate, and a single canonical Traditional Chinese public display name used everywhere.

**Scope:**
- Define `CharacterVisualBinding`: `characterId`, `runtimeId`, `spriteKey`, `paletteVariant`, `nameplate`, `portraitFrame`, `displayName`, `locale`, plus `status` and `version`.
- `displayName` holds the Traditional Chinese public name (e.g. 林映雪 for `lin-yingxue`); `locale` is fixed to `zh-TW` for the MVP.
- Assign the eight original sprites to eight characters; author clothing/hair palette variants for the remaining four.
- Implement palette-variant rendering that recolours only designated palette ranges, never the whole sprite.
- Import validation rejecting unknown characterIds or spriteKeys.
- Deterministic assignment so appearance never changes across redeploys.
- The internal `characterId` and the seed's romanized `name` remain stable identifiers; they are never shown as the public display name.

**Out of Scope:** New external art or generated images; animation state machine (FR-O002); character card UI (FR-O006); translating any other Canon text field (narration is already handled by ART-106).

**Dependencies:** FR-N001 audit (spritesheet inventory).

**Schema Impact:** New `CharacterVisualBinding` persisted shape (PRD 2.0 §14.1), versioned and auditable, now including `displayName`/`locale`.

**API Impact:** Feeds the public projection `spriteKey`/appearance/`displayName` fields; contains no private data.

**Security Impact:** Nameplate, portrait and displayName are public; must expose no private goal, secret or memory.

**Test Requirements:** Unit tests for binding validation, deterministic assignment stability, that palette variants alter only designated ranges, and that displayName is consistently zh-TW across all twelve bindings.

**Validation Commands:**
- `npm run check`

**Documentation Impact:** Character visual binding reference listing all twelve assignments and their Traditional Chinese display names.
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
- [ ] #8 Every character binding has a Traditional Chinese displayName distinct from the seed's romanized name
- [ ] #9 The map nameplate, character card, Episode surfaces and Story Arc references all show the same displayName for a given character
- [ ] #10 The internal characterId and seed name remain stable and are never shown as the public display name
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
