/**
 * PRD §12 STAGES 11–21 LIVE ENTRY POINT.
 *
 * `runLiveWorldDayCycle` is the only place in the codebase where a full daily cycle runs
 * end to end. It drives ART-97's world-day slot executor (stages 1–10, up to the Canon
 * commit) and then, for every event that commit accepted, runs the resumable post-commit
 * pipeline (stages 11–21) through {@link executePostCommitPipeline}:
 *
 *   runQueuedWorldDaySlot → for each accepted event:
 *     projection → knowledge → memory → relationship → arc → episode → recap →
 *     safety → publication → snapshot → metrics
 *
 * Invoke it against a deployment with, for example:
 *
 *   npx convex run simulation/schedulerOperations:advanceOneWorldDay '{"worldId":"mistwood","now":0}'
 *   npx convex run operations/postCommitLiveFunctions:runLiveWorldDayCycle '{"worldId":"mistwood"}'
 *
 * After it returns, the public read models (`world`, `character`, `relationship`,
 * `episode`, `episodes:<worldId>`, `timeline`, `arc`, `primer`, `liveState`, `onboarding`)
 * have been rebuilt and published, so `publicRead/readModelFunctions:getPublishedReadModel`
 * serves the new content with no generation on the read path (ADR-0001).
 *
 * This entry point lives in `convex/operations` on purpose: `architecture/module-boundaries.json`
 * lets `operations` depend on every domain, while `simulation` may not depend on `operations`,
 * so the daily cycle is composed here rather than inside the world-day executor.
 *
 * Everything runs inside ONE Convex mutation/transaction: no stage calls a provider and no
 * stage writes Canon, so a downstream failure can never edit or delete an accepted event —
 * it only records a durable checkpoint the next attempt resumes from.
 */

import { v } from 'convex/values';
import type { GenericMutationCtx } from 'convex/server';
import { internalMutation } from '../_generated/server';
import type { DataModel, Doc } from '../_generated/dataModel';
import { internalFunctionRef } from '../shared/internalFunctionRef';
import type {
  rebuildWorldProjection as rebuildWorldProjectionExport,
  rebuildCharacterProjection as rebuildCharacterProjectionExport,
} from '../publicRead/worldCharacterProjectionFunctions';
import type {
  rebuildRelationshipProjection as rebuildRelationshipProjectionExport,
  rebuildArcProjection as rebuildArcProjectionExport,
} from '../publicRead/relationshipArcProjectionFunctions';
import type { recordArcEventClassification as recordArcEventClassificationExport } from '../story/classificationFunctions';
import type {
  admitArcToPortfolio as admitArcToPortfolioExport,
  syncArcPortfolioEntry as syncArcPortfolioEntryExport,
} from '../story/portfolioFunctions';
import type { transitionArcLifecycleRecord as transitionArcLifecycleRecordExport } from '../story/functions';
import type { updateArcProjection as updateArcProjectionExport } from '../story/projectionFunctions';
import type { refreshArcStagnationPrompts as refreshArcStagnationPromptsExport } from '../story/resolutionFunctions';
import type { generateAcceptedEventEpisode as generateAcceptedEventEpisodeExport } from '../editorial/episodeFunctions';
import type { generateEpisodeShareFormats as generateEpisodeShareFormatsExport } from '../editorial/shareFormatFunctions';
import type { generateIncrementalRecap as generateIncrementalRecapExport } from '../recaps/functions';
import type {
  createEpisodePublication as createEpisodePublicationExport,
  advancePublication as advancePublicationExport,
} from '../editorial/publicationLifecycleFunctions';
import type { reassessMajorActiveArcEntries as reassessMajorActiveArcEntriesExport } from '../story/entryRecommendationFunctions';
import type {
  rebuildEpisodeProjection as rebuildEpisodeProjectionExport,
  rebuildTimelineProjection as rebuildTimelineProjectionExport,
} from '../publicRead/episodeTimelineProjectionFunctions';
import type { rebuildEpisodeIndexProjection as rebuildEpisodeIndexProjectionExport } from '../publicRead/episodeIndexProjectionFunctions';
import type { rebuildVoteConsequenceProjection as rebuildVoteConsequenceProjectionExport } from '../publicRead/voteConsequenceProjectionFunctions';
import type { rebuildRelationshipGraphProjection as rebuildRelationshipGraphProjectionExport } from '../publicRead/relationshipGraphProjectionFunctions';
import type { rebuildArcPrimer as rebuildArcPrimerExport } from '../publicRead/arcPrimerFunctions';
import type { rebuildLiveProjection as rebuildLiveProjectionExport } from '../publicRead/liveStateFunctions';
import type { rebuildOnboardingSummary as rebuildOnboardingSummaryExport } from '../publicRead/onboardingSummaryFunctions';
import type { persistDailySnapshot as persistDailySnapshotExport } from '../canon/snapshotOperations';
import type { runQueuedWorldDaySlot as runQueuedWorldDaySlotExport } from '../simulation/worldDayLiveFunctions';
import type { AcceptedEvent } from '../canon/model';
import { TIME_SLOTS } from '../canon/eventTypes';
import { rowToAcceptedEvent } from '../canon/serialize';
import { readProjectionViaSnapshot } from '../canon/snapshotReplay';
import { deriveEventId } from '../shared/ids';
import { authorizeKnowledgeRead } from '../knowledge/authorization';
import { authorizeMemoryRead } from '../knowledge/memoryAuthorization';
import { parseArcProjectionFields } from '../story/projection';
import type { WorldDaySlotOutcome } from '../simulation/worldDayLiveFunctions';
import type { ArcTier } from '../story/portfolio';
import {
  executePostCommitPipeline,
  POST_COMMIT_STAGES,
  type PostCommitRun,
  type PostCommitStage,
  type StageMetricsEntry,
} from './postCommitOrchestration';
import { createConvexPostCommitRunStore } from './postCommitOrchestrationFunctions';
import {
  createPostCommitStageHandlers,
  postCommitRunId,
  type LiveArcState,
  type PostCommitLivePort,
  type PostCommitSource,
  type PostCommitWorldState,
} from './postCommitLive';

