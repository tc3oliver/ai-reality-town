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
 * Each `PaletteRange` window was measured from the real texture
 * `public/assets/32x32folk.png` by converting every opaque pixel of the sprite's
 * 96x128 cell to HSV and reading off the cluster that covers the hair or the
 * garment. The recorded pixel counts are reproduced by
 * `mistwoodVisualBindings.test.ts`, which decodes the same PNG and asserts that
 * none of the matched pixels is skin.
 *
 * ## Where the data lives now
 *
 * ART-119 (FR-O002) moved the roster, the palette ranges and the palette
 * variants to `data/mistwoodCharacters.ts`, because the live map has to resolve
 * `characterId -> sprite` in the browser and this file's `mistwoodSeed` import
 * makes it unreachable from client code by design: the seed carries
 * `privateProfile`, `privateGoal`, `fear` and `secretContents` for every
 * resident, so `clientWorldReadOnly` and `clientLive` must never be allowed to
 * depend on `visual`. What is left here is the part that genuinely needs Canon —
 * binding the public roster to a world id — plus re-exports, so every backend
 * caller is untouched.
 */

import { MISTWOOD_PUBLIC_WORLD_ID } from '../canon/mistwoodSeed';
import { MISTWOOD_CHARACTER_VISUALS } from '../../data/mistwoodCharacters';
import {
  CHARACTER_VISUAL_BINDING_SCHEMA_VERSION,
  DEFAULT_PORTRAIT_FRAME,
  deriveRuntimeId,
  deriveVisualBindingId,
  type CharacterVisualBindingV1,
} from './characterVisualBinding';

export const MISTWOOD_VISUAL_BINDING_VERSION = 1;

export {
  MISTWOOD_PALETTE_RANGES,
  MISTWOOD_PALETTE_VARIANTS,
} from '../../data/mistwoodCharacters';

/**
 * Build the twelve Mistwood bindings.
 *
 * Deterministic: the output depends only on `MISTWOOD_CHARACTER_VISUALS`, so
 * two calls — and two deploys — are deeply equal.
 *
 * The seed's romanised `name` (`Lin Yingxue`, …) stays an internal identifier
 * and is never published; the roster's `displayName` is the only public label
 * (AC#8, AC#10).
 */
export function buildMistwoodCharacterVisualBindings(
  worldId: string = MISTWOOD_PUBLIC_WORLD_ID,
): CharacterVisualBindingV1[] {
  return MISTWOOD_CHARACTER_VISUALS.map((visual) => ({
    schemaVersion: CHARACTER_VISUAL_BINDING_SCHEMA_VERSION,
    id: deriveVisualBindingId(worldId, visual.characterId),
    worldId,
    characterId: visual.characterId,
    runtimeId: deriveRuntimeId(worldId, visual.characterId),
    spriteKey: visual.spriteKey,
    paletteVariant: visual.paletteVariant,
    nameplate: visual.displayName,
    portraitFrame: DEFAULT_PORTRAIT_FRAME,
    displayName: visual.displayName,
    locale: 'zh-TW',
    publicVariant: 'default',
    status: 'active',
    version: MISTWOOD_VISUAL_BINDING_VERSION,
  }));
}
