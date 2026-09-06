/**
 * The live scheduler → action → finalize orchestration (ART-160).
 *
 * Two layers, and the split is deliberate rather than a shortcut:
 *
 *  1. **The claim state machine**, driven through the REAL `claimLiveSlot` handler against a
 *     `scheduledSlots` fixture. Every failure mode ART-160 owes an answer to — duplicate cron
 *     delivery, duplicate action delivery, an action that never started, one that crashed or timed
 *     out, a process restart, and a finalize that never ran — reaches this one function, because
 *     from the outside they are indistinguishable and the remedy is the same.
 *
 *  2. **A whole world day, automatically**, over the in-memory Canon store: the live sequence
 *     (defer at the network → author → resume and commit) run for all five slots with nothing
 *     invoked stage by stage, ending in real accepted events.
 *
 * ## What layer 2 does NOT cover, stated rather than implied
 *
 * It drives the real orchestrator, the real authoring loop, the real Canon commit and the real
 * safety classification, over `InMemoryCanonStore`. It does not run the Convex `prepare`/`finalize`
 * mutation handlers, because doing so would need a fake of the whole deployment — a fixture large
 * enough that its own bugs would be the thing under test. The claim semantics those mutations add
 * are what layer 1 covers, against the real handler.
 */

import { TIME_SLOTS, type TimeSlot } from '../canon/eventTypes';
import { InMemoryCanonStore } from '../canon/inMemoryStore';
import { mistwoodCharacterSeed, mistwoodWorldConfiguration, MISTWOOD_PUBLIC_WORLD_ID } from '../canon/mistwoodSeed';
import { emptyProjection, type CanonRuleContext } from '../canon/model';
import { replayWorldEvents } from '../canon/replay';
import { resolveEffectiveModuleConfig } from '../shared/moduleModelConfig';
import type {
  EmbeddingResult, LanguageModelProvider, StructuredChatRequest, StructuredChatResult,
} from './provider';
import type { SceneSimulationResult } from './sceneSimulation';
import { buildLiveWorldSnapshot } from './worldDayLive';
import { FakeWholeSceneProvider } from './fakeSceneNarrator';
import { claimLiveSlot, LIVE_SLOT_LEASE_MS, liveClaimHolder, type SlotClaim } from './schedulerOperations';
import {
  authorSlotScenes,
  buildSceneAuthoringPlan,
  createWorldDayStageHandlers,
  SCENE_AUTHORING_DEFERRED,
  unmeteredWorldDayBudgetPort,
  worldDayRunId,
  type GroupingArtifact,
  type WorldDayLivePort,
  type WorldDaySlotIdentity,
  type WorldStateArtifact,
} from './worldDayLive';
import {
  executeWorldDay,
  type WorldDayCheckpoint,
  type WorldDayRun,
  type WorldDayRunStore,
  type WorldDayStage,
} from './worldDayOrchestration';

type Row = Record<string, unknown>;

const WORLD_ID = MISTWOOD_PUBLIC_WORLD_ID;
const T0 = 1_700_000_000_000;

// =============================================================================
// Layer 1 — the claim state machine, against the real handler
// =============================================================================

function slotRow(over: Row = {}): Row {
  return {
    _id: 'scheduledSlots:1', slotKey: `${WORLD_ID}:day:0:slot:morning`, worldId: WORLD_ID,
    worldDay: 0, timeSlot: 'morning', trigger: 'clock', status: 'queued', seed: 1,
    publishEnabled: true, idempotencyKey: `${WORLD_ID}:day:0:slot:morning`, attemptCount: 0,
    createdAt: T0, updatedAt: T0, ...over,
  };
}

function claimDb(rows: Row[]) {
  return {
    query(_table: string) {
      let matched = [...rows];
      const chain = {
        withIndex(_name: string, build: (q: unknown) => unknown) {
          const eqs: Array<[string, unknown]> = [];
          const q = { eq(field: string, value: unknown) { eqs.push([field, value]); return q; } };
          build(q);
          matched = matched.filter((row) => eqs.every(([field, value]) => row[field] === value));
          return chain;
        },
        first: () => Promise.resolve(matched[0] ?? null),
        collect: () => Promise.resolve(matched),
        unique: () => Promise.resolve(matched[0] ?? null),
      };
      return chain;
    },
    get: (id: string) => Promise.resolve(rows.find((row) => row._id === id) ?? null),
    patch: (id: string, patch: Row) => {
      const found = rows.find((row) => row._id === id);
      if (!found) throw new Error(`no row ${id}`);
      Object.assign(found, patch);
      return Promise.resolve();
    },
  };
}

