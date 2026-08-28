/**
 * The claim that makes FR-K005 AC#1 true rather than decorative (ART-52).
 *
 * "Operators can configure Model, Prompt Version, Temperature, Token Limit, Timeout, Retry,
 * Fallback and Daily Budget per module" is not settled by a stored row, a resolver that returns
 * it, or a console that echoes it back. Every one of those is satisfied by a configuration the
 * call path ignores. So the assertions here are made on what `structuredChat` was ACTUALLY
 * called with, after running the real `simulate_scenes` stage handler over a real port.
 *
 * The second half is the mirror claim, and it is the one that makes this change safe to ship:
 * an unconfigured world still gets 0.4 / 4_000 / 2 semantic attempts — the literals that were
 * hardcoded before the table existed.
 *
 * What is deliberately NOT asserted, because it is not true and should not be implied:
 * `fallbackModel` and `dailyTokenBudget` reach no call. They are configured, versioned and
 * readable, and nothing acts on them — ART-59 (FR-M003) owns budget enforcement and ART-91 owns
 * the degradation ordering. `wholeSceneOptionsFor` omits them for exactly that reason, and the
 * last block pins the omission so a future change cannot start passing them silently.
 */

import type { ProposedEvent } from '../canon/model';
import { InMemoryCanonStore } from '../canon/inMemoryStore';
import {
  MODULE_MODEL_DEFAULTS,
  resolveEffectiveModuleConfig,
  SCENE_SIMULATION_PROMPT_VERSION_IDS,
  type ConfigurableModule,
  type EffectiveModuleConfig,
} from '../shared/moduleModelConfig';
import { resolveModuleConfig, wholeSceneOptionsFor } from './moduleConfig';
import { PROMPT_VERSIONS, selectWholeScenePrompt } from './promptVersions';
import { SimulationProviderError } from './provider';
import type { LanguageModelProvider, StructuredChatRequest, StructuredChatResult } from './provider';
import type { GroupedScene, SceneGroupingResult } from './sceneGrouping';
import { wholeSceneSystemPrompt } from './sceneSimulation';
import {
  createWorldDayStageHandlers,
  type GroupingArtifact,
  type LiveWorldSnapshot,
  type SimulationArtifact,
  type WorldDayLivePort,
  type WorldStateArtifact,
  unmeteredWorldDayBudgetPort,
} from './worldDayLive';
import type { StageContext } from './worldDayOrchestration';

const WORLD_ID = 'mistwood';

const scene: GroupedScene = {
  schemaVersion: 1, sceneId: 'group-1:scene:1', groupingRunId: 'group-1', directorRunId: 'director-1',
  worldId: WORLD_ID, worldDay: 2, timeSlot: 'evening', locationId: 'mistwood-station',
  participantIds: ['lin-yingxue', 'wu-zhen'], sourceIntentIds: ['intent-1', 'intent-2'],
  arcIds: ['arc-station-ledger'], trigger: 'Open the sealed locker',
  dramaticPressure: 'The mayor arrives at dusk',
};

const proposal = (): ProposedEvent => ({
  schemaVersion: 1, worldId: WORLD_ID, idempotencyKey: 'scene:group-1:1', proposedBy: { type: 'system' },
  worldDay: 2, timeSlot: 'evening', eventType: 'discovery', participantIds: ['lin-yingxue', 'wu-zhen'],
  causedByEventIds: [], publicSummary: '英雪與吳振打開了車站的置物櫃。',
  stateChanges: [{ type: 'fact_created', subjectType: 'location', subjectId: 'mistwood-station',
    predicate: 'lockerOpened', value: true, visibility: 'public' }],
});

const sceneOutput = (): unknown => ({
  schemaVersion: 1, sceneId: scene.sceneId, sceneSummary: '英雪打開置物櫃，吳振在旁看著。',
  keyActions: [{ characterId: 'lin-yingxue', action: '轉動置物櫃鑰匙。' }],
  dialogueHighlights: [{ characterId: 'wu-zhen', text: '那就是我送來的信封。' }],
  proposedEvents: [proposal()],
  relationshipChanges: [], knowledgeChanges: [], memories: [], rumors: [], continuityWarnings: [],
});

/** Records every request the stage actually made, which is the only thing asserted on. */
class RecordingProvider implements LanguageModelProvider {
  readonly calls: StructuredChatRequest[] = [];
  structuredChat(request: StructuredChatRequest): Promise<StructuredChatResult> {
    this.calls.push(request);
    return Promise.resolve({
      output: sceneOutput(),
      trace: { provider: 'fake', model: 'scene-fake-v1', inputTokens: 10, outputTokens: 20, latencyMs: 1, retryCount: 0 },
    });
  }
  embed(): Promise<never> { return Promise.reject(new Error('not used')); }
}

