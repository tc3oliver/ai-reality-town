/**
 * FR-C001…FR-C005 LIVE ENTRY POINT — the transactional half.
 *
 * `runQueuedWorldDaySlot` takes one reserved `scheduledSlots` row and drives PRD §12 stages 1–10
 * through the resumable orchestrator:
 *
 *   startScheduledSlot → executeWorldDay(load world state … commit accepted events)
 *   → completeScheduledSlot(committed event) | failScheduledSlot(stable error code)
 *
 * ## Which author, and why that is an ARGUMENT
 *
 * `sceneAuthor` is required. There is no default, because a default is how the deterministic fake
 * became the production author: this file used to call `createWorldDayStageHandlers` with no
 * provider, so the choice was expressed by an absence and a reviewer saw no decision at all.
 *
 *  - `deterministic_fake` — the whole slot runs inside ONE Convex mutation. The fake author needs
 *    no network, so there is no action-then-mutation race and the Canon commit is trivially
 *    atomic. This is the dev, fixture and offline-gate path.
 *
 *      npx convex run simulation/schedulerOperations:advanceOneWorldDay '{"worldId":"mistwood","now":0}'
 *      npx convex run simulation/worldDayLiveFunctions:runQueuedWorldDaySlot '{"worldId":"mistwood","sceneAuthor":"deterministic_fake"}'
 *
 *  - `preauthored` — the LIVE path, and it cannot be one transaction: a Convex mutation may not
 *    perform network I/O. `prepareQueuedWorldDaySlot` runs stages 1–6 and stops; an action authors
 *    the scenes through the real provider; this function then resumes from those checkpoints and
 *    carries stages 7–10 out inside a transaction again. It authors NOTHING itself — a scene that
 *    is not already persisted raises {@link SCENE_AUTHORING_DEFERRED} rather than quietly falling
 *    back to the fake, which would put invented text into Canon whenever the gateway was down.
 *
 *      npx convex run simulation/providers/liveWorldDayActions:runLiveWorldDaySlotWithProvider '{"worldId":"mistwood"}'
 *
 * Canon validation, safety classification, idempotency and the commit itself are inside a
 * transaction on BOTH paths, and are the same code on both.
 *
 * The functions are internal on purpose — public reads must never trigger generation
 * (ADR-0001). Stages 11–21 (projection, cognition, episodes, publication) are the
 * separate post-commit pipeline in `convex/operations/postCommitOrchestration.ts`.
 */

