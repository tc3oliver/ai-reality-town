/**
 * Unit tests for the read-only world view model (ART-113 FR-N002 AC#1, ART-119 FR-O002).
 *
 * Pure jest (no jsdom): the module under test resolves published motion to
 * sprite poses and touches neither Pixi nor the DOM, which is exactly why the
 * renderer's frame decisions can be asserted without a browser.
 *
 * Every fixture id below is a production Mistwood seed id (ART-107 §8): a test
 * that walks `cassia` through `mistwood-market` proves nothing about a world
 * where neither exists.
 */

import { mistwoodWorldMap, MISTWOOD_TILE_DIM } from '../../../data/mistwood';
import {
  composeReadOnlyWorldViewModel,
  interpolatedTile,
  isWithinSegment,
  motionProgress,
  type PublicCharacterMotion,
} from './worldViewModel';

function motion(overrides: Partial<PublicCharacterMotion> = {}): PublicCharacterMotion {
  return {
    characterId: 'lin-yingxue',
    semanticLocationId: 'mistwood-paper',
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

const SPRITE_KEYS = { 'lin-yingxue': 'f1', 'wu-zhen': 'f2#mistwood-plum-outfit' };

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
    // The map alone is a valid frame: an empty projection must not stop the
    // world from rendering.
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
        characterId: 'lin-yingxue',
        spriteKey: 'f1',
        semanticLocationId: 'mistwood-paper',
        x: 15 * MISTWOOD_TILE_DIM,
        y: 10 * MISTWOOD_TILE_DIM,
        orientation: 0,
        animationState: 'walking',
        motionType: 'canon',
        isMoving: true,
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

  test('progress stays in [0,1] for every degenerate clock value (AC#6)', () => {
    const walk = motion();
    for (const nowMs of [-1e15, 0, 999, 1_000, 2_000, 1e15, Number.NaN, Infinity, -Infinity]) {
      const progress = motionProgress(walk, nowMs);
      expect(progress).toBeGreaterThanOrEqual(0);
      expect(progress).toBeLessThanOrEqual(1);
    }
  });

  test('keeps positions inside the map, bounded by tile centres not the last tile index', () => {
    const [character] = composeReadOnlyWorldViewModel({
      map: mistwoodWorldMap,
      motions: [motion({ from: { x: -50, y: -50 }, to: { x: 999, y: 999 } })],
      spriteKeys: SPRITE_KEYS,
      nowMs: 99_999,
    }).characters;

    expect(character.x).toBe(mistwoodWorldMap.width * MISTWOOD_TILE_DIM);
    expect(character.y).toBe(mistwoodWorldMap.height * MISTWOOD_TILE_DIM);
  });

  test('a character standing on the last column is not shunted half a tile inwards', () => {
    // Anchors are tile *centres* (`tile + 0.5`, see convex/visualRuntime/motion.ts),
    // so 47.5 is a legal position on a 48-wide map. Clamping to `width - 1` moved
    // every such character, silently and only on the map edge.
    const edgeX = mistwoodWorldMap.width - 0.5;
    const [character] = composeReadOnlyWorldViewModel({
      map: mistwoodWorldMap,
      motions: [motion({ from: { x: edgeX, y: 4.5 }, to: { x: edgeX, y: 4.5 } })],
      spriteKeys: SPRITE_KEYS,
      nowMs: 99_999,
    }).characters;
    expect(character.x).toBe(edgeX * MISTWOOD_TILE_DIM);
  });

  test('maps every direction onto the sprite sheet order (AC#4)', () => {
    const poses = (['right', 'down', 'left', 'up'] as const).map(
      (direction) =>
        composeReadOnlyWorldViewModel({
          map: mistwoodWorldMap,
          motions: [motion({ direction })],
          spriteKeys: SPRITE_KEYS,
          nowMs: 1_500,
        }).characters[0].orientation,
    );
    // `Character` reads `['right', 'down', 'left', 'up'][orientation / 90]`.
    expect(poses).toEqual([0, 90, 180, 270]);
  });

  test('a horizontal and a vertical walk really do face differently (AC#4)', () => {
    const walk = (overrides: Partial<PublicCharacterMotion>) =>
      composeReadOnlyWorldViewModel({
        map: mistwoodWorldMap,
        motions: [motion(overrides)],
        spriteKeys: SPRITE_KEYS,
        nowMs: 1_500,
      }).characters[0];

    const eastward = walk({ from: { x: 10, y: 10 }, to: { x: 20, y: 10 }, direction: 'right' });
    const southward = walk({ from: { x: 10, y: 10 }, to: { x: 10, y: 20 }, direction: 'down' });
    expect(eastward.orientation).not.toBe(southward.orientation);
    expect(eastward.isMoving).toBe(true);
    expect(southward.isMoving).toBe(true);
  });

  test('forwards the published animation state and motion type without flattening them (AC#3/#5)', () => {
    const state = (animationState: PublicCharacterMotion['animationState']) =>
      composeReadOnlyWorldViewModel({
        map: mistwoodWorldMap,
        motions: [motion({ animationState })],
        spriteKeys: SPRITE_KEYS,
        nowMs: 1_500,
      }).characters[0];

    expect(state('idle')).toMatchObject({ animationState: 'idle', isMoving: false });
    expect(state('walking')).toMatchObject({ animationState: 'walking', isMoving: true });
    expect(state('speaking')).toMatchObject({ animationState: 'speaking', isMoving: false });
    expect(state('thinking')).toMatchObject({ animationState: 'thinking', isMoving: false });
    expect(state('activity')).toMatchObject({ animationState: 'activity', isMoving: false });

    // FR-O011 (ambient) and FR-O013 (replay) are declared but not produced, and
    // this task renders them exactly as it renders `canon`.
    for (const motionType of ['canon', 'ambient', 'idle', 'replay'] as const) {
      const character = composeReadOnlyWorldViewModel({
        map: mistwoodWorldMap,
        motions: [motion({ motionType })],
        spriteKeys: SPRITE_KEYS,
        nowMs: 1_500,
      }).characters[0];
      expect(character.motionType).toBe(motionType);
      expect(character.x).toBe(15 * MISTWOOD_TILE_DIM);
    }
  });

  test('carries the semantic location through untouched by the clock (AC#7)', () => {
    const walk = motion({ semanticLocationId: 'mistwood-square' });
    for (const nowMs of [0, 1_000, 1_333, 1_667, 2_000, 9_999]) {
      const [character] = composeReadOnlyWorldViewModel({
        map: mistwoodWorldMap,
        motions: [walk],
        spriteKeys: SPRITE_KEYS,
        nowMs,
      }).characters;
      expect(character.semanticLocationId).toBe('mistwood-square');
    }
  });

  test('keeps only the latest motion per character and draws back to front', () => {
    const vm = composeReadOnlyWorldViewModel({
      map: mistwoodWorldMap,
      motions: [
        motion({ characterId: 'lin-yingxue', motionSequence: 2, from: { x: 4, y: 30 }, to: { x: 4, y: 30 } }),
        motion({ characterId: 'lin-yingxue', motionSequence: 1, from: { x: 0, y: 0 }, to: { x: 0, y: 0 } }),
        motion({ characterId: 'wu-zhen', motionSequence: 7, from: { x: 9, y: 2 }, to: { x: 9, y: 2 } }),
      ],
      spriteKeys: SPRITE_KEYS,
      nowMs: 2_000,
    });

    expect(vm.characters.map((character) => character.characterId)).toEqual([
      'wu-zhen',
      'lin-yingxue',
    ]);
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

describe('interpolatedTile (AC#2)', () => {
  test('walks monotonically from origin to destination', () => {
    const walk = motion({ from: { x: 4.5, y: 8.5 }, to: { x: 22.5, y: 8.5 } });
    const samples = [0, 0.25, 0.5, 0.75, 1].map((fraction) =>
      interpolatedTile(walk, walk.startedAt + (walk.arriveAt - walk.startedAt) * fraction),
    );

    expect(samples[0]).toEqual(walk.from);
    expect(samples[4]).toEqual(walk.to);
    for (let index = 1; index < samples.length; index++) {
      expect(samples[index].x).toBeGreaterThan(samples[index - 1].x);
    }
    expect(samples.every((point) => isWithinSegment(walk, point))).toBe(true);
  });

  test('a diagonal walk stays on its own chord', () => {
    const walk = motion({ from: { x: 4.5, y: 4.5 }, to: { x: 12.5, y: 20.5 } });
    for (let step = 0; step <= 40; step++) {
      const point = interpolatedTile(walk, walk.startedAt + (step / 40) * 1_000);
      expect(isWithinSegment(walk, point)).toBe(true);
    }
  });

  test('parks at the origin before the window and at the destination after it', () => {
    const walk = motion();
    expect(interpolatedTile(walk, -5_000)).toEqual(walk.from);
    expect(interpolatedTile(walk, 5_000_000)).toEqual(walk.to);
  });
});

describe('isWithinSegment (AC#6: characters never teleport)', () => {
  const walk = motion({ from: { x: 4, y: 4 }, to: { x: 12, y: 4 } });

  test('accepts both endpoints and the interior', () => {
    expect(isWithinSegment(walk, { x: 4, y: 4 })).toBe(true);
    expect(isWithinSegment(walk, { x: 8, y: 4 })).toBe(true);
    expect(isWithinSegment(walk, { x: 12, y: 4 })).toBe(true);
  });

  test('rejects a point beside the line, past either end, or not a number', () => {
    expect(isWithinSegment(walk, { x: 8, y: 5 })).toBe(false);
    expect(isWithinSegment(walk, { x: 13, y: 4 })).toBe(false);
    expect(isWithinSegment(walk, { x: 3, y: 4 })).toBe(false);
    expect(isWithinSegment(walk, { x: Number.NaN, y: 4 })).toBe(false);
  });

  test('a standing character has exactly one legal position', () => {
    const standing = motion({ from: { x: 7, y: 7 }, to: { x: 7, y: 7 } });
    expect(isWithinSegment(standing, { x: 7, y: 7 })).toBe(true);
    expect(isWithinSegment(standing, { x: 7.5, y: 7 })).toBe(false);
  });
});
