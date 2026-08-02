import type { TimeSlot } from '../canon/eventTypes';
import { isTimeSlot } from '../canon/eventTypes';

export type IntentSource = { sourceId: string; sourceEventId: string | null };
export type CharacterIntentContext = {
  schemaVersion: 1;
  intentRunId: string;
  directorRunId: string;
  worldId: string;
  worldDay: number;
  timeSlot: TimeSlot;
  characterId: string;
  persona: { summary: string; source: IntentSource };
  currentGoal: { value: string; source: IntentSource };
  emotionalState: { value: string; source: IntentSource };
  currentLocationId: string;
  reachableLocationIds: string[];
  knowledge: Array<{ knowledgeId: string; belief: string; sourceEventId: string }>;
  memories: Array<{ memoryId: string; content: string; sourceEventId: string; retrievalScore: number }>;
  assets: Array<{ assetId: string; sourceEventId: string }>;
  activeArcs: Array<{ arcId: string; currentQuestion: string; sourceEventId: string }>;
};

export type CharacterIntent = {
  schemaVersion: 1;
  intentId: string;
  intentRunId: string;
  directorRunId: string;
  characterId: string;
  action: 'attempt' | 'wait';
  actionDescription: string;
  targetCharacterId: string | null;
  desiredLocationId: string;
  rationale: string;
  urgency: number;
  knowledgeIds: string[];
  memoryIds: string[];
  assetIds: string[];
  arcIds: string[];
  downgradeReason: string | null;
};

export type IntentValidationResult = { disposition: 'accepted' | 'downgraded'; intent: CharacterIntent };
export type CharacterIntentAuthorization = {
  knowledgeIds: ReadonlySet<string>;
  memoryIds: ReadonlySet<string>;
  assetIds: ReadonlySet<string>;
  currentLocationId: string;
};

export class CharacterIntentError extends Error {
  constructor(readonly code: string, message: string, readonly path?: string) {
    super(`[${code}] ${message}`);
    this.name = 'CharacterIntentError';
  }
}

const nonempty = (value: unknown, path: string): string => {
  if (typeof value !== 'string' || value.trim().length === 0) throw new CharacterIntentError('INTENT_INVALID_SHAPE', 'must be a non-empty string', path);
  return value;
};
const unique = (value: unknown, path: string): string[] => {
  if (!Array.isArray(value)) throw new CharacterIntentError('INTENT_INVALID_SHAPE', 'must be an array', path);
  const strings = value.map((entry, index) => nonempty(entry, `${path}[${index}]`));
  if (new Set(strings).size !== strings.length) throw new CharacterIntentError('INTENT_INVALID_SHAPE', 'must not contain duplicates', path);
  return strings;
};
const exact = (record: Record<string, unknown>, keys: readonly string[], path: string): void => {
  const extra = Object.keys(record).find((key) => !keys.includes(key));
  if (extra) throw new CharacterIntentError('INTENT_WORLD_MUTATION_FORBIDDEN', 'unknown or world-mutating fields are forbidden', `${path}.${extra}`);
};
const object = (value: unknown, path: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new CharacterIntentError('INTENT_INVALID_SHAPE', 'must be an object', path);
  return value as Record<string, unknown>;
};
const safeDay = (value: unknown, path: string): number => {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new CharacterIntentError('INTENT_INVALID_SHAPE', 'must be a non-negative integer', path);
  return value as number;
};

function parseSource(value: unknown, path: string): IntentSource {
  const record = object(value, path);
  exact(record, ['sourceId', 'sourceEventId'], path);
  return { sourceId: nonempty(record.sourceId, `${path}.sourceId`),
    sourceEventId: record.sourceEventId === null ? null : nonempty(record.sourceEventId, `${path}.sourceEventId`) };
}

