/**
 * Convex tables for the append-only Canon Event store.
 *
 * Added to the schema via the existing upstream aggregation pattern:
 *   defineSchema({ ...canonTables, ...simulationTables, ...aiTownTables, ... })
 *
 * Three tables:
 *  - canonEvents: the append-only, immutable accepted-event log (source of truth).
 *  - canonIdempotencyKeys: dedup guard so a repeated proposal never creates a second event.
 *  - canonSnapshots: persisted projections to accelerate replay (foundation only).
 */

import { defineTable } from 'convex/server';
import { v } from 'convex/values';
import { proposedEventArgs } from './proposedEvent';

export const canonTables = {
  worldDefinitions: defineTable({
    worldId: v.string(),
    schemaVersion: v.number(),
    payload: v.any(),
    contentDeclaration: v.any(),
  }).index('by_world_id', ['worldId']),

  worldLocations: defineTable({
    worldId: v.string(),
    locationId: v.string(),
    payload: v.any(),
  })
    .index('by_world_id', ['worldId'])
    .index('by_world_and_location', ['worldId', 'locationId']),

  worldOrganizations: defineTable({
    worldId: v.string(),
    organizationId: v.string(),
    payload: v.any(),
  })
    .index('by_world_id', ['worldId'])
    .index('by_world_and_organization', ['worldId', 'organizationId']),

  worldImmutableRules: defineTable({
    worldId: v.string(),
    ruleId: v.string(),
    payload: v.any(),
  })
    .index('by_world_id', ['worldId'])
    .index('by_world_and_rule', ['worldId', 'ruleId']),

  worldHistory: defineTable({
    worldId: v.string(),
    historyId: v.string(),
    payload: v.any(),
  })
    .index('by_world_id', ['worldId'])
    .index('by_world_and_history', ['worldId', 'historyId']),

  canonEvents: defineTable({
    worldId: v.string(),
    sequenceNumber: v.number(),
    schemaVersion: v.number(),
    eventType: v.string(),
    worldDay: v.number(),
    timeSlot: v.string(),
    locationId: v.optional(v.string()),
    participantIds: v.array(v.string()),
    causedByEventIds: v.array(v.string()),
    publicSummary: v.optional(v.string()),
    // The full proposed event payload, validated by Convex on insert.
    payload: proposedEventArgs,
    validationVersion: v.string(),
    idempotencyKey: v.string(),
    traceId: v.string(),
    acceptedAt: v.number(),
  })
    .index('by_world_and_sequence', ['worldId', 'sequenceNumber'])
    .index('by_world_and_day', ['worldId', 'worldDay'])
    .index('by_world_and_idempotency_key', ['worldId', 'idempotencyKey']),

  canonIdempotencyKeys: defineTable({
    worldId: v.string(),
    idempotencyKey: v.string(),
    eventId: v.string(),
    sequenceNumber: v.number(),
    createdAt: v.number(),
  }).index('by_world_and_key', ['worldId', 'idempotencyKey']),

  canonSnapshots: defineTable({
    worldId: v.string(),
    lastSequenceNumber: v.number(),
    projection: v.any(),
    createdAt: v.number(),
  }).index('by_world_and_sequence', ['worldId', 'lastSequenceNumber']),
};