type MutationCtx = GenericMutationCtx<DataModel>;

/** Server actor for the automated pipeline; FR-K004 reserves `publish` for administrators. */
const SYSTEM_ACTOR = { type: 'system' as const, id: 'post-commit-pipeline' };
const OPERATOR = { type: 'operations' as const, operatorId: 'post-commit-pipeline' };
const LAST_TIME_SLOT = TIME_SLOTS[TIME_SLOTS.length - 1];
/**
 * Accepted events one `runLiveWorldDayCycle` transaction takes through stages 11–21.
 * Every public read model is rebuilt by replaying the whole accepted-event log, so one
 * event's post-commit work already costs several megabytes of reads on a mature world and
 * the default is one event per transaction. Raising it risks the Convex per-transaction
 * byte limit; incremental projection updates are the real fix (see ART-100).
 */
const DEFAULT_MAX_POST_COMMIT_EVENTS = 1;
const MAX_POST_COMMIT_EVENTS = 10;

const rebuildWorldProjectionRef = internalFunctionRef<typeof rebuildWorldProjectionExport>(
  'publicRead/worldCharacterProjectionFunctions:rebuildWorldProjection',
);
const rebuildCharacterProjectionRef = internalFunctionRef<typeof rebuildCharacterProjectionExport>(
  'publicRead/worldCharacterProjectionFunctions:rebuildCharacterProjection',
);
const rebuildRelationshipProjectionRef = internalFunctionRef<typeof rebuildRelationshipProjectionExport>(
  'publicRead/relationshipArcProjectionFunctions:rebuildRelationshipProjection',
);
const rebuildArcProjectionRef = internalFunctionRef<typeof rebuildArcProjectionExport>(
  'publicRead/relationshipArcProjectionFunctions:rebuildArcProjection',
);
const recordArcEventClassificationRef = internalFunctionRef<typeof recordArcEventClassificationExport>(
  'story/classificationFunctions:recordArcEventClassification',
);
const admitArcToPortfolioRef = internalFunctionRef<typeof admitArcToPortfolioExport>(
  'story/portfolioFunctions:admitArcToPortfolio',
);
const syncArcPortfolioEntryRef = internalFunctionRef<typeof syncArcPortfolioEntryExport>(
  'story/portfolioFunctions:syncArcPortfolioEntry',
);
const transitionArcLifecycleRecordRef = internalFunctionRef<typeof transitionArcLifecycleRecordExport>(
  'story/functions:transitionArcLifecycleRecord',
);
const updateArcProjectionRef = internalFunctionRef<typeof updateArcProjectionExport>(
  'story/projectionFunctions:updateArcProjection',
);
const refreshArcStagnationPromptsRef = internalFunctionRef<typeof refreshArcStagnationPromptsExport>(
  'story/resolutionFunctions:refreshArcStagnationPrompts',
);
const generateAcceptedEventEpisodeRef = internalFunctionRef<typeof generateAcceptedEventEpisodeExport>(
  'editorial/episodeFunctions:generateAcceptedEventEpisode',
);
const generateIncrementalRecapRef = internalFunctionRef<typeof generateIncrementalRecapExport>(
  'recaps/functions:generateIncrementalRecap',
);
const generateEpisodeShareFormatsRef = internalFunctionRef<typeof generateEpisodeShareFormatsExport>(
  'editorial/shareFormatFunctions:generateEpisodeShareFormats',
);
const createEpisodePublicationRef = internalFunctionRef<typeof createEpisodePublicationExport>(
  'editorial/publicationLifecycleFunctions:createEpisodePublication',
);
const advancePublicationRef = internalFunctionRef<typeof advancePublicationExport>(
  'editorial/publicationLifecycleFunctions:advancePublication',
);
const reassessMajorActiveArcEntriesRef = internalFunctionRef<typeof reassessMajorActiveArcEntriesExport>(
  'story/entryRecommendationFunctions:reassessMajorActiveArcEntries',
);
const rebuildEpisodeProjectionRef = internalFunctionRef<typeof rebuildEpisodeProjectionExport>(
  'publicRead/episodeTimelineProjectionFunctions:rebuildEpisodeProjection',
);
const rebuildEpisodeIndexProjectionRef = internalFunctionRef<typeof rebuildEpisodeIndexProjectionExport>(
  'publicRead/episodeIndexProjectionFunctions:rebuildEpisodeIndexProjection',
);
const rebuildTimelineProjectionRef = internalFunctionRef<typeof rebuildTimelineProjectionExport>(
  'publicRead/episodeTimelineProjectionFunctions:rebuildTimelineProjection',
);
const rebuildVoteConsequenceProjectionRef = internalFunctionRef<typeof rebuildVoteConsequenceProjectionExport>(
  'publicRead/voteConsequenceProjectionFunctions:rebuildVoteConsequenceProjection',
);
const rebuildRelationshipGraphProjectionRef = internalFunctionRef<typeof rebuildRelationshipGraphProjectionExport>(
  'publicRead/relationshipGraphProjectionFunctions:rebuildRelationshipGraphProjection',
);
const rebuildArcPrimerRef = internalFunctionRef<typeof rebuildArcPrimerExport>(
  'publicRead/arcPrimerFunctions:rebuildArcPrimer',
);
const rebuildLiveProjectionRef = internalFunctionRef<typeof rebuildLiveProjectionExport>(
  'publicRead/liveStateFunctions:rebuildLiveProjection',
);
const rebuildOnboardingSummaryRef = internalFunctionRef<typeof rebuildOnboardingSummaryExport>(
  'publicRead/onboardingSummaryFunctions:rebuildOnboardingSummary',
);
const persistDailySnapshotRef = internalFunctionRef<typeof persistDailySnapshotExport>(
  'canon/snapshotOperations:persistDailySnapshot',
);
const runQueuedWorldDaySlotRef = internalFunctionRef<typeof runQueuedWorldDaySlotExport>(
  'simulation/worldDayLiveFunctions:runQueuedWorldDaySlot',
);

