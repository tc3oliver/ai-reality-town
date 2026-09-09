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
import {
  PUBLICATION_STATUSES,
  isViewerServablePublicationStatus,
} from '../editorial/publicationLifecycle';
import { parseArcProjectionFields } from '../story/projection';
import { commitReadModelVersion } from './readModel';
import { episodeContentRefOf } from './visualReplay';
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
type PublicationRecordRow = { contentRef: string; status: string; isCurrent: boolean };

/**
 * The publication statuses that take content OFF the surface — the complement of
 * {@link VIEWER_SERVABLE_PUBLICATION_STATUSES}, derived rather than restated so a new status
 * cannot land on the servable side by being forgotten here.
 */
const NON_SERVABLE_PUBLICATION_STATUSES = PUBLICATION_STATUSES
  .filter((status) => !isViewerServablePublicationStatus(status));

/**
 * The world day an `episode:<worldId>:<worldDay>` content reference addresses, or `null`.
 *
 * Parsed against the reference this world would MINT rather than by splitting on colons: a world
 * id may contain one, and a reference for another content kind — `episode_share` rides the same
 * lifecycle — must not be read as an Episode.
 */
function worldDayOfEpisodeContentRef(worldId: string, contentRef: string): number | null {
  const prefix = `${episodeContentRefOf(worldId, 0).slice(0, -1)}`;
  if (!contentRef.startsWith(prefix)) return null;
  const worldDay = Number(contentRef.slice(prefix.length));
  return Number.isSafeInteger(worldDay) && worldDay >= 0 ? worldDay : null;
}
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

    const [episodeRows, recommendedRows, projectionRows, ...withheldGroups] = await Promise.all([
      ctx.db.query('dailyEpisodes').withIndex('by_world_and_day', (q) => q.eq('worldId', args.worldId)).collect(),
      ctx.db.query('storyArcRecommendedEntries').withIndex('by_world', (q) => q.eq('worldId', args.worldId)).collect(),
      ctx.db.query('storyArcProjectionEvents').withIndex('by_world_arc_and_revision', (q) => q.eq('worldId', args.worldId)).collect(),
      /**
       * The days an administrator's publication decision has taken off the surface (ART-174).
       *
       * Read from the RECORD side — one indexed sweep per non-servable status — rather than as a
       * lookup per indexed day. This rebuild already collects every `dailyEpisodes` row in the
       * world; multiplying that by a point read is the pattern ART-100 removed from this pipeline,
       * and the number of withheld days is small by construction while the number of days is not.
       */
      ...NON_SERVABLE_PUBLICATION_STATUSES.map((status) => ctx.db
        .query('publicationRecords')
        .withIndex('by_world_and_status', (q) => q.eq('worldId', args.worldId).eq('status', status))
        .collect()),
    ]);

    const withheldWorldDays = new Set<number>();
    for (const row of withheldGroups.flat() as PublicationRecordRow[]) {
      // `isCurrent` is the whole point: a superseded record for a day that was later republished
      // must not withhold it. The status sweep finds both, and only the live one decides.
      if (!row.isCurrent) continue;
      const worldDay = worldDayOfEpisodeContentRef(args.worldId, row.contentRef);
      if (worldDay !== null) withheldWorldDays.add(worldDay);
    }

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

    const payload = buildEpisodeIndex({
      worldId: args.worldId, episodes, recommendedEntryWorldDays, turningPointEventIds, withheldWorldDays,
    });
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
