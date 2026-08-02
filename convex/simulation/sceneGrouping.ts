import { isTimeSlot, type TimeSlot } from '../canon/eventTypes';
import type { CharacterIntent, IntentValidationResult } from './characterIntent';

export const MAX_MAJOR_SCENE_PARTICIPANTS = 6;

export type SceneGroupingInput = {
  schemaVersion: 1;
  groupingRunId: string;
  directorRunId: string;
  worldId: string;
  worldDay: number;
  timeSlot: TimeSlot;
  intents: IntentValidationResult[];
};

export type GroupedScene = {
  schemaVersion: 1;
  sceneId: string;
  groupingRunId: string;
  directorRunId: string;
  worldId: string;
  worldDay: number;
  timeSlot: TimeSlot;
  locationId: string;
  participantIds: string[];
  sourceIntentIds: string[];
  arcIds: string[];
  trigger: string;
  dramaticPressure: string;
};

export type IntentGroupingDecision = {
  intentId: string;
  disposition: 'grouped' | 'deferred';
  sceneId: string | null;
  reason: string;
};

export type SceneGroupingResult = { scenes: GroupedScene[]; decisions: IntentGroupingDecision[] };

export class SceneGroupingError extends Error {
  constructor(readonly code: string, message: string) {
    super(`[${code}] ${message}`);
    this.name = 'SceneGroupingError';
  }
}

const uniqueSorted = (values: readonly string[]): string[] => [...new Set(values)].sort((a, b) => a.localeCompare(b));
const participantIds = (intent: CharacterIntent): string[] => uniqueSorted([
  intent.characterId, ...(intent.targetCharacterId ? [intent.targetCharacterId] : []),
]);
const intersects = (left: readonly string[], right: readonly string[]): boolean => left.some((value) => right.includes(value));

function related(left: CharacterIntent, right: CharacterIntent): boolean {
  if (left.desiredLocationId !== right.desiredLocationId) return false;
  return intersects(left.arcIds, right.arcIds)
    || intersects(participantIds(left), participantIds(right))
    || (left.targetCharacterId !== null && left.targetCharacterId === right.targetCharacterId);
}

export function groupCharacterIntents(input: SceneGroupingInput): SceneGroupingResult {
  if (input.schemaVersion !== 1 || input.groupingRunId.trim().length === 0 || input.directorRunId.trim().length === 0
      || input.worldId.trim().length === 0 || !Number.isSafeInteger(input.worldDay) || input.worldDay < 0
      || !isTimeSlot(input.timeSlot) || !Array.isArray(input.intents)) {
    throw new SceneGroupingError('SCENE_GROUPING_INVALID', 'invalid grouping envelope');
  }
  const intents = input.intents.map(({ intent, disposition }) => ({ intent: structuredClone(intent), disposition }));
  const intentIds = intents.map(({ intent }) => intent.intentId);
  if (new Set(intentIds).size !== intentIds.length) throw new SceneGroupingError('SCENE_GROUPING_DUPLICATE_INTENT', 'intent IDs must be unique');
  const actors = intents.filter(({ intent }) => intent.action === 'attempt').map(({ intent }) => intent.characterId);
  if (new Set(actors).size !== actors.length) throw new SceneGroupingError('SCENE_GROUPING_CHARACTER_CONFLICT', 'one character cannot submit multiple major-scene attempts in a slot');
  for (const { intent } of intents) {
    if (intent.directorRunId !== input.directorRunId) throw new SceneGroupingError('SCENE_GROUPING_RUN_CONFLICT', 'every Intent must belong to the Director Run');
  }

  const attempts = intents.filter(({ intent, disposition }) => disposition === 'accepted' && intent.action === 'attempt')
    .map(({ intent }) => intent).sort((a, b) => a.intentId.localeCompare(b.intentId));
  const parent = attempts.map((_, index) => index);
  const root = (index: number): number => parent[index] === index ? index : (parent[index] = root(parent[index]));
  const union = (left: number, right: number): void => { const a = root(left); const b = root(right); if (a !== b) parent[Math.max(a, b)] = Math.min(a, b); };
  for (let left = 0; left < attempts.length; left += 1) {
    for (let right = left + 1; right < attempts.length; right += 1) if (related(attempts[left], attempts[right])) union(left, right);
  }
  const components = new Map<number, CharacterIntent[]>();
  attempts.forEach((intent, index) => components.set(root(index), [...(components.get(root(index)) ?? []), intent]));
  const decisions: IntentGroupingDecision[] = intents.filter(({ intent, disposition }) => disposition === 'downgraded' || intent.action === 'wait')
    .map(({ intent }) => ({ intentId: intent.intentId, disposition: 'deferred', sceneId: null,
      reason: intent.downgradeReason ?? 'INTENT_NOT_ACTIONABLE' }));
  const scenes: GroupedScene[] = [];
  [...components.values()].sort((a, b) => a[0].intentId.localeCompare(b[0].intentId)).forEach((component) => {
    const participants = uniqueSorted(component.flatMap(participantIds));
    const sources = component.map(({ intentId }) => intentId).sort((a, b) => a.localeCompare(b));
    if (participants.length > MAX_MAJOR_SCENE_PARTICIPANTS) {
      decisions.push(...sources.map((intentId) => ({ intentId, disposition: 'deferred' as const, sceneId: null,
        reason: 'SCENE_PARTICIPANT_LIMIT' })));
      return;
    }
    const sceneId = `${input.groupingRunId}:scene:${scenes.length + 1}`;
    const scene: GroupedScene = {
      schemaVersion: 1, sceneId, groupingRunId: input.groupingRunId, directorRunId: input.directorRunId,
      worldId: input.worldId, worldDay: input.worldDay, timeSlot: input.timeSlot,
      locationId: component[0].desiredLocationId, participantIds: participants, sourceIntentIds: sources,
      arcIds: uniqueSorted(component.flatMap(({ arcIds }) => arcIds)),
      trigger: component.map(({ actionDescription }) => actionDescription).join(' / '),
      dramaticPressure: component.map(({ rationale }) => rationale).join(' / '),
    };
    scenes.push(scene);
    decisions.push(...sources.map((intentId) => ({ intentId, disposition: 'grouped' as const, sceneId, reason: 'GROUPED_COMPATIBLE_INTENTS' })));
  });
  const sceneParticipants = scenes.flatMap(({ participantIds }) => participantIds);
  if (new Set(sceneParticipants).size !== sceneParticipants.length) {
    throw new SceneGroupingError('SCENE_GROUPING_CHARACTER_CONFLICT', 'a character cannot participate in two major scenes in one slot');
  }
  return { scenes, decisions: decisions.sort((a, b) => a.intentId.localeCompare(b.intentId)) };
}
