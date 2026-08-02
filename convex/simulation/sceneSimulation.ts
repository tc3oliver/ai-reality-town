import { normalizeProposedEventOutput } from '../canon/proposedEvent';
import type { ProposedEvent } from '../canon/model';
import { classifyPostGeneration, type PostGenerationClassification } from '../safety/postGeneration';
import { SimulationProviderError, type LanguageModelProvider, type ProviderTraceMetadata } from './provider';
import type { GroupedScene } from './sceneGrouping';

export type SceneAction = { characterId: string; action: string };
export type DialogueHighlight = { characterId: string; text: string };
export type SceneRelationshipChange = { sourceCharacterId: string; targetCharacterId: string; summary: string; proposedEventIndex: number };
export type SceneKnowledgeChange = { characterId: string; content: string; proposedEventIndex: number };
export type SceneMemory = { characterId: string; content: string; proposedEventIndex: number };
export type SceneRumor = { sourceCharacterId: string; content: string; proposedEventIndex: number };

export type WholeSceneOutput = {
  schemaVersion: 1;
  sceneId: string;
  sceneSummary: string;
  keyActions: SceneAction[];
  dialogueHighlights: DialogueHighlight[];
  proposedEvents: ProposedEvent[];
  relationshipChanges: SceneRelationshipChange[];
  knowledgeChanges: SceneKnowledgeChange[];
  memories: SceneMemory[];
  rumors: SceneRumor[];
  continuityWarnings: string[];
};

export type SceneSimulationResult = {
  schemaVersion: 1;
  simulationRunId: string;
  scene: GroupedScene;
  output: WholeSceneOutput;
  safety: PostGenerationClassification;
  reviewStatus: 'not_required' | 'required';
  attemptCount: number;
  trace: ProviderTraceMetadata;
};

export class SceneSimulationError extends Error {
  constructor(readonly code: string, message: string, readonly path?: string) {
    super(`[${code}] ${message}`);
    this.name = 'SceneSimulationError';
  }
}

const record = (value: unknown, path: string, keys: readonly string[]): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new SceneSimulationError('SCENE_OUTPUT_INVALID', 'must be an object', path);
  const result = value as Record<string, unknown>;
  const unknown = Object.keys(result).filter((key) => !keys.includes(key));
  if (unknown.length > 0) throw new SceneSimulationError('SCENE_OUTPUT_INVALID', 'contains unknown fields', path);
  return result;
};
const string = (value: unknown, path: string): string => {
  if (typeof value !== 'string' || value.trim().length === 0) throw new SceneSimulationError('SCENE_OUTPUT_INVALID', 'must be a non-empty string', path);
  return value;
};
const array = (value: unknown, path: string): unknown[] => {
  if (!Array.isArray(value)) throw new SceneSimulationError('SCENE_OUTPUT_INVALID', 'must be an array', path);
  return value;
};
const strings = (value: unknown, path: string): string[] => {
  const parsed = array(value, path).map((item, index) => string(item, `${path}[${index}]`));
  if (new Set(parsed).size !== parsed.length) throw new SceneSimulationError('SCENE_OUTPUT_INVALID', 'must not contain duplicates', path);
  return parsed;
};
const index = (value: unknown, eventCount: number, path: string): number => {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) >= eventCount) {
    throw new SceneSimulationError('SCENE_OUTPUT_INVALID', 'must reference a Proposed Event index', path);
  }
  return value as number;
};
const participant = (value: unknown, scene: GroupedScene, path: string): string => {
  const id = string(value, path);
  if (!scene.participantIds.includes(id)) throw new SceneSimulationError('SCENE_OUTPUT_INVALID', 'character is not a Scene participant', path);
  return id;
};

function parseActions(value: unknown, scene: GroupedScene): SceneAction[] {
  const actions = array(value, 'keyActions').map((item, itemIndex) => {
    const path = `keyActions[${itemIndex}]`; const row = record(item, path, ['characterId', 'action']);
    return { characterId: participant(row.characterId, scene, `${path}.characterId`), action: string(row.action, `${path}.action`) };
  });
  if (actions.length === 0) throw new SceneSimulationError('SCENE_OUTPUT_INVALID', 'at least one key action is required', 'keyActions');
  return actions;
}

