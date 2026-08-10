/**
 * Deterministic Fake Whole-Scene Provider (FR-C005, no-cost tier).
 *
 *  - No network, no real LLM, no API key — same {@link GroupedScene} always yields the
 *    same {@link WholeSceneOutput}, so the live world-day loop is fully repeatable.
 *  - Same idiom as {@link ./fakeProvider.ts}: a deterministic stand-in that implements the
 *    vendor-neutral capability port, so the real adapter (ART-72) drops in unchanged.
 *  - It only PROPOSES events; nothing here writes Canon (ADR-0001).
 *
 * Unlike the Phase-0 {@link FakeSimulationProvider} (a single movement event), this
 * narrator produces a full multi-character scene: key actions, dialogue, one Proposed
 * Event carrying relationship, memory and fact state changes, plus the derived
 * relationship / knowledge / memory / rumor links FR-C005 requires.
 */

import { CANON_SCHEMA_VERSION, MAX_PUBLIC_SUMMARY_LENGTH } from '../shared/constants';
import type { ProposedEvent, StateChange } from '../canon/model';
import type {
  EmbeddingResult,
  LanguageModelProvider,
  ProviderTraceMetadata,
  StructuredChatRequest,
  StructuredChatResult,
} from './provider';
import { SimulationProviderError } from './provider';
import type { GroupedScene } from './sceneGrouping';

export const FAKE_SCENE_MODEL = 'fake-whole-scene-v1';

