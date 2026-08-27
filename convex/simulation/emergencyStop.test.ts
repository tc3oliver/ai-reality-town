/**
 * FR-K006 failure-injection suite: engage the kill switch at EVERY world-day stage.
 *
 * The PRD promise is narrow and easy to get wrong, so it is proven by execution against
 * the real Mistwood seed and the real stage handlers rather than by mocks:
 *
 *   AC#1  Engaging the switch stops NEW work.
 *   AC#2  Every incomplete run keeps its durable state, and no accepted event is lost.
 *   AC#3  An authorized release resumes the world from exactly where it halted.
 *   AC#4  Activation, repeated activation, and release are idempotent.
 *
 * The critical property is the one a naive kill switch breaks: halting mid-run must
 * neither commit a partial batch nor cause the resumed run to commit the same events a
 * second time. Every stage is therefore checked, including the commit stage itself.
 */

import { TIME_SLOTS, type TimeSlot } from '../canon/eventTypes';
import { InMemoryCanonStore } from '../canon/inMemoryStore';
import { emptyProjection, type CanonRuleContext } from '../canon/model';
import { mistwoodCharacterSeed, mistwoodWorldConfiguration, MISTWOOD_PUBLIC_WORLD_ID } from '../canon/mistwoodSeed';
import { replayWorldEvents } from '../canon/replay';
import {
  assertEmergencyStopCommand,
  assertSimulationAdmitted,
  decideEmergencyStopEngage,
  decideEmergencyStopRelease,
  EMERGENCY_STOP_ERROR_CODE,
  guardWorldDayStageHandlers,
  isSimulationHalted,
  summarizeEmergencyStop,
  type EmergencyStopRecord,
} from './emergencyStop';
import { buildLiveWorldSnapshot, createWorldDayStageHandlers, worldDayRunId, type LiveWorldSnapshot, type WorldDayLivePort, type WorldDaySlotIdentity } from './worldDayLive';
import {
  executeWorldDay,
  WORLD_DAY_STAGES,
  type RunFailure,
  type WorldDayCheckpoint,
  type WorldDayRun,
  type WorldDayRunInput,
  type WorldDayRunStore,
  type WorldDayStage,
  type WorldDayStageHandlers,
} from './worldDayOrchestration';
import {
  resolveEffectiveModuleConfig,
  type ConfigurableModule,
} from '../shared/moduleModelConfig';

const WORLD_ID = MISTWOOD_PUBLIC_WORLD_ID;

// ---------------------------------------------------------------------------
// Pure decisions
// ---------------------------------------------------------------------------

function engagedRecord(over: Partial<EmergencyStopRecord> = {}): EmergencyStopRecord {
  return {
    worldId: WORLD_ID, state: 'engaged', engagedAt: 10, engagedBy: 'ops-admin', reason: 'runaway generation',
    scheduleStatusBefore: 'running', preservedSlotKeys: ['mistwood:day:1:slot:noon'], activationCount: 1, ...over,
  };
}

