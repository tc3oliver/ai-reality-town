/**
 * Viewer-domain tables (FR-H005, ART-70).
 *
 * Forward-compatible schema declarations: the `viewerEpisodeProgress` table
 * records which episodes a viewer has watched, enabling the future "Watched
 * Episodes Only" spoiler mode ({@link ./spoilerMode.ts}). It is declared here
 * so the data model does not block P2 spoiler support (AC#1) but is NOT
 * populated by MVP behavior (AC#2) — nothing in the committed codebase writes
 * to it yet, so adding it is non-destructive.
 */

import { defineTable } from 'convex/server';
import { v } from 'convex/values';

export const viewerTables = {
  /**
   * Per-viewer, per-episode watched progress. `viewerKey` is an opaque
   * viewer/device identifier (auth subject or device id); one row per watched
   * (worldId, viewerKey, worldDay). Indexed for fast "has this viewer watched
   * day N" lookups that the watchedOnly mode needs.
   */
  viewerEpisodeProgress: defineTable({
    worldId: v.string(),
    viewerKey: v.string(),
    worldDay: v.number(),
    episodeNumber: v.optional(v.number()),
    watchedAt: v.number(),
  }).index('by_viewer_world_day', ['worldId', 'viewerKey', 'worldDay']),
};
