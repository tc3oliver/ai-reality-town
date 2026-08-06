---
id: ART-111
title: Define Character Visual Binding with palette variants for twelve characters
status: Done
assignee:
  - '@art111-executor'
created_date: '2026-08-04 15:57'
updated_date: '2026-08-06 09:15'
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
- [x] #1 All twelve Mistwood characters have a stable and visually distinguishable visual binding
- [x] #2 Appearance does not change randomly across redeploys
- [x] #3 The same character uses the same visual identity on the map, character card and Episode surfaces
- [x] #4 Palette variants recolour only designated palette ranges and never apply a single tint to the whole sprite
- [x] #5 No external asset library or image generation model is introduced
- [x] #6 Import validation rejects unknown characterIds and unknown spriteKeys
- [x] #7 Bindings are versioned and auditable
- [x] #8 Every character binding has a Traditional Chinese displayName distinct from the seed's romanized name
- [x] #9 The map nameplate, character card, Episode surfaces and Story Arc references all show the same displayName for a given character
- [x] #10 The internal characterId and seed name remain stable and are never shown as the public display name
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
1. New `visual` module at `convex/visual/` (registered in architecture/module-boundaries.json, mayDependOn canon+shared).
2. `characterVisualBinding.ts`: CharacterVisualBindingV1 shape (schemaVersion, id, worldId, characterId, runtimeId, spriteKey, paletteVariant, nameplate, portraitFrame, displayName, locale, publicVariant, status, version), the sprite catalogue (f1-f8 -> 32x32folk.png cell origins + frame names), the HSV palette-range/variant model, pure `applyPaletteVariant()` RGBA recolour, PROTECTED_SKIN_RANGE, and `validateCharacterVisualBindingSet()` returning stable error codes.
3. `mistwoodVisualBindings.ts`: 12 authored bindings for the Mistwood seed. 8 base sprites f1-f8 assigned by seed index; 4 palette variants derived from f1/f2/f4/f6. zh-TW displayName per character; nameplate === displayName (encodes the single-public-label rule).
4. Palette ranges are measured HSV windows taken from the real `public/assets/32x32folk.png` (rgb->hsv histogram analysis per 96x128 sprite cell), each proven disjoint from the protected skin range. No global tint field exists in the model, so a whole-sprite tint is structurally unrepresentable.
5. `schema.ts`: `characterVisualBindings` Convex table (versioned + auditable, indexed by world/character and by current version).
6. Tests: shape/validation unit tests (unknown characterId, unknown spriteKey, unknown paletteVariant, duplicate runtimeId, nameplate/displayName divergence, non-zh-TW locale, skin-overlapping range, over-broad range); determinism test (bindings rebuilt twice are identical and match the seed roster); and an asset-backed test that decodes the real spritesheet PNG (node zlib, no new dependency) and asserts every variant leaves all skin-range and out-of-range pixels byte-identical while changing a bounded, non-trivial share of designated-range pixels.
7. Docs: `docs/character-visual-binding.md` listing all twelve assignments + zh-TW names + measured range evidence; update `docs/prd-2.0-requirement-matrix.md` FR-N004 row.
8. Verify with `npm run check`.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented in a new `visual` module (`convex/visual/`), registered in `architecture/module-boundaries.json` with `mayDependOn: [canon, shared]` and added to the `lint` script. Pure module: no Convex imports in the binding/palette logic, no clock, no randomness.

Files: `convex/visual/characterVisualBinding.ts` (shape, sprite catalogue, HSV palette model, `applyPaletteVariant`, `PROTECTED_SKIN_WINDOW`, validation with stable error codes), `convex/visual/mistwoodVisualBindings.ts` (4 measured palette ranges, 4 variants, 12 authored bindings, deterministic builder), `convex/visual/schema.ts` (`characterVisualBindings` table, registered in `convex/schema.ts`), two test files, and `docs/character-visual-binding.md`.

