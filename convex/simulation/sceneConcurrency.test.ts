/**
 * `maxConcurrentCalls` actually binds (ART-161).
 *
 * ## Why peak concurrency is measured rather than asserted
 *
 * FR-M003's 最大並行數 has been evaluated by `evaluateReservation` and unit-tested since ART-59, and
 * it has never bound: `authorSlotScenes` walked a slot's scenes sequentially, so `inFlight` was
 * only ever 0 or 1. ART-59 recorded that and ART-159 narrowed the reason. A test that asserted "the
 * setting is N" would have passed throughout — the setting was always N, and always meaningless.
 *
 * So every test here counts calls that are genuinely OVERLAPPING. `GatedProvider` does not resolve
 * until the test says so, which is what makes an in-flight count observable at all; a provider that
 * returned immediately would show a peak of 1 no matter how the pool was written.
 */

import type {
  LanguageModelProvider, StructuredChatRequest, StructuredChatResult, EmbeddingResult,
} from './provider';
import type { GroupedScene } from './sceneGrouping';
import type { SceneSimulationResult } from './sceneSimulation';
import { authorSlotScenes, SCENE_AUTHORING_DEFERRED, type SceneAuthoringPlan, type SceneAuthoringStore } from './worldDayLive';
import { unmeteredWorldDayBudgetPort } from './sceneBudget';
import { FakeWholeSceneProvider } from './fakeSceneNarrator';

const WORLD_ID = 'mistwood';
const GROUPING_RUN_ID = 'group-1';

const scene = (index: number): GroupedScene => ({
  schemaVersion: 1, sceneId: `${GROUPING_RUN_ID}:scene:${index}`, groupingRunId: GROUPING_RUN_ID,
  directorRunId: 'director-1', worldId: WORLD_ID, worldDay: 2, timeSlot: 'evening',
  locationId: 'mistwood-station', participantIds: ['lin-yingxue', 'wu-zhen'],
  sourceIntentIds: [`intent-${index}a`, `intent-${index}b`], arcIds: ['arc-station-ledger'],
  trigger: `打開第 ${index} 號置物櫃`, dramaticPressure: '鎮長黃昏時抵達',
});

const plan = (scenes: GroupedScene[], maxConcurrentScenes: number): SceneAuthoringPlan => ({
  slot: { worldId: WORLD_ID, worldDay: 2, timeSlot: 'evening' },
  groupingRunId: GROUPING_RUN_ID,
  scenes,
  options: { maxAttempts: 1, temperature: 0.4, maxTokens: 4_000 },
  requestedModel: 'auto',
  legalDestinationIds: Object.fromEntries(scenes.map((entry) => [entry.sceneId, ['mistwood-square']])),
  maxConcurrentScenes,
});

/**
 * A provider whose calls stay in flight until released, recording the true peak overlap.
 *
 * `inFlight` is incremented before awaiting and decremented after, so `peak` is the largest number
 * of calls that were simultaneously unresolved — the only definition of concurrency that a
 * limiter can be wrong about.
 */
class GatedProvider implements LanguageModelProvider {
  inFlight = 0;
  peak = 0;
  readonly started: string[] = [];
  private readonly gates: Array<() => void> = [];
  private readonly inner = new FakeWholeSceneProvider();

  constructor(private readonly failOn: ReadonlySet<string> = new Set()) {}

  async structuredChat(request: StructuredChatRequest): Promise<StructuredChatResult> {
    const scenePayload = JSON.parse(request.messages[1].content) as { sceneId: string };
    this.started.push(scenePayload.sceneId);
    this.inFlight += 1;
    this.peak = Math.max(this.peak, this.inFlight);
    try {
      await new Promise<void>((resolve) => { this.gates.push(resolve); });
      if (this.failOn.has(scenePayload.sceneId)) throw new Error(`scene ${scenePayload.sceneId} refused`);
      return await this.inner.structuredChat(request);
    } finally {
      this.inFlight -= 1;
    }
  }

  embed(text: string): Promise<EmbeddingResult> { return this.inner.embed(text); }

  /** Let every call currently waiting proceed, then yield so the pool can start the next batch. */
  async releaseAll(): Promise<void> {
    for (const gate of this.gates.splice(0)) gate();
    await new Promise((resolve) => { setTimeout(resolve, 0); });
  }
}

