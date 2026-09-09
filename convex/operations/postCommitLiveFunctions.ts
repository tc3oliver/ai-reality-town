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
import type { recordArcHeat as recordArcHeatExport } from '../story/heatFunctions';
import type {
  refreshArcStagnationPrompts as refreshArcStagnationPromptsExport,
  recordArcResolutionDecision as recordArcResolutionDecisionExport,
} from '../story/resolutionFunctions';
import type { applyArcResolutionConsequences as applyArcResolutionConsequencesExport } from '../story/consequenceSummaryFunctions';
import type { generateAcceptedEventEpisode as generateAcceptedEventEpisodeExport } from '../editorial/episodeFunctions';
import type { generateEpisodeShareFormats as generateEpisodeShareFormatsExport } from '../editorial/shareFormatFunctions';
import type { generateIncrementalRecap as generateIncrementalRecapExport } from '../recaps/functions';
import type { generateEpisodeRecapFormats as generateEpisodeRecapFormatsExport } from '../recaps/recapFormatFunctions';
import type { runEpisodeCoverageGate as runEpisodeCoverageGateExport } from '../recaps/coverageValidationFunctions';
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
import { drivableWorldIds } from '../simulation/schedulerOperations';
import type { AcceptedEvent } from '../canon/model';
import { TIME_SLOTS } from '../canon/eventTypes';
import { rowToAcceptedEvent } from '../canon/serialize';
import { loadDegradationState } from '../simulation/degradationFunctions';
import { policyFor } from '../simulation/degradation';
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
  recapCursorOf,
  type LiveArcState,
  type PostCommitLivePort,
  type PostCommitSource,
  type PostCommitWorldState,
} from './postCommitLive';

type MutationCtx = GenericMutationCtx<DataModel>;

/** Server actor for the automated pipeline; FR-K004 reserves `publish` for administrators. */
const SYSTEM_ACTOR = { type: 'system' as const, id: 'post-commit-pipeline' };
const OPERATOR = { type: 'operations' as const, operatorId: 'post-commit-pipeline' };
/**
 * Accepted events one `runLiveWorldDayCycle` transaction takes through stages 11–21.
 *
 * WAS 1, because every public read model was rebuilt by replaying the whole accepted-event log, so
 * one event's post-commit work already cost megabytes of reads on a mature world and a second
 * event risked the Convex per-transaction byte limit. ART-100 removed those replays — the Live
 * rebuild resumes from a checkpoint, the day list is maintained, and the cycle's own candidate
 * scan is a bounded page — so a run's read cost no longer grows with canon size and a whole time
 * slot fits in one transaction (AC#2).
 *
 * 3 is the size of a time slot's worth of events, which is the unit the acceptance criterion names.
 * It is a DEFAULT, not a ceiling: callers may still pass 1..{@link MAX_POST_COMMIT_EVENTS}.
 */
const DEFAULT_MAX_POST_COMMIT_EVENTS = 3;
const MAX_POST_COMMIT_EVENTS = 10;

/**
 * Extra rows read past the batch so the cursor can advance over events that were settled
 * out of band — by a direct `runPostCommitPipeline` call, or by a previous cycle that processed
 * more than this one will.
 *
 * Without it a page could be entirely settled events and the cycle would return empty while work
 * remained, one call earlier than it should. With it, catch-up is amortised: each call still
 * advances the cursor by up to this many settled events for a constant read cost.
 */