describe('FR-K006 kill-switch decisions', () => {
  it('admits simulation only while the switch is released', () => {
    expect(isSimulationHalted(null)).toBe(false);
    expect(isSimulationHalted(engagedRecord({ state: 'released' }))).toBe(false);
    expect(isSimulationHalted(engagedRecord())).toBe(true);
    expect(() => assertSimulationAdmitted(WORLD_ID, null)).not.toThrow();
    expect(() => assertSimulationAdmitted(WORLD_ID, engagedRecord()))
      .toThrow(new RegExp(EMERGENCY_STOP_ERROR_CODE));
  });

  it('is idempotent: repeated activation and repeated release change nothing (AC#4)', () => {
    expect(decideEmergencyStopEngage(null)).toMatchObject({ action: 'engage', resultCode: 'OPS_EMERGENCY_STOP_ENGAGED' });
    expect(decideEmergencyStopEngage(engagedRecord()))
      .toMatchObject({ action: 'none', resultCode: 'OPS_EMERGENCY_STOP_ALREADY_ENGAGED' });
    expect(decideEmergencyStopRelease(engagedRecord()))
      .toMatchObject({ action: 'release', resultCode: 'OPS_EMERGENCY_STOP_RELEASED', restoreScheduleStatus: 'running' });
    expect(decideEmergencyStopRelease(null)).toMatchObject({ action: 'none', resultCode: 'OPS_EMERGENCY_STOP_NOT_ENGAGED' });
    expect(decideEmergencyStopRelease(engagedRecord({ state: 'released' })))
      .toMatchObject({ action: 'none', resultCode: 'OPS_EMERGENCY_STOP_NOT_ENGAGED' });
  });

  it('restores the status the world held before the stop, not an assumed "running"', () => {
    // A world an operator had already paused must stay paused after the release.
    expect(decideEmergencyStopRelease(engagedRecord({ scheduleStatusBefore: 'paused' })))
      .toMatchObject({ action: 'release', restoreScheduleStatus: 'paused' });
  });

  it('requires an operator, a reason, and a finite clock before anything is written', () => {
    const valid = { operatorId: 'ops-admin', reason: 'runaway generation', now: 1 };
    expect(() => assertEmergencyStopCommand(valid)).not.toThrow();
    expect(() => assertEmergencyStopCommand({ ...valid, operatorId: '  ' })).toThrow(/EMERGENCY_STOP_INPUT_INVALID/);
    expect(() => assertEmergencyStopCommand({ ...valid, reason: '' })).toThrow(/EMERGENCY_STOP_INPUT_INVALID/);
    expect(() => assertEmergencyStopCommand({ ...valid, now: Number.NaN })).toThrow(/EMERGENCY_STOP_INPUT_INVALID/);
  });

  it('summarizes an unused switch and an engaged switch without leaking anything private', () => {
    expect(summarizeEmergencyStop(WORLD_ID, null))
      .toEqual({ worldId: WORLD_ID, engaged: false, state: 'released', preservedSlotKeys: [], activationCount: 0 });
    const view = summarizeEmergencyStop(WORLD_ID, engagedRecord());
    expect(view).toMatchObject({ engaged: true, engagedBy: 'ops-admin', activationCount: 1, scheduleStatusBefore: 'running' });
    expect(view.preservedSlotKeys).toEqual(['mistwood:day:1:slot:noon']);
  });
});