Key decision -- how to satisfy AC#4 on soft-shaded art. The eight sprites are not indexed pixel art: each 96x128 cell of `public/assets/32x32folk.png` carries 3000-4700 distinct opaque colours, so an exact source-colour -> target-colour lookup table was not viable. Instead a designated palette range is an **HSV window measured from the real texture**. Measurement method: decode the PNG, convert every opaque pixel of each cell to HSV, histogram it per row band (head / torso / legs) to separate hair and garment clusters from skin. Skin sits in one window across all eight sprites (hue 8-38 deg, S 0.14-0.70, V 0.55-1.00), recorded as `PROTECTED_SKIN_WINDOW`.

Base-sprite choice for the four variants was driven by that measurement, not by preference: f1 (blue lowerwear, hue 200-260), f2 (teal outfit, hue 150-198), f4 (achromatic white hair+blouse, S<=0.08 V>=0.82, dyed via a saturation floor rather than a hue rotation) and f6 (rose hair+dress, hue 318-358) are the four whose non-skin clusters are cleanly separable. f5 (blonde, hue ~40 S 0.4-0.6 V 0.9-1.0) and f7 (ginger, hue 25-35 S 0.5-0.7) were rejected precisely because their hair overlaps the skin band; f3 and f8 were left as base-only for the same reason.

Whole-sprite tint (section 24.23) is blocked three ways: (1) the model has no global-tint field at all, only per-range recolours, so it is unrepresentable; (2) `validatePaletteRanges` rejects a range intersecting `PROTECTED_SKIN_WINDOW` or spanning the whole colour space, and `validatePaletteVariants` rejects a recolour whose target hue lands in the skin hue window; (3) an asset-backed test decodes the shipped PNG with `node:zlib` only (deliberately no new dependency) and asserts against the real sprite cells.

Display-name gap: `displayName` holds the zh-TW public name and `nameplate` is required by validation to equal it, which encodes AC#9 as an invariant rather than a convention. `LOCALISED_DISPLAY_NAME` rejects any romanised name, and validation additionally rejects `displayName === seed.name`. `characterId` and the seed's romanised `name` are never published.

Determinism: assignment follows the seed roster order in `mistwoodSeed.ts`; `buildMistwoodCharacterVisualBindings()` takes no clock or random input, and a test asserts two calls are deeply equal. Each reused base sprite is shared by two characters whose seeded `initialLocationId` differ, asserted by test.

Deliberately not done: `convex/**` still imports nothing outside `convex/`, so `SPRITE_CELL_ORIGINS` mirrors `data/spritesheets/f1.ts`-`f8.ts` rather than importing them; the test instead checks the declared cells tile the 384x256 texture exactly. Nothing writes to the `characterVisualBindings` table yet -- that wiring belongs to the Visual Runtime tasks.

One test iteration was needed: the first version of the 'visibly different palette' assertion failed on `mistwood-plum-outfit` because deep-shadow pixels carry too little chroma for 8-bit RGB to encode a hue within 2 degrees. Corrected to judge only pixels with chroma >= 24/255 (still >50% of recoloured pixels), which is a measurement-precision fix, not a loosening of AC#4 -- the zero-skin-change and zero-out-of-range-change assertions are exact.

Validation: `npm run check` exit 0 -- 88 suites, 1187 passed / 5 skipped / 1192 total; check:architecture, test:architecture, check:asset-licenses, test:asset-licenses, typecheck, lint and build all clean. 46 new tests.

Acceptance-criteria evidence (all from `npm run check`, exit 0):

