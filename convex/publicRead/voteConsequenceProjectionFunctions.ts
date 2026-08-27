/**
 * Convex wiring for the viewer-intervention consequence projection (FR-J002 / ART-46).
 *
 * Gathers the four evidence sources the pure builder needs — Canon, the vote ledger, the
 * Scene → Director-plan chain, and the ART-132 safety verdicts — applies the safety gate, and
 * publishes through the ordinary public read-model store. Zero Canon writes: this task adds a
 * DERIVED read model and stamps no causality onto any event.
 *
 * Public reads reuse ART-40's `getPublishedReadModel`; no new public query is added, so the
 * public function surface is unchanged.
 *
 * SAFETY GATE (FR-P004 / ART-132). This is a public TEXT surface — every node carries an
 * accepted event's `publicSummary` — so it is gated at REBUILD time with ART-132's own
 * machinery rather than a second copy of it: the bounded `readWithheldSceneLabels` sweep, then
 * `sceneEventRows` + `withheldEventIds` + `redactWithheldSummaries`, imported from
 * `liveStateFunctions` rather than re-implemented, so the surfaces cannot come to disagree.
 * A refused node is KEPT and loses only its text (`publicSummary: null`,
 * `publicationStatus: 'withheld'`): the causal structure is what this view is about, and
 * dropping the row would silently misreport a chain's length. Redaction is keyed on the EVENT
 * ID, never on a position in a parallel array. An event with no resolvable Scene provenance is
 * NOT redacted — ART-132's convention, since seed and system events were never classified.
 */

import { v } from 'convex/values';
import type { GenericMutationCtx } from 'convex/server';
import { internalMutation } from '../_generated/server';
import type { DataModel } from '../_generated/dataModel';
import { rowToAcceptedEvent } from '../canon/serialize';
import { readWithheldSceneLabels } from '../safety/effectiveSafetyLabels';
import { voteConsequenceModelRef } from '../shared/environmentVoteCatalog';
import { deriveEventId } from '../shared/ids';
import { sceneEventRows, withheldEventIds, redactWithheldSummaries } from './liveStateFunctions';
import { commitReadModelVersion } from './readModel';
import { writeStore } from './readModelFunctions';
import {
  buildVoteConsequenceProjection,
  validateVoteConsequenceLinks,
  VoteConsequenceError,
  VOTE_CONSEQUENCE_LOOKAHEAD_DAYS,
  VOTE_CONSEQUENCE_MODEL_KIND,
  type VoteConsequenceEventInput,
} from './voteConsequenceProjection';

/**
 * Read `viewerInterventionEventIds` off a persisted `DirectorPlanContext`.
 *
 * `directorPlans.context` is stored as `v.any()`, and `publicRead` may not depend on
 * `simulation`, so the field is narrowed defensively here instead of being imported as a type.
 * Anything that is not an array of non-empty strings is read as "the Director was told nothing",
 * which degrades the `uncertain` bucket to empty rather than to a guess.
 */
function viewerInterventionEventIds(context: unknown): string[] {
  if (context === null || typeof context !== 'object') return [];
  const value = (context as { viewerInterventionEventIds?: unknown }).viewerInterventionEventIds;
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0);
}

type MutationDb = GenericMutationCtx<DataModel>['db'];

/**
 * Rebuild and publish the consequence projection for one world day (AC#1/#2/#3).
 *
 * A plain function over a mutation `db` rather than the registered mutation itself, so the
 * safety-override refresh below can rebuild several days in one transaction without paying a
 * `ctx.runMutation` round trip per day.
 *
 * ## Why the Director chain is walked run by run rather than collected
 *
 * `directorPlans.context`, `groupedSceneRuns.result` and `sceneSimulationRuns.result` are
 * `v.any()` columns holding the raw generation blobs — the largest rows in the deployment. This
 * mutation runs on EVERY accepted event, so collecting all three tables for the world meant
 * re-reading the whole of a world's generation history on every commit, growing without bound.
 *
 * The chain is therefore walked the way every other reader of those tables walks it
 * (`simulation/directorFunctions.ts`, `sceneGroupingFunctions.ts`, `sceneSimulationFunctions.ts`):
 * run-scoped lookups on indexes that already existed. Days first
 * (`directorPlans.by_world_day_and_slot`), then that day's plans →
 * `groupedSceneRuns.by_director_run`, then those runs → `sceneSimulationRuns.by_grouping_run`.
 * Three dependent hops, each a bounded indexed read.
 *
 * The DAY window is `[targetWorldDay, targetWorldDay + VOTE_CONSEQUENCE_LOOKAHEAD_DAYS]`: a
 * Scene planned the day AFTER the vote can still carry it in `viewerInterventionEventIds`,
 * because the Director's context window is the last ten accepted events, not the last day. See
 * the constant for the derivation and for what the bound does not cover.
 *
 * `canonEvents` is still read whole. That is unavoidable for a causal closure — a
 * `causedByEventIds` chain may reach any earlier event — and it is the same read
 * `rebuildTimelineProjection` and `rebuildLiveProjection` already make on this path. ART-100
 * tracks making these incremental.
 */