// ---------------------------------------------------------------------------
// Live world-day harness (Mistwood seed + real stage handlers)
// ---------------------------------------------------------------------------

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
  private required(runId: string): WorldDayRun {
    const run = this.runs.get(runId);
    if (!run) throw new Error('missing run');
    return run;
  }
  private find(runId: string, stage: WorldDayStage, attempt: number): WorldDayCheckpoint {
    const row = this.checkpoints.find((c) => c.runId === runId && c.stage === stage && c.attempt === attempt);
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

function seededStore(): InMemoryCanonStore {
  const store = new InMemoryCanonStore();
  store.setCanonRuleContext(mistwoodRuleContext());
  return store;
}

/** In-memory {@link WorldDayLivePort} over the Mistwood seed; persistence is recorded only. */
function createSeedPort(store: InMemoryCanonStore): WorldDayLivePort {
  return {
    canonStore: store,
    // FR-K005 / ART-52: this spec runs an UNCONFIGURED world, so the port returns the documented
    // defaults -- which are the pre-ART-52 hardcoded values.
    loadModuleConfig: (_worldId: string, module: ConfigurableModule) =>
      Promise.resolve(resolveEffectiveModuleConfig(module, null)),
    async loadWorldSnapshot(slot): Promise<LiveWorldSnapshot> {
      const acceptedEvents = await store.loadAcceptedEvents(slot.worldId);
      return buildLiveWorldSnapshot({
        slot,
        acceptedEvents,
        projection: replayWorldEvents(emptyProjection(slot.worldId), acceptedEvents),
        characters: mistwoodCharacterSeed.characters.map(({ id, publicProfile, publicGoal, initialLocationId }) =>
          ({ characterId: id, personaSummary: publicProfile, currentGoal: publicGoal, initialLocationId })),
        locationConnections: Object.fromEntries(activeLocations.map(({ id, connectedLocationIds }) => [id, connectedLocationIds])),
        seedKnowledge: mistwoodCharacterSeed.knowledge.map(({ id, characterId, content }) => ({ characterId, knowledgeId: id, belief: content })),
        seedAssets: mistwoodCharacterSeed.assets.map(({ id, ownerCharacterId }) => ({ characterId: ownerCharacterId, assetId: id })),
        secretIds: mistwoodCharacterSeed.secrets.map(({ id }) => id),
        activeArcs: [],
      });
    },
    loadScheduledEnvironmentEvents: () => Promise.resolve([]),
    markScheduledEnvironmentEventApplied: () => Promise.resolve(),
    persistDirectorPlan: () => Promise.resolve(),
    persistCharacterIntent: () => Promise.resolve(),
    persistGroupedScenes: () => Promise.resolve(),
    persistSceneSimulation: () => Promise.resolve(),
  };
}

const slotOf = (timeSlot: TimeSlot, worldDay = 0): WorldDaySlotIdentity => ({ worldId: WORLD_ID, worldDay, timeSlot });
const runInput = (slot: WorldDaySlotIdentity): WorldDayRunInput => ({ runId: worldDayRunId(slot), ...slot });

/** Record which stages actually executed, so a resume can be shown to skip completed work. */
function recording(base: WorldDayStageHandlers, calls: WorldDayStage[]): WorldDayStageHandlers {
  return Object.fromEntries(WORLD_DAY_STAGES.map((stage) => [stage, (context: Parameters<WorldDayStageHandlers[typeof stage]>[0]) => {
    calls.push(stage);
    return base[stage](context);
  }])) as WorldDayStageHandlers;
}

/**
 * Inject an operator activation that lands while the run is in flight, so the guard
 * refuses `haltBefore`. For the first stage the switch is already engaged when the run
 * starts; otherwise the operator trips it while the preceding stage is executing.
 */
function injectStopBefore(base: WorldDayStageHandlers, haltBefore: WorldDayStage, engage: () => void): WorldDayStageHandlers {
  const index = WORLD_DAY_STAGES.indexOf(haltBefore);
  if (index === 0) {
    engage();
    return base;
  }
  const previous = WORLD_DAY_STAGES[index - 1];
  return {
    ...base,
    [previous]: async (context: Parameters<WorldDayStageHandlers[typeof previous]>[0]) => {
      const artifact = await base[previous](context);
      engage();
      return artifact;
    },
  };
}

/** Baseline: what an undisturbed slot commits, used to prove a resume commits no more. */
async function undisturbedCommitCount(timeSlot: TimeSlot): Promise<number> {
  const store = seededStore();
  await executeWorldDay(runInput(slotOf(timeSlot)), new MemoryRunStore(), createWorldDayStageHandlers(createSeedPort(store)));
  return store.committedEvents().length;
}

describe('FR-K006 emergency stop injected at every world-day stage', () => {
  it.each(WORLD_DAY_STAGES)('halts at %s, preserves the run, and commits nothing partial', async (haltStage) => {
    const store = seededStore();
    const runStore = new MemoryRunStore();
    const calls: WorldDayStage[] = [];
    let engaged = false;

    const base = recording(createWorldDayStageHandlers(createSeedPort(store)), calls);
    const guarded = guardWorldDayStageHandlers(
      injectStopBefore(base, haltStage, () => { engaged = true; }),
      () => engaged,
    );
    const halted = await executeWorldDay(runInput(slotOf('morning')), runStore, guarded);

    // AC#1: the run stopped at exactly the injected stage with the stable kill-switch code.
    expect(halted).toMatchObject({ status: 'failed', failureStage: haltStage, errorCode: EMERGENCY_STOP_ERROR_CODE });
    const haltIndex = WORLD_DAY_STAGES.indexOf(haltStage);
    expect(calls).toEqual(WORLD_DAY_STAGES.slice(0, haltIndex));

    // AC#2: every stage completed before the halt keeps its durable checkpoint...
    const runId = worldDayRunId(slotOf('morning'));
    const checkpoints = runStore.checkpoints.filter((row) => row.runId === runId);
    expect(checkpoints.filter((row) => row.status === 'completed').map((row) => row.stage))
      .toEqual(WORLD_DAY_STAGES.slice(0, haltIndex));
    // ...the refused stage is recorded as failed, and no later stage was ever started.
    const refused = checkpoints.filter((row) => row.stage === haltStage);
    expect(refused).toHaveLength(1);
    expect(refused[0]).toMatchObject({ runId, stage: haltStage, attempt: 1, status: 'failed', errorCode: EMERGENCY_STOP_ERROR_CODE });
    expect(refused[0].errorMessage).toContain(haltStage);
    expect(checkpoints.some((row) => WORLD_DAY_STAGES.indexOf(row.stage) > haltIndex)).toBe(false);

    // AC#2: nothing partial reached append-only Canon, at any stage including commit.
    expect(store.committedEvents()).toEqual([]);
  });

  it.each(WORLD_DAY_STAGES)('resumes from %s after an authorized release and commits exactly once', async (haltStage) => {
    const expected = await undisturbedCommitCount('noon');
    const store = seededStore();
    const runStore = new MemoryRunStore();
    const calls: WorldDayStage[] = [];
    let engaged = false;

    const base = recording(createWorldDayStageHandlers(createSeedPort(store)), calls);
    const halted = await executeWorldDay(
      runInput(slotOf('noon')),
      runStore,
      guardWorldDayStageHandlers(injectStopBefore(base, haltStage, () => { engaged = true; }), () => engaged),
    );
    expect(halted.status).toBe('failed');
    const committedWhileHalted = store.committedEvents().length;

    // A halted world admits no new work: retrying while the switch is still engaged
    // re-refuses at the same stage and runs nothing.
    calls.length = 0;
    const retryWhileHalted = await executeWorldDay(runInput(slotOf('noon')), runStore, guardWorldDayStageHandlers(base, () => engaged));
    expect(retryWhileHalted).toMatchObject({ status: 'failed', failureStage: haltStage, errorCode: EMERGENCY_STOP_ERROR_CODE });
    expect(calls).toEqual([]);
    expect(store.committedEvents()).toHaveLength(committedWhileHalted);

    // AC#3: an authorized release lets the run continue from exactly where it halted.
    engaged = false;
    calls.length = 0;
    const resumed = await executeWorldDay(runInput(slotOf('noon')), runStore, guardWorldDayStageHandlers(base, () => engaged));

    expect(resumed).toMatchObject({ status: 'completed', attemptCount: 3 });
    expect(calls).toEqual(WORLD_DAY_STAGES.slice(WORLD_DAY_STAGES.indexOf(haltStage)));
    // AC#2/#3: exactly the undisturbed set of events, each committed once.
    const events = store.committedEvents();
    expect(events).toHaveLength(expected);
    expect(new Set(events.map(({ idempotencyKey }) => idempotencyKey)).size).toBe(expected);
    expect(events.map(({ sequenceNumber }) => sequenceNumber)).toEqual(events.map((_, index) => index));
  });

  it('never loses an accepted event when the switch engages after a run completed (AC#2)', async () => {
    const store = seededStore();
    const runStore = new MemoryRunStore();
    let engaged = false;
    const base = createWorldDayStageHandlers(createSeedPort(store));

    const completed = await executeWorldDay(runInput(slotOf('afternoon')), runStore, guardWorldDayStageHandlers(base, () => engaged));
    expect(completed.status).toBe('completed');
    const accepted = store.committedEvents();
    expect(accepted.length).toBeGreaterThan(0);

    engaged = true;
    // A completed run short-circuits before any stage guard, so the accepted events
    // stay byte-for-byte identical and the run is still reported as completed.
    const afterStop = await executeWorldDay(runInput(slotOf('afternoon')), runStore, guardWorldDayStageHandlers(base, () => engaged));
    expect(afterStop).toMatchObject({ status: 'completed', committedEventIds: completed.committedEventIds });
    expect(store.committedEvents()).toEqual(accepted);
  });

  it('stops the rest of the world day: no later slot starts while the switch is engaged (AC#1)', async () => {
    const store = seededStore();
    const runStore = new MemoryRunStore();
    const calls: WorldDayStage[] = [];
    let engaged = false;
    const guarded = guardWorldDayStageHandlers(recording(createWorldDayStageHandlers(createSeedPort(store)), calls), () => engaged);

    const first = await executeWorldDay(runInput(slotOf(TIME_SLOTS[0])), runStore, guarded);
    expect(first.status).toBe('completed');
    engaged = true;
    calls.length = 0;

    const rest: WorldDayRun[] = [];
    for (const timeSlot of TIME_SLOTS.slice(1)) {
      rest.push(await executeWorldDay(runInput(slotOf(timeSlot)), runStore, guarded));
    }
    expect(rest.map(({ status }) => status)).toEqual(TIME_SLOTS.slice(1).map(() => 'failed'));
    expect(rest.every(({ failureStage, errorCode }) =>
      failureStage === WORLD_DAY_STAGES[0] && errorCode === EMERGENCY_STOP_ERROR_CODE)).toBe(true);
    expect(calls).toEqual([]);
    // Only the slot that finished before the stop contributed to Canon.
    expect(store.committedEvents().map(({ timeSlot }) => timeSlot)).toEqual(
      store.committedEvents().map(() => TIME_SLOTS[0]),
    );
  });
});