const POST_COMMIT_CURSOR_CATCHUP = 32;

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
const recordArcHeatRef = internalFunctionRef<typeof recordArcHeatExport>(
  'story/heatFunctions:recordArcHeat',
);
const updateArcProjectionRef = internalFunctionRef<typeof updateArcProjectionExport>(
  'story/projectionFunctions:updateArcProjection',
);
const refreshArcStagnationPromptsRef = internalFunctionRef<typeof refreshArcStagnationPromptsExport>(
  'story/resolutionFunctions:refreshArcStagnationPrompts',
);
const recordArcResolutionDecisionRef = internalFunctionRef<typeof recordArcResolutionDecisionExport>(
  'story/resolutionFunctions:recordArcResolutionDecision',
);
const applyArcResolutionConsequencesRef = internalFunctionRef<typeof applyArcResolutionConsequencesExport>(
  'story/consequenceSummaryFunctions:applyArcResolutionConsequences',
);
const generateAcceptedEventEpisodeRef = internalFunctionRef<typeof generateAcceptedEventEpisodeExport>(
  'editorial/episodeFunctions:generateAcceptedEventEpisode',
);
const generateIncrementalRecapRef = internalFunctionRef<typeof generateIncrementalRecapExport>(
  'recaps/functions:generateIncrementalRecap',
);
const generateEpisodeRecapFormatsRef = internalFunctionRef<typeof generateEpisodeRecapFormatsExport>(
  'recaps/recapFormatFunctions:generateEpisodeRecapFormats',
);
const runEpisodeCoverageGateRef = internalFunctionRef<typeof runEpisodeCoverageGateExport>(
  'recaps/coverageValidationFunctions:runEpisodeCoverageGate',
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
 * A world day counts as finished once the world has moved past it — once a LATER day has an
 * accepted event. Nothing else finishes it. Only finished days get an episode, a recap close-out,
 * or a daily snapshot.
 *
 * This note used to add "or once it has produced an event in the final time slot", and that clause
 * was wrong: it was the ART-89 defect written down as though it were the rule. A day treated as
 * complete the moment its night slot BEGAN had its Episode assembled from a partial slot, and the
 * rest of that slot reached no Episode, no recap and no publication — 14 of 96 high-importance
 * events permanently uncovered over seven days, and §16.2's coverage clause at 85.4%. The clause
 * is gone from the body; it is named here so nobody restores it as a fix.
 */
export function completedWorldDays(events: readonly AcceptedEvent[]): number[] {
  const days = [...new Set(events.map(({ worldDay }) => worldDay))].sort((left, right) => left - right);
  const latest = days[days.length - 1];
  return days.filter((day) => day < latest);
}

/**
 * {@link completedWorldDays} from a maintained day list instead of the accepted-event log (ART-100).
 *
 * Identical semantics, derived differently. The original folds a full replay to get the distinct
 * day set; this takes that set as an argument, because `worldDayLedgers` maintains it
 * incrementally (see that table). A day that produced no events is absent from both.
 *
 * ## A day is over when the world has moved past it, not when its last slot begins (ART-89)
 *
 * Both functions used to admit the latest day as soon as ONE accepted event carried the last time
 * slot. That was wrong, and the way it was wrong was invisible: this pipeline runs once per
 * accepted event, so the FIRST event of a day's night slot marked the day complete, the episode
 * stage assembled that day's Episode from the events accepted so far, and episodes are idempotent
 * per world day — so the rest of the night slot was never in any Episode, any recap, or any
 * publication, for every day of every world. Over the fixed 7-day seed that left 14 of 96
 * high-importance Accepted Events permanently uncovered and §16.2's 95% coverage clause at 85.4%.
 * Nothing failed: the coverage gate obliges an Episode to cite the events of its own day AS THE
 * EPISODE SAW THEM, so an Episode built from a partial day passed its own check.
 *
 * `day < latestWorldDay` is the only rule Canon can state honestly. A world day is finished when
 * a later day has accepted an event; until then the day may still commit more. The cost is that the
 * newest day's Episode is due on the next day's first commit rather than on its own last slot,
 * which is what a daily recap means anyway — `getStoryQualityMetrics` excludes the not-yet-due day
 * from the coverage denominator with a reason rather than counting it as uncovered.
 */
export function completedWorldDaysOf(
  worldDays: readonly number[],
  latestWorldDay: number,
): number[] {
  return [...worldDays]
    .sort((left, right) => left - right)
    .filter((day) => day < latestWorldDay);
}

/**
 * Whether the latest world day has entered its final time slot.
 *
 * The daily snapshot's condition, and deliberately NOT the episode's — see
 * `PostCommitWorldState.latestWorldDayFinalSlotStarted` for why the two questions are different.
 */
export function finalSlotStarted(latestDayEvents: readonly AcceptedEvent[]): boolean {
  return latestDayEvents.some((event) => event.timeSlot === TIME_SLOTS[TIME_SLOTS.length - 1]);
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

  /**
   * The Canon-derived half of {@link PostCommitWorldState}, cached separately from the rest and
   * deliberately NOT cleared by {@link invalidate} (ART-100).
   *
   * `worldState` as a whole is invalidated by every story/editorial/recap write, and correctly so:
   * `arcs`, `characterIds`, `episodeWorldDays` and `recapCursors` all come from tables this
   * pipeline writes. These four fields do not. They are derived from `canonEvents` alone, and this
   * pipeline never writes Canon — the invariant the module docblock above already states.
   *
   * Splitting them out is not a micro-optimisation. `loadWorldState` runs at least twice per
   * post-commit run in practice (stage 17's recap write invalidates, stage 20 then re-reads to ask
   * whether the day is finished), and the day-oriented reads below — `eventsOnDay`, `dayBounds`,
   * and `completedWorldDaysBounded`'s one probe per world day — are the expensive part. Paying
   * them twice for a recap write that cannot have changed their answer was a read-cost regression
   * introduced when the earlier `loadCanonRows` cache (which `invalidate` likewise never cleared)
   * was removed. Measured on the ART-100 harness: 12 -> 6 canon reads at the small scale point and
   * 24 -> 12 at the large one, i.e. exactly the doubling, removed.
   *
   * This does NOT make the cost flat — `completedWorldDaysBounded` still probes once per world
   * day, so it remains O(days). See that function's own docblock.
   */
  type CanonWorldView = Pick<PostCommitWorldState,
    'event' | 'completedWorldDays' | 'worldDayFirstSequenceNumber' | 'timeSlotFirstSequenceNumber'
    | 'seasonFirstSequenceNumber' | 'latestWorldDay' | 'latestWorldDayFinalSlotStarted'>;
  let canonView: CanonWorldView | null = null;

  /**
   * The world's day list, advanced from the ledger by the events since it was last written.
   *
   * Accepted Canon is append-only, so a world day can only come into existence by an event coming
   * into existence — which makes "the days named by the events after `throughSequenceNumber`" an
   * EXACT catch-up rather than an approximation, and one that assumes nothing about `worldDay`
   * rising with `sequenceNumber`. The tail is one event in the steady state.
   *
   * Also carries the episode-day half, re-probed only for completed days not already known to
   * have an episode. That set is what stage 16 is about to work on regardless, so the probes cost
   * nothing the pipeline was not already going to spend.
   */
  const advanceDayLedger = async (
    worldId: string,
    completedDaysSoFar: readonly number[],
  ): Promise<{ worldDays: number[]; episodeWorldDays: number[] }> => {
    const row = await ctx.db.query('worldDayLedgers')
      .withIndex('by_world', (q) => q.eq('worldId', worldId)).unique();
    const throughSequenceNumber = row?.throughSequenceNumber ?? -1;
    const tail = await ctx.db.query('canonEvents')
      .withIndex('by_world_and_sequence', (q) => q.eq('worldId', worldId).gt('sequenceNumber', throughSequenceNumber))
      .collect();
    const worldDays = [...new Set([...(row?.worldDays ?? []), ...tail.map(({ worldDay }) => worldDay)])]
      .sort((left, right) => left - right);
    const highestSequenceNumber = tail.reduce(
      (highest, candidate) => Math.max(highest, candidate.sequenceNumber), throughSequenceNumber);

    const knownEpisodeDays = new Set(row?.episodeWorldDays ?? []);
    const unprobed = completedDaysSoFar.filter((day) => !knownEpisodeDays.has(day));
    for (const worldDay of unprobed) {
      const episode = await ctx.db.query('dailyEpisodes')
        .withIndex('by_world_and_day', (q) => q.eq('worldId', worldId).eq('worldDay', worldDay)).unique();
      if (episode) knownEpisodeDays.add(worldDay);
    }
    const episodeWorldDays = [...knownEpisodeDays].sort((left, right) => left - right);

    const ledger = {
      schemaVersion: 1 as const, worldId, worldDays, episodeWorldDays,
      throughSequenceNumber: highestSequenceNumber, updatedAt: now,
    };
    if (row) await ctx.db.patch(row._id, ledger);
    else await ctx.db.insert('worldDayLedgers', ledger);
    return { worldDays, episodeWorldDays };
  };

  let episodeWorldDays: number[] = [];

  const loadCanonView = async (source: PostCommitSource): Promise<CanonWorldView> => {
    if (canonView) return canonView;
    const { worldId } = source;
    const sourceRow = await eventAtSequence(worldId, source.sourceEventSequenceNumber);
    const event = sourceRow ? rowToAcceptedEvent(sourceRow) : null;
    if (!event || event.eventId !== source.sourceEventId) throw new Error('POST_COMMIT_SOURCE_NOT_ACCEPTED');

    const dayEvents = await eventsOnDay(worldId, event.worldDay);
    const bounds = (await dayBounds(worldId)) ?? { min: event.worldDay, max: event.worldDay };
    const latestWorldDay = Math.max(bounds.max, event.worldDay);
    // The latest day's own events, reused when it is the day being committed to.
    const latestDayEvents = latestWorldDay === event.worldDay
      ? dayEvents
      : await eventsOnDay(worldId, latestWorldDay);

    // Two passes over the ledger, deliberately: the episode probe is driven by which days are
    // COMPLETED, and that is not known until the day list is. The first call catches the day list
    // up and probes whatever it already knew; the second probes the days the first just revealed.
    // Both are bounded, and both write the same row inside one transaction.
    const firstPass = await advanceDayLedger(worldId, []);
    const completed = completedWorldDaysOf(firstPass.worldDays, latestWorldDay);
    episodeWorldDays = (await advanceDayLedger(worldId, completed)).episodeWorldDays;

    const worldDayFirstSequenceNumber = dayEvents.reduce(
      (lowest, candidate) => Math.min(lowest, candidate.sequenceNumber), event.sequenceNumber);
    canonView = {
      event,
      completedWorldDays: completed,
      latestWorldDayFinalSlotStarted: finalSlotStarted(latestDayEvents),
      worldDayFirstSequenceNumber,
      // Both derived from the day's events, already loaded — no extra read for either tier.
      timeSlotFirstSequenceNumber: dayEvents
        .filter((candidate) => candidate.timeSlot === event.timeSlot)
        .reduce((lowest, candidate) => Math.min(lowest, candidate.sequenceNumber), event.sequenceNumber),
      // See `PostCommitWorldState.seasonFirstSequenceNumber`: the day's own origin, because the
      // pipeline reaches a season's first day before any later day of it. Back-scanning to the
      // season's true start would be a read that grows with the season.
      seasonFirstSequenceNumber: worldDayFirstSequenceNumber,
      latestWorldDay,
    };
    return canonView;
  };

  return {
    async loadWorldState(source: PostCommitSource): Promise<PostCommitWorldState> {
      if (worldState) return worldState;
      const { worldId } = source;
      const canon = await loadCanonView(source);

      // `dailyEpisodes` is deliberately absent: `episodeWorldDays` is the only thing this state
      // ever read off it, and `worldDayLedgers` now maintains that list (ART-100). Sweeping the
      // table grew with the world's age for a set difference against a handful of pending days.
      const [lifecycles, projectionRows, transitionRows, portfolioRows, characterRows] = await Promise.all([
        ctx.db.query('storyArcLifecycles').withIndex('by_world_and_arc', (q) => q.eq('worldId', worldId)).collect(),
        ctx.db.query('storyArcProjectionEvents').withIndex('by_world_arc_and_revision', (q) => q.eq('worldId', worldId)).collect(),
        ctx.db.query('storyArcLifecycleTransitions').withIndex('by_world_arc_and_revision', (q) => q.eq('worldId', worldId)).collect(),
        ctx.db.query('storyArcPortfolioEntries').withIndex('by_world_and_arc', (q) => q.eq('worldId', worldId)).collect(),
        ctx.db.query('worldCharacters').withIndex('by_world_id', (q) => q.eq('worldId', worldId)).collect(),
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
      // One indexed read per arc for FR-F006's 觀眾互動 signal (ART-32). Bounded by the portfolio
      // caps the world already enforces (≤3 major, ≤6 minor active), and by `unique()` rather than
      // a scan — CLAUDE.md §9's rule about per-event paths.
      const interactionByArc = new Map((await Promise.all(lifecycles.map(async (lifecycle) => {
        const counter = await ctx.db
          .query('arcInteractionCounters')
          .withIndex('by_world_and_arc', (q) => q.eq('worldId', worldId).eq('arcId', lifecycle.arcId))
          .unique();
        // Absent means "no interaction has ever been recorded", which IS zero: the ingest bumps
        // this on the first one. `null` is reserved for a caller that cannot observe at all.
        return [lifecycle.arcId, counter?.interactions ?? 0] as const;
      }))));
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
          // ART-163. The newest projection revision's world day IS the arc's `lastProgressTime`
          // (`replayArcProjection` derives it from the event that appended the revision), so
          // stagnation is measured against real progress rather than against lifecycle churn.
          lastProgressWorldDay: latest.worldDay,
          viewerInteractionCount: interactionByArc.get(lifecycle.arcId) ?? 0,
        }];
      });

      worldState = {
        ...canon,
        arcs,
        characterIds: characterRows.map(({ characterId }) => characterId),
        episodeWorldDays,
      };
      return worldState;
    },

    /**
     * ART-164. One point read per target, replacing a `.collect()` of every recap snapshot in the
     * world on every event. That sweep was already growing with the world's age; with the scene
     * and arc tiers added it would grow with days times slots, which is exactly what
     * "never `.collect()` a whole world on a per-event path" forbids.
     *
     * The watermark is the SCOPE end where a target has one. A selective arc recap's last matching
     * event can be far behind the range it examined, and resuming from the event rather than the
     * watermark would re-examine the same quiet stretch on every later run.
     */
    async loadRecapCursors(worldId, targets) {
      const entries = await Promise.all(targets.map(async ({ recapType, targetId }) => {
        const row = await ctx.db.query('recapSnapshots').withIndex('by_target_and_version',
          (q) => q.eq('worldId', worldId).eq('recapType', recapType).eq('targetId', targetId))
          .order('desc').first();
        return row === null ? null
          : { key: `${recapType}:${targetId}`, cursor: recapCursorOf({
            sourceToSequenceNumber: row.sourceToSequenceNumber, sourceScope: row.sourceScope ?? null,
          }) };
      }));
      // No `invalidate`: this reads and writes nothing, so the cached world state is still current.
      return Object.fromEntries(entries
        .filter((entry): entry is { key: string; cursor: number } => entry !== null)
        .map(({ key, cursor }) => [key, cursor]));
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

    async recordArcHeat(heat) {
      await ctx.runMutation(recordArcHeatRef, { heat, recordedAt: now });
    },

    async updateArcProjection(input) {
      return invalidate(await ctx.runMutation(updateArcProjectionRef, input));
    },

    async refreshStagnationPrompts(worldId, currentWorldDay) {
      const prompts = await ctx.runMutation(refreshArcStagnationPromptsRef,
        { worldId, currentWorldDay });
      return prompts.length;
    },

    async recordArcResolution(worldId, decision) {
      return invalidate(await ctx.runMutation(recordArcResolutionDecisionRef, { worldId, decision }));
    },

    async applyArcConsequences(worldId, decisionId) {
      const { applied } = await ctx.runMutation(applyArcResolutionConsequencesRef,
        { worldId, decisionId, now });
      return invalidate({ applied });
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
        ...(request.arcId === undefined ? {} : { arcId: request.arcId }),
      });
      return invalidate({ snapshotId: snapshot?.id ?? null, deduplicated });
    },

    async generateRecapFormats(worldId, worldDay) {
      const outcome = await ctx.runMutation(generateEpisodeRecapFormatsRef, { worldId, worldDay, createdAt: now });
      return invalidate(outcome);
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

    async runCoverageGate(worldId, worldDay, contentRef) {
      const verdict = await ctx.runMutation(runEpisodeCoverageGateRef, { worldId, worldDay, contentRef, now });
      return invalidate({ releasable: verdict.releasable, findingCodes: [...verdict.findingCodes] });
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

    /**
     * FR-M004 rung 5 (ART-91). One indexed point read of the world's degradation state.
     *
     * `operations` may depend on `simulation`, so this reads the pure loader rather than routing
     * through another mutation — the state is one row and this stage already holds a `ctx.db`.
     */
    async defersSummaries(worldId) {
      return policyFor((await loadDegradationState(ctx.db, worldId)).level).defersSummaries;
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
    /**
     * Who authors this cycle's scenes (ART-159). Required, and passed straight through to
     * `runQueuedWorldDaySlot` — a default here would reintroduce exactly the silent choice that
     * made the deterministic fake the production author, one level further from the decision.
     */
    sceneAuthor: v.union(v.literal('deterministic_fake'), v.literal('preauthored')),
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
      { worldId: args.worldId, slotId: args.slotId, maxSlots: args.maxSlots ?? 1,
        sceneAuthor: args.sceneAuthor, now },
    );
    return {
      worldId: args.worldId,
      executed: slotResult.executed,
      slots: slotResult.slots,
      postCommit: await drainPostCommitBacklog(ctx, args.worldId, maxPostCommitEvents, now),
    };
  },
});

