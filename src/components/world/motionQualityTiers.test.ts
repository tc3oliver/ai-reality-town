/**
 * Frame-rate degradation never corrupts semantic state (ART-119 / FR-O002 AC#7).
 *
 * This is the headline proof of the task. A slow device is allowed to advance
 * the animation clock ten times a second instead of sixty; what it may not do is
 * end up anywhere else, in any sense that matters. So the *same* published
 * motion is sampled on four different update grids and three properties are
 * asserted across all of them:
 *
 * 1. `semanticLocationId` is identical at every sample in every tier — semantic
 *    identity comes from the projection, only pixel position comes from the
 *    clock;
 * 2. the final position equals the published destination exactly, whatever the
 *    tier — no accumulated drift, because nothing accumulates: each frame is
 *    computed from `(motion, nowMs)` afresh rather than from the last frame;
 * 3. no sample ever leaves the published movement segment (AC#6), so a coarse
 *    grid skips *frames*, never the route.
 *
 * The motion is planned by the real Visual Runtime from the real Mistwood
 * fixtures (`convex/visualRuntime/fixtures.ts`), not by a hand-built literal, so
 * what is sampled is what the backend actually publishes.
 */

import { buildPublicDynamicProjection } from '../../../convex/publicRead/publicDynamicProjection';
import {
  createMultiHopFixture,
  createSingleMoveFixture,
  createZeroEventFixture,
  FIXTURE_ACCEPTED_AT_MS,
  MISTWOOD_SEED_PLACEMENTS,
} from '../../../convex/visualRuntime/fixtures';
import type { VisualRuntimeInput } from '../../../convex/visualRuntime/visualSyncPlanner';
import { mistwoodCharacterSpriteKeys } from '../../../data/mistwoodCharacters';
import { mistwoodWorldMap } from '../../../data/mistwood';
import { RENDER_QUALITY_TIERS, TIER_UPDATE_HZ, updateIntervalMs } from './renderQuality';
import {
  composeReadOnlyWorldViewModel,
  interpolatedTile,
  isWithinSegment,
  latestMotionPerCharacter,
  type PublicCharacterMotion,
} from './worldViewModel';

const WORLD_ID = 'mistwood';

function project(fixture: VisualRuntimeInput): PublicCharacterMotion[] {
  return buildPublicDynamicProjection({
    worldId: WORLD_ID,
    nowMs: fixture.nowMs,
    runtime: { mapId: fixture.mapId, grid: fixture.grid, bindings: fixture.bindings },
    seedPlacements: MISTWOOD_SEED_PLACEMENTS,
    acceptedEvents: fixture.acceptedEvents,
    worldStatus: 'running',
    activeScenes: [],
  }).characters;
}

/** The one motion in `input` that actually covers ground. */
function movingMotion(motions: readonly PublicCharacterMotion[]): PublicCharacterMotion {
  const walking = latestMotionPerCharacter(motions).find(
    (motion) => motion.arriveAt > motion.startedAt,
  );
  expect(walking).toBeDefined();
  return walking!;
}

/** Every instant a tier's clock would land on across the whole of `motion`'s window. */
function sampleGrid(motion: PublicCharacterMotion, hz: number): number[] {
  const step = 1000 / hz;
  const samples: number[] = [];
  // A little before and a little after, so the pre-start and post-arrival clamps
  // are part of what every tier has to agree about.
  for (let t = motion.startedAt - step; t < motion.arriveAt + step; t += step) {
    samples.push(t);
  }
  samples.push(motion.arriveAt);
  return samples;
}