const snapshot = (): LiveWorldSnapshot => ({
  worldId: WORLD_ID, lastSequenceNumber: 0, characters: [], activeArcs: [],
  recentMajorEventIds: [], environmentFactIds: [], viewerInterventionEventIds: [],
  protectedFactIds: [], repetitionScore: 0,
});

/**
 * A port whose ONLY interesting method is `loadModuleConfig`. Everything else is the minimum the
 * `simulate_scenes` stage touches, so a failure here can only be about configuration selection.
 */
function portWith(config: EffectiveModuleConfig): WorldDayLivePort & { requested: ConfigurableModule[] } {
  const requested: ConfigurableModule[] = [];
  return {
    requested,
    // ART-59 requires every port to state whether it meters spend. This fixture does not:
    // it exercises a different capability, and an unmetered gate keeps its behaviour
    // identical to before ART-59 while leaving the choice visible rather than absent.
    budget: unmeteredWorldDayBudgetPort(),
    canonStore: new InMemoryCanonStore(),
    loadWorldSnapshot: () => Promise.resolve(snapshot()),
    loadScheduledEnvironmentEvents: () => Promise.resolve([]),
    markScheduledEnvironmentEventApplied: () => Promise.resolve(),
    persistDirectorPlan: () => Promise.resolve(),
    persistCharacterIntent: () => Promise.resolve(),
    persistGroupedScenes: () => Promise.resolve(),
    persistSceneSimulation: () => Promise.resolve(),
    loadModuleConfig: (_worldId, module) => {
      requested.push(module);
      return Promise.resolve(config);
    },
  };
}

const groupingArtifact = (): GroupingArtifact => ({
  groupingRunId: 'group-1',
  result: { scenes: [scene], decisions: [] } satisfies SceneGroupingResult,
});

const stageContext = (): StageContext => ({
  runId: `${WORLD_ID}:2:evening`, worldId: WORLD_ID, worldDay: 2, timeSlot: 'evening',
  artifacts: {
    load_world_state: { snapshot: snapshot() } satisfies WorldStateArtifact,
    group_intents_into_scenes: groupingArtifact(),
  },
});

/** Run the real stage handler and hand back what the provider was asked for. */
async function runSimulateScenes(config: EffectiveModuleConfig) {
  const provider = new RecordingProvider();
  const port = portWith(config);
  const handlers = createWorldDayStageHandlers(port, provider);
  const artifact = await handlers.simulate_scenes(stageContext()) as SimulationArtifact;
  return { provider, port, artifact };
}

const configured = (over: Partial<EffectiveModuleConfig> = {}): EffectiveModuleConfig => ({
  module: 'scene_simulation', source: 'configured', version: 3,
  ...MODULE_MODEL_DEFAULTS.scene_simulation,
  ...over,
});

// ---------------------------------------------------------------------------