/**
 * The post-commit half of a live cycle, on its own.
 *
 * The live path cannot use {@link runLiveWorldDayCycle}: its slot must be executed from an action
 * so a provider can be called, and an action has no transaction to share with the drain. So the
 * action runs the slot itself and then calls this. Same body, same cursor, same bound — only the
 * caller differs.
 */
export const drainLivePostCommit = internalMutation({
  args: {
    worldId: v.string(),
    maxPostCommitEvents: v.optional(v.number()),
    now: v.optional(v.number()),
  },
  handler: (ctx, args): Promise<PostCommitOutcome[]> => {
    const maxPostCommitEvents = args.maxPostCommitEvents ?? DEFAULT_MAX_POST_COMMIT_EVENTS;
    if (!Number.isSafeInteger(maxPostCommitEvents) || maxPostCommitEvents < 1 || maxPostCommitEvents > MAX_POST_COMMIT_EVENTS) {
      throw new Error('INVALID_POST_COMMIT_BATCH_SIZE');
    }
    return drainPostCommitBacklog(ctx, args.worldId, maxPostCommitEvents, args.now ?? Date.now());
  },
});

/**
 * Drain post-commit for every running public world (ART-160), invoked by cron.
 *
 * The live driver cannot do this itself: it is the provider composition root inside
 * `convex/simulation/providers`, and `simulation` may not depend on `operations`. That separation
 * costs nothing, because stages 11–21 were never a callback on a slot's commits — the cursor picks
 * up whatever has been accepted, whoever accepted it.
 *
 * Bounded per world per tick by the same page size the one-world entry point uses, so a backlog is
 * worked off over several ticks rather than in one transaction that would exceed a read budget.
 */
