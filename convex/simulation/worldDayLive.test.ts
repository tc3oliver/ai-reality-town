import { readFileSync } from 'node:fs';
import { commitProposedEvent } from '../canon/commit';
import { TIME_SLOTS, type TimeSlot } from '../canon/eventTypes';
import { InMemoryCanonStore } from '../canon/inMemoryStore';
import { emptyProjection, type CanonRuleContext } from '../canon/model';
import { mistwoodCharacterSeed, mistwoodWorldConfiguration, MISTWOOD_PUBLIC_WORLD_ID } from '../canon/mistwoodSeed';
import { replayWorldEvents } from '../canon/replay';
import {
  assertCharacterIntentContextAuthorization,
  validateCharacterIntent,
  type CharacterIntentContext,
} from './characterIntent';
import { MAX_MAJOR_SCENES_PER_SLOT, parseAndValidateDirectorPlan, type DirectorPlan, type DirectorPlanContext } from './director';
import { narrateGroupedScene } from './fakeSceneNarrator';
import type { LanguageModelProvider, StructuredChatRequest } from './provider';
import { MAX_MAJOR_SCENE_PARTICIPANTS, type GroupedScene, type SceneGroupingInput, type SceneGroupingResult } from './sceneGrouping';
import { finalizeWholeSceneOutput, parseWholeSceneOutput, type SceneSimulationResult } from './sceneSimulation';
import {
  executeWorldDay,
  type RunFailure,
  type WorldDayCheckpoint,
  type WorldDayRun,
  type WorldDayRunInput,
  type WorldDayRunStore,
  type WorldDayStage,
  type WorldDayStageHandlers,
} from './worldDayOrchestration';
import {
  buildCharacterIntentContext,
  buildLiveWorldSnapshot,
  createWorldDayStageHandlers,
  directorRunId,
  generateCharacterIntent,
  isTravelScene,
  withArrivalStateChanges,
  withSceneProvenance,
  worldDayRunId,
  MAX_SLOTS_WITHOUT_APPEARANCE,
  MAX_TRAVEL_SCENES_PER_SLOT,
  type CommitArtifact,
  type DirectorPlanArtifact,
  type GroupingArtifact,
  type IntentsArtifact,
  type LiveWorldSnapshot,
  type SimulationArtifact,
  type StructuralArtifact,
  type WorldDayLivePort,
  type WorldDaySlotIdentity,
} from './worldDayLive';
import {
  resolveEffectiveModuleConfig,
  type ConfigurableModule,
} from '../shared/moduleModelConfig';

const WORLD_ID = MISTWOOD_PUBLIC_WORLD_ID;

/** Multi-run in-memory {@link WorldDayRunStore} (the whole day needs five runs). */
class MemoryRunStore implements WorldDayRunStore {
  readonly runs = new Map<string, WorldDayRun>();
  readonly checkpoints: WorldDayCheckpoint[] = [];

  loadRun(runId: string): Promise<WorldDayRun | null> {
    const run = this.runs.get(runId);
    return Promise.resolve(run ? structuredClone(run) : null);
  }
  createRun(input: WorldDayRunInput): Promise<WorldDayRun> {
    const run: WorldDayRun = { ...input, status: 'running', attemptCount: 1 };
    this.runs.set(input.runId, run);
    return Promise.resolve(structuredClone(run));
  }
  listCheckpoints(runId: string): Promise<WorldDayCheckpoint[]> {
    return Promise.resolve(structuredClone(this.checkpoints.filter((row) => row.runId === runId)));
  }
  startCheckpoint(runId: string, stage: WorldDayStage, attempt: number): Promise<void> {
    this.checkpoints.push({ runId, stage, attempt, status: 'running' });
    return Promise.resolve();
  }
  completeCheckpoint(runId: string, stage: WorldDayStage, attempt: number, artifact: unknown): Promise<void> {
    Object.assign(this.find(runId, stage, attempt), { status: 'completed', artifact: structuredClone(artifact) });
    return Promise.resolve();
  }
  failCheckpoint(runId: string, stage: WorldDayStage, attempt: number, error: RunFailure): Promise<void> {
    Object.assign(this.find(runId, stage, attempt), { status: 'failed', errorCode: error.code, errorMessage: error.message });
    return Promise.resolve();
  }
  resumeRun(runId: string, attempt: number): Promise<void> {
    Object.assign(this.required(runId), { status: 'running', attemptCount: attempt, failureStage: undefined, errorCode: undefined, errorMessage: undefined });
    return Promise.resolve();
  }
  failRun(runId: string, stage: WorldDayStage, error: RunFailure): Promise<void> {
    Object.assign(this.required(runId), { status: 'failed', failureStage: stage, errorCode: error.code, errorMessage: error.message });
    return Promise.resolve();
  }
  completeRun(runId: string, committedEventIds: string[]): Promise<void> {
    Object.assign(this.required(runId), { status: 'completed', committedEventIds });
    return Promise.resolve();
  }
  artifact<T>(runId: string, stage: WorldDayStage): T {
    const rows = this.checkpoints.filter((row) => row.runId === runId && row.stage === stage && row.status === 'completed');
    if (rows.length === 0) throw new Error(`missing artifact ${stage}`);
    return rows[rows.length - 1].artifact as T;
  }
  private required(runId: string): WorldDayRun {
    const run = this.runs.get(runId);
    if (!run) throw new Error('missing run');
    return run;
  }
  private find(runId: string, stage: WorldDayStage, attempt: number): WorldDayCheckpoint {
    const row = this.checkpoints.find((candidate) => candidate.runId === runId && candidate.stage === stage && candidate.attempt === attempt);
    if (!row) throw new Error('missing checkpoint');
    return row;
  }
}