/**
 * Run an authoring pass to completion, releasing gated calls as they appear.
 *
 * Driven by whether the pass has SETTLED rather than by whether any call is currently waiting: a
 * worker that has just been released has not yet pushed its successor's gate, so a loop that
 * stopped when the queue looked empty would stop one batch early and hang.
 */
async function runToCompletion<T>(provider: GatedProvider, pass: Promise<T>): Promise<T> {
  let finished = false;
  const settled = pass.finally(() => { finished = true; });
  for (let round = 0; round < 500 && !finished; round += 1) {
    await provider.releaseAll();
  }
  return settled;
}

function memoryStore(): SceneAuthoringStore & { persisted: SceneSimulationResult[] } {
  const persisted: SceneSimulationResult[] = [];
  return {
    persisted,
    // ART-90: this fixture measures nothing, so the attempt recorder is inert.
    recordAuthoringAttempt: () => Promise.resolve(),
    loadPersistedSceneSimulation: (_worldId, _groupingRunId, simulationRunId) =>
      Promise.resolve(persisted.find((entry) => entry.simulationRunId === simulationRunId) ?? null),
    persistSceneSimulation: (_groupingRunId, result) => { persisted.push(result); return Promise.resolve(); },
    budget: unmeteredWorldDayBudgetPort('fake-whole-scene-v2'),
  };
}

/** Run the pool to completion while releasing gated calls, and return what it produced. */
async function authorAll(provider: GatedProvider, scenes: GroupedScene[], limit: number) {
  const store = memoryStore();
  const outcome = await runToCompletion(provider, authorSlotScenes(provider, store, plan(scenes, limit))
    .then(
      (results) => ({ results, error: null as unknown }),
      (error: unknown) => ({ results: [] as SceneSimulationResult[], error }),
    ));
  return { ...outcome, store, provider };
}

describe('AC#1 — the observed peak never exceeds the configured limit', () => {
  it.each([1, 2, 3])('with maxConcurrentCalls = %i, peak in-flight calls stay at or below it', async (limit) => {
    const scenes = [1, 2, 3, 4, 5, 6].map(scene);
    const provider = new GatedProvider();

    const { results, error } = await authorAll(provider, scenes, limit);

    expect(error).toBeNull();
    expect(results).toHaveLength(scenes.length);
    expect(provider.peak).toBeLessThanOrEqual(limit);
    // Guards the guard: a pool that never started more than one call would satisfy every
    // "<= limit" assertion above while enforcing nothing. The peak must actually REACH the limit.
    expect(provider.peak).toBe(limit);
  });

  it('a limit larger than the slot is capped by the scene count, not by the setting', async () => {
    const scenes = [1, 2].map(scene);
    const provider = new GatedProvider();

    await authorAll(provider, scenes, 8);

    expect(provider.peak).toBe(2);
  });

  it('never fans out over the whole slot at once', async () => {
    // The specific shape AC#2 forbids: `Promise.all(scenes.map(author))`. With a limit of 2 and
    // six scenes, an unbounded fan-out would show all six started before any resolved.
    const scenes = [1, 2, 3, 4, 5, 6].map(scene);
    const provider = new GatedProvider();
    const store = memoryStore();

    const running = authorSlotScenes(provider, store, plan(scenes, 2));
    // Nothing has been released yet, so only the pool's first batch can have started.
    await new Promise((resolve) => { setTimeout(resolve, 0); });
    expect(provider.started).toHaveLength(2);

    await runToCompletion(provider, running);
  });
});

