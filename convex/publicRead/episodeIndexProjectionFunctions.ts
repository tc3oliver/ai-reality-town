/**
 * Convex wiring for the public Episode Index projection (PRD §13.10, FR-I004).
 *
 * An INDEPENDENT rebuild entry point: gathers eligible published editorial
 * episodes, the arc recommended-entry points (ART-67), and each arc's latest
 * turning-point event, derives the index (pure), and publishes it through the
 * public read-model store as an `episode` model (modelRef `episodes:<worldId>`).
 * Public reads reuse the generic failure-isolated getPublishedReadModel. Like
 * the sibling projection writers, it is an internal mutation invoked by the
 * projection rebuild trigger and never by public visitors.
 */

import { v } from 'convex/values';
import { internalMutation } from '../_generated/server';
import type { DailyEpisode } from '../editorial/episode';
import { parseArcProjectionFields } from '../story/projection';
import { commitReadModelVersion } from './readModel';
import { writeStore } from './readModelFunctions';
import {
  EPISODE_INDEX_MODEL_KIND,
  EpisodeIndexError,
  buildEpisodeIndex,
  type EpisodeIndexEntryInput,
} from './episodeIndexProjection';

type DailyEpisodeRow = {
  status: string;
  worldDay: number;
  episode?: DailyEpisode;
};
type RecommendedEntryRow = { entry: unknown };
type ArcProjectionEventRow = { arcId: string; revision: number; fields: unknown };

/**
 * Rebuild and publish the Episode Index projection for a world. Idempotent:
 * unchanged inputs re-derive an identical payload and deduplicate.
 */
export const rebuildEpisodeIndexProjection = internalMutation({
  args: { worldId: v.string(), now: v.number() },
  handler: async (ctx, args) => {
    if (args.worldId.trim().length === 0 || !Number.isFinite(args.now)) {
      throw new EpisodeIndexError('EPISODE_INDEX_INVALID', 'worldId and a finite now are required');
    }

    const [episodeRows, recommendedRows, projectionRows] = await Promise.all([
      ctx.db.query('dailyEpisodes').withIndex('by_world_and_day', (q) => q.eq('worldId', args.worldId)).collect(),
      ctx.db.query('storyArcRecommendedEntries').withIndex('by_world', (q) => q.eq('worldId', args.worldId)).collect(),
      ctx.db.query('storyArcProjectionEvents').withIndex('by_world_arc_and_revision', (q) => q.eq('worldId', args.worldId)).collect(),
    ]);

    const episodes: EpisodeIndexEntryInput[] = (episodeRows as DailyEpisodeRow[])
      .filter((row) => row.episode)
      .map((row) => {
        const episode = row.episode as DailyEpisode;
        return {
          worldDay: episode.worldDay,
          episodeNumber: episode.episodeNumber,
          title: episode.title,
          headline: episode.headline,
          status: row.status,
          arcIds: episode.arcIds,
          characterIds: episode.characterIds,
          sourceEventIds: episode.sourceEventIds,
        };
      });

    // Recommended-entry world days (ART-67).
    const recommendedEntryWorldDays = new Set<number>();
    for (const row of recommendedRows as RecommendedEntryRow[]) {
      const entry = row.entry as { worldDay?: number } | null;
      if (entry && typeof entry.worldDay === 'number') recommendedEntryWorldDays.add(entry.worldDay);
    }

    // Each arc's latest turning-point event id (latest revision per arc).
    const latestFieldsByArc = new Map<string, { revision: number; fields: unknown }>();
    for (const row of projectionRows as ArcProjectionEventRow[]) {
      const prior = latestFieldsByArc.get(row.arcId);
      if (!prior || row.revision > prior.revision) latestFieldsByArc.set(row.arcId, { revision: row.revision, fields: row.fields });
    }
    const turningPointEventIds = new Set<string>();
    for (const { fields } of latestFieldsByArc.values()) {
      const turningPoint = parseArcProjectionFields(fields).latestTurningPointEventId;
      if (turningPoint) turningPointEventIds.add(turningPoint);
    }

    const payload = buildEpisodeIndex({ worldId: args.worldId, episodes, recommendedEntryWorldDays, turningPointEventIds });
    const result = await commitReadModelVersion(writeStore(ctx.db), {
      worldId: args.worldId,
      modelKind: EPISODE_INDEX_MODEL_KIND,
      modelRef: `episodes:${args.worldId}`,
      payload,
      sourceEventIds: payload.episodes.flatMap((entry) => [`day:${entry.worldDay}`]),
      status: 'published',
      now: args.now,
    });
    return { modelRef: `episodes:${args.worldId}`, version: result.version, deduplicated: result.deduplicated };
  },
});
