/**
 * The public half of Mistwood's character visual identity (FR-O002 / ART-119).
 *
 * The live map has to know which sprite each of the twelve residents draws with.
 * That assignment is a compile-time constant — the same on every deploy, by
 * FR-N004 AC#2 — so it is shipped as data rather than fetched: a per-viewer round
 * trip would buy nothing, and there is no public query that carries it.
 *
 * ## Why it lives here and not in `convex/visual/`
 *
 * `convex/visual/mistwoodVisualBindings.ts` imports `convex/canon/mistwoodSeed.ts`
 * for the world id, and that seed carries `privateProfile`, `privateGoal`, `fear`
 * and `secretContents` for every resident. Letting `src/components/` depend on
 * `visual` would put all of it one bundler decision away from the browser, so
 * neither `clientWorldReadOnly` nor `clientLive` lists `visual` in `mayDependOn`
 * and neither ever will. `data/` is owned by no boundary module, which is exactly
 * how `convex/visual/mistwoodLocationBindings.ts` already reads `data/mistwood.ts`
 * today, so the shared constants sit here and both sides import them.
 *
 * ## What is and is not mirrored
 *
 * The roster below is a **mirror** of `MISTWOOD_VISUAL_ROSTER`, holding only the
 * four public fields; `mistwoodCharacters.test.ts` pins it against
 * `buildMistwoodCharacterVisualBindings()` so it cannot drift. The palette ranges
 * and variants are **moved**, not mirrored — `convex/visual/` re-exports them —
 * because duplicating a skin-protection colour model would mean maintaining two
 * of it.
 *
 * Nothing private is here: no `privateProfile`, no `privateGoal`, no `fear`, no
 * `secretContents`, no romanised seed name. `dataBoundary.test.ts` enforces that
 * this file imports nothing from `convex/canon`, `convex/visual` or
 * `convex/publicRead`.
 */

import {
  BASE_PALETTE_VARIANT,
  type PaletteRange,
  type PaletteVariant,
} from './spritePalette';
import type { SpriteKey } from './spritesheets/catalogue';

/**
 * Designated palette ranges. Every window is disjoint from
 * `PROTECTED_SKIN_WINDOW`, which `validatePaletteRanges` enforces.
 */
export const MISTWOOD_PALETTE_RANGES: readonly PaletteRange[] = [
  {
    id: 'f1-lowerwear-blue',
    spriteKey: 'f1',
    slot: 'clothing',
    description:
      "f1's blue lower garment. Measured: 648 of 4903 opaque cell pixels, confined to rows 15-27 of each 32px frame.",
    window: { hueStart: 200, hueEnd: 260, minSaturation: 0.15, maxSaturation: 0.8, minValue: 0.55, maxValue: 1 },
  },
  {
    id: 'f2-outfit-teal',
    spriteKey: 'f2',
    slot: 'clothing',
    description:
      "f2's teal coat and trousers. Measured: 799 of 4321 opaque cell pixels, rows 7-27.",
    window: { hueStart: 150, hueEnd: 198, minSaturation: 0.18, maxSaturation: 0.85, minValue: 0.18, maxValue: 0.85 },
  },
  {
    id: 'f4-white-hair-and-blouse',
    spriteKey: 'f4',
    slot: 'hair-and-clothing',
    description:
      "f4's white hair and blouse. Measured: 1848 of 5003 opaque cell pixels, rows 1-20. The cluster is achromatic, so its recolour dyes it through a saturation floor rather than a hue rotation.",
    window: { hueStart: 0, hueEnd: 360, minSaturation: 0, maxSaturation: 0.08, minValue: 0.82, maxValue: 1 },
  },
  {
    id: 'f6-rose-hair-and-dress',
    spriteKey: 'f6',
    slot: 'hair-and-clothing',
    description:
      "f6's rose hair and dress, which share one dye family. Measured: 3012 of 5181 opaque cell pixels, rows 2-30.",
    window: { hueStart: 318, hueEnd: 358, minSaturation: 0.12, maxSaturation: 0.9, minValue: 0.35, maxValue: 1 },
  },
];

/** The four authored palette variants, one per reused base sprite. */
export const MISTWOOD_PALETTE_VARIANTS: readonly PaletteVariant[] = [
  {
    id: 'mistwood-jade-lowerwear',
    baseSpriteKey: 'f1',
    label: '青碧下著',
    recolours: [{ rangeId: 'f1-lowerwear-blue', targetHue: 152, saturationScale: 1, minSaturation: 0.2, valueScale: 0.9 }],
  },
  {
    id: 'mistwood-plum-outfit',
    baseSpriteKey: 'f2',
    label: '梅紫外衣',
    recolours: [{ rangeId: 'f2-outfit-teal', targetHue: 288, saturationScale: 1, minSaturation: 0.22, valueScale: 1 }],
  },
  {
    id: 'mistwood-lilac-hair',
    baseSpriteKey: 'f4',
    label: '淺紫髮色',
    recolours: [{ rangeId: 'f4-white-hair-and-blouse', targetHue: 268, saturationScale: 1, minSaturation: 0.34, valueScale: 0.94 }],
  },
  {
    id: 'mistwood-indigo-hair',
    baseSpriteKey: 'f6',
    label: '靛藍髮色',
    recolours: [{ rangeId: 'f6-rose-hair-and-dress', targetHue: 236, saturationScale: 1, minSaturation: 0.2, valueScale: 1 }],
  },
];