export function parseCharacterIntentContext(value: unknown): CharacterIntentContext {
  const record = object(value, 'context');
  exact(record, ['schemaVersion', 'intentRunId', 'directorRunId', 'worldId', 'worldDay', 'timeSlot', 'characterId',
    'persona', 'currentGoal', 'emotionalState', 'currentLocationId', 'reachableLocationIds', 'knowledge',
    'memories', 'assets', 'activeArcs'], 'context');
  if (record.schemaVersion !== 1 || !isTimeSlot(record.timeSlot)) throw new CharacterIntentError('INTENT_INVALID_SHAPE', 'invalid context schema or time slot');
  const sourcedText = (raw: unknown, path: string, key: 'summary' | 'value') => {
    const entry = object(raw, path); exact(entry, [key, 'source'], path);
    return { [key]: nonempty(entry[key], `${path}.${key}`), source: parseSource(entry.source, `${path}.source`) };
  };
  if (!Array.isArray(record.knowledge) || !Array.isArray(record.memories) || !Array.isArray(record.assets) || !Array.isArray(record.activeArcs)) {
    throw new CharacterIntentError('INTENT_INVALID_SHAPE', 'bounded cognition arrays are required');
  }
  const knowledge = record.knowledge.map((raw, index) => {
    const item = object(raw, `context.knowledge[${index}]`); exact(item, ['knowledgeId', 'belief', 'sourceEventId'], `context.knowledge[${index}]`);
    return { knowledgeId: nonempty(item.knowledgeId, `context.knowledge[${index}].knowledgeId`), belief: nonempty(item.belief, `context.knowledge[${index}].belief`), sourceEventId: nonempty(item.sourceEventId, `context.knowledge[${index}].sourceEventId`) };
  });
  const memories = record.memories.map((raw, index) => {
    const item = object(raw, `context.memories[${index}]`); exact(item, ['memoryId', 'content', 'sourceEventId', 'retrievalScore'], `context.memories[${index}]`);
    if (typeof item.retrievalScore !== 'number' || !Number.isFinite(item.retrievalScore) || item.retrievalScore < 0 || item.retrievalScore > 1) throw new CharacterIntentError('INTENT_INVALID_SHAPE', 'retrieval score must be from 0 to 1');
    return { memoryId: nonempty(item.memoryId, `context.memories[${index}].memoryId`), content: nonempty(item.content, `context.memories[${index}].content`), sourceEventId: nonempty(item.sourceEventId, `context.memories[${index}].sourceEventId`), retrievalScore: item.retrievalScore };
  });
  const assets = record.assets.map((raw, index) => {
    const item = object(raw, `context.assets[${index}]`); exact(item, ['assetId', 'sourceEventId'], `context.assets[${index}]`);
    return { assetId: nonempty(item.assetId, `context.assets[${index}].assetId`), sourceEventId: nonempty(item.sourceEventId, `context.assets[${index}].sourceEventId`) };
  });
  const activeArcs = record.activeArcs.map((raw, index) => {
    const item = object(raw, `context.activeArcs[${index}]`); exact(item, ['arcId', 'currentQuestion', 'sourceEventId'], `context.activeArcs[${index}]`);
    return { arcId: nonempty(item.arcId, `context.activeArcs[${index}].arcId`), currentQuestion: nonempty(item.currentQuestion, `context.activeArcs[${index}].currentQuestion`), sourceEventId: nonempty(item.sourceEventId, `context.activeArcs[${index}].sourceEventId`) };
  });
  for (const [path, values] of [['knowledge', knowledge.map(({ knowledgeId }) => knowledgeId)], ['memories', memories.map(({ memoryId }) => memoryId)], ['assets', assets.map(({ assetId }) => assetId)], ['activeArcs', activeArcs.map(({ arcId }) => arcId)]] as const) {
    if (new Set(values).size !== values.length) throw new CharacterIntentError('INTENT_INVALID_SHAPE', `${path} IDs must be unique`);
  }
  return {
    schemaVersion: 1, intentRunId: nonempty(record.intentRunId, 'context.intentRunId'), directorRunId: nonempty(record.directorRunId, 'context.directorRunId'),
    worldId: nonempty(record.worldId, 'context.worldId'), worldDay: safeDay(record.worldDay, 'context.worldDay'), timeSlot: record.timeSlot,
    characterId: nonempty(record.characterId, 'context.characterId'), persona: sourcedText(record.persona, 'context.persona', 'summary') as CharacterIntentContext['persona'],
    currentGoal: sourcedText(record.currentGoal, 'context.currentGoal', 'value') as CharacterIntentContext['currentGoal'], emotionalState: sourcedText(record.emotionalState, 'context.emotionalState', 'value') as CharacterIntentContext['emotionalState'],
    currentLocationId: nonempty(record.currentLocationId, 'context.currentLocationId'), reachableLocationIds: unique(record.reachableLocationIds, 'context.reachableLocationIds'),
    knowledge, memories, assets, activeArcs,
  };
}