async function rebuildForDay(
  db: MutationDb,
  args: { worldId: string; targetWorldDay: number; now: number },
): Promise<{ modelRef: string; version: number; deduplicated: boolean }> {
  if (args.worldId.trim().length === 0
    || !Number.isSafeInteger(args.targetWorldDay) || args.targetWorldDay < 0
    || !Number.isFinite(args.now)) {
    throw new VoteConsequenceError(
      'VOTE_CONSEQUENCE_INVALID',
      'worldId, a non-negative targetWorldDay, and a finite now are required',
    );
  }

  const contextDays = Array.from(
    { length: VOTE_CONSEQUENCE_LOOKAHEAD_DAYS + 1 },
    (_unused, offset) => args.targetWorldDay + offset,
  );

  const [canonRows, interventionRows, planRows, withheldSceneLabels] = await Promise.all([
    db.query('canonEvents')
      .withIndex('by_world_and_sequence', (q) => q.eq('worldId', args.worldId)).collect(),
    db.query('environmentVoteInterventions')
      .withIndex('by_world_and_target_day', (q) => q
        .eq('worldId', args.worldId).eq('targetWorldDay', args.targetWorldDay).eq('status', 'applied'))
      .collect(),
    Promise.all(contextDays.map((worldDay) => db.query('directorPlans')
      .withIndex('by_world_day_and_slot', (q) => q.eq('worldId', args.worldId).eq('worldDay', worldDay))
      .collect())).then((groups) => groups.flat()),
    // The inverted, history-independent question. See `effectiveSafetyLabels.ts` on why a
    // rebuild must never ask this Scene by Scene.
    readWithheldSceneLabels(db, args.worldId),
  ]);

  // Hop two and hop three. Dependent on the previous result, so they cannot join the batch
  // above; each is still a fan-out of bounded indexed reads rather than a table scan.
  const groupingRuns = await Promise.all(planRows.map((plan) => db.query('groupedSceneRuns')
    .withIndex('by_director_run', (q) => q.eq('worldId', args.worldId).eq('directorRunId', plan.directorRunId))
    .collect())).then((groups) => groups.flat());
  const sceneRuns = await Promise.all(groupingRuns.map((run) => db.query('sceneSimulationRuns')
    .withIndex('by_grouping_run', (q) => q.eq('worldId', args.worldId).eq('groupingRunId', run.groupingRunId))
    .collect())).then((groups) => groups.flat());

  const acceptedEvents = canonRows.map(rowToAcceptedEvent);
  const sceneEvents = sceneEventRows(acceptedEvents);
  const withheldEvents = withheldEventIds(
    sceneEvents,
    new Map(Object.entries(withheldSceneLabels)),
  );
  const publishableEvents = redactWithheldSummaries(acceptedEvents, withheldEvents);
  // Keyed on the EVENT ID, never on a position in a parallel array — the reason
  // `withheldEventIds` returns ids at all.
  const sceneIdByEvent = new Map(sceneEvents.map((event) => [event.eventId, event.sceneId ?? null]));

  const events: VoteConsequenceEventInput[] = publishableEvents.map((event) => ({
    eventId: event.eventId,
    sequenceNumber: event.sequenceNumber,
    worldDay: event.worldDay,
    timeSlot: event.timeSlot,
    eventType: event.eventType,
    idempotencyKey: event.idempotencyKey,
    causedByEventIds: [...event.causedByEventIds],
    publicSummary: event.publicSummary ?? null,
    publicationStatus: withheldEvents.has(event.eventId) ? 'withheld' : 'published',
    sceneId: sceneIdByEvent.get(event.eventId) ?? null,
  }));

  // Scene → grouping run → director run → plan context, walked through the links the pipeline
  // actually recorded. A Scene whose chain is incomplete contributes nothing rather than a
  // guess, so a partially-persisted run cannot manufacture an `uncertain` link.
  const directorRunByGrouping = new Map(
    groupingRuns.map((run) => [run.groupingRunId, run.directorRunId]),
  );
  const interventionsByDirectorRun = new Map(
    planRows.map((plan) => [plan.directorRunId, viewerInterventionEventIds(plan.context)]),
  );
  const contextInterventionEventIdsByScene: Record<string, string[]> = {};
  for (const run of sceneRuns) {
    const directorRunId = directorRunByGrouping.get(run.groupingRunId);
    if (directorRunId === undefined) continue;
    const eventIds = interventionsByDirectorRun.get(directorRunId);
    if (eventIds === undefined || eventIds.length === 0) continue;
    contextInterventionEventIdsByScene[run.sceneId] = eventIds;
  }

  /**
   * What "accepted" means, derived from the Canon ROWS rather than from `events` (AC#3).
   *
   * `deriveEventId(worldId, sequenceNumber)` is the same derivation `rowToAcceptedEvent` uses,
   * applied to the rows directly — so this set is a statement about `canonEvents`, not a
   * restatement of the array assembled above. That is what makes
   * `VOTE_CONSEQUENCE_SOURCE_NOT_ACCEPTED` reachable: had the builder kept computing it from
   * its own `events` argument, no widening of that argument could ever have failed the check.
   */
  const acceptedEventIds = canonRows.map((row) => deriveEventId(args.worldId, row.sequenceNumber));

  const payload = buildVoteConsequenceProjection({
    worldId: args.worldId,
    targetWorldDay: args.targetWorldDay,
    events,
    acceptedEventIds,
    appliedEventIds: interventionRows.flatMap((row) =>
      row.appliedEventId === undefined ? [] : [row.appliedEventId]),
    contextInterventionEventIdsByScene,
  });
  // Again, here, against Canon — defence in depth rather than ceremony. The call above proves
  // the BUILDER only claims links it was given evidence for; this one proves the PAYLOAD about
  // to be published claims only links Canon has accepted, and would catch a builder that
  // fabricated a node after validating.
  validateVoteConsequenceLinks(payload, acceptedEventIds);

  const modelRef = voteConsequenceModelRef(args.worldId, args.targetWorldDay);
  const result = await commitReadModelVersion(writeStore(db), {
    worldId: args.worldId,
    modelKind: VOTE_CONSEQUENCE_MODEL_KIND,
    modelRef,
    payload,
    sourceEventIds: payload.sourceEventIds,
    status: 'published',
    now: args.now,
  });
  return { modelRef, version: result.version, deduplicated: result.deduplicated };
}

