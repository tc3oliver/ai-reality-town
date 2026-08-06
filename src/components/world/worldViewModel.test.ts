/**
 * Unit tests for the read-only world view model (ART-113, FR-N002 AC#1).
 *
 * Pure jest (no jsdom): the module under test resolves published motion to
 * sprite poses and touches neither Pixi nor the DOM, which is exactly why the
 * renderer's frame decisions can be asserted without a browser.
 */

import { mistwoodWorldMap, MISTWOOD_TILE_DIM } from '../../../data/mistwood';
import {
  composeReadOnlyWorldViewModel,
  motionProgress,
  type PublicCharacterMotion,
} from './worldViewModel';

function motion(overrides: Partial<PublicCharacterMotion> = {}): PublicCharacterMotion {
  return {
    characterId: 'cassia',
    semanticLocationId: 'mistwood-market',
    motionType: 'canon',
    motionSequence: 1,
    from: { x: 10, y: 10 },
    to: { x: 20, y: 10 },
    startedAt: 1_000,
    arriveAt: 2_000,
    animationState: 'walking',
    direction: 'right',
    ...overrides,
  };
}

const SPRITE_KEYS = { cassia: 'f1', rowan: 'f2' };

describe('composeReadOnlyWorldViewModel', () => {
  test('renders the Mistwood map at its pixel size', () => {
    const vm = composeReadOnlyWorldViewModel({
      map: mistwoodWorldMap,
      motions: [],
      spriteKeys: SPRITE_KEYS,
      nowMs: 0,
    });

    expect(vm.map).toBe(mistwoodWorldMap);
    expect(vm.worldWidth).toBe(mistwoodWorldMap.width * MISTWOOD_TILE_DIM);
    expect(vm.worldHeight).toBe(mistwoodWorldMap.height * MISTWOOD_TILE_DIM);
    // The map alone is a valid frame: motion data is FR-N003 work that has not
    // shipped yet, and its absence must not stop the world from rendering.
    expect(vm.characters).toEqual([]);
  });

  test('renders a character sprite at the interpolated pixel position', () => {
    const vm = composeReadOnlyWorldViewModel({
      map: mistwoodWorldMap,
      motions: [motion()],
      spriteKeys: SPRITE_KEYS,
      nowMs: 1_500,
    });

    expect(vm.characters).toEqual([
      {
        characterId: 'cassia',
        spriteKey: 'f1',
        x: 15 * MISTWOOD_TILE_DIM,
        y: 10 * MISTWOOD_TILE_DIM,
        orientation: 0,
        isMoving: true,
        isSpeaking: false,
        isThinking: false,
      },
    ]);
  });

  test('clamps progress to the published window instead of extrapolating', () => {
    const walk = motion();
    expect(motionProgress(walk, 0)).toBe(0);
    expect(motionProgress(walk, 1_250)).toBe(0.25);
    expect(motionProgress(walk, 99_999)).toBe(1);
    // A zero-length window is "already arrived", not a division by zero.
    expect(motionProgress(motion({ startedAt: 5, arriveAt: 5 }), 0)).toBe(1);

    const [character] = composeReadOnlyWorldViewModel({
      map: mistwoodWorldMap,
      motions: [walk],
      spriteKeys: SPRITE_KEYS,
      nowMs: 99_999,
    }).characters;
    expect(character.x).toBe(20 * MISTWOOD_TILE_DIM);
    // An arrived walk stops animating even though the projection still calls
    // it `walking`, so a stale snapshot cannot moonwalk forever.
    expect(character.isMoving).toBe(false);
  });

  test('keeps positions inside the map when a projection is out of range', () => {
    const [character] = composeReadOnlyWorldViewModel({
      map: mistwoodWorldMap,
      motions: [motion({ from: { x: -50, y: -50 }, to: { x: 999, y: 999 } })],
      spriteKeys: SPRITE_KEYS,
      nowMs: 99_999,
    }).characters;

    expect(character.x).toBe((mistwoodWorldMap.width - 1) * MISTWOOD_TILE_DIM);
    expect(character.y).toBe((mistwoodWorldMap.height - 1) * MISTWOOD_TILE_DIM);
  });

  test('maps direction and animation state onto the sprite sheet', () => {
    const poses = (['right', 'down', 'left', 'up'] as const).map(
      (direction) =>
        composeReadOnlyWorldViewModel({
          map: mistwoodWorldMap,
          motions: [motion({ direction })],
          spriteKeys: SPRITE_KEYS,
          nowMs: 1_500,
        }).characters[0].orientation,
    );
    expect(poses).toEqual([0, 90, 180, 270]);

    const speaking = composeReadOnlyWorldViewModel({
      map: mistwoodWorldMap,
      motions: [motion({ animationState: 'speaking' })],
      spriteKeys: SPRITE_KEYS,
      nowMs: 1_500,
    }).characters[0];
    expect(speaking).toMatchObject({ isSpeaking: true, isThinking: false, isMoving: false });

    const thinking = composeReadOnlyWorldViewModel({
      map: mistwoodWorldMap,
      motions: [motion({ animationState: 'thinking' })],
      spriteKeys: SPRITE_KEYS,
      nowMs: 1_500,
    }).characters[0];
    expect(thinking).toMatchObject({ isThinking: true, isSpeaking: false, isMoving: false });
  });

  test('keeps only the latest motion per character and draws back to front', () => {
    const vm = composeReadOnlyWorldViewModel({
      map: mistwoodWorldMap,
      motions: [
        motion({ characterId: 'cassia', motionSequence: 2, from: { x: 4, y: 30 }, to: { x: 4, y: 30 } }),
        motion({ characterId: 'cassia', motionSequence: 1, from: { x: 0, y: 0 }, to: { x: 0, y: 0 } }),
        motion({ characterId: 'rowan', motionSequence: 7, from: { x: 9, y: 2 }, to: { x: 9, y: 2 } }),
      ],
      spriteKeys: SPRITE_KEYS,
      nowMs: 2_000,
    });

    expect(vm.characters.map((character) => character.characterId)).toEqual(['rowan', 'cassia']);
    expect(vm.characters[1].y).toBe(30 * MISTWOOD_TILE_DIM);
  });

  test('drops characters that have no visual binding', () => {
    const vm = composeReadOnlyWorldViewModel({
      map: mistwoodWorldMap,
      motions: [motion({ characterId: 'unbound-character' })],
      spriteKeys: SPRITE_KEYS,
      nowMs: 1_500,
    });

    expect(vm.characters).toEqual([]);
  });
});