type Registered = { _handler: (ctx: unknown, args: unknown) => Promise<unknown> };
const claim = (rows: Row[], args: Row = {}): Promise<SlotClaim> =>
  (claimLiveSlot as unknown as Registered)._handler({ db: claimDb(rows) },
    { worldId: WORLD_ID, now: T0, ...args }) as Promise<SlotClaim>;

describe('AC#4 — a world has exactly one live claim at a time', () => {
  it('claims a queued slot and marks it running with a lease', async () => {
    const rows = [slotRow()];

    const result = await claim(rows);

    expect(result).toMatchObject({ kind: 'claimed', resumed: false });
    expect(rows[0]).toMatchObject({
      status: 'running', startedAt: T0, leaseExpiresAt: T0 + LIVE_SLOT_LEASE_MS, attemptCount: 1,
    });
  });

  it('refuses a SECOND claim while the first lease is live', async () => {
    const rows = [slotRow()];
    await claim(rows);

    // The duplicate-delivery case: two cron ticks, or a retried action, arriving together.
    const second = await claim(rows, { now: T0 + 1_000 });

    expect(second.kind).toBe('busy');
  });

  it('does not hand a second driver the NEXT queued slot instead', async () => {
    // The subtle version of double-driving, and the more damaging one: world time is ordered, so
    // authoring slot two against a world slot one has not finished advancing produces scenes about
    // a state that never existed. `busy` must mean "do nothing", not "do something else".
    const rows = [slotRow(), slotRow({ _id: 'scheduledSlots:2', worldDay: 0, timeSlot: 'noon',
      slotKey: `${WORLD_ID}:day:0:slot:noon` })];
    await claim(rows);

    const second = await claim(rows, { now: T0 + 1_000 });

    expect(second.kind).toBe('busy');
    expect(rows[1].status).toBe('queued');
  });
});

describe('AC#3 — an interrupted sequence is reclaimed and resumed', () => {
  it.each([
    ['the action never started', {}],
    ['the action crashed or timed out', { attemptCount: 3 }],
    ['the process restarted', { startedAt: T0 - LIVE_SLOT_LEASE_MS * 2 }],
  ])('takes over a running slot whose lease lapsed — %s', async (_case, over) => {
    const rows = [slotRow({ status: 'running', leaseExpiresAt: T0 - 1, ...over })];

    const result = await claim(rows, { now: T0 });

    // One branch covers every interruption, because from here they are indistinguishable.
    expect(result).toMatchObject({ kind: 'claimed', resumed: true });
    expect(rows[0].leaseExpiresAt).toBe(T0 + LIVE_SLOT_LEASE_MS);
  });

  it('takes over a slot written before leases existed', async () => {
    // Migration safety: `leaseExpiresAt` is optional, and a row without one is read as expired —
    // which is correct, since nothing is holding it.
    const rows = [slotRow({ status: 'running', leaseExpiresAt: undefined })];

    expect(await claim(rows)).toMatchObject({ kind: 'claimed', resumed: true });
  });

  it('counts a takeover as an attempt, and a fresh claim as the first', async () => {
    const fresh = [slotRow()];
    const orphan = [slotRow({ status: 'running', attemptCount: 2, leaseExpiresAt: T0 - 1 })];

    await claim(fresh);
    await claim(orphan);

    // The number an operator reads to decide whether a slot is thrashing.
    expect(fresh[0].attemptCount).toBe(1);
    expect(orphan[0].attemptCount).toBe(3);
  });

  it('reports idle when nothing is queued and nothing is orphaned', async () => {
    expect(await claim([slotRow({ status: 'completed' })])).toEqual({ kind: 'idle' });
    expect(await claim([])).toEqual({ kind: 'idle' });
  });

  it('never resurrects a cancelled or completed slot', async () => {
    const rows = [slotRow({ status: 'cancelled' }), slotRow({ _id: 'scheduledSlots:2', status: 'failed' })];

    expect(await claim(rows)).toEqual({ kind: 'idle' });
    expect(rows.map((row) => row.status)).toEqual(['cancelled', 'failed']);
  });
});

describe('the deterministic path cannot start a slot under a live driver', () => {
  it('reports a holder while the lease is live, and none once it lapses', async () => {
    const rows = [slotRow({ status: 'running', leaseExpiresAt: T0 + 5_000 })];

    expect(await liveClaimHolder(claimDb(rows) as never, WORLD_ID, T0)).not.toBeNull();
    expect(await liveClaimHolder(claimDb(rows) as never, WORLD_ID, T0 + 6_000)).toBeNull();
  });

  it('reports no holder for a world that is merely queued', async () => {
    expect(await liveClaimHolder(claimDb([slotRow()]) as never, WORLD_ID, T0)).toBeNull();
  });
});