/** Rebuild and publish the consequence projection for one world day (AC#1/#2/#3). */
export const rebuildVoteConsequenceProjection = internalMutation({
  args: { worldId: v.string(), targetWorldDay: v.number(), now: v.number() },
  handler: (ctx, args) => rebuildForDay(ctx.db, args),
});

/**
 * Rebuild EVERY world day this world has already published a consequence model for
 * (FR-P004 / ART-132).
 *
 * The safety-override path's entry point. `voteConsequence` is a third cached public TEXT
 * surface built from the same `publicSummary` values as the live projection and the onboarding
 * summary, and the override handler rebuilt only those two — so an operator withholding a day-7
 * Scene while the world ran on day 9 watched the sentence vanish from the map while
 * `voteConsequence:<world>:7` went on serving it. Nothing would ever have rebuilt that day
 * again: the pipeline only refreshes a bounded trailing window around the day being committed.
 *
 * The days are taken from the read-model store itself rather than from a guess about which days
 * had votes, and rather than from parsing `modelRef`: a published payload states its own
 * `targetWorldDay`, so the set is exactly "the days that could currently be serving text". A
 * world that has published none does no work.
 */
export const refreshVoteConsequenceProjections = internalMutation({
  args: { worldId: v.string(), now: v.number() },
  handler: async (ctx, args) => {
    if (args.worldId.trim().length === 0 || !Number.isFinite(args.now)) {
      throw new VoteConsequenceError(
        'VOTE_CONSEQUENCE_INVALID',
        'worldId and a finite now are required',
      );
    }
    const rows = await ctx.db.query('publishedReadModels')
      .withIndex('by_status', (q) => q
        .eq('worldId', args.worldId).eq('modelKind', VOTE_CONSEQUENCE_MODEL_KIND).eq('status', 'published'))
      .collect();
    const days = new Set<number>();
    for (const row of rows) {
      const targetWorldDay = (row.payload as { targetWorldDay?: unknown } | null)?.targetWorldDay;
      // Defensive: `payload` is `v.any()`. A row this build cannot read is skipped rather than
      // crashing an operator's withhold — the two surfaces that DO rebuild must still take effect.
      if (typeof targetWorldDay === 'number' && Number.isSafeInteger(targetWorldDay) && targetWorldDay >= 0) {
        days.add(targetWorldDay);
      }
    }
    const modelRefs: string[] = [];
    // Sorted, so the transaction's write order is deterministic.
    for (const targetWorldDay of [...days].sort((left, right) => left - right)) {
      const { modelRef } = await rebuildForDay(ctx.db, { worldId: args.worldId, targetWorldDay, now: args.now });
      modelRefs.push(modelRef);
    }
    return { modelRefs, rebuiltDayCount: modelRefs.length };
  },
});
