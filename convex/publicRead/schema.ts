import { defineTable } from 'convex/server';
import { v } from 'convex/values';

import {
  publicActiveSceneValidator,
  publicCharacterMotionValidator,
} from './publicDynamicProjectionValidators';
import { publicRuntimeSnapshotStatusValidator } from './runtimeSnapshotValidators';

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

  /**
   * Durable public runtime snapshots (FR-N007, PRD 2.0 §14.3).
   *
   * Separate from `publishedReadModels` on purpose: a snapshot needs a wall-clock
   * `observedAt` that advances when a heartbeat re-observes unchanged content, which a
   * `contentHash`-deduplicated payload cannot carry without either polluting the hash
   * (a new row every heartbeat) or silently dropping the observation.
   *
   * `status` is `live | paused` only. `delayed` and `stale` are derived at read time from
   * elapsed clock, never written, so no row can claim to be fresher than it is.
   *
   * Deliberately absent from `TablesToVacuum` in `convex/crons.ts`: vacuuming by
   * `_creationTime` would delete a long-paused world's only remaining snapshot.
   */
  publicRuntimeSnapshots: defineTable({
    schemaVersion: v.literal(1),
    worldId: v.string(),
    runtimeVersion: v.number(),
    /** This table's own monotonic counter, starting at 1. Never regresses. */
    snapshotSequence: v.number(),
    /** The Canon-derived `PublicDynamicProjection.snapshotSequence` this was built from. */
    sourceRuntimeSequence: v.number(),
    status: publicRuntimeSnapshotStatusValidator,
    mapId: v.string(),
    characterStates: v.array(publicCharacterMotionValidator),
    activeSceneStates: v.array(publicActiveSceneValidator),
    /** The source projection's `updatedAt` — Canon-derived, not a clock read. */
    contentUpdatedAt: v.number(),
    contentHash: v.string(),
    createdAt: v.number(),
    /** Last time a capture confirmed this content and status were still current. */
    observedAt: v.number(),
    /** True for the head snapshot. Exactly one per world. */
    isCurrent: v.boolean(),
  })
    .index('by_world_and_current', ['worldId', 'isCurrent'])
    .index('by_world_and_sequence', ['worldId', 'snapshotSequence']),
};