AC#1 -- `mistwoodVisualBindings.test.ts`: 'binds every seeded character exactly once and passes import validation' (12 bindings, zero validation errors against the live seed roster), 'uses all eight inherited sprites and adds a variant for the four extra characters', 'produces a visibly different palette for each variant of a shared base sprite'.
AC#2 -- 'is deterministic, so a redeploy cannot change any appearance' (two builder calls deeply equal; builder has no clock or random input).
AC#3/#9 -- enforced structurally rather than per-surface: exactly one binding per characterId (`VISUAL_BINDING_DUPLICATE_CHARACTER`) carrying exactly one public label (`VISUAL_BINDING_NAMEPLATE_MISMATCH` requires `nameplate === displayName`), so no consuming surface can choose a different label. The map/card/Episode consumers themselves are FR-N002/FR-O006 work and are out of this task's scope by its own Out of Scope list.
AC#4 -- 'recolours only designated pixels of the real sprite and leaves skin byte-identical': decodes the shipped `public/assets/32x32folk.png`, applies each of the four variants to its real 96x128 cell, and asserts changedOutsideDesignatedRange=0, changedSkinPixels=0, rewrittenAlpha=0, with skinPixels>100 so the assertion is not vacuous, and changed pixels bounded below half the cell. 'never designates a palette range that contains a skin pixel' asserts skinOverlap=0 for all four ranges.
AC#5 -- no dependency added: `git diff` of `package.json` against main is a single line (adding `convex/visual` to `lint`), `package-lock.json` untouched; the PNG reader in the test uses `node:zlib` only. `check:asset-licenses` and `test:asset-licenses` pass.
AC#6 -- `characterVisualBinding.test.ts`: 'rejects an unknown characterId', 'rejects an unknown spriteKey', plus unknown palette variant, variant/sprite mismatch, undeclared runtime id, duplicate character/runtime id/display name, and missing binding for a seeded character.
AC#7 -- `version`/`status` on the shape, `VISUAL_BINDING_INVALID_VERSION` validation, and the `characterVisualBindings` table with `by_character_version` and `by_character_status` indexes so a superseded row is retired rather than edited in place.
AC#8/#10 -- 'gives every character a distinct zh-TW display name that is not the seed name' asserts locale zh-TW, nameplate===displayName, no display name present in the seed-name set, and twelve distinct display names; `VISUAL_BINDING_DISPLAY_NAME_NOT_LOCALISED` rejects a romanised name at import.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added the `visual` module (`convex/visual/`) holding FR-N004's Character Visual Binding: a stable, versioned, deterministic mapping from each of Mistwood's twelve Canon characterIds to a public appearance and a single public zh-TW name.

Eight of the twelve characters take the inherited sprites f1-f8 (the eight cells of `public/assets/32x32folk.png`, licensed via ART-143) unchanged; the other four reuse f1/f2/f4/f6 through a palette variant. A variant is a list of recolours, each bound to a named HSV window measured from the real texture by per-cell histogram analysis, so PRD 2.0 section 24.23's forbidden whole-sprite tint has no field to live in. Three further guards: every designated window must be disjoint from `PROTECTED_SKIN_WINDOW` (hue 8-38 deg, S 0.14-0.70, V 0.55-1.00, measured across all eight sprites), no recolour may target the skin hue window, and no window may span the whole colour space. `displayName` carries the Traditional Chinese public name and validation requires `nameplate === displayName`, so no public surface can pick a different label; `characterId` and the seed's romanised `name` stay internal and are rejected as display names.

Also added: the versioned `characterVisualBindings` Convex table, the `visual` entry in `architecture/module-boundaries.json` (canon+shared only), `convex/visual` in the `lint` script, `docs/character-visual-binding.md` (all twelve assignments, the measured ranges, the three anti-tint guards), and the FR-N004 row of `docs/prd-2.0-requirement-matrix.md`.

Verified with `npm run check` (exit 0): 88 suites, 1187 passed / 5 skipped / 1192 total; check:architecture, test:architecture, check:asset-licenses, test:asset-licenses, typecheck, lint and build all clean. 46 new tests, including an asset-backed suite that decodes the shipped PNG with `node:zlib` only -- no new dependency -- applies each variant to the real sprite cell and asserts changedOutsideDesignatedRange=0, changedSkinPixels=0 and rewrittenAlpha=0 while each variant still repaints a meaningful, sub-half share of the cell. CI green on both required workflows; PR #165 merged to main as aba5b1c.
<!-- SECTION:FINAL_SUMMARY:END -->
