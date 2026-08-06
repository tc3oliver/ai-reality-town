# Character Visual Binding (FR-N004 / ART-111)

Authoritative reference for how each of Mistwood's twelve seeded characters is
given a stable public appearance and a stable public name.

- Shape and rules: `convex/visual/characterVisualBinding.ts`
- Authored data: `convex/visual/mistwoodVisualBindings.ts`
- Persisted table: `convex/visual/schema.ts` (`characterVisualBindings`)
- Tests: `convex/visual/characterVisualBinding.test.ts`,
  `convex/visual/mistwoodVisualBindings.test.ts`

## 1. The gap this closes

Mistwood seeds **twelve** characters (`convex/canon/mistwoodSeed.ts`) but the
inherited art only ships **eight** character sprites, `f1`–`f8`, which are the
eight cells of one 384x256 texture, `public/assets/32x32folk.png` (licensing
resolved by ART-143; see `ASSETS-LICENSE.md`). PRD 2.0 §6 forbids introducing new
art or generated images in v1.

The four remaining characters therefore reuse a base sprite through a **palette
variant**: a recolour restricted to designated regions of that sprite's palette.
PRD 2.0 §24.23 forbids tinting the whole sprite, because a single tint would move
skin, hair and clothing together.

## 2. The twelve bindings

`displayName` is the only public label. `nameplate` is required to equal it, so
the map nameplate, the character card and Episode/Story Arc references cannot
drift apart. The seed's romanised `name` and the `characterId` stay internal and
are never published.

| # | characterId (internal) | seed name (internal) | displayName / nameplate (public, zh-TW) | spriteKey | paletteVariant |
|---|---|---|---|---|---|
| 1 | `lin-yingxue` | Lin Yingxue | 林映雪 | `f1` | `base` |
| 2 | `gao-wenrui` | Gao Wenrui | 高文睿 | `f2` | `base` |
| 3 | `su-meizhen` | Su Meizhen | 蘇美珍 | `f3` | `base` |
| 4 | `he-jun` | He Jun | 何俊 | `f4` | `base` |
| 5 | `qiu-an` | Qiu An | 邱安 | `f5` | `base` |
| 6 | `luo-shan` | Luo Shan | 羅山 | `f6` | `base` |
| 7 | `tang-ruoxi` | Tang Ruoxi | 唐若曦 | `f7` | `base` |
| 8 | `shen-kai` | Shen Kai | 沈凱 | `f8` | `base` |
| 9 | `pei-lan` | Pei Lan | 裴嵐 | `f1` | `mistwood-jade-lowerwear` |
| 10 | `wu-zhen` | Wu Zhen | 吳臻 | `f2` | `mistwood-plum-outfit` |
| 11 | `fang-yue` | Fang Yue | 方悅 | `f4` | `mistwood-lilac-hair` |
| 12 | `zhao-ming` | Zhao Ming | 趙銘 | `f6` | `mistwood-indigo-hair` |

`locale` is `zh-TW` for all twelve (the only supported locale in v1).
`portraitFrame` is `0`, the front-facing `down` frame.
`runtimeId` is derived, `mistwood#runtime#<characterId>`; `id` is
`mistwood#visual#<characterId>`.

Assignment follows the seed roster order and is therefore deterministic: a
redeploy rebuilds exactly the same twelve rows. Each reused base sprite is shared
by two characters whose seeded initial locations differ (`mistwood-paper` vs
`mistwood-hall`, `mistwood-hall` vs `mistwood-station`, `mistwood-mill` vs
`mistwood-square`, `mistwood-inn` vs `mistwood-mill`), so a pair is unlikely to
appear side by side.

## 3. Designated palette ranges

Every sprite cell of `public/assets/32x32folk.png` was converted to HSV and
histogrammed to find the clusters that belong to hair or garment rather than
skin. Skin sits in one window across all eight sprites, recorded as
`PROTECTED_SKIN_WINDOW` (hue 8–38°, saturation 0.14–0.70, value 0.55–1.00).

| range id | sprite | covers | hue | saturation | value | measured pixels (of opaque cell) |
|---|---|---|---|---|---|---|
| `f1-lowerwear-blue` | `f1` | clothing | 200–260° | 0.15–0.80 | 0.55–1.00 | 648 / 4903 |
| `f2-outfit-teal` | `f2` | clothing | 150–198° | 0.18–0.85 | 0.18–0.85 | 799 / 4321 |
| `f4-white-hair-and-blouse` | `f4` | hair + clothing | any | 0.00–0.08 | 0.82–1.00 | 1848 / 5003 |
| `f6-rose-hair-and-dress` | `f6` | hair + clothing | 318–358° | 0.12–0.90 | 0.35–1.00 | 3012 / 5181 |

