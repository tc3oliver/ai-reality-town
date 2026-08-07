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
import type { AcceptedEvent } from '../canon/model';
import { emptyProjection } from '../canon/model';
import { MISTWOOD_PUBLIC_WORLD_ID } from '../canon/mistwoodSeed';
import { replayWorldEvents } from '../canon/replay';
import { rowToAcceptedEvent } from '../canon/serialize';
import { parseArcProjectionFields } from '../story/projection';
import { detectUnboundCharacters } from '../visualRuntime/characterBindings';
import { mistwoodRuntimeContext, type VisualRuntimeContext } from '../visualRuntime/mistwoodRuntime';
import { buildActiveScenePresentations, type SceneArcMembership } from './activeScenePresentation';
import { detectLocationMismatches } from './canonRuntimeMismatch';
import { toIncident, type DynamicViewIncident } from './dynamicViewMetrics';
import { commitDynamicViewMetrics, dynamicViewMetricsWriteStore } from './dynamicViewMetricsFunctions';
import { commitReadModelVersion, serveReadModel } from './readModel';
import { readStore, writeStore } from './readModelFunctions';
import {
  buildPublicDynamicProjectionResult,
  excludedCharacterIds,
  seedPlacementsFromCharacterRows,
  selectPublicDynamicProjection,
  type AttributedRuntimeProblem,
  type PublicDynamicProjection,
  type PublicWorldStatus,
} from './publicDynamicProjection';
import { publicDynamicProjectionValidator } from './publicDynamicProjectionValidators';
import { commitRuntimeSnapshot } from './runtimeSnapshot';
import { runtimeSnapshotWriteStore } from './runtimeSnapshotFunctions';
import {
  VISUAL_REPLAY_MODEL_KIND,
  buildVisualReplay,
  type ReplayEpisodeInput,
  type ReplayPublicationRecord,
  type VisualReplay,
} from './visualReplay';
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
type ArcClassificationRow = { sourceEventSequenceNumber: number; memberships?: unknown };
/** `memberships` is `v.any()` in the schema, so it is read as untyped storage. */
type ClassificationMembership = { arcId?: unknown; importance?: unknown };
type PublicationRecordRow = { contentRef: string; status: string; version: number; isCurrent: boolean };
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
 * Canon's own answer to "where is everyone", folded independently of the Visual Runtime so
 * the two can be compared (FR-Q001 AC#4). Costs no extra database read — `canonRows` is
 * already collected above — only an O(events) pure fold.
 *
 * A fold that throws yields `null` rather than propagating. `replayWorldEvents` fails hard
 * on a sequence gap or duplicate, which is correct for Canon but must not take the PUBLIC
 * READ PATH down with it: a projection nobody can compare against Canon is still a
 * projection worth serving, and public read availability is isolated from simulation
 * failure by design. The consequence is stated rather than hidden — mismatch detection is
 * skipped for this pass, and `canonComparable` in the mutation's result says so.
 */
export function canonCharacterLocations(
  worldId: string,
  acceptedEvents: readonly AcceptedEvent[],
): Record<string, string> | null {
  try {
    return replayWorldEvents(emptyProjection(worldId), [...acceptedEvents]).characterLocations;
  } catch {
    return null;
  }
}

/**
 * Everything wrong with this rebuild, attributed.
 *
 * Three independent detectors, deliberately not merged into one pass: the runtime's own
 * problems come from planning, the mismatch comes from comparing two derivations, and the
 * missing sprite comes from the binding set the planner never consults. Each answers a
 * different question, and folding them together would make a single detector's failure
 * look like a clean world.
 */
export function collectIncidents(args: {
  readonly dynamic: PublicDynamicProjection;
  readonly runtime: VisualRuntimeContext;
  readonly problems: readonly AttributedRuntimeProblem[];
  readonly canonLocations: Record<string, string> | null;
}): DynamicViewIncident[] {
  const { dynamic, runtime, problems, canonLocations } = args;
  const motionSequences = new Map(dynamic.characters.map((motion) => [motion.characterId, motion.motionSequence]));

  const planningIncidents = problems.map((problem) =>
    toIncident(problem, dynamic.snapshotSequence, motionSequences.get(problem.characterId)));

  const unboundCharacters = detectUnboundCharacters(
    dynamic.characters.map((motion) => ({
      characterId: motion.characterId,
      locationId: motion.semanticLocationId,
    })),
    runtime.characterBindings,
  ).map((problem) =>
    toIncident(problem, dynamic.snapshotSequence, motionSequences.get(problem.characterId)));

  const mismatches = canonLocations
    ? detectLocationMismatches({
      characters: dynamic.characters,
      canonLocations,
      snapshotSequence: dynamic.snapshotSequence,
    })
    : [];

  return [...planningIncidents, ...unboundCharacters, ...mismatches];
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

    const [
      canonRows, lifecycleRows, projectionRows, episodeRows, characterRows, scheduleRow, classificationRows,
      publicationRows,
    ] = await Promise.all([
      ctx.db.query('canonEvents').withIndex('by_world_and_sequence', (q) => q.eq('worldId', args.worldId)).collect(),
      ctx.db.query('storyArcLifecycles').withIndex('by_world_and_arc', (q) => q.eq('worldId', args.worldId)).collect(),
      ctx.db.query('storyArcProjectionEvents').withIndex('by_world_arc_and_revision', (q) => q.eq('worldId', args.worldId)).collect(),
      ctx.db.query('dailyEpisodes').withIndex('by_world_and_day', (q) => q.eq('worldId', args.worldId)).collect(),
      ctx.db.query('worldCharacters').withIndex('by_world_id', (q) => q.eq('worldId', args.worldId)).collect(),
      ctx.db.query('worldSchedules').withIndex('by_world_id', (q) => q.eq('worldId', args.worldId)).unique(),
      // The arc membership of each event (FR-O003 AC#6). `publicRead` already depends on
      // `story`, so this is a seventh parallel read rather than a new module dependency.
      ctx.db.query('storyArcEventClassifications').withIndex('by_world', (q) => q.eq('worldId', args.worldId)).collect(),
      // The publication lifecycle of each derived text (FR-O013 / ART-121). `publicRead`
      // already depends on `editorial`, so this is an eighth parallel read rather than a new
      // module dependency. Read here and passed to the replay builder as a plain map, so the
      // builder stays pure and the version a reference pins is the one that was current when
      // the replay was built.
      ctx.db.query('publicationRecords').withIndex('by_world_and_status', (q) => q.eq('worldId', args.worldId)).collect(),
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

    // Read defensively rather than through `parseArcEventClassification`, matching the three
    // sibling projections in this directory: the strict parser throws on a malformed row,
    // and a classification nobody can parse must cost this rebuild an arc label, not the
    // whole public read path (the same isolation `canonCharacterLocations` states above).
    const arcMemberships: SceneArcMembership[] = (classificationRows as ArcClassificationRow[]).flatMap((row) => {
      const memberships = row.memberships as ClassificationMembership[] | undefined;
      if (!Array.isArray(memberships)) return [];
      const arcIds = memberships
        .map((membership) => membership.arcId)
        .filter((arcId): arcId is string => typeof arcId === 'string' && arcId.length > 0);
      // The strongest membership decides the event's story weight, which is what FR-O013's
      // scene selection ranks by. Read as defensively as `arcId` is, for the same reason.
      const importance = memberships
        .map((membership) => membership.importance)
        .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
        .reduce((best, value) => Math.max(best, value), 0);
      return arcIds.length > 0
        ? [{ sourceEventSequenceNumber: row.sourceEventSequenceNumber, arcIds, importance }]
        : [];
    });

    // Derived once and published to both the map's projection and the text Live view, so the
    // two can never disagree about which scene is current (FR-O003 AC#7).
    const presentation = buildActiveScenePresentations({
      acceptedEvents,
      arcMemberships,
      publishedEpisodeScenes: publishedEpisode?.keyScenes ?? [],
      excludedCharacterIds: excludedCharacterIds(acceptedEvents),
    });

    const runtime = visualRuntimeForWorld(args.worldId);
    const worldStatus: PublicWorldStatus = scheduleRow?.status ?? 'unknown';
    const derived = runtime
      ? buildPublicDynamicProjectionResult({
          worldId: args.worldId,
          nowMs: args.now,
          runtime,
          seedPlacements: seedPlacementsFromCharacterRows(characterRows),
          acceptedEvents,
          worldStatus,
          activeScenes: presentation.scenes,
        })
      : null;
    const dynamic = derived?.projection ?? null;

    const payload = buildLiveProjection({
      worldId: args.worldId,
      acceptedEvents,
      arcs,
      publishedEpisode,
      activeScenes: presentation.scenes,
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

    // The Visual Replay (FR-O013 / ART-121), derived from the rows this handler already
    // collected plus the publication records read above. Wrapped, and `null` on any throw:
    // a replay that cannot be built is a viewer arriving to a live map with no replay, which
    // is the PRD's own failure behaviour — and it must never be able to fail the rebuild that
    // publishes the map itself. Same isolation `canonCharacterLocations` states above.
    const episodesForReplay: ReplayEpisodeInput[] = (episodeRows as DailyEpisodeRow[]).map((row) => ({
      worldDay: row.worldDay,
      status: row.status,
      keyScenes: row.episode?.keyScenes ?? [],
    }));
    const publicationRecords = new Map<string, ReplayPublicationRecord>();
    for (const row of publicationRows as PublicationRecordRow[]) {
      if (!row.isCurrent) continue;
      publicationRecords.set(row.contentRef, { version: row.version, status: row.status });
    }
    let replay: VisualReplay | null = null;
    let replayBuildFailed = false;
    try {
      replay = runtime
        ? buildVisualReplay({
            worldId: args.worldId,
            acceptedEvents,
            arcMemberships,
            excludedCharacterIds: excludedCharacterIds(acceptedEvents),
            runtime,
            episodes: episodesForReplay,
            publicationRecords,
          })
        : null;
    } catch {
      replayBuildFailed = true;
    }
    const replayResult = replay
      ? await commitReadModelVersion(writeStore(ctx.db), {
          worldId: args.worldId,
          modelKind: VISUAL_REPLAY_MODEL_KIND,
          modelRef: `replay:${args.worldId}`,
          payload: replay as unknown as Parameters<typeof commitReadModelVersion>[1]['payload'],
          sourceEventIds: replay.sourceEventIds,
          status: 'published',
          now: args.now,
        })
      : null;
    // Capture the durable runtime snapshot (FR-N007) by a direct call inside THIS
    // transaction, not by dispatching a separate mutation: a snapshot failure then rolls the
    // whole rebuild back atomically instead of leaving a published projection with no
    // snapshot behind it. Canon is unaffected either way — this transaction writes no Canon.
    const snapshot = dynamic
      ? await commitRuntimeSnapshot(runtimeSnapshotWriteStore(ctx.db), {
          worldId: args.worldId,
          dynamic,
          worldStatus,
          now: args.now,
        })
      : null;

    // FR-Q001 metrics ride in the SAME transaction, for the reason stated above the
    // snapshot: a rebuild that published a projection but lost the record of what was
    // wrong with it is worse than a rebuild that failed. `updatedAt` is the last accepted
    // event's `acceptedAt`, so this latency is end-to-end — Canon fact to public
    // projection — not the handler's own duration. A world with no history has
    // `snapshotSequence === 0` and no fact to measure from, so it records 0 rather than
    // the distance to the Unix epoch.
    const canonLocations = dynamic ? canonCharacterLocations(args.worldId, acceptedEvents) : null;
    const incidents = dynamic && runtime
      ? collectIncidents({ dynamic, runtime, problems: derived?.problems.records ?? [], canonLocations })
      : [];
    const latencyMs = dynamic && dynamic.snapshotSequence > 0 ? Math.max(0, args.now - dynamic.updatedAt) : 0;
    if (dynamic && runtime) {
      await commitDynamicViewMetrics(dynamicViewMetricsWriteStore(ctx.db), {
        worldId: args.worldId,
        incidents,
        latencyMs,
        snapshotSequence: dynamic.snapshotSequence,
        now: args.now,
      });
    }
    const countOf = (code: DynamicViewIncident['code']): number =>
      incidents.filter((incident) => incident.code === code).length;

    // `dynamicProblem*` is the operator-facing half of the rebuild (FR-N006 / ART-117): a
    // character the Visual Runtime could not place is omitted from the payload rather than
    // guessed at, which is correct but silent. Counted here so the omission is reachable
    // from outside; the attributed rows are in `dynamicViewIncidents` (FR-Q001).
    return {
      modelRef: `live:${args.worldId}`,
      version: result.version,
      deduplicated: result.deduplicated,
      dynamicCharacterCount: dynamic?.characters.length ?? 0,
      // Which scene producer answered, without anyone having to read the payload to find
      // out (FR-O003 AC#7/#8). `degraded` for a run of rebuilds means the world has stopped
      // producing placeable events; `none` means it never has.
      activeSceneCount: presentation.scenes.length,
      activeSceneMode: presentation.mode,
      // FR-O013 observability. `replayBuildFailed` is the one that matters operationally: a
      // null replay is ordinary (a world whose only activity is the current slot has nothing
      // completed to show), whereas a *failed* build is a defect that would otherwise be
      // swallowed by the catch above.
      replaySceneCount: replay?.scenes.length ?? 0,
      replayVersion: replayResult?.version ?? null,
      replayBuildFailed,
      snapshotSequence: snapshot?.snapshotSequence ?? null,
      dynamicProblemCount: derived?.problems.total ?? 0,
      dynamicProblemsByCode: derived?.problems.byCode ?? {},
      latencyMs,
      mismatchCount: countOf('CANON_RUNTIME_LOCATION_MISMATCH'),
      unboundCharacterCount: countOf('VISUAL_RUNTIME_UNBOUND_CHARACTER'),
      canonComparable: canonLocations !== null,
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