// =============================================================================
// Layer 2 — a whole world day, automatically
// =============================================================================

class MemoryRunStore implements WorldDayRunStore {
  readonly runs = new Map<string, WorldDayRun>();
  readonly checkpoints: WorldDayCheckpoint[] = [];

  loadRun(runId: string) { return Promise.resolve(this.runs.get(runId) ?? null); }
  createRun(input: Parameters<WorldDayRunStore['createRun']>[0]) {
    const run: WorldDayRun = { ...input, status: 'running', attemptCount: 1 };
    this.runs.set(input.runId, run);
    return Promise.resolve(run);
  }
  listCheckpoints(runId: string) {
    return Promise.resolve(this.checkpoints.filter((entry) => entry.runId === runId));
  }
  startCheckpoint(runId: string, stage: WorldDayStage, attempt: number) {
    this.checkpoints.push({ runId, stage, attempt, status: 'running' });
    return Promise.resolve();
  }
  completeCheckpoint(runId: string, stage: WorldDayStage, attempt: number, artifact: unknown) {
    this.checkpoints.push({ runId, stage, attempt, status: 'completed', artifact });
    return Promise.resolve();
  }
  failCheckpoint(runId: string, stage: WorldDayStage, attempt: number, error: { code: string; message: string }) {
    this.checkpoints.push({ runId, stage, attempt, status: 'failed', errorCode: error.code, errorMessage: error.message });
    return Promise.resolve();
  }
  resumeRun(runId: string, attempt: number) {
    const run = this.runs.get(runId);
    if (run) this.runs.set(runId, { ...run, status: 'running', attemptCount: attempt });
    return Promise.resolve();
  }
  failRun(runId: string, stage: WorldDayStage, error: { code: string; message: string }) {
    const run = this.runs.get(runId);
    if (run) {
      this.runs.set(runId, { ...run, status: 'failed', failureStage: stage, errorCode: error.code, errorMessage: error.message });
    }
    return Promise.resolve();
  }
  completeRun(runId: string, committedEventIds: string[]) {
    const run = this.runs.get(runId);
    if (run) this.runs.set(runId, { ...run, status: 'completed', committedEventIds });
    return Promise.resolve();
  }
}

const activeLocations = mistwoodWorldConfiguration.locations.filter(({ active }) => active !== false);

const mistwoodRuleContext = (): CanonRuleContext => ({
  worldId: WORLD_ID,
  rules: [],
  knownEventIds: [],
});

function seededStore(): InMemoryCanonStore {
  const store = new InMemoryCanonStore();
  store.setCanonRuleContext(mistwoodRuleContext());
  return store;
}

/** A provider that counts its calls, so "did the finishing pass author?" is measurable. */
class CountingProvider implements LanguageModelProvider {
  calls = 0;
  private readonly inner = new FakeWholeSceneProvider();
  structuredChat(request: StructuredChatRequest): Promise<StructuredChatResult> {
    this.calls += 1;
    return this.inner.structuredChat(request);
  }
  embed(text: string): Promise<EmbeddingResult> { return this.inner.embed(text); }
}

const slotOf = (timeSlot: TimeSlot, worldDay = 0): WorldDaySlotIdentity => ({ worldId: WORLD_ID, worldDay, timeSlot });

/**
 * The Convex-free port, with the concurrency limit and persistence the live sequence needs.
 *
 * Deliberately NOT the fixture from `worldDayLive.test.ts`: that one persists nothing across
 * passes, and persistence across passes is precisely the mechanism the live split depends on.
 */