const activeLocations = mistwoodWorldConfiguration.locations.filter(({ active }) => active);

function mistwoodRuleContext(): CanonRuleContext {
  return {
    worldId: WORLD_ID,
    rules: mistwoodWorldConfiguration.immutableRules,
    characterIds: mistwoodCharacterSeed.characters.map(({ id }) => id),
    locationIds: activeLocations.map(({ id }) => id),
    itemIds: mistwoodCharacterSeed.assets.map(({ id }) => id),
    organizationIds: mistwoodWorldConfiguration.organizations.map(({ id }) => id),
    initialCharacterAlive: Object.fromEntries(mistwoodCharacterSeed.characters.map(({ id }) => [id, true])),
    initialItemOwners: Object.fromEntries(mistwoodCharacterSeed.assets.map(({ id, ownerCharacterId }) => [id, ownerCharacterId])),
    locationConnections: Object.fromEntries(activeLocations.map(({ id, connectedLocationIds }) => [id, connectedLocationIds])),
  };
}

type PersistedArtifacts = {
  directorPlans: Array<{ context: DirectorPlanContext; plan: DirectorPlan }>;
  intents: Array<{ context: CharacterIntentContext; intentId: string }>;
  groupings: Array<{ input: SceneGroupingInput; result: SceneGroupingResult }>;
  simulations: SceneSimulationResult[];
};

/**
 * In-memory {@link WorldDayLivePort} over the Mistwood seed. `persistCharacterIntent`
 * re-runs the SAME authorization assertion the Convex mutation performs, so the test
 * proves the live persistence rules accept what the stage generates.
 */
function createSeedPort(store: InMemoryCanonStore): WorldDayLivePort & { persisted: PersistedArtifacts; lastSnapshot: () => LiveWorldSnapshot } {
  const persisted: PersistedArtifacts = { directorPlans: [], intents: [], groupings: [], simulations: [] };
  let snapshot: LiveWorldSnapshot | null = null;
  return {
    persisted,
    lastSnapshot: () => {
      if (!snapshot) throw new Error('no snapshot loaded');
      return snapshot;
    },
    canonStore: store,
    // FR-K005 / ART-52. Defaults unless a spec overrides this method: the port under test here
    // is an unconfigured world, and `moduleConfigSelection.test.ts` owns the configured case.
    loadModuleConfig: (_worldId: string, module: ConfigurableModule) =>
      Promise.resolve(resolveEffectiveModuleConfig(module, null)),
    async loadWorldSnapshot(slot) {
      const acceptedEvents = await store.loadAcceptedEvents(slot.worldId);
      snapshot = buildLiveWorldSnapshot({
        slot,
        acceptedEvents,
        projection: replayWorldEvents(emptyProjection(slot.worldId), acceptedEvents),
        characters: mistwoodCharacterSeed.characters.map(({ id, publicProfile, publicGoal, initialLocationId }) =>
          ({ characterId: id, personaSummary: publicProfile, currentGoal: publicGoal, initialLocationId })),
        locationConnections: Object.fromEntries(activeLocations.map(({ id, connectedLocationIds }) => [id, connectedLocationIds])),
        seedKnowledge: mistwoodCharacterSeed.knowledge.map(({ id, characterId, content }) =>
          ({ characterId, knowledgeId: id, belief: content })),
        seedAssets: mistwoodCharacterSeed.assets.map(({ id, ownerCharacterId }) => ({ characterId: ownerCharacterId, assetId: id })),
        secretIds: mistwoodCharacterSeed.secrets.map(({ id }) => id),
        activeArcs: [],
      });
      return snapshot;
    },
    loadScheduledEnvironmentEvents: () => Promise.resolve([]),
    markScheduledEnvironmentEventApplied: () => Promise.resolve(),
    persistDirectorPlan: (context, plan) => {
      persisted.directorPlans.push({ context, plan });
      return Promise.resolve();
    },
    persistCharacterIntent: (context, intent) => {
      const character = snapshot?.characters.find(({ characterId }) => characterId === context.characterId);
      if (!character) throw new Error('intent context has no matching character');
      assertCharacterIntentContextAuthorization(context, {
        knowledgeIds: new Set(character.knowledge.map(({ knowledgeId }) => knowledgeId)),
        memoryIds: new Set(character.memories.map(({ memoryId }) => memoryId)),
        assetIds: new Set(character.assets.map(({ assetId }) => assetId)),
        currentLocationId: character.currentLocationId,
      });
      persisted.intents.push({ context, intentId: intent.intentId });
      return Promise.resolve();
    },
    persistGroupedScenes: (input, result) => {
      persisted.groupings.push({ input, result });
      return Promise.resolve();
    },
    persistSceneSimulation: (_groupingRunId, result) => {
      persisted.simulations.push(result);
      return Promise.resolve();
    },
  };
}

