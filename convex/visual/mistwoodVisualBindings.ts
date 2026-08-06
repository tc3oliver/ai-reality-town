/**
 * The authored Character Visual Binding set for Mistwood (FR-N004).
 *
 * Pure data plus one deterministic builder. Nothing here reads a clock or a
 * random source, so `buildMistwoodCharacterVisualBindings()` returns the same
 * twelve bindings on every deploy (AC#2).
 *
 * ## Assignment rule
 *
 * Bindings follow the seed roster order in `convex/canon/mistwoodSeed.ts`: the
 * first eight characters take the eight inherited sprites `f1`–`f8` unchanged,
 * and the last four reuse `f1`, `f2`, `f4` and `f6` through a palette variant.
 * Each reused sprite is shared by two characters whose seeded initial locations
 * differ, so the pair is unlikely to stand in one another's frame.
 *
 * ## Where the palette windows come from
 *
 * Each {@link PaletteRange} window below was measured from the real texture
 * `public/assets/32x32folk.png` by converting every opaque pixel of the sprite's
 * 96x128 cell to HSV and reading off the cluster that covers the hair or the
 * garment. The recorded pixel counts are reproduced by
 * `mistwoodVisualBindings.test.ts`, which decodes the same PNG and asserts that
 * none of the matched pixels is skin.
 */

import { MISTWOOD_PUBLIC_WORLD_ID } from '../canon/mistwoodSeed';
import {
  BASE_PALETTE_VARIANT,
  CHARACTER_VISUAL_BINDING_SCHEMA_VERSION,
  DEFAULT_PORTRAIT_FRAME,
  deriveRuntimeId,
  deriveVisualBindingId,
  type CharacterVisualBindingV1,
  type PaletteRange,
  type PaletteVariant,
  type SpriteKey,
} from './characterVisualBinding';

export const MISTWOOD_VISUAL_BINDING_VERSION = 1;

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

/**
 * `characterId`, public zh-TW `displayName`, base sprite, palette variant.
 *
 * The seed's romanised `name` (`Lin Yingxue`, …) stays an internal identifier
 * and is never published; the display name here is the only public label
 * (AC#8, AC#10).
 */
const MISTWOOD_VISUAL_ROSTER: readonly [string, string, SpriteKey, string][] = [
  ['lin-yingxue', '林映雪', 'f1', BASE_PALETTE_VARIANT],
  ['gao-wenrui', '高文睿', 'f2', BASE_PALETTE_VARIANT],
  ['su-meizhen', '蘇美珍', 'f3', BASE_PALETTE_VARIANT],
  ['he-jun', '何俊', 'f4', BASE_PALETTE_VARIANT],
  ['qiu-an', '邱安', 'f5', BASE_PALETTE_VARIANT],
  ['luo-shan', '羅山', 'f6', BASE_PALETTE_VARIANT],
  ['tang-ruoxi', '唐若曦', 'f7', BASE_PALETTE_VARIANT],
  ['shen-kai', '沈凱', 'f8', BASE_PALETTE_VARIANT],
  ['pei-lan', '裴嵐', 'f1', 'mistwood-jade-lowerwear'],
  ['wu-zhen', '吳臻', 'f2', 'mistwood-plum-outfit'],
  ['fang-yue', '方悅', 'f4', 'mistwood-lilac-hair'],
  ['zhao-ming', '趙銘', 'f6', 'mistwood-indigo-hair'],
];

/**
 * Build the twelve Mistwood bindings.
 *
 * Deterministic: the output depends only on {@link MISTWOOD_VISUAL_ROSTER}, so
 * two calls — and two deploys — are deeply equal.
 */
export function buildMistwoodCharacterVisualBindings(
  worldId: string = MISTWOOD_PUBLIC_WORLD_ID,
): CharacterVisualBindingV1[] {
  return MISTWOOD_VISUAL_ROSTER.map(([characterId, displayName, spriteKey, paletteVariant]) => ({
    schemaVersion: CHARACTER_VISUAL_BINDING_SCHEMA_VERSION,
    id: deriveVisualBindingId(worldId, characterId),
    worldId,
    characterId,
    runtimeId: deriveRuntimeId(worldId, characterId),
    spriteKey,
    paletteVariant,
    nameplate: displayName,
    portraitFrame: DEFAULT_PORTRAIT_FRAME,
    displayName,
    locale: 'zh-TW',
    publicVariant: 'default',
    status: 'active',
    version: MISTWOOD_VISUAL_BINDING_VERSION,
  }));
}
