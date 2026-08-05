import { readFileSync } from 'node:fs';
import type { ProposedEvent } from '../canon/model';
import { OpenAICompatibleProvider } from './providers/openAICompatible';
import type { OpenAICompatibleConfig } from './providers/config';
import type { LanguageModelProvider, StructuredChatRequest, StructuredChatResult } from './provider';
import { SimulationProviderError } from './provider';
import type { GroupedScene } from './sceneGrouping';
import { parseWholeSceneOutput, SceneSimulationError, simulateWholeScene, WHOLE_SCENE_JSON_SCHEMA } from './sceneSimulation';

const scene: GroupedScene = {
  schemaVersion: 1, sceneId: 'group-1:scene:1', groupingRunId: 'group-1', directorRunId: 'director-1',
  worldId: 'mistwood', worldDay: 2, timeSlot: 'evening', locationId: 'mistwood-station',
  participantIds: ['lin-yingxue', 'wu-zhen'], sourceIntentIds: ['intent-1', 'intent-2'],
  arcIds: ['arc-station-ledger'], trigger: 'Open the sealed locker', dramaticPressure: 'The mayor arrives at dusk',
};

const proposal = (): ProposedEvent => ({
  schemaVersion: 1, worldId: 'mistwood', idempotencyKey: 'scene:group-1:1', proposedBy: { type: 'system' },
  worldDay: 2, timeSlot: 'evening', eventType: 'discovery', participantIds: ['lin-yingxue', 'wu-zhen'],
  causedByEventIds: [], publicSummary: 'Yingxue and Wu Zhen open the station locker.',
  stateChanges: [{ type: 'fact_created', subjectType: 'location', subjectId: 'mistwood-station',
    predicate: 'lockerOpened', value: true, visibility: 'public' }],
});

const output = (summary = 'Yingxue opens the locker while Wu Zhen watches.'): unknown => ({
  schemaVersion: 1, sceneId: scene.sceneId, sceneSummary: summary,
  keyActions: [{ characterId: 'lin-yingxue', action: 'Turns the locker key.' }],
  dialogueHighlights: [{ characterId: 'wu-zhen', text: 'That is the envelope I delivered.' }],
  proposedEvents: [proposal()],
  relationshipChanges: [{ sourceCharacterId: 'lin-yingxue', targetCharacterId: 'wu-zhen', summary: 'Yingxue trusts his admission.', proposedEventIndex: 0 }],
  knowledgeChanges: [{ characterId: 'lin-yingxue', content: 'Wu Zhen delivered the envelope.', proposedEventIndex: 0 }],
  memories: [{ characterId: 'wu-zhen', content: 'Yingxue opened the locker.', proposedEventIndex: 0 }],
  rumors: [{ sourceCharacterId: 'wu-zhen', content: 'The old locker was opened.', proposedEventIndex: 0 }],
  continuityWarnings: [],
});

class SequenceProvider implements LanguageModelProvider {
  calls: StructuredChatRequest[] = [];
  constructor(private readonly results: unknown[]) {}
  structuredChat(request: StructuredChatRequest): Promise<StructuredChatResult> {
    this.calls.push(request);
    const next = this.results.shift();
    if (next instanceof Error) return Promise.reject(next);
    return Promise.resolve({ output: next, trace: { provider: 'fake', model: 'scene-fake-v1', inputTokens: 10,
      outputTokens: 20, latencyMs: 1, retryCount: 0 } });
  }
  embed(): Promise<never> { return Promise.reject(new Error('not used')); }
}

