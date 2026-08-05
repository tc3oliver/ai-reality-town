/**
 * Mistwood foundation fixture.
 *
 * A fixed, repeatable world used by the foundation tests. It defines:
 *   - 1 world (Mistwood)
 *   - 2 characters (Lin Yingxue, Wu Zhen — reused from the production Mistwood seed,
 *     `convex/canon/mistwoodSeed.ts`, per ART-107)
 *   - 2 locations (`mistwood-paper`, `mistwood-station` — also from the production seed)
 *   - 1 initial relationship
 *   - 4 accepted events (movement, relationship change, canon fact, and a later movement)
 *   - 1 snapshot taken after the first three events
 *
 * ART-107 (PRD 2.0 §8): this fixture previously used invented character/location IDs
 * (Lin Yingxue/Wu Zhen at mistwood-paper/mistwood-station) that do not exist in the production
 * seed, which risked V2 tasks building against the wrong ID set. Rebuilt in place to reuse
 * real seed IDs instead of renaming the file, after discovering (empirically, via a fresh
 * clean-checkout reproduction) that renaming this file perturbs TypeScript's type
 * instantiation order for the generated Convex `internal`/`api` union enough to push
 * unrelated `useQuery`/`ctx.runMutation` call sites elsewhere in the repo over a hard
 * `TS2589` depth limit. Keeping the filename and changing only its content avoids that.
 *
 * Everything here is a constant — no clock, no randomness — so the fixture produces the
 * same projection on every run. Placed under `convex/canon/` (colocated) to follow the
 * upstream test convention instead of a root `tests/` directory; see `docs/DEVELOPMENT.md`.
 */

import { CANON_VALIDATION_VERSION } from '../shared/constants';
import { deriveEventId } from '../shared/ids';
import { buildSnapshot, cloneProjection, type CanonSnapshot } from './snapshots';
import { replayWorldEvents } from './replay';
import type { AcceptedEvent, WorldProjection } from './model';

export const MISTWOOD_WORLD_ID = 'mistwood';
export const MISTWOOD_FIXTURE_VERSION = 1;
export const MISTWOOD_FIXED_SEED = 20260803;

// Fixed clock values so the fixture is fully deterministic.
const BASE_ACCEPTED_AT = 1_700_000_000_000;
const SNAPSHOT_CREATED_AT = 1_700_000_000_999;

function accepted(
  seq: number,
  partial: Omit<AcceptedEvent, 'eventId' | 'acceptedAt' | 'sequenceNumber' | 'validationVersion' | 'traceId'>,
): AcceptedEvent {
  return {
    ...partial,
    eventId: deriveEventId(MISTWOOD_WORLD_ID, seq),
    acceptedAt: BASE_ACCEPTED_AT + seq * 1000,
    sequenceNumber: seq,
    validationVersion: CANON_VALIDATION_VERSION,
    traceId: `mistwood-trace-${seq}`,
  };
}

/** The world's starting state: two characters placed, with one initial relationship. */
export const mistwoodInitialProjection: WorldProjection = {
  worldId: MISTWOOD_WORLD_ID,
  lastSequenceNumber: -1,
  characterLocations: {
    'lin-yingxue': 'mistwood-paper',
    'wu-zhen': 'mistwood-station',
  },
  characterAlive: { 'lin-yingxue': true, 'wu-zhen': true },
  characterStates: {},
  lastCharacterMovement: {},
  itemOwners: {},
  itemOwnershipHistory: {},
  characterKnowledge: {},
  characterMemories: {},
  relationships: {
    'lin-yingxue|wu-zhen': { trust: 20, affection: 10, resentment: 0, fear: 0, dependency: 5, familiarity: 30, lastUpdatedEventId: 'initial-seed' },
  },
  relationshipHistory: {},
  facts: [],
  worldEnvironment: {},
  environmentHistory: {},
  locations: {},
  locationOccupancy: {},
  organizations: {},
  organizationMembers: {},
  organizationMembershipHistory: {},
};