describe('AC#1 — the configured values reach the provider call, not the hardcoded constants', () => {
  it('sends the configured temperature and token limit, not 0.4 / 4_000', async () => {
    const { provider } = await runSimulateScenes(configured({ temperature: 1.15, maxTokens: 777 }));
    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0].temperature).toBe(1.15);
    expect(provider.calls[0].maxTokens).toBe(777);
    // Stated negatively as well: these ARE the numbers that used to be literals, and the whole
    // point is that they are no longer what the call carries.
    expect(provider.calls[0].temperature).not.toBe(0.4);
    expect(provider.calls[0].maxTokens).not.toBe(4_000);
  });

  it('sends the configured model, timeout and transport retry budget as per-request overrides', async () => {
    const { provider } = await runSimulateScenes(configured({
      model: 'a-configured-model', timeoutMs: 12_345, transportMaxAttempts: 5,
    }));
    expect(provider.calls[0]).toMatchObject({
      model: 'a-configured-model', timeoutMs: 12_345, maxAttempts: 5,
    });
  });

  it('omits the model override entirely when the module inherits the deployment model', async () => {
    // `null` means "use whatever `LLM_MODEL` is", which is a different statement from any string.
    // Sending `model: null` would override the instance with nothing.
    const { provider } = await runSimulateScenes(configured({ model: null }));
    expect(provider.calls[0].model).toBeUndefined();
  });

  it('honours the configured SEMANTIC retry budget, which is a different number from the transport one', async () => {
    // Two independent retry layers, and the configuration keeps them distinguishable. A provider
    // that always returns unparseable content exhausts the semantic budget exactly.
    class UnparseableProvider implements LanguageModelProvider {
      readonly calls: StructuredChatRequest[] = [];
      structuredChat(request: StructuredChatRequest): Promise<StructuredChatResult> {
        this.calls.push(request);
        return Promise.resolve({
          output: { not: 'a scene' },
          trace: { provider: 'fake', model: 'm', inputTokens: 0, outputTokens: 0, latencyMs: 0, retryCount: 0 },
        });
      }
      embed(): Promise<never> { return Promise.reject(new Error('not used')); }
    }
    const provider = new UnparseableProvider();
    const handlers = createWorldDayStageHandlers(
      portWith(configured({ semanticMaxAttempts: 3, transportMaxAttempts: 1 })), provider,
    );
    await expect(handlers.simulate_scenes(stageContext())).rejects.toThrow();
    expect(provider.calls).toHaveLength(3);
  });

  it('sends the prompt body the configured Prompt Version names', async () => {
    const { provider } = await runSimulateScenes(configured({ promptVersion: 'scene_simulation.v1' }));
    expect(provider.calls[0].messages[0].content).toBe(PROMPT_VERSIONS['scene_simulation.v1'](scene));
    // Selection is by ID through the registry, for every registered version — so this keeps
    // meaning "the configured version was selected" once a v2 exists rather than only pinning v1.
    for (const [id, build] of Object.entries(PROMPT_VERSIONS)) {
      expect(selectWholeScenePrompt(id)(scene)).toBe(build(scene));
    }
  });

  it('throws when a caller BYPASSES the resolver with an unregistered id', () => {
    // Scoped deliberately to what it proves. This is the guard for a direct caller, NOT the
    // retired-prompt policy — a configured world never reaches it, because
    // `resolveEffectiveModuleConfig` substitutes the defaults first (asserted below).
    for (const versionId of ['scene_simulation.v99', null]) {
      let thrown: unknown;
      try { selectWholeScenePrompt(versionId); } catch (error) { thrown = error; }
      expect(thrown).toBeInstanceOf(SimulationProviderError);
      // Permanent, not transient: retrying cannot register a prompt.
      expect(thrown).toMatchObject({ code: 'PROMPT_VERSION_UNKNOWN', kind: 'permanent' });
    }
  });

  it('runs the DEFAULT prompt, and reports doing so, when a stored version was retired', async () => {
    // The actual end-to-end behaviour, asserted through the same stage handler as everything
    // else rather than by calling the resolver. A retired prompt must not halt a world; it must
    // fall back visibly, so the console's `source: 'default'` and the runtime agree.
    const retired = resolveEffectiveModuleConfig('scene_simulation', {
      ...MODULE_MODEL_DEFAULTS.scene_simulation,
      promptVersion: 'scene_simulation.v0' as never, temperature: 1.9, version: 6,
    });
    expect(retired).toMatchObject({ source: 'default', version: null });
    const { provider } = await runSimulateScenes(retired);
    expect(provider.calls[0].messages[0].content).toBe(wholeSceneSystemPrompt(scene));
    // The whole row is discarded, not just its prompt id — the configured 1.9 does not survive.
    expect(provider.calls[0].temperature).toBe(0.4);
  });

  it('registers a builder for every declared whole-scene prompt version', () => {
    // Closes the drift the `satisfies` clause is claimed to close, at runtime as well as at
    // compile time: an id declared with no builder would be accepted by the operator write and
    // would then throw on every world-day slot with no earlier signal.
    expect(Object.keys(PROMPT_VERSIONS).sort())
      .toEqual([...SCENE_SIMULATION_PROMPT_VERSION_IDS].sort());
    for (const id of SCENE_SIMULATION_PROMPT_VERSION_IDS) {
      expect(typeof selectWholeScenePrompt(id)).toBe('function');
    }
  });

  it('reads the configuration once per slot, for the scene-simulation module', async () => {
    const { port } = await runSimulateScenes(configured());
    expect(port.requested).toEqual(['scene_simulation']);
  });
});