describe('FR-C005 whole-scene simulation', () => {
  it('simulates the whole scene once and runtime-validates every required output and Proposed Event', async () => {
    const provider = new SequenceProvider([output()]);
    const result = await simulateWholeScene(provider, 'simulation-1', scene, 2);
    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0].messages[1].content).toContain(scene.sceneId);
    expect(provider.calls[0].messages[1].content).toContain('lin-yingxue');
    expect(result).toMatchObject({ schemaVersion: 1, simulationRunId: 'simulation-1', attemptCount: 1,
      reviewStatus: 'not_required', safety: { label: 'allow' }, output: { sceneId: scene.sceneId } });
    expect(result.output.proposedEvents).toHaveLength(1);
    expect(result.output.relationshipChanges).toHaveLength(1);
    expect(result.output.knowledgeChanges).toHaveLength(1);
    expect(result.output.memories).toHaveLength(1);
    expect(result.output.rumors).toHaveLength(1);
  });

  it('retries malformed structured output as one whole-scene attempt and then succeeds', async () => {
    const provider = new SequenceProvider([{ schemaVersion: 1, sceneId: scene.sceneId }, output()]);
    const result = await simulateWholeScene(provider, 'simulation-retry', scene, 2);
    expect(provider.calls).toHaveLength(2);
    expect(result.attemptCount).toBe(2);
    expect(result.trace.retryCount).toBe(1);
  });

  it('fails after the bounded invalid-output retry budget and does not accept unknown or foreign data', async () => {
    const bad = { ...(output() as Record<string, unknown>), administrativeOverride: true };
    const provider = new SequenceProvider([bad, bad]);
    await expect(simulateWholeScene(provider, 'simulation-invalid', scene, 2)).rejects
      .toMatchObject({ code: 'SCENE_OUTPUT_INVALID' });
    expect(provider.calls).toHaveLength(2);

    const foreign = output() as Record<string, unknown>;
    foreign.proposedEvents = [{ ...proposal(), worldId: 'other-world' }];
    expect(() => parseWholeSceneOutput(foreign, scene)).toThrow(/Scene world, slot, and participants/);
  });

  it('retries transient providers but immediately rejects permanent provider failures', async () => {
    const transient = new SequenceProvider([new SimulationProviderError('transient', 'TEMP', 'temporary'), output()]);
    await expect(simulateWholeScene(transient, 'simulation-transient', scene, 2)).resolves.toMatchObject({ attemptCount: 2 });
    const permanent = new SequenceProvider([new SimulationProviderError('permanent', 'NO', 'rejected'), output()]);
    await expect(simulateWholeScene(permanent, 'simulation-permanent', scene, 2)).rejects.toMatchObject({ code: 'NO' });
    expect(permanent.calls).toHaveLength(1);
  });

  it('routes high-risk output to safety review and retains no public/raw-output API', async () => {
    const provider = new SequenceProvider([output('The scene contains graphic torture.')]);
    const result = await simulateWholeScene(provider, 'simulation-risk', scene);
    expect(result).toMatchObject({ reviewStatus: 'required', safety: { label: 'withhold', reasonCodes: ['EXTREME_VIOLENCE_DETAIL'] } });
    const functions = readFileSync('convex/simulation/sceneSimulationFunctions.ts', 'utf8');
    const service = readFileSync('convex/simulation/sceneSimulation.ts', 'utf8');
    expect(functions).toContain('internalMutation({');
    expect(functions).toContain('internalQuery({');
    expect(functions).not.toMatch(/\bmutation\(\{|\bquery\(\{|rawOutput|providerOutput/);
    expect(service).not.toMatch(/commitProposedEvent|insert\(['"]canonEvents|reduceWorldEvent/);
  });

  it('rejects invalid Scene provenance and unlinked changes with stable validation errors', () => {
    expect(() => parseWholeSceneOutput({ ...(output() as Record<string, unknown>), sceneId: 'other' }, scene))
      .toThrow(SceneSimulationError);
    const unlinked = output() as Record<string, unknown>;
    unlinked.knowledgeChanges = [{ characterId: 'lin-yingxue', content: 'Impossible', proposedEventIndex: 9 }];
    expect(() => parseWholeSceneOutput(unlinked, scene)).toThrow(/Proposed Event index/);
  });

  describe('ART-139 real-provider schemaVersion contract (FR-C002)', () => {
    const providerConfig: OpenAICompatibleConfig = { apiUrl: 'https://llm.example/v1',
      chatUrl: 'https://llm.example/v1/chat/completions', embeddingUrl: 'https://llm.example/v1/embeddings',
      chatModel: 'chat-model', embeddingModel: 'embed-model', embeddingDimension: 3, apiKey: 'k',
      allowUnauthenticated: false, timeoutMs: 100, maxAttempts: 1 };
    const asChatResponse = (body: unknown) => new Response(
      JSON.stringify({ choices: [{ message: { content: JSON.stringify(body) } }], usage: {} }),
      { status: 200, headers: { 'content-type': 'application/json' } });

    // A strict-mode JSON Schema compiler that drops an under-typed `{ const: 1 }` (no declared `type`)
    // commonly stringifies the sentinel instead of emitting the integer -- this is the shape observed
    // against the real provider in ART-106's smoke test. This is a permanent regression test for ART-139.
    it('parses the real-provider schemaVersion shape ("1" as a string) via the tolerated normalization', async () => {
      const provider = new OpenAICompatibleProvider(providerConfig, { fetch: () =>
        Promise.resolve(asChatResponse({ ...(output() as Record<string, unknown>), schemaVersion: '1' })) });
      const chat = await provider.structuredChat({ messages: [{ role: 'user', content: 'simulate' }],
        schemaName: 'whole_scene_output', jsonSchema: WHOLE_SCENE_JSON_SCHEMA, temperature: 0.4, maxTokens: 4_000 });
      const result = parseWholeSceneOutput(chat.output, scene);
      expect(result.schemaVersion).toBe(1);
    });

    it('rejects a genuinely wrong schemaVersion with a precise, distinct field path', () => {
      expect(() => parseWholeSceneOutput({ ...(output() as Record<string, unknown>), schemaVersion: 2 }, scene))
        .toThrow(SceneSimulationError);
      try {
        parseWholeSceneOutput({ ...(output() as Record<string, unknown>), schemaVersion: 2 }, scene);
        throw new Error('expected SceneSimulationError');
      } catch (error) {
        expect(error).toBeInstanceOf(SceneSimulationError);
        expect((error as SceneSimulationError).path).toBe('schemaVersion');
      }
    });

    // Confirmed against the real provider: schemaVersion is commonly omitted entirely, not just
    // sent as the wrong type. It is a caller-known constant (always 1), so a missing value is
    // defaulted rather than rejected -- this is the actual real-provider shape, not a hypothesis.
    it('defaults a missing schemaVersion to 1 instead of rejecting it (confirmed real-provider shape)', () => {
      const missing = output() as Record<string, unknown>;
      delete missing.schemaVersion;
      expect(parseWholeSceneOutput(missing, scene).schemaVersion).toBe(1);
    });

    it('defaults a missing sceneId to the Scene ID already known from the request (confirmed real-provider shape)', () => {
      const missing = output() as Record<string, unknown>;
      delete missing.sceneId;
      expect(parseWholeSceneOutput(missing, scene).sceneId).toBe(scene.sceneId);
    });

    it('rejects an unknown field inside a nested collection with its own precise field path', () => {
      const badRelationship = output() as Record<string, unknown>;
      badRelationship.relationshipChanges = [{ sourceCharacterId: 'lin-yingxue', targetCharacterId: 'wu-zhen',
        summary: 'x', proposedEventIndex: 0, confidence: 0.9 }];
      try {
        parseWholeSceneOutput(badRelationship, scene);
        throw new Error('expected SceneSimulationError');
      } catch (error) {
        expect(error).toBeInstanceOf(SceneSimulationError);
        expect((error as SceneSimulationError).path).toBe('relationshipChanges[0]');
      }
    });

    it('declares nested item properties in the request schema matching every parser allowed-key list', () => {
      const properties = WHOLE_SCENE_JSON_SCHEMA.properties as Record<string, Record<string, unknown>>;
      expect(properties.schemaVersion).toMatchObject({ type: 'integer', const: 1 });
      for (const key of ['keyActions', 'dialogueHighlights', 'relationshipChanges', 'knowledgeChanges', 'memories', 'rumors', 'proposedEvents']) {
        const items = properties[key].items as Record<string, unknown>;
        expect(items.additionalProperties).toBe(false);
        expect(Array.isArray(items.required)).toBe(true);
      }
    });
  });
});