/** The accepted event log for Mistwood (sequences 0..3). */
export const mistwoodEvents: AcceptedEvent[] = [
  // 0: Lin Yingxue travels from the newspaper office to the station.
  accepted(0, {
    schemaVersion: 1,
    worldId: MISTWOOD_WORLD_ID,
    idempotencyKey: 'mistwood:lin-yingxue:to-station',
    proposedBy: { type: 'character', id: 'lin-yingxue' },
    worldDay: 1,
    timeSlot: 'morning',
    eventType: 'movement',
    participantIds: ['lin-yingxue'],
    causedByEventIds: [],
    publicSummary: 'Lin Yingxue walks from the newspaper office to the station.',
    stateChanges: [
      {
        type: 'character_location_changed',
        characterId: 'lin-yingxue',
        fromLocationId: 'mistwood-paper',
        toLocationId: 'mistwood-station',
      },
    ],
  }),
  // 1: Lin Yingxue and Wu Zhen's relationship shifts after sharing the morning.
  accepted(1, {
    schemaVersion: 1,
    worldId: MISTWOOD_WORLD_ID,
    idempotencyKey: 'mistwood:lin-yingxue-wu-zhen:bond',
    proposedBy: { type: 'system' },
    worldDay: 1,
    timeSlot: 'noon',
    eventType: 'relationship_change',
    participantIds: ['lin-yingxue', 'wu-zhen'],
    causedByEventIds: [],
    publicSummary: 'Lin Yingxue and Wu Zhen warm to each other.',
    stateChanges: [
      {
        type: 'relationship_changed',
        sourceCharacterId: 'lin-yingxue',
        targetCharacterId: 'wu-zhen',
        trustDelta: 5,
        affectionDelta: 3,
        resentmentDelta: 0,
        fearDelta: 0,
        dependencyDelta: 1,
        familiarityDelta: 4,
        reason: 'shared a quiet morning at the station',
        visibility: 'public',
      },
    ],
  }),
  // 2: A canonical fact is recorded.
  accepted(2, {
    schemaVersion: 1,
    worldId: MISTWOOD_WORLD_ID,
    idempotencyKey: 'mistwood:fact:lin-yingxue-location',
    proposedBy: { type: 'system' },
    worldDay: 1,
    timeSlot: 'afternoon',
    eventType: 'discovery',
    participantIds: ['lin-yingxue'],
    causedByEventIds: [],
    publicSummary: 'Lin Yingxue is last seen at the station.',
    stateChanges: [
      {
        type: 'fact_created',
        subjectType: 'character',
        subjectId: 'lin-yingxue',
        predicate: 'lastKnownLocation',
        value: 'mistwood-station',
        visibility: 'public',
      },
    ],
  }),
  // 3: A later event (after the snapshot) — Wu Zhen heads to the newspaper office.
  accepted(3, {
    schemaVersion: 1,
    worldId: MISTWOOD_WORLD_ID,
    idempotencyKey: 'mistwood:wu-zhen:to-paper',
    proposedBy: { type: 'character', id: 'wu-zhen' },
    worldDay: 1,
    timeSlot: 'evening',
    eventType: 'movement',
    participantIds: ['wu-zhen'],
    causedByEventIds: [],
    publicSummary: 'Wu Zhen walks from the station to the newspaper office.',
    stateChanges: [
      {
        type: 'character_location_changed',
        characterId: 'wu-zhen',
        fromLocationId: 'mistwood-station',
        toLocationId: 'mistwood-paper',
      },
    ],
  }),
];

/** Events up to and including the snapshot point (sequences 0..2). */
export const mistwoodEventsBeforeSnapshot: AcceptedEvent[] = mistwoodEvents.slice(0, 3);

/** Events after the snapshot point (sequence 3). */
export const mistwoodEventsAfterSnapshot: AcceptedEvent[] = mistwoodEvents.slice(3);

/** The projection obtained by replaying the full event log. */
export const mistwoodFullProjection: WorldProjection = replayWorldEvents(
  mistwoodInitialProjection,
  mistwoodEvents,
);

/** Snapshot taken after sequence 2 (before the final movement). */
export const mistwoodSnapshot: CanonSnapshot = buildSnapshot(
  replayWorldEvents(mistwoodInitialProjection, mistwoodEventsBeforeSnapshot),
  SNAPSHOT_CREATED_AT,
);

export type MistwoodFixture = {
  version: number;
  seed: number;
  worldId: string;
  initialProjection: WorldProjection;
  events: AcceptedEvent[];
  eventsBeforeSnapshot: AcceptedEvent[];
  eventsAfterSnapshot: AcceptedEvent[];
  fullProjection: WorldProjection;
  snapshot: CanonSnapshot;
};

function cloneEvents(events: AcceptedEvent[]): AcceptedEvent[] {
  return events.map((event) => ({
    ...event,
    proposedBy: { ...event.proposedBy },
    participantIds: [...event.participantIds],
    causedByEventIds: [...event.causedByEventIds],
    stateChanges: event.stateChanges.map((change) => ({ ...change })),
    metadata: event.metadata ? { ...event.metadata } : undefined,
  }));
}

/** Return an isolated copy so one test cannot mutate another test's world history. */
export function createMistwoodFixture(): MistwoodFixture {
  const events = cloneEvents(mistwoodEvents);
  const beforeCount = mistwoodEventsBeforeSnapshot.length;
  return {
    version: MISTWOOD_FIXTURE_VERSION,
    seed: MISTWOOD_FIXED_SEED,
    worldId: MISTWOOD_WORLD_ID,
    initialProjection: cloneProjection(mistwoodInitialProjection),
    events,
    eventsBeforeSnapshot: events.slice(0, beforeCount),
    eventsAfterSnapshot: events.slice(beforeCount),
    fullProjection: cloneProjection(mistwoodFullProjection),
    snapshot: {
      ...mistwoodSnapshot,
      projection: cloneProjection(mistwoodSnapshot.projection),
    },
  };
}
