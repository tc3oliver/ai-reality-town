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
 *
 * ## What this reads, and what it deliberately does not (ART-100)
 *
 * It ran after every accepted event and read the world's ENTIRE accepted-event log to do it —
 * the last O(total canon) read on the post-commit path, and the largest single term in that
 * task's measurement. Five separate consumers inside this handler needed those events, so
 * bounding any one of them alone would have moved nothing. All five are bounded now:
 *
 * | consumer | now resumes from |
 * | --- | --- |
 * | `buildLiveProjection`'s location/character maps | `liveRebuildCheckpoints.fold` + the tail |
 * | `excludedCharacterIds` | the same fold |
 * | `buildVisualReplay` | `replaySceneCandidates`, ranked by index; the winners' own events |
 * | `buildActiveScenePresentations` | the current world day, plus the newest scene |
 * | `canonCharacterLocations` / the Visual Runtime's anchor chain | the newest `canonSnapshots` row; `liveRebuildCheckpoints.motionFold` |
 *
 * **The retroactive facts are still read fresh, every time.** The safety gate's withheld set,
 * the excluded characters, episode publication state and the events' own text can all change for
 * an arbitrarily old event when an operator acts, so none of them is checkpointed. That split —
 * an index of WHICH events matter, never a cache of what they say — is the whole reason this is
 * safe, and `liveSceneIndex.ts` states it at length.
 *
 * The checkpoint and the index are derived caches. Both are folds of accepted Canon, neither
 * holds a fact that is not already there, and `rebuildFromScratch` re-derives them.
 */

import { v } from 'convex/values';
import type { GenericDatabaseReader } from 'convex/server';
import { internalMutation, query } from '../_generated/server';
import type { DataModel, Doc } from '../_generated/dataModel';
import type { AcceptedEvent } from '../canon/model';
import { MISTWOOD_PUBLIC_WORLD_ID } from '../canon/mistwoodSeed';
import { rowToAcceptedEvent } from '../canon/serialize';
import { readProjectionViaSnapshot } from '../canon/snapshotReplay';
import { deriveEventId } from '../shared/ids';
import { readWithheldSceneLabels } from '../safety/effectiveSafetyLabels';
import { parseArcProjectionFields } from '../story/projection';
import { detectUnboundCharacters } from '../visualRuntime/characterBindings';
import { mistwoodRuntimeContext, type VisualRuntimeContext } from '../visualRuntime/mistwoodRuntime';
import {
  bindingsFingerprint,
  emptyCharacterMotionFold,
  foldCharacterMotion,
  type CharacterMotionFold,
  type CharacterOriginState,
  type LocationFact,
} from '../visualRuntime/visualSyncPlanner';
import {
  buildActiveScenePresentations,
  groupSceneEvents,
  type SceneArcMembership,
  type SceneEventLike,
  type SceneGroup,
  type SceneSafetyLabel,
} from './activeScenePresentation';
import {
  candidateLocationFold,
  candidateToGroup,
  foldSceneCandidates,
  sceneIdsOfEvents,
  type SceneCandidate,
} from './liveSceneIndex';
import {
  deserializeLiveFold,
  emptyLiveFold,
  foldLiveEvents,
  serializeLiveFold,
  type LiveFoldState,
} from './liveFold';
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
  REPLAY_MAX_SCENES,
  VISUAL_REPLAY_MODEL_KIND,
  buildVisualReplay,
  episodeContentRefOf,
  sceneIdOf,
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

type DatabaseReader = GenericDatabaseReader<DataModel>;
type CanonRow = Doc<'canonEvents'>;

/**
 * Canon's own answer to "where is everyone", derived independently of the Visual Runtime so the
 * two can be compared (FR-Q001 AC#4).
 *
 * Resumed from the newest Canon snapshot rather than replayed from the whole log (ART-100).
 * `characterLocations` is NOT one of `SEED_BASELINE_FIELDS`, so "resume from a snapshot" and
 * "replay from empty" agree on it exactly — the same argument `rebuildRelationshipGraphProjection`
 * makes for `relationshipHistory`, and the reason this one of `rebuildLiveProjection`'s five
 * whole-log consumers needed no new machinery at all. Read `convex/canon/snapshotReplay.ts`
 * before widening what this projection is used for.
 *
 * A read or fold that throws yields `null` rather than propagating. `replayWorldEvents` fails
 * hard on a sequence gap or duplicate, which is correct for Canon but must not take the PUBLIC
 * READ PATH down with it: a projection nobody can compare against Canon is still a projection
 * worth serving, and public read availability is isolated from simulation failure by design. The
 * consequence is stated rather than hidden — mismatch detection is skipped for this pass, and
 * `canonComparable` in the mutation's result says so.
 */
