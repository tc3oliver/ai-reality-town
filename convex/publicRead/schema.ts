import { defineTable } from 'convex/server';
import { v } from 'convex/values';

/**
 * Publication-gated public read-model store (NFR-001/002/005, §16.3).
 *
 * Public reads consult ONLY this table — never canon, simulation, or any
 * provider — so read availability is isolated from simulation/model failure.
 * Each row is an allowlisted, pre-computed projection snapshot. Versioning +
 * last-known-good retention keep a servable version available when the current
 * one is withheld or fails.
 */
export const publicReadTables = {
  publishedReadModels: defineTable({
    schemaVersion: v.literal(1),
    worldId: v.string(),
    modelKind: v.union(
      v.literal('world'), v.literal('character'), v.literal('episode'),
      v.literal('arc'), v.literal('relationship'), v.literal('liveState'), v.literal('timeline'),
    ),
    modelRef: v.string(),
    version: v.number(),
    // Allowlisted public projection JSON. Private fields are stripped before
    // insert by the pure layer; the query re-sanitises defensively on read.
    payload: v.any(),
    status: v.union(
      v.literal('publishing'), v.literal('published'),
      v.literal('withheld'), v.literal('failed'),
    ),
    sourceEventIds: v.array(v.string()),
    // True for the live version of a target. Exactly one current per
    // (worldId, modelKind, modelRef) is maintained by the wiring.
    isCurrent: v.boolean(),
    // True for the retained fallback served when current is withheld/failed.
    isLastKnownGood: v.boolean(),
    contentHash: v.string(),
    createdAt: v.number(),
    publishedAt: v.optional(v.number()),
    updatedAt: v.number(),
  })
    .index('by_current', ['worldId', 'modelKind', 'modelRef', 'isCurrent'])
    .index('by_target_and_version', ['worldId', 'modelKind', 'modelRef', 'version'])
    .index('by_status', ['worldId', 'modelKind', 'status'])
    .index('by_lkg', ['worldId', 'modelKind', 'modelRef', 'isLastKnownGood']),
};
