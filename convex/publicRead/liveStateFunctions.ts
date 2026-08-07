/**
 * Convex wiring for the public Live-state projection (FR-I002, §13.1–13.4).
 *
 * An INDEPENDENT rebuild entry point: gathers accepted events, active arc
 * projections, and the latest published episode, derives the Live projection
 * (pure), and publishes it through the public read-model store as a `liveState`
 * model. It does NOT depend on the post-commit orchestrator (AC#4) — it can be
 * invoked by a cron, the orchestrator, or an operator. Public reads use the
 * generic {@link getPublishedReadModel} (modelKind `liveState`), which is
 * failure-isolated and triggers no generation (AC#2).
 */

import { v } from 'convex/values';
import { internalMutation, query } from '../_generated/server';
import { MISTWOOD_PUBLIC_WORLD_ID } from '../canon/mistwoodSeed';
import { rowToAcceptedEvent } from '../canon/serialize';
import { parseArcProjectionFields } from '../story/projection';
import { mistwoodRuntimeContext, type VisualRuntimeContext } from '../visualRuntime/mistwoodRuntime';
import { commitReadModelVersion, serveReadModel } from './readModel';
import { readStore, writeStore } from './readModelFunctions';
import {
  buildPublicDynamicProjection,
  seedPlacementsFromCharacterRows,
  selectPublicDynamicProjection,
  type PublicWorldStatus,
} from './publicDynamicProjection';
import { publicDynamicProjectionValidator } from './publicDynamicProjectionValidators';
import {
  LIVE_MODEL_KIND,
  LIVE_RECENT_EVENT_DEFAULT,
  buildLiveProjection,
  liveSourceEventIds,
  type LiveArcInput,
  type LivePublishedEpisodeInput,
} from './liveState';

type ArcLifecycleRow = { arcId: string; status: string };
type ArcProjectionEventRow = { arcId: string; revision: number; fields: unknown };
type DailyEpisodeRow = {
  status: string;
  worldDay: number;
  episode?: { keyScenes?: Array<{ title: string; summary: string; sourceEventIds: string[] }> };
};

/**
 * The map and bindings a world's motion is planned against. Only Mistwood has a Visual
 * Runtime today; any other world yields null and publishes `dynamic: null` rather than
 * being drawn on a map that was never authored for it.
 */
function visualRuntimeForWorld(worldId: string): VisualRuntimeContext | null {
  return worldId === MISTWOOD_PUBLIC_WORLD_ID ? mistwoodRuntimeContext() : null;
}

/**
 * Rebuild and publish the Live projection for a world. Idempotent: repeating the
 * call with unchanged inputs re-derives an identical payload and deduplicates.
 */