function livePort(store: InMemoryCanonStore, maxConcurrentCalls: number | null = null) {
  const simulations = new Map<string, SceneSimulationResult>();
  const port: WorldDayLivePort = {
    canonStore: store,
    budget: unmeteredWorldDayBudgetPort(),
    loadConcurrencyLimit: () => Promise.resolve(maxConcurrentCalls),
    loadModuleConfig: (_worldId, module) => Promise.resolve(resolveEffectiveModuleConfig(module, null)),
    async loadWorldSnapshot(slot) {
      const acceptedEvents = await store.loadAcceptedEvents(slot.worldId);
      return buildLiveWorldSnapshot({
        slot,
        acceptedEvents,
        projection: replayWorldEvents(emptyProjection(slot.worldId), acceptedEvents),
        characters: mistwoodCharacterSeed.characters.map(({ id, publicProfile, publicGoal, initialLocationId }) =>
          ({ characterId: id, personaSummary: publicProfile, currentGoal: publicGoal, initialLocationId })),
        locationConnections: Object.fromEntries(
          activeLocations.map(({ id, connectedLocationIds }) => [id, connectedLocationIds])),
        seedKnowledge: mistwoodCharacterSeed.knowledge.map(({ id, characterId, content }) =>
          ({ characterId, knowledgeId: id, belief: content })),
        seedAssets: mistwoodCharacterSeed.assets.map(({ id, ownerCharacterId }) =>
          ({ characterId: ownerCharacterId, assetId: id })),
        secretIds: mistwoodCharacterSeed.secrets.map(({ id }) => id),
        activeArcs: [],
      });
    },
    loadScheduledEnvironmentEvents: () => Promise.resolve([]),
    markScheduledEnvironmentEventApplied: () => Promise.resolve(),
    persistDirectorPlan: () => Promise.resolve(),
    persistCharacterIntent: () => Promise.resolve(),
    persistGroupedScenes: () => Promise.resolve(),
    // Persistence ACROSS passes is the mechanism the live split depends on, so this fixture keeps
    // it rather than discarding results the way a single-pass fixture can afford to.
    persistSceneSimulation: (_groupingRunId, result) => {
      simulations.set(result.simulationRunId, result);
      return Promise.resolve();
    },
    loadPersistedSceneSimulation: (_worldId, _groupingRunId, simulationRunId) =>
      Promise.resolve(simulations.get(simulationRunId) ?? null),
  };
  return { port, simulations };
}

/**
 * Drive ONE slot exactly as the live path does: defer at the network, author, resume and commit.
 *
 * Nothing is invoked stage by stage — the orchestrator decides where to stop and where to resume,
 * and the only thing this function does between the two passes is what the ACTION does.
 */
async function driveSlotLive(input: {
  store: InMemoryCanonStore;
  runStore: MemoryRunStore;
  port: WorldDayLivePort;
  slot: WorldDaySlotIdentity;
  provider: CountingProvider;
}): Promise<{ deferred: WorldDayRun; final: WorldDayRun; authored: number }> {
  const runInput = { runId: worldDayRunId(input.slot), ...input.slot };

  // Pass 1: the transactional half. `null` means "may not author", so it stops at stage 7.
  const deferred = await executeWorldDay(runInput, input.runStore,
    createWorldDayStageHandlers(input.port, null));

  let authored = 0;
  if (deferred.errorCode === SCENE_AUTHORING_DEFERRED) {
    // The ACTION's half, rebuilt from the run's own checkpoints — the same artifacts pass 2 will
    // resume from, so the plan authored against is the world state the commit validates against.
    const latest = (stage: WorldDayStage): unknown => input.runStore.checkpoints
      .filter((entry) => entry.runId === runInput.runId && entry.stage === stage && entry.status === 'completed')
      .sort((left, right) => right.attempt - left.attempt)[0]?.artifact;
    const world = latest('load_world_state') as WorldStateArtifact;
    const grouping = latest('group_intents_into_scenes') as GroupingArtifact;
    const plan = await buildSceneAuthoringPlan(input.port, input.slot, grouping, world.snapshot);
    authored = (await authorSlotScenes(input.provider, input.port, plan)).length;
  }

  // Pass 2: resumes from the checkpoints, finds every scene persisted, and commits.
  const final = await executeWorldDay(runInput, input.runStore,
    createWorldDayStageHandlers(input.port, null));
  return { deferred, final, authored };
}

