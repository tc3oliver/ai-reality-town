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
import { internal } from '../_generated/api';
import type { DataModel, Doc } from '../_generated/dataModel';
import { emptyProjection, type AcceptedEvent } from '../canon/model';
import { TIME_SLOTS } from '../canon/eventTypes';
import { replayWorldEvents } from '../canon/replay';
import { rowToAcceptedEvent } from '../canon/serialize';
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

/**
 * A world day counts as finished once it is no longer the newest day, or once it has
 * produced an event in the final time slot. Only finished days get an episode, a recap
 * close-out, or a daily snapshot.
 */
function completedWorldDays(events: readonly AcceptedEvent[]): number[] {
  const days = [...new Set(events.map(({ worldDay }) => worldDay))].sort((left, right) => left - right);
  const latest = days[days.length - 1];
  return days.filter((day) => day < latest
    || events.some((event) => event.worldDay === day && event.timeSlot === LAST_TIME_SLOT));
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
  let canonRows: Doc<'canonEvents'>[] | null = null;
  let worldState: PostCommitWorldState | null = null;
  const loadCanonRows = async (worldId: string): Promise<Doc<'canonEvents'>[]> => {
    if (!canonRows) {
      canonRows = await ctx.db.query('canonEvents')
        .withIndex('by_world_and_sequence', (q) => q.eq('worldId', worldId)).collect();
    }
    return canonRows;
  };
  const loadProjection = async (worldId: string) =>
    replayWorldEvents(emptyProjection(worldId), (await loadCanonRows(worldId)).map(rowToAcceptedEvent));
  /** Any story/editorial/recap write makes the cached view stale. */
  const invalidate = <T>(value: T): T => {
    worldState = null;
    return value;
  };

  return {
    async loadWorldState(source: PostCommitSource): Promise<PostCommitWorldState> {
      if (worldState) return worldState;
      const { worldId } = source;
      const rows = await loadCanonRows(worldId);
      const events = rows.map(rowToAcceptedEvent);
      const event = events.find(({ sequenceNumber }) => sequenceNumber === source.sourceEventSequenceNumber);
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
      const worldDayBySequence = new Map(events.map(({ sequenceNumber, worldDay }) => [sequenceNumber, worldDay]));
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
      const dayEvents = events.filter(({ worldDay }) => worldDay === event.worldDay);

      worldState = {
        event,
        arcs,
        characterIds: characterRows.map(({ characterId }) => characterId),
        completedWorldDays: completedWorldDays(events),
        episodeWorldDays: episodeRows.map(({ worldDay }) => worldDay),
        worldDayFirstSequenceNumber: dayEvents.reduce(
          (lowest, candidate) => Math.min(lowest, candidate.sequenceNumber), event.sequenceNumber),
        latestWorldDay: events.reduce((highest, candidate) => Math.max(highest, candidate.worldDay), event.worldDay),
        recapCursors,
      };
      return worldState;
    },

    async rebuildWorldProjection(worldId) {
      const { modelRef } = await ctx.runMutation(
        internal.publicRead.worldCharacterProjectionFunctions.rebuildWorldProjection, { worldId, now });
      return modelRef;
    },

    async rebuildCharacterProjection(worldId, characterId) {
      const { modelRef } = await ctx.runMutation(
        internal.publicRead.worldCharacterProjectionFunctions.rebuildCharacterProjection, { worldId, characterId, now });
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
        internal.publicRead.relationshipArcProjectionFunctions.rebuildRelationshipProjection,
        { worldId, sourceCharacterId, targetCharacterId, now });
      return modelRef;
    },

    async recordArcClassification(classification) {
      const { created } = await ctx.runMutation(
        internal.story.classificationFunctions.recordArcEventClassification, { classification });
      return invalidate({ created });
    },

    async admitArcToPortfolio(worldId, candidate, remediation) {
      return invalidate(await ctx.runMutation(internal.story.portfolioFunctions.admitArcToPortfolio,
        { worldId, candidate, remediation, decidedAt: now }));
    },

    async syncArcPortfolioEntry(worldId, arcId, sourceEventId) {
      const { synced } = await ctx.runMutation(internal.story.portfolioFunctions.syncArcPortfolioEntry,
        { worldId, arcId, sourceEventId, updatedAt: now });
      return invalidate(synced);
    },

    async transitionArcLifecycle(input) {
      const { status } = await ctx.runMutation(internal.story.functions.transitionArcLifecycleRecord,
        { ...input, changedAt: now });
      return invalidate({ status });
    },

    async updateArcProjection(input) {
      return invalidate(await ctx.runMutation(internal.story.projectionFunctions.updateArcProjection, input));
    },

    async refreshStagnationPrompts(worldId, currentWorldDay) {
      const prompts = await ctx.runMutation(internal.story.resolutionFunctions.refreshArcStagnationPrompts,
        { worldId, currentWorldDay });
      return prompts.length;
    },

    async generateEpisode(worldId, worldDay, episodeNumber) {
      return invalidate(await ctx.runMutation(internal.editorial.episodeFunctions.generateAcceptedEventEpisode,
        { worldId, worldDay, episodeNumber, createdAt: now }));
    },

    async generateRecap(worldId, request) {
      const { snapshot, deduplicated } = await ctx.runMutation(internal.recaps.functions.generateIncrementalRecap, {
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

    async createPublication(worldId, contentRef, summary) {
      const { status } = await ctx.runMutation(internal.editorial.publicationLifecycleFunctions.createEpisodePublication,
        { worldId, contentRef, summary, actor: SYSTEM_ACTOR, reason: 'post-commit editorial pipeline', now });
      return { status };
    },

    async advancePublication(worldId, contentRef, action) {
      const { status } = await ctx.runMutation(internal.editorial.publicationLifecycleFunctions.advancePublication,
        { worldId, contentRef, action, actor: SYSTEM_ACTOR, reason: 'post-commit editorial pipeline', now });
      return { status };
    },

    async reassessArcEntries(worldId) {
      const { reassessed } = await ctx.runMutation(
        internal.story.entryRecommendationFunctions.reassessMajorActiveArcEntries, { worldId, now });
      return reassessed;
    },

    async rebuildEpisodeProjection(worldId, worldDay) {
      const { modelRef } = await ctx.runMutation(
        internal.publicRead.episodeTimelineProjectionFunctions.rebuildEpisodeProjection, { worldId, worldDay, now });
      return modelRef;
    },

    async rebuildEpisodeIndexProjection(worldId) {
      const { modelRef } = await ctx.runMutation(
        internal.publicRead.episodeIndexProjectionFunctions.rebuildEpisodeIndexProjection, { worldId, now });
      return modelRef;
    },

    async rebuildTimelineProjection(worldId) {
      const { modelRef } = await ctx.runMutation(
        internal.publicRead.episodeTimelineProjectionFunctions.rebuildTimelineProjection, { worldId, now });
      return modelRef;
    },

    async rebuildArcReadModel(worldId, arcId) {
      const { modelRef } = await ctx.runMutation(
        internal.publicRead.relationshipArcProjectionFunctions.rebuildArcProjection, { worldId, arcId, now });
      return modelRef;
    },

    async rebuildArcPrimer(worldId, arcId) {
      const { modelRef } = await ctx.runMutation(
        internal.publicRead.arcPrimerFunctions.rebuildArcPrimer, { worldId, arcId, now });
      return modelRef;
    },

    async rebuildLiveProjection(worldId) {
      const { modelRef } = await ctx.runMutation(
        internal.publicRead.liveStateFunctions.rebuildLiveProjection, { worldId, now });
      return modelRef;
    },

    async rebuildOnboardingSummary(worldId) {
      const { modelRef } = await ctx.runMutation(
        internal.publicRead.onboardingSummaryFunctions.rebuildOnboardingSummary, { worldId, now });
      return modelRef;
    },

    async persistDailySnapshot(worldId, worldDay) {
      const { snapshot, deduplicated } = await ctx.runMutation(
        internal.canon.snapshotOperations.persistDailySnapshot, { worldId, worldDay, createdAt: now });
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
      internal.simulation.worldDayLiveFunctions.runQueuedWorldDaySlot,
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