const slotOf = (timeSlot: TimeSlot, worldDay = 0): WorldDaySlotIdentity => ({ worldId: WORLD_ID, worldDay, timeSlot });
const runInput = (slot: WorldDaySlotIdentity): WorldDayRunInput => ({ runId: worldDayRunId(slot), ...slot });

function seededStore(): InMemoryCanonStore {
  const store = new InMemoryCanonStore();
  store.setCanonRuleContext(mistwoodRuleContext());
  return store;
}

async function runWholeDay(store: InMemoryCanonStore, runStore: MemoryRunStore, port: WorldDayLivePort): Promise<WorldDayRun[]> {
  const handlers = createWorldDayStageHandlers(port);
  const runs: WorldDayRun[] = [];
  for (const timeSlot of TIME_SLOTS) {
    runs.push(await executeWorldDay(runInput(slotOf(timeSlot)), runStore, handlers));
  }
  return runs;
}

async function runWorldDays(runStore: MemoryRunStore, port: WorldDayLivePort, worldDays: number): Promise<WorldDayRun[]> {
  const handlers = createWorldDayStageHandlers(port);
  const runs: WorldDayRun[] = [];
  for (let worldDay = 0; worldDay < worldDays; worldDay += 1) {
    for (const timeSlot of TIME_SLOTS) {
      runs.push(await executeWorldDay(runInput(slotOf(timeSlot, worldDay)), runStore, handlers));
    }
  }
  return runs;
}

