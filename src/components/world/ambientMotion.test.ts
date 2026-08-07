/**
 * In-zone ambient drift, acceptance criterion by acceptance criterion (ART-120 / FR-O011).
 *
 * The suite is organised by criterion because the criteria are the contract: a failure should
 * name the promise that broke, not just the function that threw. Every character id is a
 * production Mistwood seed id and every zone is a real Mistwood zone, per this repo's fixture
 * rule — a synthetic `char-a` in `loc-1` would prove the arithmetic and nothing about the town.
 */

import {
  isPointInZonePolygon,
  type ZonePoint,
} from '../../../convex/visual/locationVisualBinding';
import { mistwoodLocationVisualBindings } from '../../../convex/visual/mistwoodLocationBindings';
import {
  selectAmbientAnchorForBucket,
} from '../../../convex/visualRuntime/ambientAnchor';
import { MISTWOOD_SEED_PLACEMENTS } from '../../../convex/visualRuntime/fixtures';
import {
  AMBIENT_SPEED_TILES_PER_SECOND,
  MOVEMENT_SPEED_TILES_PER_SECOND,
} from '../../../convex/visualRuntime/motion';
import {
  AMBIENT_BUCKET_DURATION_MS,
  ambientPhaseOffsetMs,
} from '../../../convex/visualRuntime/seededRandom';
import { toPublicDirection } from '../../../convex/publicRead/publicDynamicProjection';
import { mistwoodAmbientAnchorsByLocationId } from '../../../data/mistwoodAmbientAnchors';
import { ambientTravelMs, deriveAmbientPose, SPRITE_FACING } from './ambientMotion';
import type { PublicCharacterMotion } from './worldViewModel';

/** An arbitrary but fixed instant well past every fixture's `arriveAt`. */
const NOW_MS = 1_700_000_600_000;
const WORLD_DAY = 3;

const bindingFor = (locationId: string) =>
  mistwoodLocationVisualBindings.find((binding) => binding.locationId === locationId)!;

/** A settled, ambient-eligible unit for one of the twelve residents. */
function settled(overrides: Partial<PublicCharacterMotion> = {}): PublicCharacterMotion {
  const placement = MISTWOOD_SEED_PLACEMENTS[0];
  const anchor = mistwoodAmbientAnchorsByLocationId[placement.initialLocationId][0];
  return {
    characterId: placement.characterId,
    semanticLocationId: placement.initialLocationId,
    motionType: 'ambient',
    motionSequence: 2,
    from: { ...anchor },
    to: { ...anchor },
    startedAt: NOW_MS - 100_000,
    arriveAt: NOW_MS - 100_000,
    animationState: 'idle',
    direction: 'down',
    ...overrides,
  };
}

function poseFor(motion: PublicCharacterMotion, nowMs: number, reducedMotion = false) {
  return deriveAmbientPose({
    motion,
    anchors: mistwoodAmbientAnchorsByLocationId[motion.semanticLocationId],
    worldDay: WORLD_DAY,
    nowMs,
    reducedMotion,
  });
}

/** Every resident, standing in its seeded zone. The whole town, as fixtures. */
const TOWN: readonly PublicCharacterMotion[] = MISTWOOD_SEED_PLACEMENTS.map((placement) =>
  settled({
    characterId: placement.characterId,
    semanticLocationId: placement.initialLocationId,
  }),
);

