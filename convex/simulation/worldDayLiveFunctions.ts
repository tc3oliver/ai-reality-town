/**
 * FR-C001…FR-C005 LIVE ENTRY POINT.
 *
 * `runQueuedWorldDaySlot` is the only place in the codebase where a queued world time slot
 * is actually executed end to end. It takes one reserved `scheduledSlots` row and drives
 * PRD §12 stages 1–10 through the resumable orchestrator:
 *
 *   startScheduledSlot → executeWorldDay(load world state … commit accepted events)
 *   → completeScheduledSlot(committed event) | failScheduledSlot(stable error code)
 *
 * Invoke it against a deployment with, for example:
 *
 *   npx convex run simulation/schedulerOperations:advanceOneWorldDay '{"worldId":"mistwood","now":0}'
 *   npx convex run simulation/worldDayLiveFunctions:runQueuedWorldDaySlot '{"worldId":"mistwood"}'
 *
 * Everything runs inside ONE Convex mutation/transaction, exactly like the foundation
 * workflow: the deterministic provider needs no network, so there is no action-then-
 * mutation race and the Canon commit stays atomic and idempotent.
 *
 * The function is internal on purpose — public reads must never trigger generation
 * (ADR-0001). Stages 11–21 (projection, cognition, episodes, publication) are the
 * separate post-commit pipeline in `convex/operations/postCommitOrchestration.ts`.
 */

import { internalMutation } from '../_generated/server';
import type { DataModel, Doc, Id } from '../_generated/dataModel';
import type { GenericMutationCtx } from 'convex/server';
import { v } from 'convex/values';
import { internalFunctionRef } from '../shared/internalFunctionRef';
import type { persistDirectorPlan as persistDirectorPlanExport } from './directorFunctions';
import type { persistCharacterIntent as persistCharacterIntentExport } from './characterIntentFunctions';
import type { groupPersistedCharacterIntents as groupPersistedCharacterIntentsExport } from './sceneGroupingFunctions';
import type { persistValidatedSceneSimulation as persistValidatedSceneSimulationExport } from './sceneSimulationFunctions';
import type {
  startScheduledSlot as startScheduledSlotExport,
  completeScheduledSlot as completeScheduledSlotExport,
  failScheduledSlot as failScheduledSlotExport,
} from './schedulerOperations';
import { createConvexCanonStore } from '../canon/commit';
import { TIME_SLOTS, type TimeSlot } from '../canon/eventTypes';
import { emptyProjection, type ProposedEvent } from '../canon/model';
import { replayWorldEvents } from '../canon/replay';
import { rowToAcceptedEvent } from '../canon/serialize';
import { isActiveArcStatus } from '../story/lifecycle';
import { guardWorldDayStageHandlers } from './emergencyStop';
import { resolveModuleConfig } from './moduleConfig';
import { createConvexBudgetPort } from './tokenBudgetGate';
import { FAKE_SCENE_MODEL } from './fakeSceneNarrator';
import { assertWorldAdmitsSimulation, isWorldEmergencyStopped } from './emergencyStopOperations';
import { executeWorldDay, type WorldDayRun } from './worldDayOrchestration';
import { createConvexWorldDayRunStore } from './worldDayOrchestrationFunctions';
import {
  buildLiveWorldSnapshot,
  buildViewerVoteProposal,
  createWorldDayStageHandlers,
  worldDayRunId,
  type LiveArc,
  type LiveWorldSnapshot,
  type WorldDayLivePort,
  type WorldDaySlotIdentity,
} from './worldDayLive';

type MutationCtx = GenericMutationCtx<DataModel>;
type MutationDb = MutationCtx['db'];

const persistDirectorPlanRef = internalFunctionRef<typeof persistDirectorPlanExport>(
  'simulation/directorFunctions:persistDirectorPlan',
);
const persistCharacterIntentRef = internalFunctionRef<typeof persistCharacterIntentExport>(
  'simulation/characterIntentFunctions:persistCharacterIntent',
);
const groupPersistedCharacterIntentsRef = internalFunctionRef<typeof groupPersistedCharacterIntentsExport>(
  'simulation/sceneGroupingFunctions:groupPersistedCharacterIntents',
);
const persistValidatedSceneSimulationRef = internalFunctionRef<typeof persistValidatedSceneSimulationExport>(
  'simulation/sceneSimulationFunctions:persistValidatedSceneSimulation',
);
const startScheduledSlotRef = internalFunctionRef<typeof startScheduledSlotExport>(
  'simulation/schedulerOperations:startScheduledSlot',
);
const completeScheduledSlotRef = internalFunctionRef<typeof completeScheduledSlotExport>(
  'simulation/schedulerOperations:completeScheduledSlot',
);
const failScheduledSlotRef = internalFunctionRef<typeof failScheduledSlotExport>(
  'simulation/schedulerOperations:failScheduledSlot',
);