describe('AC#3 — commit order is scene order, whatever the gateway does', () => {
  it('returns results in scene order even when calls resolve out of order', async () => {
    const scenes = [1, 2, 3, 4].map(scene);
    // A provider that resolves in reverse: the LAST started call finishes first.
    class ReverseProvider extends GatedProvider {
      override async releaseAll(): Promise<void> {
        const gates = (this as unknown as { gates: Array<() => void> }).gates;
        for (const gate of gates.splice(0).reverse()) gate();
        await new Promise((resolve) => { setTimeout(resolve, 0); });
      }
    }
    const provider = new ReverseProvider();

    const { results, error } = await authorAll(provider, scenes, 4);

    expect(error).toBeNull();
    // The property Canon depends on: sequence numbers are assigned in THIS order, so a replay of
    // the same slot cannot produce a different world because the gateway was differently loaded.
    expect(results.map((result) => result.scene.sceneId)).toEqual(scenes.map((entry) => entry.sceneId));
  });

  it('produces the same ordering at every concurrency level', async () => {
    const scenes = [1, 2, 3, 4, 5, 6].map(scene);
    const orderings: string[][] = [];
    for (const limit of [1, 2, 3, 6]) {
      const { results } = await authorAll(new GatedProvider(), scenes, limit);
      orderings.push(results.map((result) => result.scene.sceneId));
    }

    // Sequential is the reference. Raising the limit must change timing and nothing else.
    for (const ordering of orderings) expect(ordering).toEqual(orderings[0]);
  });
});

describe('AC#4/#5 — a failed call gives its capacity back', () => {
  it('capacity recovers after a call throws, and the remaining scenes still run', async () => {
    const scenes = [1, 2, 3, 4].map(scene);
    const provider = new GatedProvider(new Set([scene(1).sceneId]));

    const { error } = await authorAll(provider, scenes, 2);

    // The slot fails — that is correct, an unauthored scene must not be silently dropped — but
    // the pool did not deadlock on the failed worker's slot.
    expect(error).toBeTruthy();
    expect(provider.inFlight).toBe(0);
    expect(provider.peak).toBeLessThanOrEqual(2);
  });

  it('releases exactly one reservation per granted one, including on the failure path', async () => {
    const scenes = [1, 2, 3, 4].map(scene);
    const granted: string[] = [];
    const resolved: string[] = [];
    const store = memoryStore();
    const counting: SceneAuthoringStore = {
      ...store,
      budget: {
        reserve: (request, decisionId) => {
          granted.push(decisionId);
          return store.budget.reserve(request, decisionId);
        },
        settle: (request, decisionId, settlement) => {
          resolved.push(decisionId);
          return store.budget.settle(request, decisionId, settlement);
        },
        release: (request, decisionId, failure) => {
          resolved.push(decisionId);
          return store.budget.release(request, decisionId, failure);
        },
      },
    };
    const provider = new GatedProvider(new Set([scene(2).sceneId]));

    await runToCompletion(provider,
      authorSlotScenes(provider, counting, plan(scenes, 2)).catch(() => undefined));

    // Exactly once each, and no reservation left outstanding — a granted reservation that is
    // never resolved permanently consumes one of `maxConcurrentCalls` for the world day.
    expect(resolved.sort()).toEqual(granted.sort());
    expect(new Set(resolved).size).toBe(resolved.length);
  });

  it('does not start new scenes once one has failed', async () => {
    const scenes = [1, 2, 3, 4, 5, 6].map(scene);
    const provider = new GatedProvider(new Set([scene(1).sceneId]));

    await authorAll(provider, scenes, 2);

    // Whatever had already started finishes; nothing new begins. Spending a shared key allowance
    // on the rest of a slot that is already going to fail is exactly the waste to avoid.
    expect(provider.started.length).toBeLessThan(scenes.length);
  });
});

describe('the pool preserves what it inherited', () => {
  it('reuses an already-persisted scene without calling the provider', async () => {
    const scenes = [1, 2].map(scene);
    const first = await authorAll(new GatedProvider(), scenes, 2);
    const provider = new GatedProvider();

    const results = await runToCompletion(provider,
      authorSlotScenes(provider, first.store, plan(scenes, 2)));

    expect(provider.started).toHaveLength(0);
    expect(results.map((result) => result.scene.sceneId)).toEqual(scenes.map((entry) => entry.sceneId));
  });

  it('still refuses to author when handed no provider, whatever the limit', async () => {
    await expect(authorSlotScenes(null, memoryStore(), plan([scene(1), scene(2)], 4)))
      .rejects.toMatchObject({ code: SCENE_AUTHORING_DEFERRED });
  });

  it('a limit of zero is read as one rather than authoring nothing', async () => {
    // A configured 0 would otherwise look like a setting while silently producing an empty slot.
    const provider = new GatedProvider();
    const { results, error } = await authorAll(provider, [scene(1)], 0);

    expect(error).toBeNull();
    expect(results).toHaveLength(1);
    expect(provider.peak).toBe(1);
  });
});
