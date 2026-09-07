import { defineTable } from 'convex/server';
import { v } from 'convex/values';

const recapType = v.union(v.literal('scene'), v.literal('episode'), v.literal('arc'), v.literal('season'), v.literal('viewer_context'));

export const recapTables = {
  recapSnapshots: defineTable({
    snapshotId: v.string(), schemaVersion: v.literal(1), worldId: v.string(), recapType, targetId: v.string(),
    sourceFromEventId: v.string(), sourceToEventId: v.string(), sourceFromSequenceNumber: v.number(),
    sourceToSequenceNumber: v.number(), content: v.string(), structuredPayload: v.any(), version: v.number(),
    generatedAt: v.number(),
  })
    .index('by_snapshot_id', ['snapshotId'])
    .index('by_target_and_version', ['worldId', 'recapType', 'targetId', 'version'])
    .index('by_target_and_time', ['worldId', 'recapType', 'targetId', 'generatedAt']),

  /**
   * The four FR-G003 recap formats for one daily Episode (ART-164).
   *
   * Its own table rather than a column on `dailyEpisodes`, for the reason `episodeShareFormats`
   * is separate too: the two carry different decisions. An Episode can be `ready` while its
   * recaps failed to compose — a world day with too little public content to reach 80 中文字 is a
   * real state — and the Episode must not be re-derived or re-graded because a recap could not be
   * written.
   *
   * `formats` is `v.any()` and validated by `validateRecapFormats` on the way in and on the way
   * out, matching `dailyEpisodes.episode`. `failed` rows deliberately leave it UNSET: a recap the
   * length contract refused is not stored where a later reader could mistake its existence for
   * permission to publish it.
   *
   * `formatterVersion` is stored rather than inferred so a future composition change never leaves
   * an older row unidentifiable, and `composition` records what was dropped — truncation is never
   * silent here any more than anywhere else.
   */
  episodeRecapFormats: defineTable({
    schemaVersion: v.literal(1),
    formatterVersion: v.number(),
    worldId: v.string(),
    worldDay: v.number(),
    episodeNumber: v.number(),
    status: v.union(v.literal('ready'), v.literal('failed')),
    formats: v.optional(v.any()),
    composition: v.optional(v.any()),
    /** Accepted events the composed text actually accounts for. */
    sourceEventIds: v.array(v.string()),
    errorCode: v.optional(v.string()),
    errorDetails: v.optional(v.any()),
    createdAt: v.number(),
  })
    .index('by_world_and_day', ['worldId', 'worldDay'])
    .index('by_world_and_episode', ['worldId', 'episodeNumber'])
    .index('by_world_and_status', ['worldId', 'status']),
};