describe('AC#1 — a whole world day advances through the live sequence automatically', () => {
  it('completes all five slots and commits real accepted events', async () => {
    const store = seededStore();
    const runStore = new MemoryRunStore();
    const { port } = livePort(store);
    const provider = new CountingProvider();

    const outcomes = [];
    for (const timeSlot of TIME_SLOTS) {
      outcomes.push(await driveSlotLive({ store, runStore, port, slot: slotOf(timeSlot), provider }));
    }

    // Every slot deferred at the network, authored, then resumed and committed. Nothing was
    // driven stage by stage: the orchestrator chose both stopping points.
    expect(outcomes.map((entry) => entry.deferred.errorCode))
      .toEqual(TIME_SLOTS.map(() => SCENE_AUTHORING_DEFERRED));
    expect(outcomes.map((entry) => entry.final.status)).toEqual(TIME_SLOTS.map(() => 'completed'));
    expect(outcomes.every((entry) => entry.authored > 0)).toBe(true);

    const events = await store.loadAcceptedEvents(WORLD_ID);
    expect(events.length).toBeGreaterThan(0);
    // Canon order is the slot order, and sequence numbers are contiguous from the seed.
    expect(events.map((event) => event.sequenceNumber))
      .toEqual(events.map((_event, index) => events[0].sequenceNumber + index));
  });

  it('the finishing pass authors NOTHING — it only commits what the action already produced', async () => {
    const store = seededStore();
    const runStore = new MemoryRunStore();
    const { port } = livePort(store);
    const provider = new CountingProvider();

    const { authored } = await driveSlotLive({ store, runStore, port, slot: slotOf('morning'), provider });
    const callsAfterAuthoring = provider.calls;

    // Re-running the finishing pass calls no provider at all: it is handed `null`, and every
    // scene it needs is already persisted.
    const again = await executeWorldDay({ runId: worldDayRunId(slotOf('morning')), ...slotOf('morning') },
      runStore, createWorldDayStageHandlers(port, null));

    expect(authored).toBeGreaterThan(0);
    expect(again.status).toBe('completed');
    expect(provider.calls).toBe(callsAfterAuthoring);
  });
});

describe('AC#2/#6 — a repeated sequence commits once', () => {
  it('re-driving a completed slot commits no second event', async () => {
    const store = seededStore();
    const runStore = new MemoryRunStore();
    const { port } = livePort(store);
    const provider = new CountingProvider();

    await driveSlotLive({ store, runStore, port, slot: slotOf('morning'), provider });
    const afterFirst = (await store.loadAcceptedEvents(WORLD_ID)).length;
    const callsAfterFirst = provider.calls;

    await driveSlotLive({ store, runStore, port, slot: slotOf('morning'), provider });

    // The whole idempotency stack, exercised at once: a completed run short-circuits, persisted
    // scenes are reused rather than re-paid for, and the commit dedups on `idempotencyKey`.
    expect((await store.loadAcceptedEvents(WORLD_ID)).length).toBe(afterFirst);
    expect(provider.calls).toBe(callsAfterFirst);
  });

  it('a slot interrupted after authoring resumes without paying for the scenes again', async () => {
    const store = seededStore();
    const runStore = new MemoryRunStore();
    const { port } = livePort(store);
    const provider = new CountingProvider();
    const slot = slotOf('morning');
    const runInput = { runId: worldDayRunId(slot), ...slot };

    // Pass 1 defers; the action authors; then the process dies before the finishing pass.
    await executeWorldDay(runInput, runStore, createWorldDayStageHandlers(port, null));
    const latest = (stage: WorldDayStage): unknown => runStore.checkpoints
      .filter((entry) => entry.runId === runInput.runId && entry.stage === stage && entry.status === 'completed')
      .sort((left, right) => right.attempt - left.attempt)[0]?.artifact;
    const plan = await buildSceneAuthoringPlan(port, slot,
      latest('group_intents_into_scenes') as GroupingArtifact,
      (latest('load_world_state') as WorldStateArtifact).snapshot);
    await authorSlotScenes(provider, port, plan);
    const paidFor = provider.calls;

    // Recovery: the reclaimed slot re-runs the whole sequence.
    const recovered = await driveSlotLive({ store, runStore, port, slot, provider });

    expect(recovered.final.status).toBe('completed');
    // Not one extra provider call — the authored scenes were already persisted.
    expect(provider.calls).toBe(paidFor);
    expect((await store.loadAcceptedEvents(WORLD_ID)).length).toBeGreaterThan(0);
  });
});

describe('AC#1 — concurrency changes timing, not the world', () => {
  it('produces byte-identical Canon at every concurrency level', async () => {
    const canon = [];
    for (const limit of [null, 1, 3]) {
      const store = seededStore();
      const { port } = livePort(store, limit);
      await driveSlotLive({
        store, runStore: new MemoryRunStore(), port,
        slot: slotOf('morning'), provider: new CountingProvider(),
      });
      canon.push((await store.loadAcceptedEvents(WORLD_ID))
        .map((event) => [event.sequenceNumber, event.eventId, event.publicSummary]));
    }

    // ART-161's ordering guarantee, measured where it actually matters: raising the limit must
    // change how long a slot takes and nothing else about the world it produces.
    expect(canon[1]).toEqual(canon[0]);
    expect(canon[2]).toEqual(canon[0]);
  });
});
