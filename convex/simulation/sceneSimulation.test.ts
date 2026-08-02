import { readFileSync } from 'node:fs';
import type { ProposedEvent } from '../canon/model';
import type { LanguageModelProvider, StructuredChatRequest, StructuredChatResult } from './provider';
import { SimulationProviderError } from './provider';
import type { GroupedScene } from './sceneGrouping';
import { parseWholeSceneOutput, SceneSimulationError, simulateWholeScene } from './sceneSimulation';

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
});