describe('AC#1 — ambient movement never leaves the Canon zone', () => {
  it('keeps every sampled point of every anchor pair inside its own zone polygon', () => {
    // The proof is convexity, not sampling: every anchor is asserted inside its zone, every
    // zone polygon is asserted convex, and a convex set contains the segment between any two
    // of its points. The sampling below is what turns that argument into a failing test if
    // either assumption is ever weakened.
    for (const binding of mistwoodLocationVisualBindings) {
      const anchors = mistwoodAmbientAnchorsByLocationId[binding.locationId];
      for (const from of anchors) {
        for (const to of anchors) {
          for (let step = 0; step <= 25; step++) {
            const t = step / 25;
            const point: ZonePoint = {
              x: from.x + (to.x - from.x) * t,
              y: from.y + (to.y - from.y) * t,
            };
            expect({ zone: binding.locationId, t, inside: isPointInZonePolygon(point, binding.zonePolygon) })
              .toEqual({ zone: binding.locationId, t, inside: true });
          }
        }
      }
    }
  });

  it('rests every derived pose inside the zone, sampled across four whole buckets', () => {
    for (const motion of TOWN) {
      const binding = bindingFor(motion.semanticLocationId);
      for (let offset = 0; offset < 4 * AMBIENT_BUCKET_DURATION_MS; offset += 977) {
        const pose = poseFor(motion, NOW_MS + offset);
        expect(pose).not.toBeNull();
        expect({
          character: motion.characterId,
          offset,
          inside: isPointInZonePolygon(pose!, binding.zonePolygon),
        }).toEqual({ character: motion.characterId, offset, inside: true });
      }
    }
  });

  it('leaves the published semantic location alone, whatever the drift does', () => {
    // RISK2-008: ambient movement must never be mistaken for plot. The strongest form of that
    // is "it cannot change where Canon says the character is", and `deriveAmbientPose` cannot
    // — it returns coordinates and a facing, and nothing else.
    const pose = poseFor(TOWN[0], NOW_MS);
    expect(Object.keys(pose!).sort()).toEqual(['direction', 'isMoving', 'x', 'y']);
  });
});

describe('AC#4 / AC#5 — deterministic, and identical for concurrent viewers', () => {
  it('is byte-identical over a thousand repeated derivations', () => {
    const first = JSON.stringify(poseFor(TOWN[4], NOW_MS + 12_345));
    for (let repeat = 0; repeat < 1000; repeat++) {
      expect(JSON.stringify(poseFor(TOWN[4], NOW_MS + 12_345))).toBe(first);
    }
  });

  it('agrees across the whole town regardless of the order two viewers derive in', () => {
    const forwards = TOWN.map((motion) => poseFor(motion, NOW_MS + 7_000));
    const backwards = [...TOWN].reverse().map((motion) => poseFor(motion, NOW_MS + 7_000)).reverse();
    expect(backwards).toEqual(forwards);
  });

  it('responds to each of the four seed components and to nothing else', () => {
    // PRD 2.0 §9.1.2 names exactly these four. Changing any one of them must be capable of
    // moving the character; changing something outside them must not.
    const base = TOWN[0];
    const bucketLater = NOW_MS + AMBIENT_BUCKET_DURATION_MS;

    const byCharacter = poseFor({ ...base, characterId: MISTWOOD_SEED_PLACEMENTS[1].characterId }, NOW_MS);
    const byDay = deriveAmbientPose({
      motion: base,
      anchors: mistwoodAmbientAnchorsByLocationId[base.semanticLocationId],
      worldDay: WORLD_DAY + 1,
      nowMs: NOW_MS,
      reducedMotion: false,
    });
    const byBucket = poseFor(base, bucketLater);
    const here = poseFor(base, NOW_MS);

    expect([byCharacter, byDay, byBucket].filter((pose) => JSON.stringify(pose) !== JSON.stringify(here)))
      .toHaveLength(3);

    // The location is the fourth: the same character standing in a different zone lands on
    // that zone's anchors, which are disjoint from the first zone's.
    const elsewhere = poseFor(settled({ semanticLocationId: 'mistwood-inn' }), NOW_MS);
    expect(isPointInZonePolygon(elsewhere!, bindingFor('mistwood-inn').zonePolygon)).toBe(true);

    // ...and `motionSequence`, `startedAt` and `direction` are *not* seed components, so a
    // projection rebuild that only bumps them must not teleport anybody.
    expect(poseFor({ ...base, motionSequence: 99, startedAt: 1, direction: 'up' }, NOW_MS)).toEqual(here);
  });

  it('does not jump at a bucket boundary: the character walks out of one and into the next', () => {
    const motion = TOWN[0];
    const phase = ambientPhaseOffsetMs(motion.characterId, motion.semanticLocationId);
    // The instant this character's own bucket turns over, not the raw epoch minute.
    const boundary =
      (Math.floor((NOW_MS + phase) / AMBIENT_BUCKET_DURATION_MS) + 1) * AMBIENT_BUCKET_DURATION_MS -
      phase;
    const before = poseFor(motion, boundary - 1)!;
    const after = poseFor(motion, boundary + 1)!;
    // Both buckets end and begin at the same anchor, so the position is continuous: the
    // anchor bucket n rests on is the anchor bucket n+1 sets off from.
    expect(Math.hypot(after.x - before.x, after.y - before.y)).toBeLessThan(0.01);
  });

  it('never rests two consecutive buckets on the same anchor', () => {
    // Standing still through two buckets reads as a frozen character rather than an idling
    // one. `selectAmbientAnchorForBucket` guarantees this algebraically; this is the check.
    for (const placement of MISTWOOD_SEED_PLACEMENTS) {
      const anchors = mistwoodAmbientAnchorsByLocationId[placement.initialLocationId];
      for (let bucket = 0; bucket < 200; bucket++) {
        const seed = {
          characterId: placement.characterId,
          locationId: placement.initialLocationId,
          worldDay: WORLD_DAY,
          timeBucket: bucket,
        };
        const current = selectAmbientAnchorForBucket(anchors, seed);
        const previous = selectAmbientAnchorForBucket(anchors, { ...seed, timeBucket: bucket - 1 });
        expect({ character: placement.characterId, bucket, repeated: current === previous }).toEqual({
          character: placement.characterId,
          bucket,
          repeated: false,
        });
      }
    }
  });

  it('spreads the twelve residents across the bucket grid instead of stepping in unison', () => {
    const offsets = new Set(
      MISTWOOD_SEED_PLACEMENTS.map((placement) =>
        ambientPhaseOffsetMs(placement.characterId, placement.initialLocationId),
      ),
    );
    expect(offsets.size).toBeGreaterThan(8);
    for (const offset of offsets) {
      expect(offset).toBeGreaterThanOrEqual(0);
      expect(offset).toBeLessThan(AMBIENT_BUCKET_DURATION_MS);
    }
  });
});

