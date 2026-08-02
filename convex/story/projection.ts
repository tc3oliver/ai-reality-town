import { TIME_SLOTS } from '../canon/eventTypes';
import type {
  ArcProjectionEvent,
  ArcProjectionFields,
  StoryArcProjectionData,
  StoryArcStatus,
} from './model';

export type ArcProjectionErrorCode =
  | 'ARC_PROJECTION_INVALID_SHAPE'
  | 'ARC_PROJECTION_SEQUENCE_CONFLICT'
  | 'ARC_PROJECTION_NOT_INITIALIZED';

export class ArcProjectionError extends Error {
  constructor(readonly code: ArcProjectionErrorCode, message: string, readonly path?: string) {
    super(`[${code}] ${message}`);
    this.name = 'ArcProjectionError';
  }
}

const requiredKeys = [
  'title', 'premise', 'currentQuestion', 'coreCharacterIds', 'incitingEventId',
  'latestTurningPointEventId', 'essentialFactIds', 'unresolvedQuestions',
  'resolvedQuestions', 'recommendedEntryEventId', 'heatScore',
] as const;

function nonempty(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ArcProjectionError('ARC_PROJECTION_INVALID_SHAPE', 'must be a non-empty string', path);
  }
  return value;
}

function referenceOrNull(value: unknown, path: string): string | null {
  if (value === null) return null;
  return nonempty(value, path);
}

function uniqueStrings(value: unknown, path: string, allowEmpty: boolean): string[] {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) {
    throw new ArcProjectionError('ARC_PROJECTION_INVALID_SHAPE', 'must be an array of strings', path);
  }
  const values = value.map((entry, index) => nonempty(entry, `${path}[${index}]`));
  if (new Set(values).size !== values.length) {
    throw new ArcProjectionError('ARC_PROJECTION_INVALID_SHAPE', 'must not contain duplicates', path);
  }
  return values;
}

export function parseArcProjectionFields(value: unknown): ArcProjectionFields {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ArcProjectionError('ARC_PROJECTION_INVALID_SHAPE', 'fields must be an object', 'fields');
  }
  const record = value as Record<string, unknown>;
  const unknown = Object.keys(record).filter((key) => !requiredKeys.includes(key as typeof requiredKeys[number]));
  if (unknown.length > 0) throw new ArcProjectionError('ARC_PROJECTION_INVALID_SHAPE', 'unknown fields are not allowed', `fields.${unknown[0]}`);
  const unresolvedQuestions = uniqueStrings(record.unresolvedQuestions, 'fields.unresolvedQuestions', true);
  const resolvedQuestions = uniqueStrings(record.resolvedQuestions, 'fields.resolvedQuestions', true);
  if (unresolvedQuestions.some((question) => resolvedQuestions.includes(question))) {
    throw new ArcProjectionError('ARC_PROJECTION_INVALID_SHAPE', 'a question cannot be both unresolved and resolved', 'fields.resolvedQuestions');
  }
  if (typeof record.heatScore !== 'number' || !Number.isFinite(record.heatScore)
      || record.heatScore < 0 || record.heatScore > 100) {
    throw new ArcProjectionError('ARC_PROJECTION_INVALID_SHAPE', 'heatScore must be from 0 to 100', 'fields.heatScore');
  }
  return {
    title: nonempty(record.title, 'fields.title'),
    premise: nonempty(record.premise, 'fields.premise'),
    currentQuestion: nonempty(record.currentQuestion, 'fields.currentQuestion'),
    coreCharacterIds: uniqueStrings(record.coreCharacterIds, 'fields.coreCharacterIds', false),
    incitingEventId: nonempty(record.incitingEventId, 'fields.incitingEventId'),
    latestTurningPointEventId: referenceOrNull(record.latestTurningPointEventId, 'fields.latestTurningPointEventId'),
    essentialFactIds: uniqueStrings(record.essentialFactIds, 'fields.essentialFactIds', true),
    unresolvedQuestions,
    resolvedQuestions,
    recommendedEntryEventId: referenceOrNull(record.recommendedEntryEventId, 'fields.recommendedEntryEventId'),
    heatScore: record.heatScore,
  };
}

export function validateArcProjectionReferences(
  fields: ArcProjectionFields,
  knownCharacterIds: ReadonlySet<string>,
  knownEventIds: ReadonlySet<string>,
): void {
  if (fields.coreCharacterIds.some((id) => !knownCharacterIds.has(id))) {
    throw new ArcProjectionError('ARC_PROJECTION_INVALID_SHAPE', 'core character is unknown', 'fields.coreCharacterIds');
  }
  for (const [path, id] of [
    ['fields.incitingEventId', fields.incitingEventId],
    ['fields.latestTurningPointEventId', fields.latestTurningPointEventId],
    ['fields.recommendedEntryEventId', fields.recommendedEntryEventId],
  ] as const) {
    if (id !== null && !knownEventIds.has(id)) {
      throw new ArcProjectionError('ARC_PROJECTION_INVALID_SHAPE', 'event reference is unknown', path);
    }
  }
}

export function parseArcProjectionEvent(value: ArcProjectionEvent): ArcProjectionEvent {
  if (value.schemaVersion !== 1 || value.worldId.trim().length === 0 || value.arcId.trim().length === 0
      || !Number.isSafeInteger(value.revision) || value.revision < 0
      || !Number.isSafeInteger(value.sourceEventSequenceNumber) || value.sourceEventSequenceNumber < 0
      || !Number.isSafeInteger(value.worldDay) || value.worldDay < 0
      || !TIME_SLOTS.includes(value.timeSlot) || value.sourceEventId.trim().length === 0
      || (value.kind !== 'initialized' && value.kind !== 'updated')) {
    throw new ArcProjectionError('ARC_PROJECTION_INVALID_SHAPE', 'projection event envelope is invalid');
  }
  return { ...value, fields: parseArcProjectionFields(value.fields) };
}

export function replayArcProjection(
  events: readonly ArcProjectionEvent[],
  status: StoryArcStatus,
): StoryArcProjectionData {
  if (events.length === 0) throw new ArcProjectionError('ARC_PROJECTION_NOT_INITIALIZED', 'arc has no projection events');
  let projection: StoryArcProjectionData | null = null;
  events.forEach((raw, index) => {
    const event = parseArcProjectionEvent(raw);
    if (event.revision !== index || (index === 0 ? event.kind !== 'initialized' : event.kind !== 'updated')) {
      throw new ArcProjectionError('ARC_PROJECTION_SEQUENCE_CONFLICT', 'projection revisions must be contiguous and start with initialized');
    }
    if (index > 0 && projection && (event.worldId !== projection.worldId || event.arcId !== projection.arcId)) {
      throw new ArcProjectionError('ARC_PROJECTION_SEQUENCE_CONFLICT', 'projection event identity changed');
    }
    projection = {
      schemaVersion: 1, worldId: event.worldId, arcId: event.arcId,
      ...event.fields, status,
      lastProgressTime: { worldDay: event.worldDay, timeSlot: event.timeSlot, sourceEventId: event.sourceEventId },
      revision: event.revision,
    };
  });
  if (!projection) throw new ArcProjectionError('ARC_PROJECTION_NOT_INITIALIZED', 'arc has no projection events');
  return projection;
}