/** One resident's public visual identity. */
export type MistwoodCharacterVisual = {
  characterId: string;
  /** The canonical public zh-TW label. The seed's romanised name is never published. */
  displayName: string;
  spriteKey: SpriteKey;
  /** {@link BASE_PALETTE_VARIANT} for a sprite used exactly as inherited. */
  paletteVariant: string;
};

/**
 * The twelve residents, in seed order.
 *
 * The first eight take the inherited sprites `f1`–`f8` unchanged; the last four
 * reuse `f1`, `f2`, `f4` and `f6` through a palette variant. Each reused sprite
 * is shared by two characters whose seeded initial locations differ, so the pair
 * is unlikely to stand in one another's frame.
 */
export const MISTWOOD_CHARACTER_VISUALS: readonly MistwoodCharacterVisual[] = [
  { characterId: 'lin-yingxue', displayName: '林映雪', spriteKey: 'f1', paletteVariant: BASE_PALETTE_VARIANT },
  { characterId: 'gao-wenrui', displayName: '高文睿', spriteKey: 'f2', paletteVariant: BASE_PALETTE_VARIANT },
  { characterId: 'su-meizhen', displayName: '蘇美珍', spriteKey: 'f3', paletteVariant: BASE_PALETTE_VARIANT },
  { characterId: 'he-jun', displayName: '何俊', spriteKey: 'f4', paletteVariant: BASE_PALETTE_VARIANT },
  { characterId: 'qiu-an', displayName: '邱安', spriteKey: 'f5', paletteVariant: BASE_PALETTE_VARIANT },
  { characterId: 'luo-shan', displayName: '羅山', spriteKey: 'f6', paletteVariant: BASE_PALETTE_VARIANT },
  { characterId: 'tang-ruoxi', displayName: '唐若曦', spriteKey: 'f7', paletteVariant: BASE_PALETTE_VARIANT },
  { characterId: 'shen-kai', displayName: '沈凱', spriteKey: 'f8', paletteVariant: BASE_PALETTE_VARIANT },
  { characterId: 'pei-lan', displayName: '裴嵐', spriteKey: 'f1', paletteVariant: 'mistwood-jade-lowerwear' },
  { characterId: 'wu-zhen', displayName: '吳臻', spriteKey: 'f2', paletteVariant: 'mistwood-plum-outfit' },
  { characterId: 'fang-yue', displayName: '方悅', spriteKey: 'f4', paletteVariant: 'mistwood-lilac-hair' },
  { characterId: 'zhao-ming', displayName: '趙銘', spriteKey: 'f6', paletteVariant: 'mistwood-indigo-hair' },
];

/**
 * The key a resolved texture is cached and looked up under.
 *
 * A base-variant character keys on its sprite alone, so the eight inherited
 * sprites are shared rather than resolved twelve times. A palette variant needs
 * its own recoloured texture, so it keys on the variant id. Injective over the
 * roster, which `mistwoodCharacters.test.ts` asserts: two characters may only
 * share a key when they genuinely draw the same pixels.
 */
export function spriteAssetKey(spriteKey: string, paletteVariant: string): string {
  return paletteVariant === BASE_PALETTE_VARIANT ? spriteKey : `${spriteKey}#${paletteVariant}`;
}

/**
 * `characterId -> asset key`, the lookup the view model resolves a sprite
 * through. A character absent from this map draws nothing rather than borrowing
 * another resident's appearance (FR-N004 AC#6).
 */
export const mistwoodCharacterSpriteKeys: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(
    MISTWOOD_CHARACTER_VISUALS.map((visual) => [
      visual.characterId,
      spriteAssetKey(visual.spriteKey, visual.paletteVariant),
    ]),
  ),
);

/** `asset key -> the sprite and variant it resolves to`, for the texture loader. */
export const mistwoodSpriteAssetSources: Readonly<
  Record<string, { spriteKey: SpriteKey; paletteVariant: string }>
> = Object.freeze(
  Object.fromEntries(
    MISTWOOD_CHARACTER_VISUALS.map((visual) => [
      spriteAssetKey(visual.spriteKey, visual.paletteVariant),
      { spriteKey: visual.spriteKey, paletteVariant: visual.paletteVariant },
    ]),
  ),
);

/** The palette variant an asset key needs, or `undefined` for a base sprite. */
export function paletteVariantById(variantId: string): PaletteVariant | undefined {
  return MISTWOOD_PALETTE_VARIANTS.find((variant) => variant.id === variantId);
}