export async function canonCharacterLocations(
  db: DatabaseReader,
  worldId: string,
): Promise<Record<string, string> | null> {
  try {
    return (await readProjectionViaSnapshot(db, worldId)).characterLocations;
  } catch {
    return null;
  }
}

/**
 * Accepted events named by id, by point lookup.
 *
 * The `#`-suffixed sequence number is parsed out and then CHECKED by re-deriving the id from it
 * (`deriveEventId`), so an id that happens to address an existing row of another world — or that
 * was minted by something other than Canon — resolves to nothing rather than to a neighbour. The
 * same shape the arc and portfolio reference validators use, and the same one
 * `rebuildOnboardingSummary` uses for exactly this question.
 */
export async function readEventsByEventId(
  db: DatabaseReader,
  worldId: string,
  eventIds: readonly string[],
): Promise<CanonRow[]> {
  const rows = await Promise.all([...new Set(eventIds)].map(async (eventId) => {
    const sequenceNumber = Number(eventId.split('#').at(-1));
    if (!Number.isSafeInteger(sequenceNumber)) return null;
    const row = await db.query('canonEvents')
      .withIndex('by_world_and_sequence', (q) => q.eq('worldId', worldId).eq('sequenceNumber', sequenceNumber))
      .unique();
    return row && deriveEventId(worldId, sequenceNumber) === eventId ? row : null;
  }));
  return rows.filter((row): row is CanonRow => row !== null);
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
 * Above this many events in one catch-up, the arc classifications are read in one indexed sweep
 * rather than one point lookup apiece.
 *
 * The steady state is a tail of ONE event, where a point lookup is the whole cost. A cold start —
 * the first rebuild after this checkpoint was introduced, or one forced with `rebuildFromScratch`
 * — folds the world's history in a single call, and paying a lookup per event there would be
 * slower than the sweep it exists to avoid. The threshold is not a correctness boundary: both
 * branches answer the same question and `liveStateFunctions.test.ts` pins that they agree.
 */
const CLASSIFICATION_SWEEP_THRESHOLD = 32;

/**
 * How many `ready` daily-episode rows are examined when looking for the newest one that actually
 * carries key scenes.
 *
 * A `ready` row without an `episode` body is an anomaly rather than a state the editorial pipeline
 * produces, so one row is normally the answer. The scan is bounded anyway, because "walk back
 * until you find one" is unbounded by construction — and when the bound is REACHED without a
 * match, the rebuild reports `publishedEpisodeScanExhausted` rather than quietly publishing
 * "no episode". Truncation is never silent.
 */
const READY_EPISODE_SCAN_LIMIT = 8;

type ClassificationRow = { sourceEventSequenceNumber: number; memberships?: unknown };

/**
 * The arc classifications for a named set of events.
 *
 * Point lookups on `by_world_and_source_event` in the steady state; one indexed sweep past
 * {@link CLASSIFICATION_SWEEP_THRESHOLD}. This replaces the whole-table `by_world` collect the
 * rebuild used to make, which grew with the world exactly as the canon read did — it was simply
 * invisible in a fixture that never classified anything.
 */
async function readArcClassifications(
  db: DatabaseReader,
  worldId: string,
  sequenceNumbers: readonly number[],
): Promise<ClassificationRow[]> {
  const wanted = [...new Set(sequenceNumbers)];
  if (wanted.length > CLASSIFICATION_SWEEP_THRESHOLD) {
    const all = await db.query('storyArcEventClassifications')
      .withIndex('by_world', (q) => q.eq('worldId', worldId)).collect();
    const keep = new Set(wanted);
    return all.filter((row) => keep.has(row.sourceEventSequenceNumber));
  }
  const rows = await Promise.all(wanted.map((sourceEventSequenceNumber) =>
    db.query('storyArcEventClassifications')
      .withIndex('by_world_and_source_event', (q) =>
        q.eq('worldId', worldId).eq('sourceEventSequenceNumber', sourceEventSequenceNumber))
      .collect()));
  return rows.flat();
}

/**
 * Parse classification rows into the memberships the pure builders take.
 *
 * Read defensively rather than through `parseArcEventClassification`, matching the three sibling
 * projections in this directory: the strict parser throws on a malformed row, and a classification
 * nobody can parse must cost this rebuild an arc label, not the whole public read path.
 */
function toArcMemberships(rows: readonly ClassificationRow[]): SceneArcMembership[] {
  return rows.flatMap((row) => {
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
}

type StoredMotionFold = NonNullable<Doc<'liveRebuildCheckpoints'>['motionFold']>;

/** `LocationFact` uses `null` for "no declared origin"; the stored column omits the field. */
const storeFact = (fact: LocationFact) => ({
  characterId: fact.characterId,
  ...(fact.fromLocationId === null ? {} : { fromLocationId: fact.fromLocationId }),
  toLocationId: fact.toLocationId,
  worldDay: fact.worldDay,
  timeSlot: fact.timeSlot,
  acceptedAt: fact.acceptedAt,
  sequenceNumber: fact.sequenceNumber,
  eventId: fact.eventId,
});

const loadFact = (stored: StoredMotionFold['characters'][number]['firstFact']): LocationFact => ({
  ...stored,
  fromLocationId: stored.fromLocationId ?? null,
});

function serializeMotionFold(fold: CharacterMotionFold): StoredMotionFold {
  return {
    factCharacterIds: [...fold.factCharacterIds],
    characters: [...fold.byCharacter.entries()].map(([characterId, state]) => ({
      characterId,
      firstFact: storeFact(state.firstFact),
      lastFact: storeFact(state.lastFact),
      ...(state.lastBoundHopAnchor === null ? {} : { lastBoundHopAnchor: state.lastBoundHopAnchor }),
      unboundHopLocationIds: [...state.unboundHopLocationIds],
    })),
    lastSequenceNumber: fold.lastSequenceNumber,
    bindingsFingerprint: fold.bindingsFingerprint,
  };
}

function deserializeMotionFold(stored: StoredMotionFold): CharacterMotionFold {
  const byCharacter = new Map<string, CharacterOriginState>(stored.characters.map((entry) => [
    entry.characterId,
    {
      firstFact: loadFact(entry.firstFact),
      lastFact: loadFact(entry.lastFact),
      lastBoundHopAnchor: entry.lastBoundHopAnchor ?? null,
      unboundHopLocationIds: [...entry.unboundHopLocationIds],
    },
  ]));
  return {
    factCharacterIds: [...stored.factCharacterIds],
    byCharacter,
    lastSequenceNumber: stored.lastSequenceNumber,
    bindingsFingerprint: stored.bindingsFingerprint,
  };
}

type CandidateRow = Doc<'replaySceneCandidates'>;

const rowToCandidate = (row: CandidateRow): SceneCandidate => ({
  sceneId: row.sceneId,
  worldDay: row.worldDay,
  timeSlot: row.timeSlot,
  locationId: row.locationId,
  minSequenceNumber: row.minSequenceNumber,
  maxSequenceNumber: row.maxSequenceNumber,
  eventSequenceNumbers: row.eventSequenceNumbers,
  score: row.score,
  positionsBefore: row.positionsBefore,
  positionsAfter: row.positionsAfter,
});

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
    /**
     * Ignore the stored checkpoint and re-fold the world from Canon (ART-100).
     *
     * The escape hatch every derived cache owes its operator. The checkpoint, the scene index and
     * the anchor chain are all functions of accepted Canon, so this reproduces them exactly; it is
     * the documented answer to "the index looks wrong" and the reason none of those rows is
     * load-bearing. It reads the whole accepted log, so it is not for the hot path.
     */
    rebuildFromScratch: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    if (args.worldId.trim().length === 0 || !Number.isFinite(args.now)) {
      throw new Error('LIVE_STATE_INVALID');
    }
    const { worldId } = args;
    const runtime = visualRuntimeForWorld(worldId);
    const recentLimit = args.recentEventCount ?? LIVE_RECENT_EVENT_DEFAULT;

    // ---- resume point ----------------------------------------------------------------------
    // ART-100. This rebuild runs after EVERY accepted event and used to read the world's entire
    // accepted log to do it. Everything below is folded from a checkpoint plus the events since,
    // except the four things that are retroactive — the safety gate's verdicts, the excluded
    // characters, episode publication state, and the events' own text — which are read fresh on
    // every call because an operator override can change any of them for an arbitrarily old
    // event. See `liveSceneIndex.ts` for why that split is the whole safety argument.
    const checkpointRow = await ctx.db.query('liveRebuildCheckpoints')
      .withIndex('by_world', (q) => q.eq('worldId', worldId)).unique();
    // A stored anchor chain was resolved against the map bindings compiled in at the time. If the
    // map has been edited since, those anchors describe a world that no longer exists, and no
    // amount of care at this call site would notice — so the fingerprint decides, not a comment.
    const resumable = checkpointRow !== null
      && args.rebuildFromScratch !== true
      && (runtime === null || checkpointRow.motionFold?.bindingsFingerprint === bindingsFingerprint(runtime.bindings));
    const resumeFrom = resumable && checkpointRow ? checkpointRow.lastSequenceNumber : -1;

    const tailRows = await ctx.db.query('canonEvents')
      .withIndex('by_world_and_sequence', (q) => q.eq('worldId', worldId).gt('sequenceNumber', resumeFrom))
      .collect();
    const tailEvents = tailRows.map(rowToAcceptedEvent);
    const tailSceneEvents = sceneEventRows(tailEvents);

    const touchedSceneIds = sceneIdsOfEvents(tailSceneEvents);
    const touchedCandidateRows = await Promise.all(touchedSceneIds.map((sceneId) =>
      ctx.db.query('replaySceneCandidates')
        .withIndex('by_world_and_scene', (q) => q.eq('worldId', worldId).eq('sceneId', sceneId))
        .unique()));
    const rowBySceneId = new Map(touchedCandidateRows
      .filter((row): row is CandidateRow => row !== null)
      .map((row) => [row.sceneId, row]));

    const tailImportance = new Map(
      toArcMemberships(await readArcClassifications(ctx.db, worldId, tailEvents.map((e) => e.sequenceNumber)))
        .map((membership) => [membership.sourceEventSequenceNumber, membership.importance ?? 0]));

    const priorFold: LiveFoldState = resumable && checkpointRow
      ? deserializeLiveFold(checkpointRow.fold)
      : emptyLiveFold();
    const priorReplayPositions = new Map(resumable && checkpointRow
      ? checkpointRow.replayPositions.map(({ characterId, locationId }) => [characterId, locationId] as const)
      : []);
    const priorMotionFold = resumable && checkpointRow?.motionFold
      ? deserializeMotionFold(checkpointRow.motionFold)
      : emptyCharacterMotionFold();

    const fold = foldLiveEvents(priorFold, tailEvents);
    const sceneFold = foldSceneCandidates({
      // Rebuilding from scratch must not inherit a stored scene's `positionsBefore`, or the
      // rebuild would preserve the very value it was asked to re-derive.
      prior: resumable ? new Map([...rowBySceneId].map(([id, row]) => [id, rowToCandidate(row)])) : new Map(),
      events: tailSceneEvents,
      priorPositions: priorReplayPositions,
      importanceOf: (sequenceNumber) => tailImportance.get(sequenceNumber) ?? 0,
    });
    const motionFold = runtime
      ? foldCharacterMotion(priorMotionFold, tailEvents, runtime.bindings)
      : null;

    // ---- persist the checkpoint ------------------------------------------------------------
    const lastSequenceNumber = tailEvents.reduce(
      (highest, event) => Math.max(highest, event.sequenceNumber), resumeFrom);
    if (tailEvents.length > 0 || !resumable) {
      const stored = serializeLiveFold(fold);
      const checkpoint = {
        schemaVersion: 1 as const,
        worldId,
        lastSequenceNumber,
        // Copied into mutable arrays: the fold's own lists are `readonly`, deliberately, and a
        // Convex write takes ownership of what it is given.
        fold: {
          locations: [...stored.locations],
          positionByCharacter: [...stored.positionByCharacter],
          aliveByCharacter: [...stored.aliveByCharacter],
          knownCharacters: [...stored.knownCharacters],
          excludedCharacterIds: [...stored.excludedCharacterIds],
          lastSequenceNumber: stored.lastSequenceNumber,
        },
        replayPositions: [...sceneFold.positions.entries()]
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([characterId, locationId]) => ({ characterId, locationId })),
        ...(motionFold ? { motionFold: serializeMotionFold(motionFold) } : {}),
        updatedAt: args.now,
      };
      if (checkpointRow) await ctx.db.patch(checkpointRow._id, checkpoint);
      else await ctx.db.insert('liveRebuildCheckpoints', checkpoint);

      for (const candidate of sceneFold.touched.values()) {
        const row = rowBySceneId.get(candidate.sceneId);
        const storedCandidate = {
          schemaVersion: 1 as const,
          worldId,
          sceneId: candidate.sceneId,
          worldDay: candidate.worldDay,
          timeSlot: candidate.timeSlot,
          locationId: candidate.locationId,
          minSequenceNumber: candidate.minSequenceNumber,
          maxSequenceNumber: candidate.maxSequenceNumber,
          eventSequenceNumbers: [...candidate.eventSequenceNumbers],
          score: candidate.score,
          positionsBefore: candidate.positionsBefore.map((entry) => ({ ...entry })),
          positionsAfter: candidate.positionsAfter.map((entry) => ({ ...entry })),
          updatedAt: args.now,
        };
        if (row) await ctx.db.patch(row._id, storedCandidate);
        else await ctx.db.insert('replaySceneCandidates', storedCandidate);
      }
    }

    const [
      lifecycleRows, projectionRows, characterRows, scheduleRow,
      withheldSceneRecord, newestCandidateRow, latestRowFallback, recentRowsDesc,
    ] = await Promise.all([
      // These three grow with the world's ARCS and CAST, not with its accepted-event count, so
      // they are left whole. `by_world_and_arc` / `by_world_id` are already the narrowest index
      // that answers them.
      ctx.db.query('storyArcLifecycles').withIndex('by_world_and_arc', (q) => q.eq('worldId', worldId)).collect(),
      ctx.db.query('storyArcProjectionEvents').withIndex('by_world_arc_and_revision', (q) => q.eq('worldId', worldId)).collect(),
      ctx.db.query('worldCharacters').withIndex('by_world_id', (q) => q.eq('worldId', worldId)).collect(),
      ctx.db.query('worldSchedules').withIndex('by_world_id', (q) => q.eq('worldId', worldId)).unique(),
      // The Scenes the safety gate currently refuses (FR-P004 / ART-132), and deliberately the
      // INVERTED question: asking "what governs each Scene in history" would grow with the world
      // and eventually fail this whole rebuild, which is the one failure that would stop future
      // safety updates from ever reaching a viewer. See `readWithheldSceneLabels`.
      readWithheldSceneLabels(ctx.db, worldId),
      // The newest scene in the world, for AC#8's degraded fallback: when the current slot
      // produced nothing placeable, that scene stands in. One row, off the index that orders
      // scenes by their newest event.
      ctx.db.query('replaySceneCandidates')
        .withIndex('by_world_and_sequence', (q) => q.eq('worldId', worldId)).order('desc').first(),
      // Only consulted when the tail was empty — a rebuild invoked by an operator rather than by
      // a commit still needs to know what "now" is.
      ctx.db.query('canonEvents')
        .withIndex('by_world_and_sequence', (q) => q.eq('worldId', worldId)).order('desc').first(),
      // `recentEvents` is the last N events and nothing older, so it is a bounded tail read
      // rather than a slice of the whole log.
      ctx.db.query('canonEvents')
        .withIndex('by_world_and_sequence', (q) => q.eq('worldId', worldId)).order('desc').take(recentLimit),
    ]);

    const latestRow = tailRows.at(-1) ?? latestRowFallback;
    const latest = latestRow ? rowToAcceptedEvent(latestRow) : null;

    /**
     * The current world day's events — the window the ACTIVE scene presentation is derived from.
     *
     * A scene is the events sharing (worldDay, timeSlot, locationId), so every scene in the
     * current slot lives inside the current DAY. One day's rows, off the index whose second field
     * is `worldDay`, is therefore an exact window rather than a guess at one.
     */
    const dayRows = latest
      ? await ctx.db.query('canonEvents')
        .withIndex('by_world_and_day', (q) => q.eq('worldId', worldId).eq('worldDay', latest.worldDay))
        .collect()
      : [];

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

    // ---- which scenes matter: the current slot, and the replay's winners -------------------
    const dayEvents = dayRows.map(rowToAcceptedEvent);
    const daySceneEvents = sceneEventRows(dayEvents);
    const currentSlotSceneIds = new Set(
      (latest
        ? groupSceneEvents(daySceneEvents)
          .filter((group) => group.worldDay === latest.worldDay && group.timeSlot === latest.timeSlot)
        : []
      ).map(sceneIdOf));

    /**
     * The replay's winners, straight off the rank index instead of an in-memory sort of every
     * scene the world has ever had.
     *
     * Taking `REPLAY_MAX_SCENES + currentSlotSceneIds.size` rows is PROVABLY enough rather than a
     * budget: the only rows discarded are current-slot ones, and there are exactly that many of
     * them. So this is `selectReplayGroups` exactly, not an approximation of it — see
     * `liveSceneIndex.ts` on why the index order reproduces the comparator.
     */
    const selectedCandidates = (await ctx.db.query('replaySceneCandidates')
      .withIndex('by_world_and_rank', (q) => q.eq('worldId', worldId))
      .order('desc')
      .take(REPLAY_MAX_SCENES + currentSlotSceneIds.size))
      .filter((row) => !currentSlotSceneIds.has(row.sceneId))
      .slice(0, REPLAY_MAX_SCENES)
      .map(rowToCandidate)
      // Chronological, because a replay is a story being retold and a viewer reads forwards.
      // Importance decided WHICH scenes; it has no business deciding the order they happened in.
      .sort((left, right) => left.minSequenceNumber - right.minSequenceNumber);

    // AC#8's stand-in: when the current slot produced nothing placeable, the newest completed
    // scene is shown instead. Its events are read so `buildActiveScenePresentations` can fall
    // back to it exactly as it would have with the whole log in hand.
    const fallbackCandidate = newestCandidateRow ? rowToCandidate(newestCandidateRow) : null;

    const eventsBySequence = new Map<number, AcceptedEvent>();
    for (const event of [...tailEvents, ...dayEvents]) eventsBySequence.set(event.sequenceNumber, event);
    const recentEvents = [...recentRowsDesc].reverse().map(rowToAcceptedEvent);
    for (const event of recentEvents) eventsBySequence.set(event.sequenceNumber, event);

    const missingSequences = [
      ...selectedCandidates.flatMap((candidate) => candidate.eventSequenceNumbers),
      ...(fallbackCandidate?.eventSequenceNumbers ?? []),
    ].filter((sequenceNumber) => !eventsBySequence.has(sequenceNumber));
    for (const row of await Promise.all([...new Set(missingSequences)].map((sequenceNumber) =>
      ctx.db.query('canonEvents').withIndex('by_world_and_sequence',
        (q) => q.eq('worldId', worldId).eq('sequenceNumber', sequenceNumber)).unique()))) {
      if (row) eventsBySequence.set(row.sequenceNumber, rowToAcceptedEvent(row));
    }

    // ---- the safety gate ------------------------------------------------------------------
    // Applied at REBUILD time rather than at read time: the public read path serves published
    // snapshots only, so a refused sentence must never be written into one. An operator override
    // re-runs this rebuild, which is what makes a withhold take effect at once.
    // `withheldSceneRecord` holds only the Scenes currently refused; every Scene absent from it
    // is showable.
    const sceneSafetyLabels = new Map<string, SceneSafetyLabel>(Object.entries(withheldSceneRecord));
    const sceneEvents = sceneEventRows([...eventsBySequence.values()]);
    const withheldEvents = withheldEventIds(sceneEvents, sceneSafetyLabels);
    const sceneEventsBySequence = new Map(sceneEvents.map((event) => [event.sequenceNumber, event]));

    // ---- episodes: the newest narrated one, plus the replayed days' own -------------------
    const readyEpisodeRows = await ctx.db.query('dailyEpisodes')
      .withIndex('by_world_status_and_day', (q) => q.eq('worldId', worldId).eq('status', 'ready'))
      .order('desc').take(READY_EPISODE_SCAN_LIMIT);
    const narratedEpisode = (readyEpisodeRows as DailyEpisodeRow[])
      .find((row) => row.episode?.keyScenes);
    // Reported rather than swallowed: "no narrated episode" and "gave up looking" are different
    // facts about the world, and only one of them is a defect. See READY_EPISODE_SCAN_LIMIT.
    const publishedEpisodeScanExhausted =
      narratedEpisode === undefined && readyEpisodeRows.length === READY_EPISODE_SCAN_LIMIT;
    const publishedEpisode: LivePublishedEpisodeInput | null = narratedEpisode?.episode?.keyScenes
      ? {
        status: narratedEpisode.status,
        keyScenes: narratedEpisode.episode.keyScenes.map((scene) => ({
          title: scene.title, summary: scene.summary, sourceEventIds: scene.sourceEventIds,
        })),
      }
      : null;

    const replayWorldDays = [...new Set(selectedCandidates.map((candidate) => candidate.worldDay))];
    const replayEpisodeRows = (await Promise.all(replayWorldDays.map((worldDay) =>
      ctx.db.query('dailyEpisodes')
        .withIndex('by_world_and_day', (q) => q.eq('worldId', worldId).eq('worldDay', worldDay))
        .unique()))).filter((row): row is NonNullable<typeof row> => row !== null) as DailyEpisodeRow[];

    /**
     * A key scene narrates SEVERAL events, and can name one far outside every window read above.
     * Reusing `withheldEvents` for the narration gate would therefore give a false "not withheld"
     * for exactly the event the window never reached — which is publishing refused text, not
     * merely missing an optimisation. Each `sourceEventId` is already a bounded, named reference,
     * so it is resolved by point lookup. (`rebuildOnboardingSummary` closed the same hole.)
     */
    const narrationWithheld = withheldEventIds(
      sceneEventRows((await readEventsByEventId(ctx.db, worldId, [
        ...(publishedEpisode?.keyScenes ?? []).flatMap((scene) => scene.sourceEventIds),
        ...replayEpisodeRows.flatMap((row) => (row.episode?.keyScenes ?? [])
          .flatMap((scene) => scene.sourceEventIds)),
      ])).map(rowToAcceptedEvent)),
      sceneSafetyLabels,
    );
    const withheldForNarration = new Set([...withheldEvents, ...narrationWithheld]);
    // The episode's narration is redacted alongside the events' own summaries, because BOTH
    // the overlay and the replay prefer narration when it exists — see `redactWithheldNarration`.
    const publishableKeyScenes = redactWithheldNarration(publishedEpisode?.keyScenes ?? [], withheldForNarration);

    // ---- arc memberships, for exactly the events that will be presented --------------------
    const arcMemberships: SceneArcMembership[] = toArcMemberships(await readArcClassifications(
      ctx.db,
      worldId,
      [
        ...dayEvents.map((event) => event.sequenceNumber),
        ...selectedCandidates.flatMap((candidate) => candidate.eventSequenceNumbers),
        ...(fallbackCandidate?.eventSequenceNumbers ?? []),
      ],
    ));

    /**
     * Derived once and published to both the map's projection and the text Live view, so the two
     * can never disagree about which scene is current (FR-O003 AC#7).
     *
     * Fed the current DAY's events plus the fallback scene's, rather than the world's. That
     * subset is sufficient rather than approximate: every scene in the current slot is inside the
     * current day, the degraded branch wants only the newest scene, and the builder's own "what
     * time is it" comes from the newest event in what it is given — which is in the day. Pinned
     * against the whole-log answer in `liveStateFunctions.test.ts`.
     */
    const fallbackSceneEvents = (fallbackCandidate?.eventSequenceNumbers ?? [])
      .map((sequenceNumber) => sceneEventsBySequence.get(sequenceNumber))
      .filter((event): event is SceneEventLike => event !== undefined);
    const presentationEvents = [...new Map(
      [...daySceneEvents, ...fallbackSceneEvents].map((event) => [event.sequenceNumber, event]),
    ).values()];

    const presentation = buildActiveScenePresentations({
      acceptedEvents: presentationEvents,
      arcMemberships,
      publishedEpisodeScenes: publishableKeyScenes,
      excludedCharacterIds: fold.excludedCharacterIds,
      sceneSafetyLabels,
    });

    const worldStatus: PublicWorldStatus = scheduleRow?.status ?? 'unknown';
    const derived = runtime && motionFold
      ? buildPublicDynamicProjectionResult({
          worldId,
          nowMs: args.now,
          runtime,
          seedPlacements: seedPlacementsFromCharacterRows(characterRows),
          // Only the newest event is read off this list now; the anchor chain and the excluded
          // set are supplied pre-folded.
          acceptedEvents: latest ? [latest] : [],
          motionFold,
          excludedCharacterIds: fold.excludedCharacterIds,
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
        .withIndex('by_world_and_created', (q) => q.eq('worldId', worldId))
        .collect(),
    );
    const dynamic = derived?.projection
      ? applyDynamicViewControls(derived.projection, dynamicControls)
      : null;

    const publishableEvents = redactWithheldSummaries([...eventsBySequence.values()], withheldEvents);

    /**
     * `acceptedEvents` is the last `recentLimit` events and `priorFold` covers everything (ART-100).
     *
     * The two overlap, and that is safe rather than sloppy: the fold is last-write-wins over a
     * sequence, so re-applying events already folded in re-assigns the same values — and these are
     * the NEWEST events, so nothing later could have overwritten them. Applying them twice is
     * therefore the identity. `liveState.test.ts` pins that against the full replay rather than
     * leaving it as an argument.
     */
    const payload = buildLiveProjection({
      worldId,
      acceptedEvents: redactWithheldSummaries(recentEvents, withheldEvents),
      priorFold: fold,
      arcs,
      publishedEpisode: publishedEpisode && { ...publishedEpisode, keyScenes: publishableKeyScenes },
      activeScenes: presentation.scenes,
      recentEventCount: recentLimit,
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
    // Only the replayed days' episodes, not the world's: `resolveEventCardStep` looks an episode
    // up by the replayed event's own `worldDay`, so every other row was read and discarded.
    const episodesForReplay: ReplayEpisodeInput[] = replayEpisodeRows.map((row) => ({
      worldDay: row.worldDay,
      status: row.status,
      // Neutralised, not merely index-preserved: `resolveEventCardStep` PREFERS an episode's
      // narration over an event's own summary, and that branch is gated on the episode's
      // publication version alone. Without this, every day with a published episode would
      // replay the withheld text the overlay is busy replacing with a placeholder (AC#6).
      keyScenes: redactWithheldNarration(row.episode?.keyScenes ?? [], withheldForNarration),
    }));
    // The publication lifecycle of each replayed day's text (FR-O013 / ART-121), read as point
    // lookups on the `isCurrent` index rather than by sweeping the world's records. The version a
    // reference pins is the one current when the replay was built, which is what makes a later
    // withhold resolve to nothing.
    const publicationRecords = new Map<string, ReplayPublicationRecord>();
    for (const contentRef of replayWorldDays.map((worldDay) => episodeContentRefOf(worldId, worldDay))) {
      const row = await ctx.db.query('publicationRecords')
        .withIndex('by_current', (q) => q.eq('worldId', worldId).eq('contentRef', contentRef).eq('isCurrent', true))
        .unique();
      if (row) publicationRecords.set(contentRef, { version: row.version, status: row.status });
    }

    // Redacted, for the reason stated on `redactWithheldSummaries`: a replay step must not be
    // able to name a sentence the safety gate refuses (AC#6).
    const publishableSceneEvents = new Map(
      sceneEventRows(publishableEvents).map((event) => [event.sequenceNumber, event]));
    const selectionGroups = selectedCandidates
      .map((candidate) => candidateToGroup(candidate, publishableSceneEvents))
      .filter((group): group is SceneGroup => group !== null);

    let replay: VisualReplay | null = null;
    let replayBuildFailed = false;
    try {
      replay = runtime && selectionGroups.length > 0
        ? buildVisualReplay({
            worldId,
            acceptedEvents: selectionGroups.flatMap((group) => group.events),
            selection: {
              groups: selectionGroups,
              locationFolds: new Map(selectedCandidates
                .map((candidate) => [candidate.sceneId, candidateLocationFold(candidate)])),
            },
            arcMemberships,
            excludedCharacterIds: fold.excludedCharacterIds,
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
    const canonLocations = dynamic ? await canonCharacterLocations(ctx.db, worldId) : null;
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
        // ART-100: this ONE answer still costs a whole-log read, and it is the right place to
        // spend it. There is no index on `metadata.sceneId`, and the operator is owed an exact
        // number — a count over "the events this rebuild happened to read" would report a
        // truthful-looking figure that shrinks as the rebuild gets cheaper. The read happens only
        // when an operator explicitly asks about a Scene (`overridePostGenerationSafetyLabel`),
        // never on the post-commit path, which is the path the byte budget belongs to.
        : sceneEventRows((await ctx.db.query('canonEvents')
          .withIndex('by_world_and_sequence', (q) => q.eq('worldId', worldId)).collect())
          .map(rowToAcceptedEvent))
          .filter((event) => event.sceneId === args.correlateSceneId).length,
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