/** Deterministic FNV-1a fingerprint used for repeatable "sampling" and fake embeddings. */
function fingerprint(value: string): number {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** Clamp any generated text to the Canon public-summary limit without breaking words. */
function summaryText(value: string): string {
  return value.length <= MAX_PUBLIC_SUMMARY_LENGTH
    ? value
    : `${value.slice(0, MAX_PUBLIC_SUMMARY_LENGTH - 1).trimEnd()}…`;
}

const STANCES = ['weighs the request', 'presses for detail', 'offers a careful trade', 'holds back one fact'] as const;
const READINGS = ['reads the room', 'notes an inconsistency', 'keeps the exchange civil', 'measures the risk'] as const;

const pick = <T>(options: readonly T[], seed: number): T => options[seed % options.length];

/** The Proposed Event a grouped scene contributes to Canon (proposal only, never a write). */
function sceneProposedEvent(scene: GroupedScene, summary: string): ProposedEvent {
  const stateChanges: StateChange[] = [{
    type: 'fact_created',
    subjectType: 'location',
    subjectId: scene.locationId,
    predicate: 'lastMajorSceneSummary',
    value: summary,
    visibility: 'public',
  }];
  for (let index = 0; index + 1 < scene.participantIds.length; index += 1) {
    const sourceCharacterId = scene.participantIds[index];
    const targetCharacterId = scene.participantIds[index + 1];
    const seed = fingerprint(`${scene.sceneId}:${sourceCharacterId}:${targetCharacterId}`);
    stateChanges.push({
      type: 'relationship_changed',
      sourceCharacterId,
      targetCharacterId,
      trustDelta: (seed % 3) - 1,
      affectionDelta: 0,
      resentmentDelta: 0,
      fearDelta: 0,
      dependencyDelta: 0,
      familiarityDelta: 1 + (seed % 2),
      reason: `They spoke directly during the scene at ${scene.locationId}.`,
      // A public summary accompanies this event, so the change must be public too.
      visibility: 'public',
    });
  }
  for (const characterId of scene.participantIds) {
    const seed = fingerprint(`${scene.sceneId}:memory:${characterId}`);
    stateChanges.push({
      type: 'character_memory_formed',
      characterId,
      content: `${characterId} took part in the exchange at ${scene.locationId}.`,
      interpretation: `${characterId} ${pick(READINGS, seed)} and keeps their own goal in view.`,
      importance: ((seed % 5) + 3) / 10,
      emotionalWeight: ((seed % 7) - 3) / 10,
      confidence: ((seed % 4) + 6) / 10,
      visibility: 'trusted',
    });
  }
  return {
    schemaVersion: CANON_SCHEMA_VERSION,
    worldId: scene.worldId,
    idempotencyKey: `${scene.sceneId}:event:1`,
    proposedBy: { type: 'director', id: scene.directorRunId },
    worldDay: scene.worldDay,
    timeSlot: scene.timeSlot,
    eventType: 'conversation',
    locationId: scene.locationId,
    participantIds: [...scene.participantIds],
    causedByEventIds: [],
    publicSummary: summary,
    stateChanges,
    // FR-P004 / ART-132: the Scene whose post-generation safety classification governs this
    // event's public text. The live orchestrator stamps the same key on every real proposal;
    // it is set here too so the deterministic fixture path exercises the identical shape.
    metadata: { sceneId: scene.sceneId },
  };
}

/** Build the complete FR-C005 whole-scene output for one grouped scene. */
export function narrateGroupedScene(scene: GroupedScene): Record<string, unknown> {
  const summary = summaryText(
    `At ${scene.locationId}, ${scene.participantIds.join(' and ')} meet over: ${scene.trigger}`,
  );
  const proposed = sceneProposedEvent(scene, summary);
  return {
    schemaVersion: 1,
    sceneId: scene.sceneId,
    sceneSummary: summaryText(`${summary} The pressure in the room: ${scene.dramaticPressure}`),
    keyActions: scene.participantIds.map((characterId) => ({
      characterId,
      action: `${characterId} ${pick(STANCES, fingerprint(`${scene.sceneId}:action:${characterId}`))}.`,
    })),
    dialogueHighlights: scene.participantIds.map((characterId) => ({
      characterId,
      text: `${characterId}: "We settle this here, before it grows."`,
    })),
    proposedEvents: [proposed],
    relationshipChanges: scene.participantIds.slice(0, -1).map((sourceCharacterId, index) => ({
      sourceCharacterId,
      targetCharacterId: scene.participantIds[index + 1],
      summary: `${sourceCharacterId} and ${scene.participantIds[index + 1]} left the scene more familiar with each other.`,
      proposedEventIndex: 0,
    })),
    knowledgeChanges: scene.participantIds.map((characterId) => ({
      characterId,
      content: `${characterId} learned where the others now stand on: ${scene.trigger}`,
      proposedEventIndex: 0,
    })),
    memories: scene.participantIds.map((characterId) => ({
      characterId,
      content: `${characterId} remembers the exchange at ${scene.locationId}.`,
      proposedEventIndex: 0,
    })),
    rumors: scene.participantIds.slice(0, 1).map((sourceCharacterId) => ({
      sourceCharacterId,
      content: `People at ${scene.locationId} were seen talking at length.`,
      proposedEventIndex: 0,
    })),
    continuityWarnings: [],
  };
}

/**
 * Deterministic {@link LanguageModelProvider} for whole-scene simulation. The request the
 * scene simulator sends carries the serialized {@link GroupedScene} as its user message,
 * which is the only input this provider reads.
 */
export class FakeWholeSceneProvider implements LanguageModelProvider {
  readonly model = FAKE_SCENE_MODEL;

  structuredChat(request: StructuredChatRequest): Promise<StructuredChatResult> {
    if (request.schemaName !== 'whole_scene_output') {
      return Promise.reject(new SimulationProviderError('permanent', 'FAKE_SCENE_UNSUPPORTED_SCHEMA',
        `fake whole-scene provider does not serve schema ${request.schemaName}`));
    }
    const payload = request.messages.find(({ role }) => role === 'user')?.content ?? '';
    let scene: GroupedScene;
    try {
      scene = JSON.parse(payload) as GroupedScene;
    } catch {
      return Promise.reject(new SimulationProviderError('permanent', 'FAKE_SCENE_INVALID_REQUEST',
        'fake whole-scene provider requires a serialized Grouped Scene'));
    }
    const output = narrateGroupedScene(scene);
    return Promise.resolve({ output, trace: this.trace(payload, JSON.stringify(output)) });
  }

  embed(text: string): Promise<EmbeddingResult> {
    const seed = fingerprint(text);
    const embedding = Array.from({ length: 8 }, (_, index) => ((seed >>> index) % 1000) / 1000);
    return Promise.resolve({ embedding, trace: this.trace(text, '') });
  }

  private trace(input: string, output: string): ProviderTraceMetadata {
    // Deterministic, cost-free accounting: no tokens are actually consumed.
    return {
      provider: 'fake',
      model: FAKE_SCENE_MODEL,
      inputTokens: Math.ceil(input.length / 4),
      outputTokens: Math.ceil(output.length / 4),
      latencyMs: 0,
      retryCount: 0,
    };
  }
}