const text = (payload: unknown, key: string): string | null => {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const value = (payload as Record<string, unknown>)[key];
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
};

const stringList = (payload: unknown, key: string): string[] => {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return [];
  const value = (payload as Record<string, unknown>)[key];
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
};

async function loadActiveArcs(db: MutationDb, worldId: string): Promise<LiveArc[]> {
  const lifecycles = await db.query('storyArcLifecycles')
    .withIndex('by_world_and_arc', (q) => q.eq('worldId', worldId)).collect();
  const arcs: LiveArc[] = [];
  for (const lifecycle of lifecycles) {
    if (!isActiveArcStatus(lifecycle.status)) continue;
    const projections = await db.query('storyArcProjectionEvents')
      .withIndex('by_world_arc_and_revision', (q) => q.eq('worldId', worldId).eq('arcId', lifecycle.arcId)).collect();
    const latest = projections.sort((left, right) => left.revision - right.revision).at(-1);
    const currentQuestion = text(latest?.fields, 'currentQuestion');
    // An arc with no established projection has no question the Director can plan around.
    if (!latest || !currentQuestion) continue;
    arcs.push({
      arcId: lifecycle.arcId,
      currentQuestion,
      status: lifecycle.status as LiveArc['status'],
      sourceEventId: latest.sourceEventId,
    });
  }
  return arcs;
}

/** Stage 1: map this deployment's rows onto the shared snapshot builder. */
async function loadWorldSnapshot(db: MutationDb, slot: WorldDaySlotIdentity): Promise<LiveWorldSnapshot> {
  const { worldId } = slot;
  const [eventRows, characterRows, locationRows, knowledgeRows, assetRows, secretRows, activeArcs] = await Promise.all([
    db.query('canonEvents').withIndex('by_world_and_sequence', (q) => q.eq('worldId', worldId)).collect(),
    db.query('worldCharacters').withIndex('by_world_id', (q) => q.eq('worldId', worldId)).collect(),
    db.query('worldLocations').withIndex('by_world_id', (q) => q.eq('worldId', worldId)).collect(),
    db.query('worldCharacterKnowledge').withIndex('by_world_id', (q) => q.eq('worldId', worldId)).collect(),
    db.query('worldAssets').withIndex('by_world_id', (q) => q.eq('worldId', worldId)).collect(),
    db.query('worldSecrets').withIndex('by_world_id', (q) => q.eq('worldId', worldId)).collect(),
    loadActiveArcs(db, worldId),
  ]);
  const acceptedEvents = eventRows.map(rowToAcceptedEvent);
  return buildLiveWorldSnapshot({
    slot,
    acceptedEvents,
    projection: replayWorldEvents(emptyProjection(worldId), acceptedEvents),
    characters: characterRows.map((row) => ({
      characterId: row.characterId,
      personaSummary: text(row.payload, 'publicProfile') ?? text(row.payload, 'name') ?? row.characterId,
      currentGoal: text(row.payload, 'publicGoal') ?? 'Keep to their established routine.',
      initialLocationId: text(row.payload, 'initialLocationId'),
    })),
    locationConnections: Object.fromEntries(locationRows.map((row) =>
      [row.locationId, stringList(row.payload, 'connectedLocationIds')])),
    seedKnowledge: knowledgeRows.map((row) => ({
      characterId: row.characterId,
      knowledgeId: row.knowledgeId,
      belief: text(row.payload, 'content') ?? row.knowledgeId,
    })),
    seedAssets: assetRows.map((row) => ({ characterId: row.ownerCharacterId, assetId: row.assetId })),
    secretIds: secretRows.map(({ secretId }) => secretId),
    activeArcs,
  });
}

/**
 * Drain the viewer vote queue for one slot (FR-J001 AC#4).
 *
 * ## Why this reads rows instead of importing the viewer module
 *
 * `simulation` may not depend on `viewer` (`architecture/module-boundaries.json`), and the edge
 * should not be added: the ballot must never be something the world consults while it plans.
 * The queue's contract is therefore the TABLE, and each side owns one end of it — `viewer`
 * fills it and can go no further, `simulation` drains it and never looks at a ballot.
 *
 * ## Why the event is rebuilt rather than stored
 *
 * The queued row carries a catalog id, not an event. {@link buildViewerVoteProposal} constructs
 * the Proposed World Event from `convex/shared/environmentVoteCatalog.ts` at the moment it is
 * proposed, so the sentence that reaches Canon is reviewed repository source rather than a
 * payload that travelled through a public mutation.
 *
 * Only the day's FIRST slot drains the queue. Returning the same proposal in all five slots
 * would be harmless — the commit is idempotent on `idempotencyKey` — but it would report four
 * spurious "applied" events per day into the run artifact, and an artifact that overstates what
 * happened is worse than one that is quiet.
 */