/**
 * A world day counts as finished once it is no longer the newest day, or once it has
 * produced an event in the final time slot. Only finished days get an episode, a recap
 * close-out, or a daily snapshot.
 */
export function completedWorldDays(events: readonly AcceptedEvent[]): number[] {
  const days = [...new Set(events.map(({ worldDay }) => worldDay))].sort((left, right) => left - right);
  const latest = days[days.length - 1];
  return days.filter((day) => day < latest
    || events.some((event) => event.worldDay === day && event.timeSlot === LAST_TIME_SLOT));
}

/**
 * {@link completedWorldDays} without reading the whole accepted-event log (ART-100).
 *
 * Identical semantics, derived differently. The original folds a full replay to get the distinct
 * day set; this probes one row per day across `[min, max]` on `by_world_and_day`, so a day that
 * produced no events is absent from both. Every day below the latest is finished by definition,
 * so only the latest day needs its time slots examined — one day's rows, not the world's.
 *
 * The cost is one row per world day rather than one row per accepted event. That is a change of
 * order, not a removal: a world thousands of days old still pays per day. Recording that plainly
 * because the alternative — a maintained completed-day summary — is a schema change this task did
 * not take, and the next person to hit this ceiling should know the option was considered.
 */
export async function completedWorldDaysBounded(
  bounds: { min: number; max: number },
  latestDayEvents: readonly AcceptedEvent[],
  dayExists: (worldDay: number) => Promise<boolean>,
): Promise<number[]> {
  const days: number[] = [];
  for (let day = bounds.min; day <= bounds.max; day += 1) {
    if (await dayExists(day)) days.push(day);
  }
  const latestIsFinished = latestDayEvents.some((event) => event.timeSlot === LAST_TIME_SLOT);
  return days.filter((day) => day < bounds.max || latestIsFinished);
}

