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
};