describe('the published fixtures render (AC#1/#8)', () => {
  test('a freshly seeded world puts all twelve residents on the map', () => {
    const vm = composeReadOnlyWorldViewModel({
      map: mistwoodWorldMap,
      motions: project(createZeroEventFixture()),
      spriteKeys: mistwoodCharacterSpriteKeys,
      nowMs: FIXTURE_ACCEPTED_AT_MS,
    });

    expect(vm.characters).toHaveLength(12);
    expect(vm.characters.map((character) => character.characterId).sort()).toEqual(
      MISTWOOD_SEED_PLACEMENTS.map((placement) => placement.characterId).sort(),
    );
    // Nobody is dropped for want of a sprite binding, which is the AC#1 failure
    // mode the `data/` roster exists to prevent.
    expect(vm.characters.every((character) => character.spriteKey.length > 0)).toBe(true);
  });

  test('a seeded world with no accepted history is standing still, not walking (AC#3)', () => {
    const vm = composeReadOnlyWorldViewModel({
      map: mistwoodWorldMap,
      motions: project(createZeroEventFixture()),
      spriteKeys: mistwoodCharacterSpriteKeys,
      nowMs: FIXTURE_ACCEPTED_AT_MS,
    });
    expect(vm.characters.every((character) => character.isMoving === false)).toBe(true);
    expect(vm.characters.every((character) => character.animationState === 'idle')).toBe(true);
  });

  test('an accepted location change renders as a cross-location walk (AC#2/#8)', () => {
    const motions = project(createSingleMoveFixture());
    const walk = movingMotion(motions);

    expect(walk.motionType).toBe('canon');
    expect(walk.animationState).toBe('walking');
    // It is a *cross-location* move: the endpoints are genuinely apart.
    expect(walk.from).not.toEqual(walk.to);

    const midpoint = composeReadOnlyWorldViewModel({
      map: mistwoodWorldMap,
      motions,
      spriteKeys: mistwoodCharacterSpriteKeys,
      nowMs: (walk.startedAt + walk.arriveAt) / 2,
    }).characters.find((character) => character.characterId === walk.characterId);

    expect(midpoint).toBeDefined();
    expect(midpoint!.isMoving).toBe(true);
    // Genuinely between the endpoints, not parked on either: this is the
    // difference between walking there and teleporting there (AC#2/#6).
    const distanceFrom = (point: { x: number; y: number }) =>
      Math.hypot(
        midpoint!.x - point.x * mistwoodWorldMap.tileDim,
        midpoint!.y - point.y * mistwoodWorldMap.tileDim,
      );
    expect(distanceFrom(walk.from)).toBeGreaterThan(0);
    expect(distanceFrom(walk.to)).toBeGreaterThan(0);
  });
});

describe('reducing the update rate cannot corrupt semantic state (AC#7)', () => {
  const motions = project(createMultiHopFixture());
  const walk = movingMotion(motions);
  /** The three shipped tiers plus a deliberately absurd one-frame-a-second grid. */
  const grids = [...RENDER_QUALITY_TIERS.map((tier) => TIER_UPDATE_HZ[tier]), 1];

  test.each(grids)('at %iHz the semantic location never changes', (hz) => {
    for (const nowMs of sampleGrid(walk, hz)) {
      const character = composeReadOnlyWorldViewModel({
        map: mistwoodWorldMap,
        motions,
        spriteKeys: mistwoodCharacterSpriteKeys,
        nowMs,
      }).characters.find((entry) => entry.characterId === walk.characterId);

      expect(character).toBeDefined();
      expect(character!.semanticLocationId).toBe(walk.semanticLocationId);
      expect(character!.animationState).toBe(walk.animationState);
      expect(character!.motionType).toBe(walk.motionType);
    }
  });

  test.each(grids)('at %iHz every sampled position stays on the published segment', (hz) => {
    for (const nowMs of sampleGrid(walk, hz)) {
      expect(isWithinSegment(walk, interpolatedTile(walk, nowMs))).toBe(true);
    }
  });

  test.each(grids)('at %iHz the character still arrives exactly at the destination', (hz) => {
    const arrival = composeReadOnlyWorldViewModel({
      map: mistwoodWorldMap,
      motions,
      spriteKeys: mistwoodCharacterSpriteKeys,
      // One whole tick past arrival: the coarsest grid still lands here.
      nowMs: walk.arriveAt + 1000 / hz,
    }).characters.find((entry) => entry.characterId === walk.characterId);

    expect(arrival!.x).toBe(walk.to.x * mistwoodWorldMap.tileDim);
    expect(arrival!.y).toBe(walk.to.y * mistwoodWorldMap.tileDim);
    expect(arrival!.isMoving).toBe(false);
  });

  test('every tier agrees on the whole cast at the same instant', () => {
    // The per-character assertions above could in principle hold while the tiers
    // disagreed about *who* is on the map. They do not.
    const rosters = RENDER_QUALITY_TIERS.map((tier) => {
      const nowMs = walk.startedAt + updateIntervalMs(tier);
      return composeReadOnlyWorldViewModel({
        map: mistwoodWorldMap,
        motions,
        spriteKeys: mistwoodCharacterSpriteKeys,
        nowMs,
      }).characters.map((character) => `${character.characterId}@${character.semanticLocationId}`);
    });

    for (const roster of rosters) {
      expect(roster.sort()).toEqual(rosters[0].slice().sort());
    }
  });

  test('a coarse grid changes only how many intermediate positions are drawn', () => {
    // The actual, intended difference between the tiers, stated as a test so a
    // future "optimisation" that also drops the destination gets caught.
    const distinct = (hz: number) =>
      new Set(
        sampleGrid(walk, hz).map((nowMs) => {
          const point = interpolatedTile(walk, nowMs);
          return `${point.x},${point.y}`;
        }),
      ).size;

    expect(distinct(TIER_UPDATE_HZ.high)).toBeGreaterThan(distinct(TIER_UPDATE_HZ.low));
    expect(distinct(TIER_UPDATE_HZ.low)).toBeGreaterThan(1);
  });
});