import { internalMutation } from '../_generated/server';
import type { DataModel, Doc, Id } from '../_generated/dataModel';
import type { GenericMutationCtx } from 'convex/server';
import { v } from 'convex/values';
import { internalFunctionRef } from '../shared/internalFunctionRef';
import type { persistDirectorPlan as persistDirectorPlanExport } from './directorFunctions';
import type {
  recordProposalValidations as recordProposalValidationsExport,
  recordAuthoringAttempt as recordAuthoringAttemptExport,
} from './qualityEvidenceFunctions';
import type { persistCharacterIntent as persistCharacterIntentExport } from './characterIntentFunctions';
import type { groupPersistedCharacterIntents as groupPersistedCharacterIntentsExport } from './sceneGroupingFunctions';
import type {
  findReusableSceneSimulation as findReusableSceneSimulationExport,
  persistValidatedSceneSimulation as persistValidatedSceneSimulationExport,
} from './sceneSimulationFunctions';
import type {
  claimLiveSlot as claimLiveSlotExport,
  startScheduledSlot as startScheduledSlotExport,
  completeScheduledSlot as completeScheduledSlotExport,
  failScheduledSlot as failScheduledSlotExport,
} from './schedulerOperations';
import { commitProposedEvent, createConvexCanonStore } from '../canon/commit';
import { validateEventStructure } from '../canon/validators';
import { CanonError } from '../shared/errors';
import { TIME_SLOTS, type TimeSlot } from '../canon/eventTypes';
import type { ProposedEvent, WorldProjection } from '../canon/model';
import { replayWorldEvents } from '../canon/replay';
import { rowToAcceptedEvent } from '../canon/serialize';
import { cloneProjection, type CanonSnapshot } from '../canon/snapshots';
import { resolveWorldBaseline } from '../canon/snapshotManager';
import { isActiveArcStatus } from '../story/lifecycle';
import { guardWorldDayStageHandlers } from './emergencyStop';
import { resolveModuleConfig } from './moduleConfig';
import { createConvexBudgetPort, resolveTokenBudgetPolicy } from './tokenBudgetGate';
import { FakeWholeSceneProvider, FAKE_SCENE_MODEL } from './fakeSceneNarrator';
import { assertWorldAdmitsSimulation, isWorldEmergencyStopped } from './emergencyStopOperations';
import { loadDegradationState } from './degradationFunctions';
import {
  degradedPlan, effectivePolicy, policyFor, shouldProbeProvider,
  type DegradationLevel,
} from './degradation';
import { deriveRulesOnlyEvents } from './rulesOnlyAuthor';
import { liveClaimHolder, type SlotClaim } from './schedulerOperations';
import { executeWorldDay, WorldDayOrchestrationError, type WorldDayRun, type WorldDayStage } from './worldDayOrchestration';
import { createConvexWorldDayRunStore } from './worldDayOrchestrationFunctions';
import type { LanguageModelProvider } from './provider';
import {
  buildLiveWorldSnapshot,
  buildSceneAuthoringPlan,
  buildViewerVoteProposal,
  createWorldDayStageHandlers,
  directorRunId,
  worldDayRunId,
  SCENE_AUTHORING_DEFERRED,
  type GroupingArtifact,
  type LiveArc,
  type LiveWorldSnapshot,
  type SceneAuthoringPlan,
  type WorldDayLivePort,
  type WorldDaySlotIdentity,
  type WorldStateArtifact,
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
const recordProposalValidationsRef = internalFunctionRef<typeof recordProposalValidationsExport>(
  'simulation/qualityEvidenceFunctions:recordProposalValidations',
);
const recordAuthoringAttemptRef = internalFunctionRef<typeof recordAuthoringAttemptExport>(
  'simulation/qualityEvidenceFunctions:recordAuthoringAttempt',
);
const findReusableSceneSimulationRef = internalFunctionRef<typeof findReusableSceneSimulationExport>(
  'simulation/sceneSimulationFunctions:findReusableSceneSimulation',
);
const startScheduledSlotRef = internalFunctionRef<typeof startScheduledSlotExport>(
  'simulation/schedulerOperations:startScheduledSlot',
);
const claimLiveSlotRef = internalFunctionRef<typeof claimLiveSlotExport>(
  'simulation/schedulerOperations:claimLiveSlot',
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

/** The seeded `initial` snapshot for a world, or null when the world was never seeded. */
async function loadInitialSnapshotProjection(db: MutationDb, worldId: string): Promise<CanonSnapshot | null> {
  const row = await db.query('canonSnapshots')
    .withIndex('by_world_day_and_kind', (q) => q.eq('worldId', worldId).eq('worldDay', 0).eq('kind', 'initial'))
    .unique();
  if (!row) return null;
  return {
    snapshotVersion: row.snapshotVersion as 1,
    worldId: row.worldId,
    worldDay: row.worldDay as number,
    lastSequenceNumber: row.lastSequenceNumber,
    projection: row.projection as WorldProjection,
    projectionHash: row.projectionHash as string,
    createdAt: row.createdAt,
  };
}

/** Stage 1: map this deployment's rows onto the shared snapshot builder. */
async function loadWorldSnapshot(db: MutationDb, slot: WorldDaySlotIdentity): Promise<LiveWorldSnapshot> {
  const { worldId } = slot;
  const [eventRows, characterRows, locationRows, knowledgeRows, assetRows, secretRows, activeArcs, initialSnapshot] = await Promise.all([
    db.query('canonEvents').withIndex('by_world_and_sequence', (q) => q.eq('worldId', worldId)).collect(),
    db.query('worldCharacters').withIndex('by_world_id', (q) => q.eq('worldId', worldId)).collect(),
    db.query('worldLocations').withIndex('by_world_id', (q) => q.eq('worldId', worldId)).collect(),
    db.query('worldCharacterKnowledge').withIndex('by_world_id', (q) => q.eq('worldId', worldId)).collect(),
    db.query('worldAssets').withIndex('by_world_id', (q) => q.eq('worldId', worldId)).collect(),
    db.query('worldSecrets').withIndex('by_world_id', (q) => q.eq('worldId', worldId)).collect(),
    loadActiveArcs(db, worldId),
    loadInitialSnapshotProjection(db, worldId),
  ]);
  const acceptedEvents = eventRows.map(rowToAcceptedEvent);
  // Seeded baseline, not `emptyProjection` — see `commitProposedEvent`. Without it
  // `projection.locations` omits every seeded location, so `legalDestinationsFrom` would offer the
  // scene author no destination at all and the prompt would forbid all movement.
  const baseline = resolveWorldBaseline(worldId, initialSnapshot);
  return buildLiveWorldSnapshot({
    slot,
    acceptedEvents,
    projection: replayWorldEvents(
      cloneProjection(baseline.projection),
      acceptedEvents.filter((event) => event.sequenceNumber > baseline.lastSequenceNumber),
    ),
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
 * Who authors this pass's scenes, and therefore which model the meter keys on.
 *
 * The two facts have to be chosen TOGETHER — a reservation keyed on a model the author does not
 * call meters a bucket nothing spends from, while the real model spends unbounded and every other
 * signal keeps looking healthy. Before ART-159 they were two arguments to two different functions
 * held in agreement by a comment and a source-scanning pin. They are now one value, so the
 * compiler carries the agreement instead.
 *
 * - `deterministic_fake` — the zero-cost {@link FakeWholeSceneProvider}, metered against
 *   {@link FAKE_SCENE_MODEL}. The dev and fixture path; needs no network and no credential.
 * - `preauthored` — authors NOTHING. Every scene must already be persisted, and a scene that is
 *   not raises {@link SCENE_AUTHORING_DEFERRED}. This is the transactional half of the live path:
 *   the network call happened in an action, which a mutation cannot make. The meter keys on the
 *   deployment's configured route, so the plan handed to that action names the right bucket.
 */
export type SceneAuthorMode = 'deterministic_fake' | 'preauthored';

const sceneAuthorValidator = v.union(v.literal('deterministic_fake'), v.literal('preauthored'));

/**
 * Resolve the pair. Deliberately NOT defaulted anywhere: `runQueuedWorldDaySlot` requires the
 * argument, so a caller that has not thought about which author it wants cannot get one by
 * omission — which is how the deterministic fake became the production author in the first place.
 *
 * `deploymentModelId` is supplied by the caller for `preauthored` rather than read from the
 * environment here, for two reasons. The architectural one: constructing or configuring an adapter
 * outside `convex/simulation/providers` is a boundary violation, and this file is outside it. The
 * better one: the caller that passes it is the same action that BUILT the provider, so the model
 * the reservation is keyed on is the first route of the chain that will actually be called, rather
 * than a second reading of the environment that could resolve differently.
 */
export function sceneAuthorFor(mode: SceneAuthorMode, deploymentModelId?: string): {
  provider: LanguageModelProvider | null;
  deploymentModelId: () => Promise<string>;
} {
  if (mode === 'deterministic_fake') {
    return {
      provider: new FakeWholeSceneProvider(),
      deploymentModelId: () => Promise.resolve(FAKE_SCENE_MODEL),
    };
  }
  return {
    provider: null,
    deploymentModelId: () => deploymentModelId === undefined
      // Loud rather than plausible. This is only reached when a scene still needs authoring and
      // ART-52 left the module's model unset — so answering with a placeholder would key the
      // per-model daily cap on a bucket nothing spends from while the real route spends freely,
      // and every other signal would keep looking healthy.
      ? Promise.reject(new Error('LIVE_DEPLOYMENT_MODEL_NOT_SUPPLIED'))
      : Promise.resolve(deploymentModelId),
  };
}

/**
 * Convex-backed {@link WorldDayLivePort}. Canon goes through the shared commit store;
 * every Director/Intent/Grouping/Scene artifact is persisted through its own already
 * tested internal mutation, so their idempotency and authorization rules run live.
 */
function createConvexWorldDayLivePort(
  ctx: MutationCtx,
  now: number,
  author: ReturnType<typeof sceneAuthorFor>,
): WorldDayLivePort {
  return {
    canonStore: createConvexCanonStore(ctx.db),
    loadWorldSnapshot: (slot) => loadWorldSnapshot(ctx.db, slot),
    // FR-M004 (ART-165). `effectivePolicy`, so a probe slot authors for real; checkpointed at
    // stage 1 so the finishing pass reduces the plan the authoring pass actually authored.
    loadAuthoringPolicy: async (worldId) => effectivePolicy(await loadDegradationState(ctx.db, worldId)),
    // FR-K005 / ART-52: the authorized, versioned per-module model configuration. Reading it
    // here keeps `worldDayLive.ts` free of any database handle, exactly like every other port
    // method.
    loadModuleConfig: (worldId, module) => resolveModuleConfig(ctx.db, worldId, module),
    // FR-M003 最大並行數 (ART-161). Read from the SAME effective policy `evaluateReservation`
    // enforces against, so the pool that proposes work and the gate that grants it cannot
    // disagree about the limit. `null` — the default — means no configured limit, which
    // `buildSceneAuthoringPlan` reads as one at a time rather than as unbounded.
    loadConcurrencyLimit: async (worldId) =>
      (await resolveTokenBudgetPolicy(ctx.db, worldId)).maxConcurrentCalls,
    // FR-M003 / ART-59: the durable accountant. Bound to `ctx.db` and to the surrounding
    // mutation's `now`, which reaches only the audit row's timestamp — never the decision, so
    // the same reservation always names the same bound limit (AC#2).
    //
    // `deploymentModelId` comes from the SAME value that chose the provider, so the per-model
    // daily cap cannot be keyed on a model this path does not call.
    budget: createConvexBudgetPort(ctx.db, now, author.deploymentModelId),
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
    loadPersistedSceneSimulation: (worldId, groupingRunId, simulationRunId) =>
      ctx.runQuery(findReusableSceneSimulationRef, { worldId, groupingRunId, simulationRunId }),
    persistSceneSimulation: async (groupingRunId, result) => {
      await ctx.runMutation(persistValidatedSceneSimulationRef, {
        worldId: result.scene.worldId, simulationRunId: result.simulationRunId, groupingRunId,
        sceneId: result.scene.sceneId, output: result.output, attemptCount: result.attemptCount,
        trace: result.trace, createdAt: now,
      });
    },
    // FR-M002 / ART-90. Both are insert-if-absent on a derived key, so a retried slot re-records
    // rather than re-counts; see `convex/simulation/qualityEvidenceFunctions.ts`.
    recordProposalValidations: async (outcomes) => {
      if (outcomes.length === 0) return;
      await ctx.runMutation(recordProposalValidationsRef, { outcomes: [...outcomes], now });
    },
    recordAuthoringAttempt: async (attempt) => {
      await ctx.runMutation(recordAuthoringAttemptRef, { ...attempt, now });
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
async function executeSlot(
  ctx: MutationCtx,
  row: Doc<'scheduledSlots'>,
  now: number,
  author: ReturnType<typeof sceneAuthorFor>,
): Promise<WorldDaySlotOutcome> {
  // Claimed only if it is not already claimed. On the live path `prepareQueuedWorldDaySlot` took
  // this slot before the action authored its scenes, and `startScheduledSlot` admits only `queued`
  // rows — so re-claiming here would fail the finishing pass with `INVALID_SLOT_TRANSITION` and
  // strand a slot whose scenes have already been paid for. Re-claiming would also increment
  // `attemptCount` a second time for one attempt, which is the number an operator reads to decide
  // whether a slot is thrashing.
  if (row.status === 'queued') await ctx.runMutation(startScheduledSlotRef, { slotId: row._id, now });
  const slot: WorldDaySlotIdentity = { worldId: row.worldId, worldDay: row.worldDay, timeSlot: row.timeSlot };
  const run = await executeWorldDay(
    { runId: worldDayRunId(slot), ...slot },
    createConvexWorldDayRunStore(ctx.db, now),
    // FR-K006: the kill switch is re-checked at every stage boundary, so a stop that
    // engages mid-run halts before the next stage starts. Completed checkpoints keep
    // their artifacts and nothing reaches Canon, so a later resume restarts at exactly
    // the halted stage and cannot commit the same events twice.
    guardWorldDayStageHandlers(
      createWorldDayStageHandlers(createConvexWorldDayLivePort(ctx, now, author), author.provider),
      () => isWorldEmergencyStopped(ctx.db, row.worldId),
    ),
  );
  const committedEventIds = run.committedEventIds ?? [];
  if (run.status === 'completed') {
    await ctx.runMutation(completeScheduledSlotRef,
      { slotId: row._id, committedEventId: committedEventIds[0], now });
  } else if (run.errorCode !== SCENE_AUTHORING_DEFERRED) {
    await ctx.runMutation(failScheduledSlotRef,
      { slotId: row._id, errorCode: run.errorCode ?? 'WORLD_DAY_RUN_FAILED', now });
  }
  // A deferral leaves the slot `running` on purpose. It is not a fault — it is the live path
  // pausing at the one stage a transaction cannot perform — and failing the slot here would make
  // every healthy live run indistinguishable from a broken one in the row an operator reads, as
  // well as releasing a slot whose scenes another caller could then pay to author a second time.
  // The run record still holds the failed `simulate_scenes` checkpoint, which is what lets
  // `executeWorldDay` resume at exactly that stage.
  return {
    slotKey: row.slotKey, worldDay: row.worldDay, timeSlot: row.timeSlot, status: run.status,
    attemptCount: run.attemptCount, committedEventIds, failureStage: run.failureStage,
    errorCode: run.errorCode, errorMessage: run.errorMessage,
  };
}

/**
 * Run one slot at FR-M004 rung 4 or 5: deterministic background events, no provider (ART-91).
 *
 * The slot is claimed and settled exactly as an authored slot is, and its proposals go through the
 * same two validators and the same commit. What is different is only where the proposals came
 * from: `deriveRulesOnlyEvents` reads the world snapshot the Director would have planned against
 * and asserts the one thing the world already implies — that the slot passed at an occupied place.
 *
 * A rules-only slot that produces nothing (an empty world, every location vacant) still completes.
 * It is not a failure, and failing it would push the ladder DOWN for a world that is simply quiet.
 */
async function runRulesOnlySlot(
  ctx: MutationCtx,
  row: Doc<'scheduledSlots'>,
  now: number,
  /** The rung the slot ran at — `rules_only` or `deferred_summaries`, both of which author no scene. */
  degradationLevel: 'rules_only' | 'deferred_summaries',
): Promise<WorldDaySlotOutcome> {
  if (row.status === 'queued') await ctx.runMutation(startScheduledSlotRef, { slotId: row._id, now });
  const slot: WorldDaySlotIdentity = { worldId: row.worldId, worldDay: row.worldDay, timeSlot: row.timeSlot };
  const snapshot = await loadWorldSnapshot(ctx.db, slot);
  const proposals = deriveRulesOnlyEvents({
    worldId: slot.worldId,
    worldDay: slot.worldDay,
    timeSlot: slot.timeSlot,
    directorRunId: directorRunId(slot),
    placements: snapshot.characters.map(({ characterId, currentLocationId }) =>
      ({ characterId, locationId: currentLocationId })),
    degradationLevel,
  });

  const store = createConvexCanonStore(ctx.db);
  const committedEventIds: string[] = [];
  let errorCode: string | undefined;
  for (const proposed of proposals) {
    // Structural first, then Canon inside `commitProposedEvent` against the projection it reads —
    // the same two gates every authored proposal passes. A rules-only event that a validator
    // refuses is a defect in this derivation, not a reason to write it anyway.
    const structural = validateEventStructure(proposed);
    if (structural) {
      errorCode = structural.code;
      break;
    }
    try {
      const result = await commitProposedEvent(store, { proposed, traceId: worldDayRunId(slot) });
      committedEventIds.push(result.eventId);
    } catch (error) {
      errorCode = error instanceof CanonError ? error.error.code : 'RULES_ONLY_COMMIT_FAILED';
      break;
    }
  }

  if (errorCode === undefined) {
    await ctx.runMutation(completeScheduledSlotRef,
      { slotId: row._id, committedEventId: committedEventIds[0], now });
  } else {
    await ctx.runMutation(failScheduledSlotRef, { slotId: row._id, errorCode, now });
  }
  return {
    slotKey: row.slotKey, worldDay: row.worldDay, timeSlot: row.timeSlot,
    status: errorCode === undefined ? 'completed' : 'failed',
    attemptCount: row.attemptCount, committedEventIds,
    ...(errorCode === undefined ? {} : { errorCode }),
  };
}

/** What `prepareQueuedWorldDaySlot` found, for the action that has to decide what to do next. */
export type PreparedSlot =
  /** Nothing queued and nothing orphaned. The caller stops. */
  | { kind: 'idle' }
  /**
   * Another driver holds this world's live claim. The caller must do nothing at all — NOT move on
   * to the next queued slot, because world time is ordered and authoring slot N+1 against a world
   * that slot N has not finished advancing produces scenes about a state that never existed.
   */
  | { kind: 'busy'; slotKey: string; leaseExpiresAt: number }
  /**
   * Stages 1–6 are checkpointed and these scenes need a provider. The slot is CLAIMED (`running`)
   * and stays that way until the finishing pass settles it, so nothing else picks it up while the
   * network call is in flight.
   */
  | {
    kind: 'awaiting_authoring';
    slotId: Id<'scheduledSlots'>;
    plan: SceneAuthoringPlan;
    /** FR-M004 (ART-91): the rung this slot is being authored at, so the action can trace it. */
    degradationLevel: DegradationLevel;
    /**
     * FR-M004 (ART-165): whether this slot is the periodic probe that a no-provider rung takes to
     * find out the outage has ended. The rung is still `degradationLevel`; only this slot differs.
     */
    probe: boolean;
    /** FR-M004 (ART-167): which attempt at this slot the action is about to author. */
    attempt: number;
  }
  /**
   * The slot reached a terminal state without needing to author anything — every scene was
   * already persisted, the Director planned no scenes at all, or a stage before authoring failed.
   */
  | {
    kind: 'settled';
    slotId: Id<'scheduledSlots'>;
    outcome: WorldDaySlotOutcome;
    /** FR-M004 (ART-165): the rung this slot ran at, so a settled slot is as traceable as an authored one. */
    degradationLevel: DegradationLevel;
  };

/**
 * Rebuild the authoring plan from the run's own checkpoints.
 *
 * Deliberately NOT returned out of the stage handler that raised the deferral. `executeWorldDay`
 * absorbs a stage's throw into the run record, and threading a payload out through that would
 * mean inventing a second, non-error return channel through the orchestrator.
 *
 * Reading it back from the persisted checkpoints is better than a shortcut anyway: these are the
 * exact artifacts the finishing pass will resume from, so the plan the action authors against is
 * provably the same world state the pass that commits its results validates against. A plan
 * derived from a fresh read could differ from the checkpoint by anything that changed in between.
 */
async function authoringPlanFromCheckpoints(
  ctx: MutationCtx,
  now: number,
  author: ReturnType<typeof sceneAuthorFor>,
  slot: WorldDaySlotIdentity,
): Promise<SceneAuthoringPlan | null> {
  const store = createConvexWorldDayRunStore(ctx.db, now);
  const checkpoints = await store.listCheckpoints(worldDayRunId(slot));
  const latest = (stage: WorldDayStage): unknown => checkpoints
    .filter((checkpoint) => checkpoint.stage === stage && checkpoint.status === 'completed')
    .sort((left, right) => right.attempt - left.attempt)[0]?.artifact;
  const world = latest('load_world_state') as WorldStateArtifact | undefined;
  const grouping = latest('group_intents_into_scenes') as GroupingArtifact | undefined;
  if (!world || !grouping) return null;
  // The SAME reduction `simulate_scenes` applies, from the SAME checkpoint (ART-165). Reading the
  // world's current rung here instead would let the ladder move between the two passes and leave the
  // finishing pass demanding scenes this one was never asked to author.
  return degradedPlan(
    await buildSceneAuthoringPlan(
      createConvexWorldDayLivePort(ctx, now, author), slot, grouping, world.snapshot),
    world.authoringPolicy ?? policyFor('normal'),
  );
}

/**
 * The transactional first half of a LIVE world-day slot: everything up to the network call.
 *
 * Claims the oldest queued slot, drives PRD §12 stages 1–6 through the same resumable
 * orchestrator the deterministic path uses, and stops at stage 7 because a Convex mutation cannot
 * call a provider. The caller — `runLiveWorldDaySlotWithProvider` — authors the returned scenes in
 * an action and then invokes `runQueuedWorldDaySlot` with `sceneAuthor: 'preauthored'`, which
 * resumes from these checkpoints and carries stages 7–10 out inside a transaction again.
 *
 * ## What this deliberately does NOT do
 *
 * It does not fail the slot on a deferral. A deferral is a normal step in the live sequence, not a
 * fault, and marking the slot `failed` would make an ordinary live run indistinguishable from a
 * broken one in the row an operator reads. A genuine stage failure IS recorded, exactly as the
 * one-pass path records it.
 *
 * It also commits no scene events. Stage 2 can reach Canon — a viewer's scheduled environment
 * event is a proposal like any other — but that is the same commit the one-pass path performs at
 * the same point, through the same validation, with the same idempotency key.
 */
export const prepareQueuedWorldDaySlot = internalMutation({
  args: {
    worldId: v.string(),
    slotId: v.optional(v.id('scheduledSlots')),
    /** The first route of the chain the caller built, for the FR-M003 reservation key. */
    deploymentModelId: v.optional(v.string()),
    /** Override the claim lease. Tests use it to make an orphan observable without waiting. */
    leaseMs: v.optional(v.number()),
    now: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<PreparedSlot> => {
    const now = args.now ?? Date.now();
    // FR-K001/FR-K006 first: a paused or emergency-stopped world must not even be claimed, let
    // alone authored. Throwing here rather than returning a state keeps the kill switch's meaning
    // in one place — the driver catches per world and moves on.
    await assertWorldAdmitsSimulation(ctx.db, args.worldId);
    /**
     * FR-M004 rung 6 (ART-91). A world the ladder paused admits no new simulation, and the check
     * is HERE — before the claim — for the same reason the emergency stop is: a slot claimed and
     * then refused has burned a lease and left a `running` row behind.
     *
     * Deliberately a different gate from `world.pause` and from the kill switch. The schedule's
     * pause stops the clock reserving slots; the kill switch halts the executor; this one says the
     * world's automatic responses to a provider outage are exhausted. All three can be true at
     * once and each is released by its own action.
     */
    const degradation = await loadDegradationState(ctx.db, args.worldId);
    /**
     * `effectivePolicy`, not `policyFor` (ART-165): one slot in every
     * `SLOTS_BETWEEN_PROVIDER_PROBES` is a probe, which is how a world on a no-provider rung finds
     * out the outage has ended. Admission is decided by the RUNG — a probe must not resurrect a
     * paused world, and `effectivePolicy` never returns one that would.
     */
    const policy = effectivePolicy(degradation);
    if (!policyFor(degradation.level).admitsSimulation) {
      throw new WorldDayOrchestrationError('WORLD_DEGRADATION_PAUSED',
        `world is paused at degradation level ${degradation.level}`);
    }
    const author = sceneAuthorFor('preauthored', args.deploymentModelId);

    // ART-160. One durable claim per world, covering duplicate delivery and every way the
    // prepare → author → finalize sequence can be interrupted. See `claimLiveSlot`.
    const claim: SlotClaim = await ctx.runMutation(claimLiveSlotRef, {
      worldId: args.worldId, slotId: args.slotId, now,
      ...(args.leaseMs === undefined ? {} : { leaseMs: args.leaseMs }),
    });
    if (claim.kind === 'idle') return { kind: 'idle' };
    if (claim.kind === 'busy') {
      return { kind: 'busy', slotKey: claim.slotKey, leaseExpiresAt: claim.leaseExpiresAt };
    }
    const row = await ctx.db.get(claim.slotId);
    if (!row) throw new Error('CLAIMED_SLOT_DISAPPEARED');

    /**
     * FR-M004 rungs 4 and 5 (ART-91): the world proposes deterministic background events and calls
     * no model at all.
     *
     * Handled in the TRANSACTIONAL pass, before authoring is even considered, because a rules-only
     * slot has nothing to author — and routing it through the action would put an empty network
     * call between the same two mutations for no reason. The proposals still travel
     * `validate_structured_output` → `validate_canon` → `commit_accepted_events`: FR-M004 forbids
     * skipping any of them, and rung 4 is the rung most likely to be built as a bypass.
     */
    if (policy.rulesOnly) {
      // `policy.rulesOnly` is true for exactly these two rungs, and the narrowing says so.
      const settled = await runRulesOnlySlot(
        ctx, row, now,
        degradation.level === 'deferred_summaries' ? 'deferred_summaries' : 'rules_only',
      );
      return { kind: 'settled', slotId: row._id, outcome: settled, degradationLevel: degradation.level };
    }

    const outcome = await executeSlot(ctx, row, now, author);
    if (outcome.errorCode !== SCENE_AUTHORING_DEFERRED) {
      return { kind: 'settled', slotId: row._id, outcome, degradationLevel: degradation.level };
    }

    const slot: WorldDaySlotIdentity = { worldId: row.worldId, worldDay: row.worldDay, timeSlot: row.timeSlot };
    const plan = await authoringPlanFromCheckpoints(ctx, now, author, slot);
    if (!plan) {
      // The deferral said scenes need authoring, but the checkpoints that name them are not
      // there. That is a contradiction rather than a state to paper over, and continuing would
      // author nothing and then report the slot as done.
      throw new Error('WORLD_DAY_AUTHORING_PLAN_UNAVAILABLE');
    }
    /**
     * The ladder's reductions, applied to the plan the action will author from (AC#1).
     *
     * Applied here rather than inside `buildSceneAuthoringPlan` because the level is a property of
     * the WORLD and the plan is a property of the slot: the authoring half runs in an action with
     * no database handle, so a plan that carried no level would have to re-read one.
     */
    return {
      kind: 'awaiting_authoring', slotId: row._id,
      // Already reduced, by `authoringPlanFromCheckpoints`, from the policy stage 1 pinned.
      plan, degradationLevel: degradation.level, probe: shouldProbeProvider(degradation),
      // The row's own count, which `claimLiveSlot` has just incremented for this attempt.
      attempt: row.attemptCount,
    };
  },
});

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
    /** Required, not defaulted — see {@link SceneAuthorMode} for why that is the whole point. */
    sceneAuthor: sceneAuthorValidator,
    /** Only meaningful for `preauthored`; the deterministic author knows its own model. */
    deploymentModelId: v.optional(v.string()),
    now: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<{
    worldId: string; executed: number; slots: WorldDaySlotOutcome[]; skipped?: string;
  }> => {
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
    const author = sceneAuthorFor(args.sceneAuthor, args.deploymentModelId);
    const slots: WorldDaySlotOutcome[] = [];
    let explicit: Id<'scheduledSlots'> | undefined = args.slotId;

    /**
     * ART-160. Refuse to START a new slot while a live driver holds this world's claim.
     *
     * Without this an operator running the deterministic author by hand — or a stray invocation —
     * would take the NEXT queued slot while the live driver was still authoring the current one,
     * and author it against a world state the running slot has not finished advancing. The
     * finishing pass is exempt: it is handed the claimed slot explicitly, and refusing it would
     * strand a slot whose scenes have already been paid for.
     */
    const held = explicit === undefined ? await liveClaimHolder(ctx.db, args.worldId, now) : null;
    if (held) {
      return { worldId: args.worldId, executed: 0, slots: [], skipped: 'SLOT_LEASE_HELD' };
    }
    for (let index = 0; index < maxSlots; index += 1) {
      const row = explicit ? await ctx.db.get(explicit) : await nextQueuedSlot(ctx.db, args.worldId);
      explicit = undefined;
      if (!row) break;
      if (row.worldId !== args.worldId) throw new Error('SLOT_WORLD_MISMATCH');
      slots.push(await executeSlot(ctx, row, now, author));
      if (slots[slots.length - 1].status !== 'completed') break;
    }
    return { worldId: args.worldId, executed: slots.length, slots };
  },
});