function parseDialogue(value: unknown, scene: GroupedScene): DialogueHighlight[] {
  return array(value, 'dialogueHighlights').map((item, itemIndex) => {
    const path = `dialogueHighlights[${itemIndex}]`; const row = record(item, path, ['characterId', 'text']);
    return { characterId: participant(row.characterId, scene, `${path}.characterId`), text: string(row.text, `${path}.text`) };
  });
}

function parseEventLinked<T>(value: unknown, path: string, scene: GroupedScene, eventCount: number,
  parser: (row: Record<string, unknown>, itemPath: string, eventIndex: number) => T): T[] {
  return array(value, path).map((item, itemIndex) => {
    const itemPath = `${path}[${itemIndex}]`;
    const allowed = path === 'relationshipChanges'
      ? ['sourceCharacterId', 'targetCharacterId', 'summary', 'proposedEventIndex']
      : path === 'rumors' ? ['sourceCharacterId', 'content', 'proposedEventIndex']
        : ['characterId', 'content', 'proposedEventIndex'];
    const row = record(item, itemPath, allowed);
    return parser(row, itemPath, index(row.proposedEventIndex, eventCount, `${itemPath}.proposedEventIndex`));
  });
}

export function parseWholeSceneOutput(value: unknown, scene: GroupedScene): WholeSceneOutput {
  const root = record(value, '$', ['schemaVersion', 'sceneId', 'sceneSummary', 'keyActions', 'dialogueHighlights',
    'proposedEvents', 'relationshipChanges', 'knowledgeChanges', 'memories', 'rumors', 'continuityWarnings']);
  if (root.schemaVersion !== 1) throw new SceneSimulationError('SCENE_OUTPUT_INVALID', 'unsupported schema version', 'schemaVersion');
  if (root.sceneId !== scene.sceneId) throw new SceneSimulationError('SCENE_OUTPUT_PROVENANCE_MISMATCH', 'output Scene ID does not match', 'sceneId');
  const proposedEvents = array(root.proposedEvents, 'proposedEvents').map((event, eventIndex) => {
    const parsed = normalizeProposedEventOutput(event);
    if (parsed.worldId !== scene.worldId || parsed.worldDay !== scene.worldDay || parsed.timeSlot !== scene.timeSlot
        || parsed.participantIds.some((id) => !scene.participantIds.includes(id))) {
      throw new SceneSimulationError('SCENE_OUTPUT_PROVENANCE_MISMATCH', 'Proposed Event must remain within the Scene world, slot, and participants', `proposedEvents[${eventIndex}]`);
    }
    return parsed;
  });
  if (new Set(proposedEvents.map(({ idempotencyKey }) => idempotencyKey)).size !== proposedEvents.length) {
    throw new SceneSimulationError('SCENE_OUTPUT_INVALID', 'Proposed Event idempotency keys must be unique', 'proposedEvents');
  }
  const relationshipChanges = parseEventLinked(root.relationshipChanges, 'relationshipChanges', scene, proposedEvents.length,
    (row, path, proposedEventIndex) => ({ sourceCharacterId: participant(row.sourceCharacterId, scene, `${path}.sourceCharacterId`),
      targetCharacterId: participant(row.targetCharacterId, scene, `${path}.targetCharacterId`), summary: string(row.summary, `${path}.summary`), proposedEventIndex }));
  if (relationshipChanges.some(({ sourceCharacterId, targetCharacterId }) => sourceCharacterId === targetCharacterId)) {
    throw new SceneSimulationError('SCENE_OUTPUT_INVALID', 'relationship endpoints must differ', 'relationshipChanges');
  }
  const characterLinked = (row: Record<string, unknown>, path: string, proposedEventIndex: number): SceneKnowledgeChange => ({
    characterId: participant(row.characterId, scene, `${path}.characterId`), content: string(row.content, `${path}.content`), proposedEventIndex,
  });
  return {
    schemaVersion: 1, sceneId: scene.sceneId, sceneSummary: string(root.sceneSummary, 'sceneSummary'),
    keyActions: parseActions(root.keyActions, scene), dialogueHighlights: parseDialogue(root.dialogueHighlights, scene), proposedEvents,
    relationshipChanges,
    knowledgeChanges: parseEventLinked(root.knowledgeChanges, 'knowledgeChanges', scene, proposedEvents.length, characterLinked),
    memories: parseEventLinked(root.memories, 'memories', scene, proposedEvents.length, characterLinked),
    rumors: parseEventLinked(root.rumors, 'rumors', scene, proposedEvents.length,
      (row, path, proposedEventIndex) => ({ sourceCharacterId: participant(row.sourceCharacterId, scene, `${path}.sourceCharacterId`),
        content: string(row.content, `${path}.content`), proposedEventIndex })),
    continuityWarnings: strings(root.continuityWarnings, 'continuityWarnings'),
  };
}

