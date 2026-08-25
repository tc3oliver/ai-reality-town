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
import { readWithheldSceneLabels } from '../safety/effectiveSafetyLabels';
import { parseArcProjectionFields } from '../story/projection';
import { detectUnboundCharacters } from '../visualRuntime/characterBindings';
import { mistwoodRuntimeContext, type VisualRuntimeContext } from '../visualRuntime/mistwoodRuntime';
import {
  buildActiveScenePresentations,
  type SceneArcMembership,
  type SceneEventLike,
  type SceneSafetyLabel,
} from './activeScenePresentation';
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
import {
  applyDynamicViewControls,
  resolveDynamicViewControlRows,
} from '../shared/dynamicViewControls';
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
 * Lift the Scene provenance an accepted event carries into the field the scene resolver reads
 * (FR-P004 / ART-132).
 *
 * `metadata` is untyped storage, so the value is read defensively: anything that is not a
 * non-empty string is treated as absent, and an event with no Scene provenance is presented
 * exactly as it was before this task — the safety gate governs Scenes, and an event that
 * belongs to none was never classified in the first place.
 *
 * This is the ONLY place `metadata` is read on the public path. `SceneEventLike` names a single
 * new identifier and no new text, so the resolver's privacy boundary is unchanged.
 */
export function sceneEventRows(events: readonly AcceptedEvent[]): SceneEventLike[] {
  return events.map((event) => {
    const sceneId = event.metadata?.sceneId;
    return typeof sceneId === 'string' && sceneId.length > 0 ? { ...event, sceneId } : event;
  });
}

/**
 * The ids of the events whose Scene the safety gate currently refuses (FR-P004 / ART-132).
 *
 * Every redaction below is keyed on the EVENT ID this returns, never on a position in a
 * parallel array. Correlating two arrays by index would work today — `sceneEventRows` is a 1:1
 * `.map()` — and would silently start redacting events against their neighbour's verdict the
 * day anyone put a `.filter()` upstream of it, publishing withheld text and withholding
 * published text in the same pass, with nothing in the type system objecting.
 */
export function withheldEventIds(
  sceneEvents: readonly SceneEventLike[],
  // A `Map` of refused Scenes to their labels and a bare `Set` of refused Scene ids both
  // satisfy this; only membership is asked, and only refused Scenes are ever in either.
  withheldScenes: { has(sceneId: string): boolean },
): Set<string> {
  const withheld = new Set<string>();
  for (const event of sceneEvents) {
    if (event.sceneId !== undefined && withheldScenes.has(event.sceneId)) withheld.add(event.eventId);
  }
  return withheld;
}

/**
 * Drop the public summary of every event whose Scene the safety gate refuses (FR-P004 /
 * ART-132, AC#1/#6).
 *
 * The redaction happens at REBUILD time, not at read time, because the public read path serves
 * published snapshots and nothing else: a summary the gate refuses must never be written into
 * the `liveState` payload in the first place, or a later read would have to be trusted to
 * filter it, and the last-known-good fallback would happily keep serving the unfiltered version
 * long after the override. An operator override re-runs this rebuild, so a withhold takes
 * effect immediately, and the Visual Replay — which resolves a `canonEventSummary` reference
 * out of exactly this payload's `recentEvents` — stops resolving that sentence at the same
 * moment, without the read-time resolver needing a rule of its own.
 *
 * Only `publicSummary` is dropped. Every other field, including `stateChanges`, survives, which
 * is what keeps positions identical whether or not a scene is withheld (AC#4). Canon is not
 * touched: this maps a value read out of the database, it does not write one back.
 */
export function redactWithheldSummaries(
  events: readonly AcceptedEvent[],
  withheld: ReadonlySet<string>,
): AcceptedEvent[] {
  return events.map((event) => {
    if (!withheld.has(event.eventId)) return event;
    const redacted: AcceptedEvent = { ...event };
    delete redacted.publicSummary;
    return redacted;
  });
}

/** A published key scene, as both consumers of the redaction below describe one. */
type KeySceneLike = {
  readonly title: string;
  readonly summary: string;
  readonly sourceEventIds: readonly string[];
};

/**
 * Neutralise every published key scene that narrates a withheld event (FR-P004 / ART-132, AC#6).
 *
 * Dropping the event's own `publicSummary` is not enough on its own, and this is the hole that
 * closes here. A day's episode narrates SEVERAL events in one key scene, and both the live
 * overlay (`narrationForEvents`) and the Visual Replay (`resolveEventCardStep`) PREFER that
 * narration when it exists — the replay's `episodeScene` branch resolves it from
 * `publicationRecords` and the episode body, gated only on the episode's publication version
 * and status, which know nothing about scene-level safety. So on any day with a published
 * episode, the overlay would show the safe placeholder while the replay narrated the withheld
 * content, for the same scene, at the same time.
 *
 * The neutralised scene keeps its POSITION in the array and loses its `sourceEventIds`, which is
 * what makes it unmatchable and therefore unaddressable: `narrationForEvents` can no longer
 * select it, so no replay step is ever built naming its index. Removing the entry instead would
 * shift every later index, and the read-time resolver looks the summary up by index in the REAL
 * `dailyEpisodes` row — it would then serve a different scene's text under this one's address.
 *
 * A key scene covering a withheld event AND an allowed one is neutralised whole. Its text is a
 * joint narration of both; publishing it would publish the withheld half.
 */
