/**
 * Mistwood foundation fixture.
 *
 * A fixed, repeatable world used by the foundation tests. It defines:
 *   - 1 world (Mistwood)
 *   - 2 characters (Cassia, Rowan — fictional, not real people)
 *   - 2 locations (market, grove)
 *   - 1 initial relationship
 *   - 4 accepted events (movement, relationship change, canon fact, and a later movement)
 *   - 1 snapshot taken after the first three events
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
    cassia: 'mistwood-market',
    rowan: 'mistwood-grove',
  },
  characterAlive: { cassia: true, rowan: true },
  lastCharacterMovement: {},
  itemOwners: {},
  characterKnowledge: {},
  relationships: {
    'cassia|rowan': { trust: 20, affection: 10, resentment: 0 },
  },
  facts: [],
};

/** The accepted event log for Mistwood (sequences 0..3). */
export const mistwoodEvents: AcceptedEvent[] = [
  // 0: Cassia travels from the market to the grove.
  accepted(0, {
    schemaVersion: 1,
    worldId: MISTWOOD_WORLD_ID,
    idempotencyKey: 'mistwood:cassia:to-grove',
    proposedBy: { type: 'character', id: 'cassia' },
    worldDay: 1,
    timeSlot: 'morning',
    eventType: 'movement',
    participantIds: ['cassia'],
    causedByEventIds: [],
    publicSummary: 'Cassia walks from the market to the grove.',
    stateChanges: [
      {
        type: 'character_location_changed',
        characterId: 'cassia',
        fromLocationId: 'mistwood-market',
        toLocationId: 'mistwood-grove',
      },
    ],
  }),
  // 1: Cassia and Rowan's relationship shifts after sharing the morning.
  accepted(1, {
    schemaVersion: 1,
    worldId: MISTWOOD_WORLD_ID,
    idempotencyKey: 'mistwood:cassia-rowan:bond',
    proposedBy: { type: 'system' },
    worldDay: 1,
    timeSlot: 'noon',
    eventType: 'relationship_change',
    participantIds: ['cassia', 'rowan'],
    causedByEventIds: [],
    publicSummary: 'Cassia and Rowan warm to each other.',
    stateChanges: [
      {
        type: 'relationship_changed',
        sourceCharacterId: 'cassia',
        targetCharacterId: 'rowan',
        trustDelta: 5,
        affectionDelta: 3,
        resentmentDelta: 0,
        reason: 'shared a quiet morning at the grove',
      },
    ],
  }),
  // 2: A canonical fact is recorded.
  accepted(2, {
    schemaVersion: 1,
    worldId: MISTWOOD_WORLD_ID,
    idempotencyKey: 'mistwood:fact:cassia-location',
    proposedBy: { type: 'system' },
    worldDay: 1,
    timeSlot: 'afternoon',
    eventType: 'discovery',
    participantIds: ['cassia'],
    causedByEventIds: [],
    publicSummary: 'Cassia is last seen at the grove.',
    stateChanges: [
      {
        type: 'fact_created',
        subjectType: 'character',
        subjectId: 'cassia',
        predicate: 'lastKnownLocation',
        value: 'mistwood-grove',
        visibility: 'public',
      },
    ],
  }),
  // 3: A later event (after the snapshot) — Rowan heads to the market.
  accepted(3, {
    schemaVersion: 1,
    worldId: MISTWOOD_WORLD_ID,
    idempotencyKey: 'mistwood:rowan:to-market',
    proposedBy: { type: 'character', id: 'rowan' },
    worldDay: 1,
    timeSlot: 'evening',
    eventType: 'movement',
    participantIds: ['rowan'],
    causedByEventIds: [],
    publicSummary: 'Rowan walks from the grove to the market.',
    stateChanges: [
      {
        type: 'character_location_changed',
        characterId: 'rowan',
        fromLocationId: 'mistwood-grove',
        toLocationId: 'mistwood-market',
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
