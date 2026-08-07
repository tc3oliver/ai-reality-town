/**
 * The mirrored public roster cannot drift from the authored bindings (ART-119 / FR-O002 AC#1).
 *
 * `data/mistwoodCharacters.ts` exists so the browser can resolve
 * `characterId -> sprite` without importing `convex/visual/`, which transitively
 * carries private Canon data. A mirror is only safe if something proves it is
 * still a mirror, which is what this file is: it imports the authored bindings
 * (legal here, because a test never ships to the browser) and asserts the two
 * agree row for row.
 *
 * It doubles as the "the relocation changed nothing" proof for Phase 1 of
 * ART-119: `convex/visual/` now re-exports the moved palette engine and roster,
 * so `validateCharacterVisualBindings` still returning `[]` over the real
 * authoring set means the move was behaviour-preserving.
 */

import { mistwoodCharacterSeed } from '../convex/canon/mistwoodSeed';
import {
  BASE_PALETTE_VARIANT,
  validateCharacterVisualBindings,
} from '../convex/visual/characterVisualBinding';
import {
  buildMistwoodCharacterVisualBindings,
  MISTWOOD_PALETTE_RANGES as BOUND_RANGES,
  MISTWOOD_PALETTE_VARIANTS as BOUND_VARIANTS,
} from '../convex/visual/mistwoodVisualBindings';
import { MISTWOOD_SEED_PLACEMENTS } from '../convex/visualRuntime/fixtures';
import {
  MISTWOOD_CHARACTER_VISUALS,
  MISTWOOD_PALETTE_RANGES,
  MISTWOOD_PALETTE_VARIANTS,
  mistwoodCharacterSpriteKeys,
  mistwoodSpriteAssetSources,
  paletteVariantById,
  spriteAssetKey,
} from './mistwoodCharacters';
import { SPRITE_KEYS, spriteSheetData } from './spritesheets/catalogue';

describe('the mirrored Mistwood character roster', () => {
  test('matches the authored visual bindings row for row', () => {
    const authored = buildMistwoodCharacterVisualBindings();
    expect(
      MISTWOOD_CHARACTER_VISUALS.map((visual) => ({
        characterId: visual.characterId,
        displayName: visual.displayName,
        spriteKey: visual.spriteKey,
        paletteVariant: visual.paletteVariant,
      })),
    ).toEqual(
      authored.map((binding) => ({
        characterId: binding.characterId,
        displayName: binding.displayName,
        spriteKey: binding.spriteKey,
        paletteVariant: binding.paletteVariant,
      })),
    );
  });

  test('covers exactly the twelve seeded residents', () => {
    expect(MISTWOOD_CHARACTER_VISUALS).toHaveLength(12);
    expect(MISTWOOD_CHARACTER_VISUALS.map((visual) => visual.characterId)).toEqual(
      MISTWOOD_SEED_PLACEMENTS.map((placement) => placement.characterId),
    );
    // The placements themselves are a mirror of the seed, so anchor the chain to
    // the seed rather than to another mirror.
    expect(MISTWOOD_CHARACTER_VISUALS.map((visual) => visual.characterId)).toEqual(
      mistwoodCharacterSeed.characters.map((character) => character.id),
    );
  });

  test('publishes no private character field and no romanised seed name', () => {
    // The whole reason this file exists: the mirror must carry the four public
    // fields and nothing that travelled with them in the seed.
    const seedNames = new Set(mistwoodCharacterSeed.characters.map((character) => character.name));
    for (const visual of MISTWOOD_CHARACTER_VISUALS) {
      expect(Object.keys(visual).sort()).toEqual([
        'characterId', 'displayName', 'paletteVariant', 'spriteKey',
      ]);
      expect(seedNames.has(visual.displayName)).toBe(false);
    }
  });

  test('relocating the palette model to data/ left convex/visual re-exporting the same objects', () => {
    expect(BOUND_RANGES).toBe(MISTWOOD_PALETTE_RANGES);
    expect(BOUND_VARIANTS).toBe(MISTWOOD_PALETTE_VARIANTS);
  });

  test('the authored set still validates cleanly after the relocation', () => {
    expect(
      validateCharacterVisualBindings({
        bindings: buildMistwoodCharacterVisualBindings(),
        characters: mistwoodCharacterSeed.characters,
        ranges: MISTWOOD_PALETTE_RANGES,
        variants: MISTWOOD_PALETTE_VARIANTS,
        worldId: mistwoodCharacterSeed.worldId,
      }),
    ).toEqual([]);
  });
});

describe('sprite asset keys', () => {
  test('are injective over the roster: two characters share a key only when they share pixels', () => {
    const keys = MISTWOOD_CHARACTER_VISUALS.map((visual) =>
      spriteAssetKey(visual.spriteKey, visual.paletteVariant),
    );
    expect(new Set(keys).size).toBe(keys.length);
    expect(Object.keys(mistwoodCharacterSpriteKeys)).toHaveLength(12);
  });

  test('a base variant keys on the sprite alone, a palette variant on the variant', () => {
    expect(spriteAssetKey('f1', BASE_PALETTE_VARIANT)).toBe('f1');
    expect(spriteAssetKey('f1', 'mistwood-jade-lowerwear')).toBe('f1#mistwood-jade-lowerwear');
    expect(mistwoodCharacterSpriteKeys['lin-yingxue']).toBe('f1');
    expect(mistwoodCharacterSpriteKeys['pei-lan']).toBe('f1#mistwood-jade-lowerwear');
  });

  test('every asset key resolves to a real sprite sheet and, where needed, a real variant', () => {
    for (const [assetKey, source] of Object.entries(mistwoodSpriteAssetSources)) {
      expect(SPRITE_KEYS).toContain(source.spriteKey);
      expect(spriteSheetData[source.spriteKey]).toBeDefined();
      // Four directional walk cycles and nothing else: there is no speaking or
      // thinking frame in the inherited art, which is why FR-O002 draws those
      // states as vector indicators instead.
      expect(Object.keys(spriteSheetData[source.spriteKey].animations ?? {}).sort()).toEqual([
        'down', 'left', 'right', 'up',
      ]);
      if (source.paletteVariant === BASE_PALETTE_VARIANT) {
        expect(assetKey).toBe(source.spriteKey);
        expect(paletteVariantById(source.paletteVariant)).toBeUndefined();
      } else {
        const variant = paletteVariantById(source.paletteVariant);
        expect(variant).toBeDefined();
        expect(variant!.baseSpriteKey).toBe(source.spriteKey);
      }
    }
  });

  test('every seeded resident resolves to an asset key (AC#1: all twelve can display)', () => {
    for (const placement of MISTWOOD_SEED_PLACEMENTS) {
      const assetKey = mistwoodCharacterSpriteKeys[placement.characterId];
      expect(assetKey).toBeDefined();
      expect(mistwoodSpriteAssetSources[assetKey]).toBeDefined();
    }
  });
});