async function loadQueuedEnvironmentEvents(
  db: MutationDb,
  slot: WorldDaySlotIdentity,
): Promise<ProposedEvent[]> {
  if (slot.timeSlot !== TIME_SLOTS[0]) return [];
  const queued = await db
    .query('environmentVoteInterventions')
    .withIndex('by_world_and_target_day', (q) =>
      q.eq('worldId', slot.worldId).eq('targetWorldDay', slot.worldDay).eq('status', 'queued'))
    .collect();
  return queued.flatMap((row) => {
    const proposal = buildViewerVoteProposal(row, slot);
    return proposal === null ? [] : [proposal];
  });
}

/** Record what Canon accepted, so the queue reflects the world rather than the intent. */
async function markQueuedEnvironmentEventApplied(
  db: MutationDb,
  idempotencyKey: string,
  appliedEventId: string,
): Promise<void> {
  const row = await db
    .query('environmentVoteInterventions')
    .withIndex('by_idempotency_key', (q) => q.eq('idempotencyKey', idempotencyKey))
    .unique();
  if (row && row.status === 'queued') {
    await db.patch(row._id, { status: 'applied', appliedEventId, appliedAt: Date.now() });
  }
}

/**
 * Convex-backed {@link WorldDayLivePort}. Canon goes through the shared commit store;
 * every Director/Intent/Grouping/Scene artifact is persisted through its own already
 * tested internal mutation, so their idempotency and authorization rules run live.
 */
function createConvexWorldDayLivePort(ctx: MutationCtx, now: number): WorldDayLivePort {
  return {
    canonStore: createConvexCanonStore(ctx.db),
    loadWorldSnapshot: (slot) => loadWorldSnapshot(ctx.db, slot),
    // FR-K005 / ART-52: the authorized, versioned per-module model configuration. Reading it
    // here keeps `worldDayLive.ts` free of any database handle, exactly like every other port
    // method.
    loadModuleConfig: (worldId, module) => resolveModuleConfig(ctx.db, worldId, module),
    // FR-M003 / ART-59: the durable accountant. Bound to `ctx.db` and to the surrounding
    // mutation's `now`, which reaches only the audit row's timestamp — never the decision, so
    // the same reservation always names the same bound limit (AC#2).
    //
    // `deploymentModelId` answers FAKE_SCENE_MODEL because that is the model this path actually
    // calls: `createWorldDayStageHandlers` is invoked below WITHOUT a provider argument, so it
    // defaults to the deterministic FakeWholeSceneProvider. ART-72 injecting a real adapter has
    // to change both together — the per-model daily cap is keyed on whatever this returns, and a
    // key that did not match the model the provider reports would leave the cap counting an empty
    // bucket while the real model spent freely.
    budget: createConvexBudgetPort(ctx.db, now, () => Promise.resolve(FAKE_SCENE_MODEL)),
    // PRD §12 stage 2. Scheduled environment events originate from the daily viewer vote
    // (FR-J001) — see {@link loadQueuedEnvironmentEvents} for why the queue is read as rows
    // rather than through an import.
    loadScheduledEnvironmentEvents: (slot) => loadQueuedEnvironmentEvents(ctx.db, slot),
    markScheduledEnvironmentEventApplied: (idempotencyKey, eventId) =>
      markQueuedEnvironmentEventApplied(ctx.db, idempotencyKey, eventId),
    persistDirectorPlan: async (context, plan) => {
      await ctx.runMutation(persistDirectorPlanRef,
        { context, plan, createdAt: now });
    },
    persistCharacterIntent: async (context, intent) => {
      await ctx.runMutation(persistCharacterIntentRef,
        { context, intent, createdAt: now });
    },
    persistGroupedScenes: async (input) => {
      await ctx.runMutation(groupPersistedCharacterIntentsRef, {
        worldId: input.worldId, groupingRunId: input.groupingRunId, directorRunId: input.directorRunId,
        worldDay: input.worldDay, timeSlot: input.timeSlot,
        intentRunIds: input.intents.map(({ intent }) => intent.intentRunId), createdAt: now,
      });
    },
    persistSceneSimulation: async (groupingRunId, result) => {
      await ctx.runMutation(persistValidatedSceneSimulationRef, {
        worldId: result.scene.worldId, simulationRunId: result.simulationRunId, groupingRunId,
        sceneId: result.scene.sceneId, output: result.output, attemptCount: result.attemptCount,
        trace: result.trace, createdAt: now,
      });
    },
  };
}