/**
 * Convex-backed {@link PostCommitLivePort}. Every method delegates to an already tested
 * internal capability, so their idempotency, authorization and provenance rules run live.
 *
 * Reads are cached inside one run and invalidated on write, because a Convex transaction
 * has a byte budget and several stages need the same view. The accepted-event list never
 * needs invalidating: this pipeline never writes Canon.
 */
function createConvexPostCommitLivePort(ctx: MutationCtx, now: number): PostCommitLivePort {
  let worldState: PostCommitWorldState | null = null;
  /**
   * Resumed from the newest daily snapshot rather than replayed from the whole log (ART-100).
   *
   * Only `characterKnowledge` and `characterMemories` are read off this projection (see
   * `loadCharacterKnowledge` / `loadCharacterMemories` below), and neither is one of
   * `SEED_BASELINE_FIELDS`, so the snapshot's seeded baseline cannot perturb the answer. Read
   * `convex/canon/snapshotReplay.ts` before widening what this projection is used for.
   */
  const loadProjection = async (worldId: string) => readProjectionViaSnapshot(ctx.db, worldId);

  /** One accepted event by sequence number: a point lookup on the index's full key. */
  const eventAtSequence = async (worldId: string, sequenceNumber: number) => {
    const row = await ctx.db.query('canonEvents')
      .withIndex('by_world_and_sequence', (q) => q.eq('worldId', worldId).eq('sequenceNumber', sequenceNumber))
      .unique();
    return row ?? null;
  };

  /** Every event of one world day, on the index that exists for exactly this question. */
  const eventsOnDay = async (worldId: string, worldDay: number) => {
    const rows = await ctx.db.query('canonEvents')
      .withIndex('by_world_and_day', (q) => q.eq('worldId', worldId).eq('worldDay', worldDay))
      .collect();
    return rows.map(rowToAcceptedEvent);
  };

  /**
   * The world's lowest and highest `worldDay`, each a single row.
   *
   * Read off `by_world_and_day`, NOT off the first/last event by sequence. Those coincide only
   * if `worldDay` never decreases as `sequenceNumber` grows, which is true in practice and is
   * not enforced anywhere — and `completedWorldDays` feeds `episodeNumberFor`, which numbers
   * episodes by position, so being wrong here silently renumbers published episodes. The index
   * whose second field IS `worldDay` answers the question directly and assumes nothing.
   */
  const dayBounds = async (worldId: string): Promise<{ min: number; max: number } | null> => {
    const [lowest, highest] = await Promise.all([
      ctx.db.query('canonEvents').withIndex('by_world_and_day', (q) => q.eq('worldId', worldId)).order('asc').first(),
      ctx.db.query('canonEvents').withIndex('by_world_and_day', (q) => q.eq('worldId', worldId)).order('desc').first(),
    ]);
    if (!lowest || !highest) return null;
    return { min: lowest.worldDay, max: highest.worldDay };
  };
  /** Any story/editorial/recap write makes the cached view stale. */
  const invalidate = <T>(value: T): T => {
    worldState = null;
    return value;
  };

  return {
    async loadWorldState(source: PostCommitSource): Promise<PostCommitWorldState> {
      if (worldState) return worldState;
      const { worldId } = source;
      const sourceRow = await eventAtSequence(worldId, source.sourceEventSequenceNumber);
      const event = sourceRow ? rowToAcceptedEvent(sourceRow) : null;
      if (!event || event.eventId !== source.sourceEventId) throw new Error('POST_COMMIT_SOURCE_NOT_ACCEPTED');

      const [lifecycles, projectionRows, transitionRows, portfolioRows, characterRows, episodeRows, recapRows] = await Promise.all([
        ctx.db.query('storyArcLifecycles').withIndex('by_world_and_arc', (q) => q.eq('worldId', worldId)).collect(),
        ctx.db.query('storyArcProjectionEvents').withIndex('by_world_arc_and_revision', (q) => q.eq('worldId', worldId)).collect(),
        ctx.db.query('storyArcLifecycleTransitions').withIndex('by_world_arc_and_revision', (q) => q.eq('worldId', worldId)).collect(),
        ctx.db.query('storyArcPortfolioEntries').withIndex('by_world_and_arc', (q) => q.eq('worldId', worldId)).collect(),
        ctx.db.query('worldCharacters').withIndex('by_world_id', (q) => q.eq('worldId', worldId)).collect(),
        ctx.db.query('dailyEpisodes').withIndex('by_world_and_day', (q) => q.eq('worldId', worldId)).collect(),
        ctx.db.query('recapSnapshots').withIndex('by_target_and_version', (q) => q.eq('worldId', worldId)).collect(),
      ]);

      const tierByArc = new Map<string, ArcTier>(portfolioRows.map((row) =>
        [row.arcId, (row.entry as { tier: ArcTier }).tier]));
      /**
       * `worldDay` for exactly the sequence numbers the arc transitions name — the only thing the
       * old whole-log map was ever consulted for (see `lastTransitionWorldDay` below). Point
       * lookups on the full index key, deduped so an arc with several transitions on one event
       * does not pay twice.
       */
      const transitionSequences = [...new Set(transitionRows.map((row) => row.sourceEventSequenceNumber))];
      const worldDayBySequence = new Map(await Promise.all(transitionSequences.map(async (sequenceNumber) => {
        const row = await eventAtSequence(worldId, sequenceNumber);
        return [sequenceNumber, row?.worldDay] as const;
      })));
      const arcs: LiveArcState[] = lifecycles.flatMap((lifecycle): LiveArcState[] => {
        const latest = projectionRows
          .filter((row) => row.arcId === lifecycle.arcId)
          .sort((left, right) => left.revision - right.revision)
          .at(-1);
        if (!latest) return [];
        const transitions = transitionRows.filter((row) => row.arcId === lifecycle.arcId);
        return [{
          arcId: lifecycle.arcId,
          status: lifecycle.status,
          projectionRevision: latest.revision,
          fields: parseArcProjectionFields(latest.fields),
          tier: tierByArc.get(lifecycle.arcId) ?? null,
          lastTransitionWorldDay: transitions.reduce(
            (highest, row) => Math.max(highest, worldDayBySequence.get(row.sourceEventSequenceNumber) ?? 0), 0),
        }];
      });

      const recapCursors: Record<string, number> = {};
      for (const row of recapRows) {
        const key = `${row.recapType}:${row.targetId}`;
        recapCursors[key] = Math.max(recapCursors[key] ?? -1, row.sourceToSequenceNumber);
      }
      const dayEvents = await eventsOnDay(worldId, event.worldDay);
      const bounds = (await dayBounds(worldId)) ?? { min: event.worldDay, max: event.worldDay };
      const latestWorldDay = Math.max(bounds.max, event.worldDay);
      // The latest day's own events, reused when it is the day being committed to.
      const latestDayEvents = latestWorldDay === event.worldDay
        ? dayEvents
        : await eventsOnDay(worldId, latestWorldDay);

      worldState = {
        event,
        arcs,
        characterIds: characterRows.map(({ characterId }) => characterId),
        completedWorldDays: await completedWorldDaysBounded(
          { min: bounds.min, max: latestWorldDay },
          latestDayEvents,
          async (worldDay) => (await ctx.db.query('canonEvents')
            .withIndex('by_world_and_day', (q) => q.eq('worldId', worldId).eq('worldDay', worldDay))
            .first()) !== null,
        ),
        episodeWorldDays: episodeRows.map(({ worldDay }) => worldDay),
        worldDayFirstSequenceNumber: dayEvents.reduce(
          (lowest, candidate) => Math.min(lowest, candidate.sequenceNumber), event.sequenceNumber),
        latestWorldDay,
        recapCursors,
      };
      return worldState;
    },

    async rebuildWorldProjection(worldId) {
      const { modelRef } = await ctx.runMutation(rebuildWorldProjectionRef, { worldId, now });
      return modelRef;
    },

    async rebuildCharacterProjection(worldId, characterId) {
      const { modelRef } = await ctx.runMutation(rebuildCharacterProjectionRef, { worldId, characterId, now });
      return modelRef;
    },

    async loadCharacterKnowledge(worldId, characterId) {
      const projection = await loadProjection(worldId);
      return authorizeKnowledgeRead(projection.characterKnowledge, characterId, OPERATOR);
    },

    async loadCharacterMemories(worldId, characterId) {
      const projection = await loadProjection(worldId);
      return authorizeMemoryRead(projection.characterMemories, characterId, OPERATOR);
    },

    async rebuildRelationshipProjection(worldId, sourceCharacterId, targetCharacterId) {
      const { modelRef } = await ctx.runMutation(
        rebuildRelationshipProjectionRef,
        { worldId, sourceCharacterId, targetCharacterId, now });
      return modelRef;
    },

    async recordArcClassification(classification) {
      const { created } = await ctx.runMutation(recordArcEventClassificationRef, { classification });
      return invalidate({ created });
    },

    async admitArcToPortfolio(worldId, candidate, remediation) {
      return invalidate(await ctx.runMutation(admitArcToPortfolioRef,
        { worldId, candidate, remediation, decidedAt: now }));
    },

    async syncArcPortfolioEntry(worldId, arcId, sourceEventId) {
      const { synced } = await ctx.runMutation(syncArcPortfolioEntryRef,
        { worldId, arcId, sourceEventId, updatedAt: now });
      return invalidate(synced);
    },

    async transitionArcLifecycle(input) {
      const { status } = await ctx.runMutation(transitionArcLifecycleRecordRef,
        { ...input, changedAt: now });
      return invalidate({ status });
    },

    async updateArcProjection(input) {
      return invalidate(await ctx.runMutation(updateArcProjectionRef, input));
    },

    async refreshStagnationPrompts(worldId, currentWorldDay) {
      const prompts = await ctx.runMutation(refreshArcStagnationPromptsRef,
        { worldId, currentWorldDay });
      return prompts.length;
    },

    async generateEpisode(worldId, worldDay, episodeNumber) {
      return invalidate(await ctx.runMutation(generateAcceptedEventEpisodeRef,
        { worldId, worldDay, episodeNumber, createdAt: now }));
    },

    async generateRecap(worldId, request) {
      const { snapshot, deduplicated } = await ctx.runMutation(generateIncrementalRecapRef, {
        snapshotId: request.snapshotId, worldId, recapType: request.recapType, targetId: request.targetId,
        mode: 'incremental', fromSequenceNumber: request.fromSequenceNumber,
        toSequenceNumber: request.toSequenceNumber, generatedAt: now,
      });
      return invalidate({ snapshotId: snapshot.id, deduplicated });
    },

    async loadEpisodeStatus(worldId, worldDay) {
      const row = await ctx.db.query('dailyEpisodes')
        .withIndex('by_world_and_day', (q) => q.eq('worldId', worldId).eq('worldDay', worldDay)).unique();
      return row
        ? { status: row.status, safetyClassificationId: row.safetyClassificationId ?? null, hasEpisode: Boolean(row.episode) }
        : null;
    },

    async generateShareFormats(worldId, worldDay) {
      const { status, reasonCodes } = await ctx.runMutation(generateEpisodeShareFormatsRef,
        { worldId, worldDay, createdAt: now });
      return { status, reasonCodes: [...reasonCodes] };
    },

    async createPublication(worldId, contentRef, summary) {
      const { status } = await ctx.runMutation(createEpisodePublicationRef,
        { worldId, contentRef, summary, actor: SYSTEM_ACTOR, reason: 'post-commit editorial pipeline', now });
      return { status };
    },

    async advancePublication(worldId, contentRef, action) {
      const { status } = await ctx.runMutation(advancePublicationRef,
        { worldId, contentRef, action, actor: SYSTEM_ACTOR, reason: 'post-commit editorial pipeline', now });
      return { status };
    },

    async reassessArcEntries(worldId) {
      const { reassessed } = await ctx.runMutation(
        reassessMajorActiveArcEntriesRef, { worldId, now });
      return reassessed;
    },

    async rebuildEpisodeProjection(worldId, worldDay) {
      const { modelRef } = await ctx.runMutation(
        rebuildEpisodeProjectionRef, { worldId, worldDay, now });
      return modelRef;
    },

    async rebuildEpisodeIndexProjection(worldId) {
      const { modelRef } = await ctx.runMutation(
        rebuildEpisodeIndexProjectionRef, { worldId, now });
      return modelRef;
    },

    async rebuildTimelineProjection(worldId) {
      const { modelRef } = await ctx.runMutation(
        rebuildTimelineProjectionRef, { worldId, now });
      return modelRef;
    },

    async rebuildVoteConsequenceProjection(worldId, targetWorldDay) {
      const { modelRef } = await ctx.runMutation(
        rebuildVoteConsequenceProjectionRef, { worldId, targetWorldDay, now });
      return modelRef;
    },

    async rebuildRelationshipGraphProjection(worldId, targetWorldDay) {
      const { modelRef } = await ctx.runMutation(
        rebuildRelationshipGraphProjectionRef, { worldId, targetWorldDay, now });
      return modelRef;
    },

    async rebuildArcReadModel(worldId, arcId) {
      const { modelRef } = await ctx.runMutation(
        rebuildArcProjectionRef, { worldId, arcId, now });
      return modelRef;
    },

    async rebuildArcPrimer(worldId, arcId) {
      const { modelRef } = await ctx.runMutation(
        rebuildArcPrimerRef, { worldId, arcId, now });
      return modelRef;
    },

    async rebuildLiveProjection(worldId) {
      const { modelRef } = await ctx.runMutation(
        rebuildLiveProjectionRef, { worldId, now });
      return modelRef;
    },

    async rebuildOnboardingSummary(worldId) {
      const { modelRef } = await ctx.runMutation(
        rebuildOnboardingSummaryRef, { worldId, now });
      return modelRef;
    },

    async persistDailySnapshot(worldId, worldDay) {
      const { snapshot, deduplicated } = await ctx.runMutation(
        persistDailySnapshotRef, { worldId, worldDay, createdAt: now });
      return { snapshotId: String(snapshot.snapshotId), deduplicated };
    },

    async loadStageMetrics(runId) {
      const rows = await ctx.db.query('postCommitCheckpoints')
        .withIndex('by_run_and_stage', (q) => q.eq('runId', runId)).collect();
      const latest = new Map<PostCommitStage, Doc<'postCommitCheckpoints'>>();
      for (const row of rows) {
        const stage = row.stage ;
        const prior = latest.get(stage);
        if (!prior || row.attempt > prior.attempt) latest.set(stage, row);
      }
      const stages: StageMetricsEntry[] = POST_COMMIT_STAGES.flatMap((stage) => {
        const row = latest.get(stage);
        return row ? [{ stage, status: row.status, durationMs: Math.max(0, row.updatedAt - row.createdAt) }] : [];
      });
      return { stages, recordedAt: now };
    },
  };
}