export function validateCharacterIntent(value: unknown, rawContext: unknown): IntentValidationResult {
  const context = parseCharacterIntentContext(rawContext);
  const record = object(value, 'intent');
  exact(record, ['schemaVersion', 'intentId', 'intentRunId', 'directorRunId', 'characterId', 'action', 'actionDescription',
    'targetCharacterId', 'desiredLocationId', 'rationale', 'urgency', 'knowledgeIds', 'memoryIds', 'assetIds', 'arcIds', 'downgradeReason'], 'intent');
  if (record.schemaVersion !== 1 || (record.action !== 'attempt' && record.action !== 'wait')) throw new CharacterIntentError('INTENT_INVALID_SHAPE', 'invalid intent schema or action');
  if (typeof record.urgency !== 'number' || !Number.isFinite(record.urgency) || record.urgency < 0 || record.urgency > 1) throw new CharacterIntentError('INTENT_INVALID_SHAPE', 'urgency must be from 0 to 1');
  const intent: CharacterIntent = {
    schemaVersion: 1, intentId: nonempty(record.intentId, 'intent.intentId'), intentRunId: nonempty(record.intentRunId, 'intent.intentRunId'),
    directorRunId: nonempty(record.directorRunId, 'intent.directorRunId'), characterId: nonempty(record.characterId, 'intent.characterId'), action: record.action,
    actionDescription: nonempty(record.actionDescription, 'intent.actionDescription'), targetCharacterId: record.targetCharacterId === null ? null : nonempty(record.targetCharacterId, 'intent.targetCharacterId'),
    desiredLocationId: nonempty(record.desiredLocationId, 'intent.desiredLocationId'), rationale: nonempty(record.rationale, 'intent.rationale'), urgency: record.urgency,
    knowledgeIds: unique(record.knowledgeIds, 'intent.knowledgeIds'), memoryIds: unique(record.memoryIds, 'intent.memoryIds'), assetIds: unique(record.assetIds, 'intent.assetIds'), arcIds: unique(record.arcIds, 'intent.arcIds'),
    downgradeReason: record.downgradeReason === null ? null : nonempty(record.downgradeReason, 'intent.downgradeReason'),
  };
  if (intent.intentRunId !== context.intentRunId || intent.directorRunId !== context.directorRunId || intent.characterId !== context.characterId) throw new CharacterIntentError('INTENT_RUN_CONFLICT', 'intent provenance does not match its context');
  const allowed = (selected: string[], available: string[], kind: string) => {
    if (selected.some((id) => !available.includes(id))) throw new CharacterIntentError('INTENT_UNAUTHORIZED_CONTEXT', `intent references unauthorized ${kind}`);
  };
  allowed(intent.knowledgeIds, context.knowledge.map(({ knowledgeId }) => knowledgeId), 'knowledge');
  allowed(intent.memoryIds, context.memories.map(({ memoryId }) => memoryId), 'memory');
  allowed(intent.assetIds, context.assets.map(({ assetId }) => assetId), 'asset');
  allowed(intent.arcIds, context.activeArcs.map(({ arcId }) => arcId), 'Arc');
  if (intent.action === 'wait' && intent.downgradeReason === null) throw new CharacterIntentError('INTENT_INVALID_SHAPE', 'wait intent requires a downgrade reason');
  const locations = new Set([context.currentLocationId, ...context.reachableLocationIds]);
  if (!locations.has(intent.desiredLocationId)) {
    return { disposition: 'downgraded', intent: { ...intent, action: 'wait', actionDescription: 'Remain in place', desiredLocationId: context.currentLocationId,
      urgency: 0, downgradeReason: 'INTENT_LOCATION_UNAVAILABLE' } };
  }
  return { disposition: 'accepted', intent };
}

/** Proves the supplied cognition context belongs to the target character's Canon/seed projection. */
export function assertCharacterIntentContextAuthorization(
  rawContext: unknown,
  authorization: CharacterIntentAuthorization,
): CharacterIntentContext {
  const context = parseCharacterIntentContext(rawContext);
  const check = (ids: readonly string[], allowed: ReadonlySet<string>, kind: string): void => {
    if (ids.some((id) => !allowed.has(id))) {
      throw new CharacterIntentError('INTENT_CONTEXT_ACCESS_DENIED', `context contains another character's or unknown ${kind}`);
    }
  };
  check(context.knowledge.map(({ knowledgeId }) => knowledgeId), authorization.knowledgeIds, 'knowledge');
  check(context.memories.map(({ memoryId }) => memoryId), authorization.memoryIds, 'memory');
  check(context.assets.map(({ assetId }) => assetId), authorization.assetIds, 'asset');
  if (context.currentLocationId !== authorization.currentLocationId) {
    throw new CharacterIntentError('INTENT_CONTEXT_STALE', 'context location does not match the current character projection');
  }
  return context;
}