async function nextQueuedSlot(db: MutationDb, worldId: string): Promise<Doc<'scheduledSlots'> | null> {
  // The index orders by reservation time, which is the world-time order slots are created in.
  return db.query('scheduledSlots')
    .withIndex('by_world_and_status', (q) => q.eq('worldId', worldId).eq('status', 'queued')).first();
}

export type WorldDaySlotOutcome = {
  slotKey: string;
  worldDay: number;
  timeSlot: TimeSlot;
  status: WorldDayRun['status'];
  attemptCount: number;
  committedEventIds: string[];
  failureStage?: string;
  errorCode?: string;
  errorMessage?: string;
};

/** Execute one queued slot: reserve → run stages 1–10 → record the slot outcome. */
async function executeSlot(ctx: MutationCtx, row: Doc<'scheduledSlots'>, now: number): Promise<WorldDaySlotOutcome> {
  await ctx.runMutation(startScheduledSlotRef, { slotId: row._id, now });
  const slot: WorldDaySlotIdentity = { worldId: row.worldId, worldDay: row.worldDay, timeSlot: row.timeSlot };
  const run = await executeWorldDay(
    { runId: worldDayRunId(slot), ...slot },
    createConvexWorldDayRunStore(ctx.db, now),
    // FR-K006: the kill switch is re-checked at every stage boundary, so a stop that
    // engages mid-run halts before the next stage starts. Completed checkpoints keep
    // their artifacts and nothing reaches Canon, so a later resume restarts at exactly
    // the halted stage and cannot commit the same events twice.
    guardWorldDayStageHandlers(
      createWorldDayStageHandlers(createConvexWorldDayLivePort(ctx, now)),
      () => isWorldEmergencyStopped(ctx.db, row.worldId),
    ),
  );
  const committedEventIds = run.committedEventIds ?? [];
  if (run.status === 'completed') {
    await ctx.runMutation(completeScheduledSlotRef,
      { slotId: row._id, committedEventId: committedEventIds[0], now });
  } else {
    await ctx.runMutation(failScheduledSlotRef,
      { slotId: row._id, errorCode: run.errorCode ?? 'WORLD_DAY_RUN_FAILED', now });
  }
  return {
    slotKey: row.slotKey, worldDay: row.worldDay, timeSlot: row.timeSlot, status: run.status,
    attemptCount: run.attemptCount, committedEventIds, failureStage: run.failureStage,
    errorCode: run.errorCode, errorMessage: run.errorMessage,
  };
}

/**
 * Run queued world time slots for one world.
 *
 * `slotId` targets a specific reserved slot; otherwise the oldest queued slot is taken.
 * `maxSlots` (1…{@link TIME_SLOTS}.length) runs consecutive slots so a whole world day can
 * be executed in one call. Re-running a slot is safe: the world-day Run ID, every stage
 * Run ID and every Proposed Event idempotency key derive from (worldId, worldDay,
 * timeSlot), so a completed run short-circuits and a resumed run dedups at commit
 * instead of appending a second event (FR-C001 AC#1/#3/#4).
 */
export const runQueuedWorldDaySlot = internalMutation({
  args: {
    worldId: v.string(),
    slotId: v.optional(v.id('scheduledSlots')),
    maxSlots: v.optional(v.number()),
    now: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<{ worldId: string; executed: number; slots: WorldDaySlotOutcome[] }> => {
    const now = args.now ?? Date.now();
    const maxSlots = args.maxSlots ?? 1;
    if (!Number.isSafeInteger(maxSlots) || maxSlots < 1 || maxSlots > TIME_SLOTS.length) {
      throw new Error('INVALID_SLOT_BATCH_SIZE');
    }
    // FR-K006: refuse to CLAIM any slot while the world is under an emergency stop.
    // An ordinary FR-K001 pause only stops the clock from reserving new slots; the
    // kill switch additionally stops the executor from draining the existing queue.
    // Queued and running rows are left exactly as they are — the stop halts new work,
    // it does not discard work in progress.
    await assertWorldAdmitsSimulation(ctx.db, args.worldId);
    const slots: WorldDaySlotOutcome[] = [];
    let explicit: Id<'scheduledSlots'> | undefined = args.slotId;
    for (let index = 0; index < maxSlots; index += 1) {
      const row = explicit ? await ctx.db.get(explicit) : await nextQueuedSlot(ctx.db, args.worldId);
      explicit = undefined;
      if (!row) break;
      if (row.worldId !== args.worldId) throw new Error('SLOT_WORLD_MISMATCH');
      slots.push(await executeSlot(ctx, row, now));
      if (slots[slots.length - 1].status !== 'completed') break;
    }
    return { worldId: args.worldId, executed: slots.length, slots };
  },
});