/** Run (or safely resume) stages 11–21 for one accepted event. */
async function executeLivePostCommit(
  ctx: MutationCtx,
  source: PostCommitSource,
  traceId: string,
  now: number,
): Promise<PostCommitRun> {
  return executePostCommitPipeline(
    { runId: postCommitRunId(source.worldId, source.sourceEventSequenceNumber), ...source },
    createConvexPostCommitRunStore(ctx.db, now),
    createPostCommitStageHandlers(createConvexPostCommitLivePort(ctx, now)),
    traceId,
  );
}

export type PostCommitOutcome = {
  runId: string;
  sourceEventId: string;
  worldDay: number;
  status: PostCommitRun['status'];
  attemptCount: number;
  failureStage?: string;
  errorCode?: string;
  errorMessage?: string;
};

const toOutcome = (run: PostCommitRun): PostCommitOutcome => ({
  runId: run.runId, sourceEventId: run.sourceEventId, worldDay: run.worldDay,
  status: run.status, attemptCount: run.attemptCount, failureStage: run.failureStage,
  errorCode: run.errorCode, errorMessage: run.errorMessage,
});

/**
 * Run stages 11–21 for ONE already-accepted event. Safe to call repeatedly: a completed
 * run short-circuits and a failed run resumes at the stage that failed, so no memory,
 * episode, recap or publication is duplicated (ART-83 AC#4).
 */