describe('FR-C001…FR-C005 live world-day execution', () => {
  it('runs every time slot of one world day end to end and appends Canon events', async () => {
    const store = seededStore();
    const runStore = new MemoryRunStore();
    const port = createSeedPort(store);
    const runs = await runWholeDay(store, runStore, port);

    expect(runs.map(({ status }) => status)).toEqual(TIME_SLOTS.map(() => 'completed'));
    expect(runs.every((run) => (run.committedEventIds ?? []).length > 0)).toBe(true);
    const events = store.committedEvents();
    expect(events.length).toBe(runs.reduce((total, run) => total + (run.committedEventIds ?? []).length, 0));
    expect(new Set(events.map(({ idempotencyKey }) => idempotencyKey)).size).toBe(events.length);
    expect(events.map(({ sequenceNumber }) => sequenceNumber)).toEqual(events.map((_, index) => index));
    // Every event is a director-planned multi-character scene, not a scaffold movement.
    expect(events.every(({ eventType }) => eventType === 'conversation')).toBe(true);
    expect(events.every(({ participantIds }) => participantIds.length >= 2)).toBe(true);
    expect(events.every(({ proposedBy }) => proposedBy.type === 'director')).toBe(true);
    expect(events.every(({ stateChanges }) =>
      stateChanges.some(({ type }) => type === 'relationship_changed')
      && stateChanges.some(({ type }) => type === 'character_memory_formed'))).toBe(true);
    // Every slot of the day is represented.
    expect(new Set(events.map(({ timeSlot }) => timeSlot))).toEqual(new Set(TIME_SLOTS));
  });

  it('is idempotent: a completed slot replays without appending a second event', async () => {
    const store = seededStore();
    const runStore = new MemoryRunStore();
    const port = createSeedPort(store);
    const handlers = createWorldDayStageHandlers(port);
    const first = await executeWorldDay(runInput(slotOf('morning')), runStore, handlers);
    const committed = store.committedEvents().length;

    const replay = await executeWorldDay(runInput(slotOf('morning')), runStore, handlers);
    expect(replay).toMatchObject({ status: 'completed', attemptCount: 1, committedEventIds: first.committedEventIds });
    expect(store.committedEvents()).toHaveLength(committed);
  });

  it('resumes a partially committed slot without duplicating accepted events', async () => {
    const clean = seededStore();
    await executeWorldDay(runInput(slotOf('noon')), new MemoryRunStore(), createWorldDayStageHandlers(createSeedPort(clean)));
    const expected = clean.committedEvents().length;

    const store = seededStore();
    const runStore = new MemoryRunStore();
    const port = createSeedPort(store);
    const handlers = createWorldDayStageHandlers(port);
    const partial: WorldDayStageHandlers = {
      ...handlers,
      // Commit the first proposal, then fail — exactly the crash the retry must survive.
      commit_accepted_events: async (context) => {
        const { proposedEvents } = context.artifacts.validate_structured_output as StructuralArtifact;
        await commitProposedEvent(store, { proposed: proposedEvents[0], traceId: 'partial' });
        throw new Error('interrupted after the first commit');
      },
    };
    const failed = await executeWorldDay(runInput(slotOf('noon')), runStore, partial);
    expect(failed).toMatchObject({ status: 'failed', failureStage: 'commit_accepted_events' });
    expect(store.committedEvents()).toHaveLength(1);

    const resumed = await executeWorldDay(runInput(slotOf('noon')), runStore, handlers);
    expect(resumed).toMatchObject({ status: 'completed', attemptCount: 2 });
    const events = store.committedEvents();
    expect(events).toHaveLength(expected);
    expect(new Set(events.map(({ idempotencyKey }) => idempotencyKey)).size).toBe(expected);
  });

  it('keeps the Director Plan inside its FR-C002 constraints when driven live', async () => {
    const store = seededStore();
    const port = createSeedPort(store);
    await executeWorldDay(runInput(slotOf('afternoon')), new MemoryRunStore(), createWorldDayStageHandlers(port));

    const { context, plan } = port.persisted.directorPlans[0];
    expect(plan.scenes.length).toBeGreaterThan(0);
    expect(plan.scenes.length).toBeLessThanOrEqual(MAX_MAJOR_SCENES_PER_SLOT);
    expect(plan.scenes.every((scene) => scene.directorRunId === directorRunId(slotOf('afternoon')))).toBe(true);
    expect(new Set(plan.scenes.map(({ locationId }) => locationId)).size).toBe(plan.scenes.length);
    const cast = plan.scenes.flatMap(({ participantIds }) => participantIds);
    expect(new Set(cast).size).toBe(cast.length);
    const located = new Map(context.characters.map((character) => [character.characterId, character.currentLocationId]));
    expect(plan.scenes.every(({ locationId, participantIds }) =>
      participantIds.every((characterId) => located.get(characterId) === locationId))).toBe(true);
    // FR-C002 AC#1: the plan schema structurally cannot carry a prescribed outcome.
    expect(plan.scenes.every((scene) => !('outcome' in scene) && !('dialogue' in scene))).toBe(true);
  });

  it('produces a traceable, structured intent for every character and defers the unplanned ones', async () => {
    const store = seededStore();
    const runStore = new MemoryRunStore();
    const port = createSeedPort(store);
    await executeWorldDay(runInput(slotOf('evening')), runStore, createWorldDayStageHandlers(port));

    const runId = worldDayRunId(slotOf('evening'));
    const { intents } = runStore.artifact<IntentsArtifact>(runId, 'generate_character_intents');
    const { plan } = runStore.artifact<DirectorPlanArtifact>(runId, 'generate_daily_director_plan');
    const planned = new Set(plan.scenes.flatMap(({ participantIds }) => participantIds));

    expect(intents).toHaveLength(port.lastSnapshot().characters.length);
    expect(port.persisted.intents).toHaveLength(intents.length);
    for (const { disposition, intent } of intents) {
      expect(disposition).toBe('accepted');
      expect(intent.action).toBe(planned.has(intent.characterId) ? 'attempt' : 'wait');
      if (intent.action === 'wait') expect(intent.downgradeReason).toBe('INTENT_NOT_SCHEDULED_THIS_SLOT');
      // FR-C003 AC#1/#3: every referenced input is carried by the intent's own context.
      const context = port.persisted.intents.find(({ context: candidate }) => candidate.characterId === intent.characterId)?.context;
      expect(context).toBeDefined();
      expect(intent.knowledgeIds.every((id) => context?.knowledge.some(({ knowledgeId }) => knowledgeId === id))).toBe(true);
      expect(intent.memoryIds.every((id) => context?.memories.some(({ memoryId }) => memoryId === id))).toBe(true);
      expect(intent.assetIds.every((id) => context?.assets.some(({ assetId }) => assetId === id))).toBe(true);
    }
  });

  it('degrades an intent that reaches for an unavailable location (FR-C003 AC#4)', async () => {
    const store = seededStore();
    const port = createSeedPort(store);
    const slot = slotOf('morning');
    const snapshot = await port.loadWorldSnapshot(slot);
    const character = snapshot.characters[0];
    const context = buildCharacterIntentContext(slot, character, []);
    const unreachable = generateCharacterIntent(context, { locationId: 'mistwood-nowhere', targetCharacterId: null });

    expect(validateCharacterIntent(unreachable, context)).toMatchObject({
      disposition: 'downgraded',
      intent: { action: 'wait', desiredLocationId: character.currentLocationId, downgradeReason: 'INTENT_LOCATION_UNAVAILABLE' },
    });
  });

  it('merges intents into bounded scenes that keep their source Intent references (FR-C004)', async () => {
    const store = seededStore();
    const runStore = new MemoryRunStore();
    const port = createSeedPort(store);
    await executeWorldDay(runInput(slotOf('night')), runStore, createWorldDayStageHandlers(port));

    const { result } = runStore.artifact<GroupingArtifact>(worldDayRunId(slotOf('night')), 'group_intents_into_scenes');
    expect(result.scenes.length).toBeGreaterThan(0);
    const participants = result.scenes.flatMap(({ participantIds }) => participantIds);
    expect(new Set(participants).size).toBe(participants.length);
    expect(result.scenes.every(({ participantIds }) => participantIds.length <= MAX_MAJOR_SCENE_PARTICIPANTS)).toBe(true);
    expect(result.scenes.every(({ sourceIntentIds }) => sourceIntentIds.length > 0)).toBe(true);
    const grouped = result.decisions.filter(({ disposition }) => disposition === 'grouped');
    expect(grouped.every(({ sceneId }) => result.scenes.some((scene) => scene.sceneId === sceneId))).toBe(true);
    expect(result.decisions.filter(({ disposition }) => disposition === 'deferred').length).toBeGreaterThan(0);
  });

  it('withholds high-risk scene output from Canon and routes it to safety review (FR-C005 AC#5)', async () => {
    const store = seededStore();
    const port = createSeedPort(store);
    const handlers = createWorldDayStageHandlers(port);
    const scene: GroupedScene = {
      schemaVersion: 1, sceneId: 'grouping:mistwood:0:morning:scene:1', groupingRunId: 'grouping:mistwood:0:morning',
      directorRunId: directorRunId(slotOf('morning')), worldId: WORLD_ID, worldDay: 0, timeSlot: 'morning',
      locationId: 'mistwood-hall', participantIds: ['gao-wenrui', 'pei-lan'], sourceIntentIds: ['a', 'b'],
      arcIds: [], trigger: 'graphic torture of a witness', dramaticPressure: 'The record must hold',
    };
    const artifact = await handlers.simulate_scenes({
      runId: worldDayRunId(slotOf('morning')), worldId: WORLD_ID, worldDay: 0, timeSlot: 'morning',
      artifacts: {
        // Stage 8 reads the stage-1 snapshot to state the movement precondition of any
        // participant who is not yet standing where the Scene happens.
        load_world_state: { snapshot: await port.loadWorldSnapshot(slotOf('morning')) },
        group_intents_into_scenes: { groupingRunId: scene.groupingRunId, result: { scenes: [scene], decisions: [] } },
      },
    }) as SimulationArtifact;

    expect(artifact.withheldSceneIds).toEqual([scene.sceneId]);
    expect(artifact.results).toHaveLength(0);
    // It is still persisted for review, and nothing reached Canon.
    expect(port.persisted.simulations[0]).toMatchObject({ reviewStatus: 'required', safety: { label: 'withhold' } });
    expect(store.committedEvents()).toHaveLength(0);
  });

  it('commits only structurally and canon-valid scene output through the shared commit pipeline', async () => {
    const store = seededStore();
    const runStore = new MemoryRunStore();
    const port = createSeedPort(store);
    const run = await executeWorldDay(runInput(slotOf('morning')), runStore, createWorldDayStageHandlers(port));
    const runId = worldDayRunId(slotOf('morning'));

    const structural = runStore.artifact<StructuralArtifact>(runId, 'validate_structured_output');
    const commit = runStore.artifact<CommitArtifact>(runId, 'commit_accepted_events');
    expect(commit.committedEventIds).toEqual(run.committedEventIds);
    expect(commit.deduplicatedEventIds).toEqual([]);
    expect(structural.proposedEvents).toHaveLength(commit.committedEventIds.length);
    const events = store.committedEvents();
    expect(events.map(({ idempotencyKey }) => idempotencyKey))
      .toEqual(structural.proposedEvents.map(({ idempotencyKey }) => idempotencyKey));
    expect(events.every(({ validationVersion, traceId }) => validationVersion === 'canon-v1' && traceId === runId)).toBe(true);
  });

  it('accepts any LanguageModelProvider so a real adapter swaps in without rewiring (AC#5)', async () => {
    const store = seededStore();
    const calls: StructuredChatRequest[] = [];
    const recording: LanguageModelProvider = {
      structuredChat: (request) => {
        calls.push(request);
        return Promise.resolve({
          output: narrateGroupedScene(JSON.parse(request.messages[1].content) as GroupedScene),
          trace: { provider: 'openai-compatible', model: 'swapped-in', inputTokens: 1, outputTokens: 2, latencyMs: 3, retryCount: 0 },
        });
      },
      embed: () => Promise.reject(new Error('not used')),
    };
    const run = await executeWorldDay(
      runInput(slotOf('morning')),
      new MemoryRunStore(),
      createWorldDayStageHandlers(createSeedPort(store), recording),
    );

    expect(run.status).toBe('completed');
    expect(calls.length).toBe(store.committedEvents().length);
    expect(calls.every(({ schemaName }) => schemaName === 'whole_scene_output')).toBe(true);
  });

  it('narrates a scene deterministically and keeps the live entry point internal', () => {
    const scene: GroupedScene = {
      schemaVersion: 1, sceneId: 'grouping:mistwood:1:noon:scene:1', groupingRunId: 'grouping:mistwood:1:noon',
      directorRunId: 'director:mistwood:1:noon', worldId: WORLD_ID, worldDay: 1, timeSlot: 'noon',
      locationId: 'mistwood-mill', participantIds: ['he-jun', 'zhao-ming'], sourceIntentIds: ['i1', 'i2'],
      arcIds: [], trigger: 'The refinancing deadline lands', dramaticPressure: 'The audit is not finished',
    };
    expect(narrateGroupedScene(scene)).toEqual(narrateGroupedScene(scene));
    const parsed = parseWholeSceneOutput(narrateGroupedScene(scene), scene);
    expect(parsed.proposedEvents).toHaveLength(1);
    expect(parsed.proposedEvents[0].idempotencyKey).toBe(`${scene.sceneId}:event:1`);

    const source = readFileSync('convex/simulation/worldDayLiveFunctions.ts', 'utf8');
    expect(source).toContain('internalMutation({');
    expect(source).not.toMatch(/\bmutation\(\{|\bquery\(\{/);
  });
});

/**
 * ART-101. The Mistwood seed places five residents alone (lin-yingxue at the paper,
 * su-meizhen at the clinic, luo-shan at the inn, tang-ruoxi at the orchard, wu-zhen at the
 * station) and three locations holding two or more — exactly {@link MAX_MAJOR_SCENES_PER_SLOT}
 * of them. The ART-60 harness proved that under the old "prefer multi-character locations"
 * rule those five were never cast in 30 world days and never moved. These cases assert the
 * live Director now reaches them, and that the way it reaches them stays inside FR-C002.
 */
describe('FR-C002 neglected-character reachability (ART-101)', () => {
  const ISOLATED_CHARACTER_IDS = ['lin-yingxue', 'su-meizhen', 'luo-shan', 'tang-ruoxi', 'wu-zhen'];
  const WORLD_DAYS = 4;

  let store: InMemoryCanonStore;
  let runStore: MemoryRunStore;
  let port: ReturnType<typeof createSeedPort>;

  beforeAll(async () => {
    store = seededStore();
    runStore = new MemoryRunStore();
    port = createSeedPort(store);
    const runs = await runWorldDays(runStore, port, WORLD_DAYS);
    expect(runs.every(({ status }) => status === 'completed')).toBe(true);
  });

  it('casts every seeded character, including the ones the seed places alone', () => {
    const cast = new Set(store.committedEvents().flatMap(({ participantIds }) => participantIds));
    expect(mistwoodCharacterSeed.characters.filter(({ id }) => !cast.has(id))).toEqual([]);
    // The regression this task exists for: none of the five is missing.
    expect(ISOLATED_CHARACTER_IDS.filter((characterId) => !cast.has(characterId))).toEqual([]);
  });

  it('keeps every character inside the one-world-day neglect ceiling the Director plans against', () => {
    const plans = port.persisted.directorPlans;
    expect(plans).toHaveLength(WORLD_DAYS * TIME_SLOTS.length);
    const neglected = plans.flatMap(({ context }) =>
      context.characters.filter(({ slotsSinceMajorAppearance }) => slotsSinceMajorAppearance > MAX_SLOTS_WITHOUT_APPEARANCE));
    // A character may cross the ceiling only in the slot that then reserves a scene for
    // them, so nobody is left above it once the run has warmed up.
    const late = plans.slice(TIME_SLOTS.length * 2).flatMap(({ context }) =>
      context.characters.filter(({ slotsSinceMajorAppearance }) => slotsSinceMajorAppearance > MAX_SLOTS_WITHOUT_APPEARANCE * 2));
    expect(late).toEqual([]);
    expect(neglected.every(({ slotsSinceMajorAppearance }) => slotsSinceMajorAppearance <= WORLD_DAYS * TIME_SLOTS.length)).toBe(true);
  });

  it('moves an isolated character to an occupied location through Canon, not by fiat', () => {
    const moves = store.committedEvents().flatMap(({ eventId, stateChanges }) =>
      stateChanges.filter((change) => change.type === 'character_location_changed').map((change) => ({ eventId, change })));
    expect(moves.length).toBeGreaterThan(0);

    const projection = replayWorldEvents(emptyProjection(WORLD_ID), store.committedEvents());
    for (const { change } of moves) {
      if (change.type !== 'character_location_changed') throw new Error('unreachable');
      // The move went somewhere the world says is connected, and the character is a
      // participant of the event that moved them.
      const connections = mistwoodWorldConfiguration.locations.find(({ id }) => id === change.fromLocationId)?.connectedLocationIds ?? [];
      expect(connections).toContain(change.toLocationId);
    }
    const moved = [...new Set(moves.map(({ change }) => (change.type === 'character_location_changed' ? change.characterId : '')))];
    expect(moved.some((characterId) => ISOLATED_CHARACTER_IDS.includes(characterId))).toBe(true);
    // The projection actually carries the relocation; it is not narration only.
    for (const characterId of moved) {
      const seatedAt = projection.characterLocations[characterId];
      const last = moves.filter(({ change }) => change.type === 'character_location_changed' && change.characterId === characterId).at(-1);
      expect(last && last.change.type === 'character_location_changed' ? last.change.toLocationId : null).toBe(seatedAt);
    }
    // A relocated character becomes castable with others: at least one committed scene now
    // seats a formerly isolated character alongside somebody else.
    expect(store.committedEvents().some(({ participantIds }) =>
      participantIds.length > 1 && participantIds.some((characterId) => ISOLATED_CHARACTER_IDS.includes(characterId)))).toBe(true);
  });

  it('never breaks the FR-C002 plan contract while doing it', () => {
    for (const { context, plan } of port.persisted.directorPlans) {
      // parseAndValidateDirectorPlan already ran inside the stage; re-running it here proves
      // the neglect-first selection produces plans the pure validator still accepts.
      expect(parseAndValidateDirectorPlan(plan, context)).toEqual(plan);
      const located = new Map(context.characters.map(({ characterId, currentLocationId }) => [characterId, currentLocationId]));
      // Every planned participant is already standing at the planned location: a travel
      // scene is planned at the character's ORIGIN, never at their destination.
      expect(plan.scenes.every(({ locationId, participantIds }) =>
        participantIds.every((characterId) => located.get(characterId) === locationId))).toBe(true);
      expect(plan.scenes.length).toBeLessThanOrEqual(MAX_MAJOR_SCENES_PER_SLOT);
      const cast = plan.scenes.flatMap(({ participantIds }) => participantIds);
      expect(new Set(cast).size).toBe(cast.length);
      // At most one scene per slot may relocate its character, so a merged Scene cannot
      // overflow the FR-C004 participant limit.
      expect(plan.scenes.filter(isTravelScene).length).toBeLessThanOrEqual(MAX_TRAVEL_SCENES_PER_SLOT);
    }
    const scenes = port.persisted.groupings.flatMap(({ result }) => result.scenes);
    expect(scenes.every(({ participantIds }) => participantIds.length <= MAX_MAJOR_SCENE_PARTICIPANTS)).toBe(true);
  });

  it('leaves a scene alone when every participant is already standing in it', () => {
    const scene: GroupedScene = {
      schemaVersion: 1, sceneId: 'grouping:mistwood:0:morning:scene:1', groupingRunId: 'grouping:mistwood:0:morning',
      directorRunId: directorRunId(slotOf('morning')), worldId: WORLD_ID, worldDay: 0, timeSlot: 'morning',
      locationId: 'mistwood-mill', participantIds: ['he-jun', 'zhao-ming'], sourceIntentIds: ['i1', 'i2'],
      arcIds: [], trigger: 'The refinancing deadline lands', dramaticPressure: 'The audit is not finished',
    };
    const result = finalizeWholeSceneOutput('sim', scene, parseWholeSceneOutput(narrateGroupedScene(scene), scene), 1,
      { provider: 'fake', model: 'fake-whole-scene-v1', inputTokens: 1, outputTokens: 1, latencyMs: 0, retryCount: 0 });
    expect(withArrivalStateChanges(result, port.lastSnapshot())).toBe(result);
  });

  /**
   * FR-P004 / ART-132. Without this stamp, an accepted event carries no link back to the Scene
   * whose post-generation safety classification governs its public text, and the public
   * projection has nothing to ask about. `simulate_scenes` is the last stage where the Scene
   * and its proposals are co-located — `validate_structured_output` flattens the proposals and
   * discards the Scene — so a regression here is silent everywhere else.
   */
  it('stamps the Scene id onto every proposal before the Scene link is discarded', () => {
    const scene: GroupedScene = {
      schemaVersion: 1, sceneId: 'grouping:mistwood:0:morning:scene:1', groupingRunId: 'grouping:mistwood:0:morning',
      directorRunId: directorRunId(slotOf('morning')), worldId: WORLD_ID, worldDay: 0, timeSlot: 'morning',
      locationId: 'mistwood-mill', participantIds: ['he-jun', 'zhao-ming'], sourceIntentIds: ['i1', 'i2'],
      arcIds: [], trigger: 'The refinancing deadline lands', dramaticPressure: 'The audit is not finished',
    };
    const result = finalizeWholeSceneOutput('sim', scene, parseWholeSceneOutput(narrateGroupedScene(scene), scene), 1,
      { provider: 'fake', model: 'fake-whole-scene-v1', inputTokens: 1, outputTokens: 1, latencyMs: 0, retryCount: 0 });

    const stamped = withSceneProvenance(result);
    expect(stamped.output.proposedEvents.length).toBeGreaterThan(0);
    for (const proposed of stamped.output.proposedEvents) {
      expect(proposed.metadata?.sceneId).toBe(scene.sceneId);
    }
    // The Scene itself is untouched, and so is the rest of every proposal: this adds one key.
    expect(stamped.scene).toEqual(result.scene);
    const withoutMetadata = (result: SceneSimulationResult) =>
      result.output.proposedEvents.map((proposed) => ({ ...proposed, metadata: null }));
    expect(withoutMetadata(stamped)).toEqual(withoutMetadata(result));
  });

  it('leaves any other metadata a proposal already carried in place', () => {
    const scene: GroupedScene = {
      schemaVersion: 1, sceneId: 'grouping:mistwood:0:noon:scene:1', groupingRunId: 'grouping:mistwood:0:noon',
      directorRunId: directorRunId(slotOf('noon')), worldId: WORLD_ID, worldDay: 0, timeSlot: 'noon',
      locationId: 'mistwood-mill', participantIds: ['he-jun', 'zhao-ming'], sourceIntentIds: ['i1', 'i2'],
      arcIds: [], trigger: 'A ledger goes missing', dramaticPressure: 'The auditor is waiting',
    };
    const base = finalizeWholeSceneOutput('sim', scene, parseWholeSceneOutput(narrateGroupedScene(scene), scene), 1,
      { provider: 'fake', model: 'fake-whole-scene-v1', inputTokens: 1, outputTokens: 1, latencyMs: 0, retryCount: 0 });
    const withExtra = {
      ...base,
      output: {
        ...base.output,
        proposedEvents: base.output.proposedEvents.map((proposed) => ({
          ...proposed, metadata: { remediation: 'ops-1' },
        })),
      },
    };
    const stamped = withSceneProvenance(withExtra);
    expect(stamped.output.proposedEvents[0].metadata)
      .toEqual({ remediation: 'ops-1', sceneId: scene.sceneId });
  });
});

describe('FR-P004 — the deterministic fake narrator stamps the same provenance', () => {
  it('carries metadata.sceneId on the Proposed Event it builds', () => {
    const scene: GroupedScene = {
      schemaVersion: 1, sceneId: 'grouping:mistwood:0:evening:scene:1', groupingRunId: 'grouping:mistwood:0:evening',
      directorRunId: directorRunId(slotOf('evening')), worldId: WORLD_ID, worldDay: 0, timeSlot: 'evening',
      locationId: 'mistwood-mill', participantIds: ['he-jun', 'zhao-ming'], sourceIntentIds: ['i1', 'i2'],
      arcIds: [], trigger: 'The mill wheel is repaired', dramaticPressure: 'The debt is still owed',
    };
    // The fixture path must exercise the same shape the live orchestrator produces, or every
    // test downstream of it would be testing a world where no event has provenance.
    const output = parseWholeSceneOutput(narrateGroupedScene(scene), scene);
    expect(output.proposedEvents.every((proposed) => proposed.metadata?.sceneId === scene.sceneId)).toBe(true);
  });
});