describe('AC#6 — ambient movement is distinguishable from Canon movement', () => {
  it('walks at roughly half the Canon speed', () => {
    expect(AMBIENT_SPEED_TILES_PER_SECOND).toBeLessThan(MOVEMENT_SPEED_TILES_PER_SECOND);
    expect(AMBIENT_SPEED_TILES_PER_SECOND / MOVEMENT_SPEED_TILES_PER_SECOND).toBeLessThan(0.6);
  });

  it('spends most of each bucket standing still rather than pacing', () => {
    for (const binding of mistwoodLocationVisualBindings) {
      const anchors = mistwoodAmbientAnchorsByLocationId[binding.locationId];
      for (const from of anchors) {
        for (const to of anchors) {
          expect(ambientTravelMs(from, to)).toBeLessThanOrEqual(
            AMBIENT_BUCKET_DURATION_MS * 0.4,
          );
        }
      }
    }
  });

  it('stays inside one zone, where a Canon walk crosses the map', () => {
    // The third signal: extent. Every ambient displacement is bounded by its zone's diagonal;
    // the station-to-square Canon walk covered by ART-119 is several times that.
    for (const binding of mistwoodLocationVisualBindings) {
      const anchors = mistwoodAmbientAnchorsByLocationId[binding.locationId];
      const rect = binding.zonePolygon;
      const width = Math.max(...rect.map((p) => p.x)) - Math.min(...rect.map((p) => p.x));
      const height = Math.max(...rect.map((p) => p.y)) - Math.min(...rect.map((p) => p.y));
      const diagonal = Math.hypot(width, height);
      for (const from of anchors) {
        for (const to of anchors) {
          expect(Math.hypot(to.x - from.x, to.y - from.y)).toBeLessThanOrEqual(diagonal);
        }
      }
    }
  });

  it('mirrors the published eight-to-four facing collapse exactly', () => {
    // `ambientMotion.ts` cannot import `toPublicDirection` without dragging the whole
    // trajectory planner into the browser bundle, so it carries its own copy of the table.
    // This is the pin that stops the copy drifting: a character drifting east must face the
    // way a character walking east on Canon business faces, or the two would read as
    // different kinds of creature.
    for (const compass of Object.keys(SPRITE_FACING) as (keyof typeof SPRITE_FACING)[]) {
      expect({ compass, facing: SPRITE_FACING[compass] }).toEqual({
        compass,
        facing: toPublicDirection(compass),
      });
    }
  });

  it('faces the way it is travelling while walking, and the camera while resting', () => {
    const motion = TOWN[0];
    const facings = new Set<string>();
    let restingFacings = new Set<string>();
    for (let offset = 0; offset < 2 * AMBIENT_BUCKET_DURATION_MS; offset += 250) {
      const pose = poseFor(motion, NOW_MS + offset)!;
      if (pose.isMoving) facings.add(pose.direction);
      else restingFacings = restingFacings.add(pose.direction);
    }
    expect(facings.size).toBeGreaterThan(0);
    expect([...restingFacings]).toEqual(['down']);
  });
});