export function redactWithheldNarration<T extends KeySceneLike>(
  keyScenes: readonly T[],
  withheld: ReadonlySet<string>,
): T[] {
  return keyScenes.map((scene) => (
    scene.sourceEventIds.some((eventId) => withheld.has(eventId))
      ? { ...scene, title: '', summary: '', sourceEventIds: [] }
      : scene
  ));
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
  args: {
    worldId: v.string(),
    now: v.number(),
    recentEventCount: v.optional(v.number()),
    /**
     * A Scene id an operator has just decided about, for the truthful "how much did that
     * actually change" signal FR-P004 owes them. Answered from rows this handler already holds,
     * so it costs no read; see `correlatedEventCount` in the result.
     */
    correlateSceneId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (args.worldId.trim().length === 0 || !Number.isFinite(args.now)) {
      throw new Error('LIVE_STATE_INVALID');
    }

    const [
      canonRows, lifecycleRows, projectionRows, episodeRows, characterRows, scheduleRow, classificationRows,
      publicationRows, withheldSceneRecord,
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
      // The Scenes the safety gate currently refuses (FR-P004 / ART-132). A ninth parallel
      // read, and deliberately the INVERTED question: asking "what governs each Scene in
      // history" would grow with the world and eventually fail this whole rebuild, which is
      // the one failure that would stop future safety updates from ever reaching a viewer.
      // See `readWithheldSceneLabels`.
      readWithheldSceneLabels(ctx.db, args.worldId),
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

    // The safety gate (FR-P004 / ART-132), applied at REBUILD time rather than at read time:
    // the public read path serves published snapshots only, so a refused sentence must never be
    // written into one. An operator override re-runs this rebuild, which is what makes a
    // withhold take effect at once. `withheldSceneRecord` holds only the Scenes currently
    // refused; every Scene absent from it is showable.
    const sceneSafetyLabels = new Map<string, SceneSafetyLabel>(Object.entries(withheldSceneRecord));
    const sceneEvents = sceneEventRows(acceptedEvents);
    const withheldEvents = withheldEventIds(sceneEvents, sceneSafetyLabels);
    // The episode's narration is redacted alongside the events' own summaries, because BOTH
    // the overlay and the replay prefer narration when it exists — see `redactWithheldNarration`.
    const publishableKeyScenes = redactWithheldNarration(publishedEpisode?.keyScenes ?? [], withheldEvents);

    // Derived once and published to both the map's projection and the text Live view, so the
    // two can never disagree about which scene is current (FR-O003 AC#7).
    const presentation = buildActiveScenePresentations({
      acceptedEvents: sceneEvents,
      arcMemberships,
      publishedEpisodeScenes: publishableKeyScenes,
      excludedCharacterIds: excludedCharacterIds(acceptedEvents),
      sceneSafetyLabels,
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
    /**
     * FR-Q002 / ART-134 AC#3 — the operator's hidden characters and scenes, removed HERE.
     *
     * At build time, not at read time, for the same reason FR-P004's safety gate is: a
     * read-time filter would leave the hidden thing in the stored payload, and FR-O010's
     * last-known-good fallback would keep serving it the moment the current version could not
     * be read. The hidden character would come back, from the mechanism designed to keep the
     * page alive.
     *
     * The LEDGER is read here and the EFFECTIVE state is resolved by the shared resolver the
     * operator console also uses. `publicRead` may not depend on `operations` (that edge already
     * runs the other way), so the pure model lives in `shared` — which means the console and the
     * projection cannot disagree about what is hidden. Re-deriving it here instead would be two
     * implementations of that question, and the way those diverge is that something an operator
     * hid stays on screen while the console keeps reporting it as hidden.
     */
    const dynamicControls = resolveDynamicViewControlRows(
      await ctx.db
        .query('dynamicViewControls')
        .withIndex('by_world_and_created', (q) => q.eq('worldId', args.worldId))
        .collect(),
    );
    const dynamic = derived?.projection
      ? applyDynamicViewControls(derived.projection, dynamicControls)
      : null;

    const publishableEvents = redactWithheldSummaries(acceptedEvents, withheldEvents);

    const payload = buildLiveProjection({
      worldId: args.worldId,
      acceptedEvents: publishableEvents,
      arcs,
      publishedEpisode: publishedEpisode && { ...publishedEpisode, keyScenes: publishableKeyScenes },
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
      // Neutralised, not merely index-preserved: `resolveEventCardStep` PREFERS an episode's
      // narration over an event's own summary, and that branch is gated on the episode's
      // publication version alone. Without this, every day with a published episode would
      // replay the withheld text the overlay is busy replacing with a placeholder (AC#6).
      keyScenes: redactWithheldNarration(row.episode?.keyScenes ?? [], withheldEvents),
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
            // Redacted, for the reason stated on `redactWithheldSummaries`: a replay step must
            // not be able to name a sentence the safety gate refuses (AC#6).
            acceptedEvents: publishableEvents,
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
      // FR-P004 observability: how much of what the map is showing right now is a placeholder.
      // A rebuild that withheld everything and one that withheld nothing are otherwise
      // indistinguishable from outside, and the difference is the whole point of the gate.
      withheldSceneCount: presentation.scenes.filter((scene) => scene.publicationStatus === 'withheld').length,
      withheldEventCount: withheldEvents.size,
      /**
       * How many accepted events `correlateSceneId` actually governs.
       *
       * `metadata.sceneId` is only stamped on events committed after ART-132 shipped, so an
       * override of a Scene whose events predate it changes nothing observable. Zero here is
       * how the operator learns that, instead of receiving a blank success — see
       * `overridePostGenerationSafetyLabel`. Costs no read: `sceneEvents` is already in hand.
       */
      correlatedEventCount: args.correlateSceneId === undefined
        ? null
        : sceneEvents.filter((event) => event.sceneId === args.correlateSceneId).length,
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