describe('AC#1 — an unconfigured world keeps today\'s exact behaviour', () => {
  it('sends 0.4 / 4_000 and the v1 prompt when no configuration row exists', async () => {
    const { provider } = await runSimulateScenes({
      module: 'scene_simulation', source: 'default', version: null,
      ...MODULE_MODEL_DEFAULTS.scene_simulation,
    });
    expect(provider.calls[0].temperature).toBe(0.4);
    expect(provider.calls[0].maxTokens).toBe(4_000);
    expect(provider.calls[0].messages[0].content).toBe(wholeSceneSystemPrompt(scene));
  });

  it('sends NO model, timeout or transport-retry override, so the deployment env still decides', async () => {
    // The assertion this file was missing, and the reason a real regression passed it: these
    // three are the settings backed by `LLM_MODEL` / `LLM_TIMEOUT_MS` / `LLM_MAX_ATTEMPTS`, and
    // `OpenAICompatibleProvider` resolves `overrides.x ?? this.config.x` — so a present key,
    // even one holding the "right" default, silently beats the deployment variable. Absent is
    // the only value that preserves it.
    const { provider } = await runSimulateScenes({
      module: 'scene_simulation', source: 'default', version: null,
      ...MODULE_MODEL_DEFAULTS.scene_simulation,
    });
    expect(provider.calls[0].model).toBeUndefined();
    expect(provider.calls[0].timeoutMs).toBeUndefined();
    expect(provider.calls[0].maxAttempts).toBeUndefined();
    // Stated structurally too: the request carries no key at all for them, so a later change
    // that started sending `undefined` explicitly would still be caught.
    expect(Object.keys(provider.calls[0]))
      .toEqual(['messages', 'schemaName', 'jsonSchema', 'temperature', 'maxTokens']);
  });

  it('omits an env-backed override the moment a module sets it back to null', async () => {
    // A world that HAD configured a timeout and then cleared it must return to the deployment
    // value, not to a table default.
    const { provider } = await runSimulateScenes(configured({
      timeoutMs: null, transportMaxAttempts: null, model: null,
    }));
    expect(provider.calls[0]).not.toHaveProperty('timeoutMs');
    expect(provider.calls[0]).not.toHaveProperty('maxAttempts');
    expect(provider.calls[0]).not.toHaveProperty('model');
  });

  it('allows 2 semantic attempts by default, exactly as `simulateWholeScene` always did', () => {
    expect(wholeSceneOptionsFor({
      module: 'scene_simulation', source: 'default', version: null,
      ...MODULE_MODEL_DEFAULTS.scene_simulation,
    }).maxAttempts).toBe(2);
  });

  it('resolves to the defaults when the database holds no row for the world', async () => {
    const db = fakeDb([]);
    await expect(resolveModuleConfig(db, WORLD_ID, 'scene_simulation')).resolves.toEqual({
      module: 'scene_simulation', source: 'default', version: null,
      ...MODULE_MODEL_DEFAULTS.scene_simulation,
    });
  });

  it('resolves the stored current version when one exists', async () => {
    const db = fakeDb([{
      worldId: WORLD_ID, module: 'scene_simulation', isCurrent: true, version: 4,
      ...MODULE_MODEL_DEFAULTS.scene_simulation, temperature: 1.4, maxTokens: 512,
    }]);
    await expect(resolveModuleConfig(db, WORLD_ID, 'scene_simulation')).resolves.toMatchObject({
      source: 'configured', version: 4, temperature: 1.4, maxTokens: 512,
    });
  });
});

describe('scope boundary — Fallback and Daily Budget are configured, never applied here', () => {
  it('does not pass the fallback model or the daily budget into the call options', () => {
    const options = wholeSceneOptionsFor(configured({
      fallbackModel: 'a-cheaper-model', dailyTokenBudget: 100_000,
    }));
    // Passing values a call cannot honour would look like they were being applied. ART-59
    // (FR-M003) owns budget enforcement; ART-91 owns the degradation ordering.
    // `timeoutMs` and `transportMaxAttempts` are absent because this fixture leaves them `null`
    // (inherit the deployment value); the block above pins that separately. What matters here is
    // that the two ART-59/ART-91 settings are absent no matter what they hold.
    expect(Object.keys(options).sort())
      .toEqual(['buildSystemPrompt', 'maxAttempts', 'maxTokens', 'temperature']);
    expect(options).not.toHaveProperty('fallbackModel');
    expect(options).not.toHaveProperty('dailyTokenBudget');
  });

  it('still stores and reports them, so the tasks that own enforcement have something to read', async () => {
    const config = configured({ fallbackModel: 'a-cheaper-model', dailyTokenBudget: 100_000 });
    expect(config.fallbackModel).toBe('a-cheaper-model');
    expect(config.dailyTokenBudget).toBe(100_000);
    const { provider } = await runSimulateScenes(config);
    // …and neither reaches the wire.
    expect(JSON.stringify(provider.calls[0])).not.toContain('a-cheaper-model');
  });
});

/** The slice of `ctx.db` {@link resolveModuleConfig} uses: one indexed point lookup. */
function fakeDb(rows: Array<Record<string, unknown>>) {
  return {
    query() {
      return {
        withIndex(_index: string, build: (q: unknown) => unknown) {
          const constraints: Record<string, unknown> = {};
          const builder = { eq(field: string, value: unknown) { constraints[field] = value; return builder; } };
          build(builder);
          const matched = rows.filter((row) =>
            Object.entries(constraints).every(([field, value]) => row[field] === value));
          return { unique: () => Promise.resolve(matched[0] ?? null) };
        },
      };
    },
  } as unknown as Parameters<typeof resolveModuleConfig>[0];
}