export const runPostCommitPipeline = internalMutation({
  args: { worldId: v.string(), sourceEventSequenceNumber: v.number(), now: v.optional(v.number()) },
  handler: async (ctx, args): Promise<PostCommitOutcome> => {
    const now = args.now ?? Date.now();
    const row = await ctx.db.query('canonEvents').withIndex('by_world_and_sequence', (q) =>
      q.eq('worldId', args.worldId).eq('sequenceNumber', args.sourceEventSequenceNumber)).unique();
    if (!row) throw new Error('POST_COMMIT_SOURCE_NOT_ACCEPTED');
    const run = await executeLivePostCommit(ctx, {
      worldId: args.worldId,
      sourceEventId: deriveEventId(args.worldId, row.sequenceNumber),
      sourceEventSequenceNumber: row.sequenceNumber,
      worldDay: row.worldDay,
    }, row.traceId, now);
    return toOutcome(run);
  },
});

/**
 * THE live daily-cycle entry point: execute queued world time slots (ART-97, stages 1–10)
 * and immediately run the post-commit cognition + editorial pipeline for every event those
 * slots committed, in canon order.
 *
 * Post-commit work is a CURSOR over accepted events, not a callback on this call's commits:
 * each call takes the oldest accepted events that have no completed post-commit run, in
 * canon order. That makes one entry point cover three cases with the same code — events
 * this call just committed, a previous call's failure, and events accepted before the
 * pipeline existed — and it guarantees arcs, episodes and recaps are derived in canon
 * order. Post-commit failures never roll the Canon commit back; they are recorded on the
 * run and retried by the next call.
 *
 * `maxSlots` bounds how many time slots are simulated; `maxPostCommitEvents` bounds how
 * many accepted events one transaction takes through stages 11–21. Call repeatedly until
 * `postCommit` comes back empty to drain the backlog.
 */
