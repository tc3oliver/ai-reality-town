/**
 * Convex tables for the append-only Canon Event store.
 *
 * Added to the schema via the existing upstream aggregation pattern:
 *   defineSchema({ ...canonTables, ...simulationTables, ...aiTownTables, ... })
 *
 * Canon storage tables include:
 *  - canonEvents: the append-only, immutable accepted-event log (source of truth).
 *  - canonIdempotencyKeys: dedup guard so a repeated proposal never creates a second event.
 *  - canonSnapshots: versioned daily/manual projections that accelerate replay.
 *  - canonRecoveryHeads / canonRecoveryAudit: reversible operational rollback pointer
 *    plus immutable operator audit; neither changes accepted history.
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

  worldCharacters: defineTable({
    worldId: v.string(),
    characterId: v.string(),
    payload: v.any(),
  })
    .index('by_world_id', ['worldId'])
    .index('by_world_and_character', ['worldId', 'characterId']),

  worldSecrets: defineTable({
    worldId: v.string(),
    secretId: v.string(),
    payload: v.any(),
  })
    .index('by_world_id', ['worldId'])
    .index('by_world_and_secret', ['worldId', 'secretId']),

  worldCharacterKnowledge: defineTable({
    worldId: v.string(),
    knowledgeId: v.string(),
    characterId: v.string(),
    payload: v.any(),
  })
    .index('by_world_id', ['worldId'])
    .index('by_world_and_character', ['worldId', 'characterId'])
    .index('by_world_and_knowledge', ['worldId', 'knowledgeId']),

  worldAssets: defineTable({
    worldId: v.string(),
    assetId: v.string(),
    ownerCharacterId: v.string(),
    payload: v.any(),
  })
    .index('by_world_id', ['worldId'])
    .index('by_world_and_owner', ['worldId', 'ownerCharacterId'])
    .index('by_world_and_asset', ['worldId', 'assetId']),

  worldSeedRelationships: defineTable({
    worldId: v.string(),
    sourceCharacterId: v.string(),
    targetCharacterId: v.string(),
    payload: v.any(),
  })
    .index('by_world_id', ['worldId'])
    .index('by_world_and_source', ['worldId', 'sourceCharacterId'])
    .index('by_world_and_pair', ['worldId', 'sourceCharacterId', 'targetCharacterId']),

  worldTensionProfiles: defineTable({
    worldId: v.string(),
    schemaVersion: v.number(),
    evaluatedAt: v.number(),
    payload: v.any(),
  }).index('by_world_and_time', ['worldId', 'evaluatedAt']),

  worldTensionReadinessReports: defineTable({
    worldId: v.string(),
    readyForWarmup: v.boolean(),
    evaluatedAt: v.number(),
    payload: v.any(),
  })
    .index('by_world_and_time', ['worldId', 'evaluatedAt'])
    .index('by_ready_and_time', ['readyForWarmup', 'evaluatedAt']),

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
    snapshotVersion: v.optional(v.number()),
    worldId: v.string(),
    worldDay: v.optional(v.number()),
    lastSequenceNumber: v.number(),
    projection: v.any(),
    projectionHash: v.optional(v.string()),
    kind: v.optional(v.union(v.literal('initial'), v.literal('daily'), v.literal('manual'))),
    createdAt: v.number(),
  })
    .index('by_world_and_sequence', ['worldId', 'lastSequenceNumber'])
    .index('by_world_day_and_kind', ['worldId', 'worldDay', 'kind']),

  canonRecoveryHeads: defineTable({
    worldId: v.string(),
    targetSnapshotId: v.id('canonSnapshots'),
    targetSequenceNumber: v.number(),
    activatedAt: v.number(),
    operatorId: v.string(),
    reason: v.string(),
  }).index('by_world_id', ['worldId']),

  canonRecoveryAudit: defineTable({
    worldId: v.string(),
    action: v.union(v.literal('activated'), v.literal('cleared')),
    targetSnapshotId: v.optional(v.id('canonSnapshots')),
    targetSequenceNumber: v.optional(v.number()),
    operatorId: v.string(),
    reason: v.string(),
    createdAt: v.number(),
  }).index('by_world_and_time', ['worldId', 'createdAt']),
};