Each window is disjoint from `PROTECTED_SKIN_WINDOW`;
`validatePaletteRanges` rejects any range that is not, and
`mistwoodVisualBindings.test.ts` re-measures it against the shipped PNG.

`f4-white-hair-and-blouse` is achromatic, so its recolour dyes it through a
saturation floor instead of a hue rotation.

## 4. The four palette variants

| variant id | base | label | target hue | saturation floor | value scale |
|---|---|---|---|---|---|
| `mistwood-jade-lowerwear` | `f1` | 青碧下著 | 152° | 0.20 | 0.90 |
| `mistwood-plum-outfit` | `f2` | 梅紫外衣 | 288° | 0.22 | 1.00 |
| `mistwood-lilac-hair` | `f4` | 淺紫髮色 | 268° | 0.34 | 0.94 |
| `mistwood-indigo-hair` | `f6` | 靛藍髮色 | 236° | 0.20 | 1.00 |

`applyPaletteVariant()` moves matched pixels onto the target hue while keeping
each pixel's own saturation and value, which preserves the sprite's shading. It
copies every other pixel byte for byte and never touches alpha.

## 5. Why a whole-sprite tint cannot happen

Three independent guards:

1. **The model has no global tint.** A variant is a list of recolours, each bound
   to a named range. There is no field that applies to the whole sprite, so
   §24.23's forbidden case is unrepresentable rather than merely discouraged.
2. **Validation.** `validatePaletteRanges` rejects a range that intersects
   `PROTECTED_SKIN_WINDOW` (`PALETTE_RANGE_OVERLAPS_PROTECTED_SKIN`) or that
   spans the whole colour space (`PALETTE_RANGE_TOO_BROAD`).
   `validatePaletteVariants` rejects a recolour whose target hue lands in the
   protected skin hue window (`PALETTE_RECOLOUR_TARGETS_PROTECTED_SKIN`).
3. **Asset-backed test.** `mistwoodVisualBindings.test.ts` decodes the real PNG
   (`node:zlib` only, no new dependency), applies each variant to the real sprite
   cell and asserts that no pixel outside a designated range changed, that no
   skin pixel changed, that alpha never changed, and that each variant still
   repaints a meaningful but sub-half share of the cell.

## 6. Import validation

`validateCharacterVisualBindings()` returns stable error codes rather than
messages. It rejects, among others:

- `VISUAL_BINDING_UNKNOWN_CHARACTER` / `VISUAL_BINDING_MISSING_CHARACTER` — the
  binding set must match the seed roster exactly.
- `VISUAL_BINDING_UNKNOWN_SPRITE_KEY` — only `f1`–`f8` exist.
- `VISUAL_BINDING_UNKNOWN_PALETTE_VARIANT` and
  `VISUAL_BINDING_PALETTE_VARIANT_SPRITE_MISMATCH`.
- `VISUAL_BINDING_NAMEPLATE_MISMATCH` — nameplate must equal displayName.
- `VISUAL_BINDING_DISPLAY_NAME_NOT_LOCALISED` — the display name must be a
  localised name, never the seed's romanised `name`.
- `VISUAL_BINDING_UNSUPPORTED_LOCALE`, `VISUAL_BINDING_INVALID_PORTRAIT_FRAME`,
  `VISUAL_BINDING_INVALID_VERSION`, `VISUAL_BINDING_INVALID_IDENTIFIER`,
  and the duplicate-character / runtime-id / display-name codes.

## 7. Versioning, audit and public state

Persisted rows carry `version`, `status` (`active` / `retired`) and
`createdAt`/`updatedAt`. An appearance change writes a new version and retires
the previous row instead of editing it, so what the public saw stays
reconstructable.

`publicVariant` (`default` / `inactive` / `memorial`) is the separate switch for
FR-N004 AC#7: when a character is deactivated or dies, the renderer changes
presentation without touching the identity fields.

## 8. Out of scope here

The animation state machine (FR-O002), the character card UI (FR-O006), movement
and the runtime projection wiring are separate tasks. This document only fixes
the binding itself.

Note that `SPRITE_CELL_ORIGINS` in `characterVisualBinding.ts` mirrors the frame
coordinates in `data/spritesheets/f1.ts`–`f8.ts`; those inherited files are
frozen art data and are not imported from `convex/` so that the Convex module
tree stays self-contained.
