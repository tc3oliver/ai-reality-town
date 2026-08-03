import { defineTable } from 'convex/server';
import { v } from 'convex/values';

export const editorialTables = {
  dailyEpisodes: defineTable({
    schemaVersion: v.literal(1), worldId: v.string(), worldDay: v.number(), episodeNumber: v.number(),
    status: v.union(v.literal('ready'), v.literal('withheld'), v.literal('failed')),
    episode: v.optional(v.any()), safetyClassificationId: v.optional(v.string()), errorCode: v.optional(v.string()),
    sourceEventIds: v.array(v.string()), createdAt: v.number(),
  })
    .index('by_world_and_day', ['worldId', 'worldDay'])
    .index('by_world_and_episode', ['worldId', 'episodeNumber']),

  // Independent publication lifecycle (FR-K004). Separate from canon: rows here
  // govern only the visibility of derived public content. Deleting/superseding
  // a record never touches an accepted Canon Event.
  publicationRecords: defineTable({
    schemaVersion: v.literal(1),
    worldId: v.string(),
    contentKind: v.literal('episode'),
    contentRef: v.string(),
    publicationId: v.string(),
    status: v.union(
      v.literal('generated'),
      v.literal('validated'),
      v.literal('safety_review'),
      v.literal('ready'),
      v.literal('published'),
      v.literal('withheld'),
      v.literal('superseded'),
    ),
    version: v.number(),
    summary: v.optional(v.string()),
    audit: v.array(v.any()),
    // True for the live (non-superseded) record of a contentRef. Exactly one
    // current record per (worldId, contentRef) is maintained by the wiring.
    isCurrent: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_world_and_content', ['worldId', 'contentRef'])
    .index('by_current', ['worldId', 'contentRef', 'isCurrent'])
    .index('by_world_and_status', ['worldId', 'status']),
};