describe('AC#8 — Reduced Motion disables ambient movement', () => {
  it('returns null for every resident, at every instant sampled', () => {
    for (const motion of TOWN) {
      for (let offset = 0; offset < 3 * AMBIENT_BUCKET_DURATION_MS; offset += 1_311) {
        expect(poseFor(motion, NOW_MS + offset, true)).toBeNull();
      }
    }
  });

  it('checks Reduced Motion before anything else could produce a pose', () => {
    // Order matters: a later branch that returned a pose would leak motion past the
    // preference. The strongest statement of that is "even the case that would definitely
    // drift returns null".
    expect(poseFor(TOWN[0], NOW_MS)).not.toBeNull();
    expect(poseFor(TOWN[0], NOW_MS, true)).toBeNull();
  });
});

describe('the cases that must not drift at all', () => {
  it('leaves a Canon walk that is still under way alone', () => {
    // Overlaying drift on an unfinished walk would take a character off its published route
    // mid-journey, which is the teleport FR-O002 AC#6 forbids.
    const walking = settled({
      motionType: 'canon',
      animationState: 'walking',
      startedAt: NOW_MS,
      arriveAt: NOW_MS + 20_000,
    });
    expect(poseFor(walking, NOW_MS + 5_000)).toBeNull();
  });

  it('leaves an arrived Canon unit alone: eligibility is published, not inferred', () => {
    const arrived = settled({ motionType: 'canon', arriveAt: NOW_MS - 1 });
    expect(poseFor(arrived, NOW_MS)).toBeNull();
  });

  it('leaves a replay unit alone', () => {
    expect(poseFor(settled({ motionType: 'replay' }), NOW_MS)).toBeNull();
  });

  it('drifts a never-moved seeded character, which the planner publishes as idle', () => {
    // `idle` is deliberately eligible: the twelve founding residents have no accepted history
    // on day one, and freezing them until Canon first moved them would leave the map dead.
    expect(poseFor(settled({ motionType: 'idle', motionSequence: 0 }), NOW_MS)).not.toBeNull();
  });

  it('stands still rather than teleporting when the zone offers nowhere to go', () => {
    const anchors = mistwoodAmbientAnchorsByLocationId['mistwood-inn'];
    for (const few of [undefined, [], [anchors[0]]]) {
      expect(
        deriveAmbientPose({
          motion: settled({ semanticLocationId: 'mistwood-inn' }),
          anchors: few,
          worldDay: WORLD_DAY,
          nowMs: NOW_MS,
          reducedMotion: false,
        }),
      ).toBeNull();
    }
  });

  it('seeds a world with no accepted history from day zero rather than refusing to draw it', () => {
    const pose = deriveAmbientPose({
      motion: settled(),
      anchors: mistwoodAmbientAnchorsByLocationId[settled().semanticLocationId],
      worldDay: undefined,
      nowMs: NOW_MS,
      reducedMotion: false,
    });
    expect(pose).not.toBeNull();
    // Whatever it picked, two viewers pick the same thing, which is all the seed has to do.
    expect(pose).toEqual(
      deriveAmbientPose({
        motion: settled(),
        anchors: mistwoodAmbientAnchorsByLocationId[settled().semanticLocationId],
        worldDay: undefined,
        nowMs: NOW_MS,
        reducedMotion: false,
      }),
    );
  });
});