export const runLiveWorldDayCycle = internalMutation({
  args: {
    worldId: v.string(),
    slotId: v.optional(v.id('scheduledSlots')),
    maxSlots: v.optional(v.number()),
    maxPostCommitEvents: v.optional(v.number()),
    now: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<{
    worldId: string; executed: number; slots: WorldDaySlotOutcome[]; postCommit: PostCommitOutcome[];
  }> => {
    const now = args.now ?? Date.now();
    const maxPostCommitEvents = args.maxPostCommitEvents ?? DEFAULT_MAX_POST_COMMIT_EVENTS;
    if (!Number.isSafeInteger(maxPostCommitEvents) || maxPostCommitEvents < 1 || maxPostCommitEvents > MAX_POST_COMMIT_EVENTS) {
      throw new Error('INVALID_POST_COMMIT_BATCH_SIZE');
    }
    const slotResult: { worldId: string; executed: number; slots: WorldDaySlotOutcome[] } = await ctx.runMutation(
      runQueuedWorldDaySlotRef,
      { worldId: args.worldId, slotId: args.slotId, maxSlots: args.maxSlots ?? 1, now },
    );
    const rows = await ctx.db.query('canonEvents')
      .withIndex('by_world_and_sequence', (q) => q.eq('worldId', args.worldId)).collect();
    const settled = new Set((await ctx.db.query('postCommitRuns')
      .withIndex('by_world_and_sequence', (q) => q.eq('worldId', args.worldId)).collect())
      .filter((run) => run.status === 'completed')
      .map((run) => run.sourceEventSequenceNumber));

    const postCommit: PostCommitOutcome[] = [];
    for (const row of rows.filter(({ sequenceNumber }) => !settled.has(sequenceNumber))) {
      if (postCommit.length >= maxPostCommitEvents) break;
      const run = await executeLivePostCommit(ctx, {
        worldId: args.worldId,
        sourceEventId: deriveEventId(args.worldId, row.sequenceNumber),
        sourceEventSequenceNumber: row.sequenceNumber,
        worldDay: row.worldDay,
      }, row.traceId, now);
      postCommit.push(toOutcome(run));
      if (run.status !== 'completed') break;
    }
    return {
      worldId: args.worldId,
      executed: slotResult.executed,
      slots: slotResult.slots,
      postCommit,
    };
  },
});