export const drainAllLivePostCommit = internalMutation({
  args: {
    maxPostCommitEvents: v.optional(v.number()),
    now: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<{ worldId: string; postCommit: PostCommitOutcome[] }[]> => {
    const maxPostCommitEvents = args.maxPostCommitEvents ?? DEFAULT_MAX_POST_COMMIT_EVENTS;
    if (!Number.isSafeInteger(maxPostCommitEvents) || maxPostCommitEvents < 1 || maxPostCommitEvents > MAX_POST_COMMIT_EVENTS) {
      throw new Error('INVALID_POST_COMMIT_BATCH_SIZE');
    }
    const now = args.now ?? Date.now();
    const drained: { worldId: string; postCommit: PostCommitOutcome[] }[] = [];
    // The SAME rule the live driver uses to decide which worlds it may advance, shared rather than
    // restated — two definitions of "a world the pipeline runs for" could disagree, and the one
    // that ran fewer would strand events with nothing saying why.
    for (const worldId of await drivableWorldIds(ctx.db)) {
      drained.push({
        worldId,
        postCommit: await drainPostCommitBacklog(ctx, worldId, maxPostCommitEvents, now),
      });
    }
    return drained;
  },
});

/**
 * Take the next bounded page of accepted events through stages 11–21.
 *
 * Extracted from {@link runLiveWorldDayCycle} for ART-159: the live path runs its slot from an
 * ACTION (a Convex mutation cannot call a provider), so "execute the slot" and "drain the
 * backlog" can no longer be one transaction. Both callers share this body rather than each
 * having their own copy, because the cursor arithmetic below is the part that must not diverge —
 * two implementations of "how far is settled" would be two chances to strand an event.
 */
async function drainPostCommitBacklog(
  ctx: GenericMutationCtx<DataModel>,
  worldId: string,
  maxPostCommitEvents: number,
  now: number,
): Promise<PostCommitOutcome[]> {
  /**
   * ART-100 AC#2. One bounded page of candidates instead of the whole accepted-event log and
   * the whole post-commit run table — both of which were read, and filtered in memory, before a
   * single event was processed.
   *
   * `postCommitCursors` records how far a contiguous run of completed post-commit runs reaches.
   * Everything at or below it is settled and is never looked at again, so the cost of a call
   * does not grow with how much the world has already done.
   */
  const cursorRow = await ctx.db.query('postCommitCursors')
    .withIndex('by_world', (q) => q.eq('worldId', worldId)).unique();
  const cursor = cursorRow?.settledThroughSequenceNumber ?? -1;
  const page = maxPostCommitEvents + POST_COMMIT_CURSOR_CATCHUP;
  const [candidateRows, runRows] = await Promise.all([
    ctx.db.query('canonEvents')
      .withIndex('by_world_and_sequence', (q) => q.eq('worldId', worldId).gt('sequenceNumber', cursor))
      .take(page),
    ctx.db.query('postCommitRuns')
      .withIndex('by_world_and_sequence', (q) =>
        q.eq('worldId', worldId).gt('sourceEventSequenceNumber', cursor))
      .take(page),
  ]);
  const settled = new Set(runRows
    .filter((run) => run.status === 'completed')
    .map((run) => run.sourceEventSequenceNumber));

  /**
   * Advance the cursor over the leading settled events, and only those.
   *
   * Stopping at the first unsettled event is what keeps a directly-invoked, out-of-order run
   * from stranding its predecessors. Advancing here — before any work — is also what guarantees
   * PROGRESS: a page that turns out to be entirely settled still moves the cursor, so the next
   * call reaches new events rather than re-reading the same page forever.
   */
  let settledThrough = cursor;
  for (const row of candidateRows) {
    if (!settled.has(row.sequenceNumber)) break;
    settledThrough = row.sequenceNumber;
  }
  if (settledThrough > cursor) {
    const advanced = {
      schemaVersion: 1 as const, worldId,
      settledThroughSequenceNumber: settledThrough, updatedAt: now,
    };
    if (cursorRow) await ctx.db.patch(cursorRow._id, advanced);
    else await ctx.db.insert('postCommitCursors', advanced);
  }

  const postCommit: PostCommitOutcome[] = [];
  for (const row of candidateRows.filter(({ sequenceNumber }) => !settled.has(sequenceNumber))) {
    if (postCommit.length >= maxPostCommitEvents) break;
    const run = await executeLivePostCommit(ctx, {
      worldId,
      sourceEventId: deriveEventId(worldId, row.sequenceNumber),
      sourceEventSequenceNumber: row.sequenceNumber,
      worldDay: row.worldDay,
    }, row.traceId, now);
    postCommit.push(toOutcome(run));
    if (run.status !== 'completed') break;
  }
  return postCommit;
}
