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

  // FR-H003 recommended entry episodes for major active arcs. Derived artifacts
  // reassessed after major changes; upserting never touches accepted Canon.
  storyArcRecommendedEntries: defineTable({
    worldId: v.string(),
    arcId: v.string(),
    entry: v.any(),
    reassessedAtSequenceNumber: v.number(),
    updatedAt: v.number(),
  })
    .index('by_world_and_arc', ['worldId', 'arcId'])
    .index('by_world', ['worldId']),

  /**
   * The composition of each arc's current heat score (FR-F006 AC#1, AC#3 / ART-32).
   *
   * ONE ROW PER ARC, patched in place, rather than one per computation. Heat is recomputed on every
   * accepted event that touches the arc, so an append-only stream would grow with traffic while
   * answering a question that is only ever asked about NOW — 「這個 Arc 現在為什麼是這個分數」. The
   * durable history of the score itself is already append-only elsewhere: `heatScore` is a field of
   * `storyArcProjectionEvents`, whose revisions are never rewritten, so「分數如何隨時間變化」 is
   * answerable from the projection stream and「分數由什麼組成」 from here.
   *
   * `components` is `v.any()` for the reason every other derived payload in this schema is: the
   * shape is owned and validated by the pure module that writes it (`convex/story/heat.ts`), and a
   * second validator here would be a second place for the shape to be wrong.
   *
   * NO NARRATIVE TEXT. Component evidence carries ids, counts and world days only, so this table
   * cannot become a route around the publication gate.
   */
  storyArcHeatScores: defineTable({
    schemaVersion: v.literal(1),
    worldId: v.string(),
    arcId: v.string(),
    definitionVersion: v.number(),
    score: v.number(),
    measuredWeight: v.number(),
    components: v.any(),
    digest: v.string(),
    sourceEventId: v.string(),
    recordedAt: v.number(),
  })
    .index('by_world_and_arc', ['worldId', 'arcId'])
    .index('by_world', ['worldId']),
};
