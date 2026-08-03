import { defineTable } from 'convex/server';
import { v } from 'convex/values';

export const storyArcStatusValidator = v.union(
  v.literal('emerging'), v.literal('active'), v.literal('escalating'),
  v.literal('climax'), v.literal('resolving'), v.literal('resolved'), v.literal('archived'),
);

export const storyTables = {
  storyArcLifecycles: defineTable({
    schemaVersion: v.literal(1),
    worldId: v.string(),
    arcId: v.string(),
    status: storyArcStatusValidator,
    revision: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_world_and_arc', ['worldId', 'arcId'])
    .index('by_world_and_status', ['worldId', 'status']),

  storyArcLifecycleTransitions: defineTable({
    worldId: v.string(),
    arcId: v.string(),
    transitionId: v.string(),
    revision: v.number(),
    fromStatus: v.optional(storyArcStatusValidator),
    toStatus: storyArcStatusValidator,
    sourceEventId: v.string(),
    sourceEventSequenceNumber: v.number(),
    reason: v.string(),
    changedAt: v.number(),
  })
    .index('by_world_arc_and_revision', ['worldId', 'arcId', 'revision'])
    .index('by_source_event', ['worldId', 'sourceEventSequenceNumber']),

  storyArcProjectionEvents: defineTable({
    schemaVersion: v.literal(1),
    worldId: v.string(),
    arcId: v.string(),
    revision: v.number(),
    kind: v.union(v.literal('initialized'), v.literal('updated')),
    fields: v.any(),
    sourceEventId: v.string(),
    sourceEventSequenceNumber: v.number(),
    worldDay: v.number(),
    timeSlot: v.string(),
  })
    .index('by_world_arc_and_revision', ['worldId', 'arcId', 'revision'])
    .index('by_world_and_source_event', ['worldId', 'sourceEventSequenceNumber']),

  storyArcEventClassifications: defineTable({
    schemaVersion: v.literal(1),
    worldId: v.string(),
    sourceEventId: v.string(),
    sourceEventSequenceNumber: v.number(),
    memberships: v.any(),
    newArc: v.any(),
    createdAt: v.number(),
  })
    .index('by_world_and_source_event', ['worldId', 'sourceEventSequenceNumber'])
    .index('by_world', ['worldId']),

  storyArcPortfolioEntries: defineTable({
    worldId: v.string(),
    arcId: v.string(),
    entry: v.any(),
    updatedAt: v.number(),
  }).index('by_world_and_arc', ['worldId', 'arcId']),

  storyArcPortfolioDecisions: defineTable({
    worldId: v.string(),
    decisionId: v.string(),
    decision: v.any(),
    createdAt: v.number(),
  }).index('by_world_and_decision', ['worldId', 'decisionId']),

  storyArcStagnationPrompts: defineTable({
    worldId: v.string(),
    arcId: v.string(),
    promptId: v.string(),
    prompt: v.any(),
    detectedAtWorldDay: v.number(),
  })
    .index('by_world_and_prompt', ['worldId', 'promptId'])
    .index('by_world_and_day', ['worldId', 'detectedAtWorldDay']),

  storyArcResolutionDecisions: defineTable({
    worldId: v.string(),
    arcId: v.string(),
    decisionId: v.string(),
    decision: v.any(),
    sourceEventSequenceNumber: v.number(),
  })
    .index('by_world_and_decision', ['worldId', 'decisionId'])
    .index('by_world_and_arc', ['worldId', 'arcId']),

  // FR-F005 consequence summaries derived from resolved arcs. Separate from
  // canon: rows here are derived public-summary artifacts with full provenance.
  // Upserting/superseding a row never touches an accepted Canon Event.
  arcConsequenceSummaries: defineTable({
    schemaVersion: v.literal(1),
    worldId: v.string(),
    arcId: v.string(),
    summaryId: v.string(),
    scope: v.union(v.literal('character'), v.literal('world')),
    subjectId: v.string(),
    outcome: v.string(),
    consequenceId: v.string(),
    summary: v.string(),
    sourceEventId: v.string(),
    sourceEventIds: v.array(v.string()),
    resolutionSequenceNumber: v.number(),
    revision: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_summary_id', ['summaryId'])
    .index('by_world_and_arc', ['worldId', 'arcId'])
    .index('by_subject', ['worldId', 'scope', 'subjectId'])
    .index('by_arc_and_revision', ['worldId', 'arcId', 'revision']),
};
