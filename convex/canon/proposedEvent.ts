/**
 * Convex runtime validators for proposed events and state changes.
 *
 * These mirror the TypeScript domain types in `model.ts` but provide runtime validation
 * at the Convex function boundary (argument parsing and document inserts). Convex
 * validators are the schema-level guard; the richer business checks (duplicates,
 * participant consistency, preconditions) live in `validators.ts`.
 */

import { v } from 'convex/values';

export const stateChangeValidator = v.union(
  v.object({
    type: v.literal('character_location_changed'),
    characterId: v.string(),
    fromLocationId: v.string(),
    toLocationId: v.string(),
  }),
  v.object({
    type: v.literal('relationship_changed'),
    sourceCharacterId: v.string(),
    targetCharacterId: v.string(),
    trustDelta: v.number(),
    affectionDelta: v.number(),
    resentmentDelta: v.number(),
    reason: v.string(),
  }),
  v.object({
    type: v.literal('fact_created'),
    subjectType: v.union(
      v.literal('world'),
      v.literal('character'),
      v.literal('location'),
      v.literal('item'),
    ),
    subjectId: v.string(),
    predicate: v.string(),
    value: v.union(v.string(), v.number(), v.boolean()),
    visibility: v.union(v.literal('canon'), v.literal('public'), v.literal('private')),
  }),
);

export const proposedByValidator = v.object({
  type: v.union(
    v.literal('system'),
    v.literal('director'),
    v.literal('character'),
    v.literal('admin'),
  ),
  id: v.optional(v.string()),
});

/** Validator for a complete proposed event (used as function args and as the stored payload). */
export const proposedEventArgs = v.object({
  schemaVersion: v.number(),
  worldId: v.string(),
  idempotencyKey: v.string(),
  proposedBy: proposedByValidator,
  worldDay: v.number(),
  timeSlot: v.string(),
  eventType: v.string(),
  locationId: v.optional(v.string()),
  participantIds: v.array(v.string()),
  causedByEventIds: v.array(v.string()),
  publicSummary: v.optional(v.string()),
  stateChanges: v.array(stateChangeValidator),
  metadata: v.optional(v.any()),
});