export const WHOLE_SCENE_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object', additionalProperties: false,
  required: ['schemaVersion', 'sceneId', 'sceneSummary', 'keyActions', 'dialogueHighlights', 'proposedEvents',
    'relationshipChanges', 'knowledgeChanges', 'memories', 'rumors', 'continuityWarnings'],
  properties: {
    schemaVersion: { const: 1 }, sceneId: { type: 'string' }, sceneSummary: { type: 'string' },
    keyActions: { type: 'array', items: { type: 'object' } }, dialogueHighlights: { type: 'array', items: { type: 'object' } },
    proposedEvents: { type: 'array', items: { type: 'object' } }, relationshipChanges: { type: 'array', items: { type: 'object' } },
    knowledgeChanges: { type: 'array', items: { type: 'object' } }, memories: { type: 'array', items: { type: 'object' } },
    rumors: { type: 'array', items: { type: 'object' } }, continuityWarnings: { type: 'array', items: { type: 'string' } },
  },
};

function publicText(output: WholeSceneOutput): string {
  return [output.sceneSummary, ...output.keyActions.map(({ action }) => action), ...output.dialogueHighlights.map(({ text }) => text),
    ...output.relationshipChanges.map(({ summary }) => summary), ...output.knowledgeChanges.map(({ content }) => content),
    ...output.memories.map(({ content }) => content), ...output.rumors.map(({ content }) => content), ...output.continuityWarnings,
    ...output.proposedEvents.map(({ publicSummary }) => publicSummary ?? '')].join(' ');
}

export function finalizeWholeSceneOutput(simulationRunId: string, scene: GroupedScene, output: WholeSceneOutput,
  attemptCount: number, trace: ProviderTraceMetadata): SceneSimulationResult {
  const safety = classifyPostGeneration({ classificationId: `${simulationRunId}:safety`, worldId: scene.worldId,
    sourceId: scene.sceneId, kind: 'scene', text: publicText(output),
    coreFactIds: output.proposedEvents.map(({ idempotencyKey }) => idempotencyKey) });
  return { schemaVersion: 1, simulationRunId, scene: structuredClone(scene), output: structuredClone(output), safety,
    reviewStatus: safety.label === 'withhold' || safety.label === 'human_review_required' ? 'required' : 'not_required',
    attemptCount, trace: { ...trace } };
}

export async function simulateWholeScene(provider: LanguageModelProvider, simulationRunId: string, scene: GroupedScene,
  maxAttempts = 2): Promise<SceneSimulationResult> {
  if (simulationRunId.trim().length === 0 || !Number.isSafeInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 3) {
    throw new SceneSimulationError('SCENE_SIMULATION_INVALID', 'valid Run ID and 1-3 attempts are required');
  }
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await provider.structuredChat({
        messages: [{ role: 'system', content: 'Simulate the entire grouped scene once. Return structured JSON only. You may propose events but never commit or mutate Canon.' },
          { role: 'user', content: JSON.stringify(scene) }],
        schemaName: 'whole_scene_output', jsonSchema: WHOLE_SCENE_JSON_SCHEMA, temperature: 0.4, maxTokens: 4_000,
      });
      const output = parseWholeSceneOutput(response.output, scene);
      return finalizeWholeSceneOutput(simulationRunId, scene, output, attempt,
        { ...response.trace, retryCount: response.trace.retryCount + attempt - 1 });
    } catch (error) {
      lastError = error;
      const retryable = error instanceof SceneSimulationError
        || (error instanceof SimulationProviderError && error.kind === 'transient');
      if (!retryable || attempt === maxAttempts) break;
    }
  }
  if (lastError instanceof SceneSimulationError) throw lastError;
  if (lastError instanceof SimulationProviderError) throw lastError;
  throw new SceneSimulationError('SCENE_SIMULATION_FAILED', 'whole-scene provider failed');
}
