/**
 * Deterministic Visual Runtime fixtures (FR-N010 AC#6 / ART-114).
 *
 * Source, not test code: FR-N003's projection and FR-N006's sync state machine both need a
 * world they can plan against without a provider, a database or a network call, and duplicating
 * these three shapes in each of their test files would let them drift apart.
 *
 * Every value here is fixed. No clock is read, so a fixture planned twice produces the same
 * bytes and a golden-vector test stays meaningful.
 */

import { mistwoodRuntimeContext } from './mistwoodRuntime';
import type { SeedPlacement } from './seedBootstrap';
import type { AcceptedEventLike, VisualRuntimeInput } from './visualSyncPlanner';

/**
 * Mirrors the `id` / `initialLocationId` pairs of `convex/canon/mistwoodSeed.ts`'s
 * `mistwoodCharacterSeed.characters`, in seed order. Mirrored rather than imported so this
 * module stays free of Canon; `fixtures.test.ts` pins it against the seed so it cannot drift.
 */
export const MISTWOOD_SEED_PLACEMENTS: readonly SeedPlacement[] = [
  { characterId: 'lin-yingxue', initialLocationId: 'mistwood-paper' },
  { characterId: 'gao-wenrui', initialLocationId: 'mistwood-hall' },
  { characterId: 'su-meizhen', initialLocationId: 'mistwood-clinic' },
  { characterId: 'he-jun', initialLocationId: 'mistwood-mill' },
  { characterId: 'qiu-an', initialLocationId: 'mistwood-hall' },
  { characterId: 'luo-shan', initialLocationId: 'mistwood-inn' },
  { characterId: 'tang-ruoxi', initialLocationId: 'mistwood-orchard' },
  { characterId: 'shen-kai', initialLocationId: 'mistwood-square' },
  { characterId: 'pei-lan', initialLocationId: 'mistwood-hall' },
  { characterId: 'wu-zhen', initialLocationId: 'mistwood-station' },
  { characterId: 'fang-yue', initialLocationId: 'mistwood-square' },
  { characterId: 'zhao-ming', initialLocationId: 'mistwood-mill' },
];

/** An arbitrary but fixed instant, so fixture timestamps read like real ones without a clock. */
export const FIXTURE_ACCEPTED_AT_MS = 1_700_000_000_000;

/** One second after the move is accepted: far enough into a walk to still be under way. */
export const FIXTURE_NOW_MS = FIXTURE_ACCEPTED_AT_MS + 1_000;

function locationEvent(args: {
  readonly sequenceNumber: number;
  readonly characterId: string;
  readonly fromLocationId: string;
  readonly toLocationId: string;
  readonly worldDay: number;
  readonly timeSlot: string;
}): AcceptedEventLike {
  return {
    eventId: `mistwood#event#${args.sequenceNumber}`,
    sequenceNumber: args.sequenceNumber,
    worldDay: args.worldDay,
    timeSlot: args.timeSlot,
    acceptedAt: FIXTURE_ACCEPTED_AT_MS + args.sequenceNumber,
    stateChanges: [
      {
        type: 'character_location_changed',
        characterId: args.characterId,
        fromLocationId: args.fromLocationId,
        toLocationId: args.toLocationId,
      },
    ],
  };
}

function mistwoodInput(
  acceptedEvents: readonly AcceptedEventLike[],
  nowMs: number,
): VisualRuntimeInput {
  const context = mistwoodRuntimeContext();
  return {
    mapId: context.mapId,
    nowMs,
    grid: context.grid,
    bindings: context.bindings,
    seedPlacements: MISTWOOD_SEED_PLACEMENTS,
    acceptedEvents,
  };
}

/** A freshly seeded world: twelve residents, no accepted history. Exercises AC#8. */
export function createZeroEventFixture(nowMs: number = FIXTURE_NOW_MS): VisualRuntimeInput {
  return mistwoodInput([], nowMs);
}

/** One resident walks the station-to-square road; the other eleven stay bootstrapped. */
export function createSingleMoveFixture(nowMs: number = FIXTURE_NOW_MS): VisualRuntimeInput {
  return mistwoodInput(
    [
      locationEvent({
        sequenceNumber: 1,
        characterId: 'wu-zhen',
        fromLocationId: 'mistwood-station',
        toLocationId: 'mistwood-square',
        worldDay: 1,
        timeSlot: 'morning',
      }),
    ],
    nowMs,
  );
}

/**
 * Three hops for one resident across two world days. Only the last hop is pathed; the earlier
 * two exist to prove the anchor chain uses each fact's own day and slot rather than the clock.
 */
export function createMultiHopFixture(nowMs: number = FIXTURE_NOW_MS): VisualRuntimeInput {
  return mistwoodInput(
    [
      locationEvent({
        sequenceNumber: 1,
        characterId: 'lin-yingxue',
        fromLocationId: 'mistwood-paper',
        toLocationId: 'mistwood-station',
        worldDay: 1,
        timeSlot: 'morning',
      }),
      locationEvent({
        sequenceNumber: 2,
        characterId: 'lin-yingxue',
        fromLocationId: 'mistwood-station',
        toLocationId: 'mistwood-square',
        worldDay: 1,
        timeSlot: 'afternoon',
      }),
      locationEvent({
        sequenceNumber: 3,
        characterId: 'lin-yingxue',
        fromLocationId: 'mistwood-square',
        toLocationId: 'mistwood-inn',
        worldDay: 2,
        timeSlot: 'evening',
      }),
    ],
    nowMs,
  );
}