export const rebuildLiveProjection = internalMutation({
  args: { worldId: v.string(), now: v.number(), recentEventCount: v.optional(v.number()) },
  handler: async (ctx, args) => {
    if (args.worldId.trim().length === 0 || !Number.isFinite(args.now)) {
      throw new Error('LIVE_STATE_INVALID');
    }

    const [canonRows, lifecycleRows, projectionRows, episodeRows, characterRows, scheduleRow] = await Promise.all([
      ctx.db.query('canonEvents').withIndex('by_world_and_sequence', (q) => q.eq('worldId', args.worldId)).collect(),
      ctx.db.query('storyArcLifecycles').withIndex('by_world_and_arc', (q) => q.eq('worldId', args.worldId)).collect(),
      ctx.db.query('storyArcProjectionEvents').withIndex('by_world_arc_and_revision', (q) => q.eq('worldId', args.worldId)).collect(),
      ctx.db.query('dailyEpisodes').withIndex('by_world_and_day', (q) => q.eq('worldId', args.worldId)).collect(),
      ctx.db.query('worldCharacters').withIndex('by_world_id', (q) => q.eq('worldId', args.worldId)).collect(),
      ctx.db.query('worldSchedules').withIndex('by_world_id', (q) => q.eq('worldId', args.worldId)).unique(),
    ]);

    const acceptedEvents = canonRows.map(rowToAcceptedEvent);

    // Latest projection fields per arc.
    const latestFieldsByArc = new Map<string, { revision: number; fields: unknown }>();
    for (const row of projectionRows as ArcProjectionEventRow[]) {
      const prior = latestFieldsByArc.get(row.arcId);
      if (!prior || row.revision > prior.revision) latestFieldsByArc.set(row.arcId, { revision: row.revision, fields: row.fields });
    }
    const arcs: LiveArcInput[] = (lifecycleRows as ArcLifecycleRow[]).flatMap((lifecycle) => {
      const latest = latestFieldsByArc.get(lifecycle.arcId);
      if (!latest) return [];
      const fields = parseArcProjectionFields(latest.fields);
      return [{
        arcId: lifecycle.arcId,
        title: fields.title,
        currentQuestion: fields.currentQuestion,
        status: lifecycle.status,
      }];
    });

    // Latest published (ready) episode for the world.
    const publishedEpisode: LivePublishedEpisodeInput | null = (() => {
      const ready = (episodeRows as DailyEpisodeRow[])
        .filter((row) => row.status === 'ready' && row.episode?.keyScenes)
        .sort((a, b) => b.worldDay - a.worldDay)[0];
      if (!ready || !ready.episode?.keyScenes) return null;
      return {
        status: ready.status,
        keyScenes: ready.episode.keyScenes.map((scene) => ({
          title: scene.title, summary: scene.summary, sourceEventIds: scene.sourceEventIds,
        })),
      };
    })();

    const runtime = visualRuntimeForWorld(args.worldId);
    const worldStatus: PublicWorldStatus = scheduleRow?.status ?? 'unknown';
    const dynamic = runtime
      ? buildPublicDynamicProjection({
          worldId: args.worldId,
          nowMs: args.now,
          runtime,
          seedPlacements: seedPlacementsFromCharacterRows(characterRows),
          acceptedEvents,
          worldStatus,
          activeScenes: publishedEpisode?.keyScenes ?? [],
        })
      : null;

    const payload = buildLiveProjection({
      worldId: args.worldId,
      acceptedEvents,
      arcs,
      publishedEpisode,
      recentEventCount: args.recentEventCount ?? LIVE_RECENT_EVENT_DEFAULT,
      dynamic,
    });

    const result = await commitReadModelVersion(writeStore(ctx.db), {
      worldId: args.worldId,
      modelKind: LIVE_MODEL_KIND,
      modelRef: `live:${args.worldId}`,
      payload,
      sourceEventIds: liveSourceEventIds(payload),
      status: 'published',
      now: args.now,
    });
    return {
      modelRef: `live:${args.worldId}`,
      version: result.version,
      deduplicated: result.deduplicated,
      dynamicCharacterCount: dynamic?.characters.length ?? 0,
    };
  },
});

/**
 * Public read of the Dynamic Projection (FR-N003). Serves the already-published `liveState`
 * snapshot through the same store as every other public read, so it inherits the
 * last-known-good fallback for free: when a rebuild fails and the current version is marked
 * failed, this keeps serving the previous valid projection rather than nothing (AC#6).
 *
 * A query, not a mutation — there is no write anywhere on this path (AC#5). The payload is
 * re-validated on the way out so a version persisted under an older contract cannot reach a
 * client expecting the current one (AC#4).
 */
export const getPublicDynamicProjection = query({
  args: { worldId: v.string() },
  returns: v.union(publicDynamicProjectionValidator, v.null()),
  handler: async (ctx, args) => {
    const served = await serveReadModel(
      readStore(ctx.db),
      args.worldId,
      LIVE_MODEL_KIND,
      `live:${args.worldId}`,
    );
    if (!served) return null;
    return selectPublicDynamicProjection(served.payload);
  },
});
