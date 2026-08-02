/**
 * Convex runtime validators for proposed events and state changes.
 *
 * These mirror the TypeScript domain types in `model.ts` but provide runtime validation
 * at the Convex function boundary (argument parsing and document inserts). Convex
 * validators are the schema-level guard; the richer business checks (duplicates,
 * participant consistency, preconditions) live in `validators.ts`.
 */

import { v } from 'convex/values';
import { CanonError, canonError } from '../shared/errors';
import type { JsonValue, ProposedBy, ProposedEvent, StateChange } from './model';
import { validateEventStructure } from './validators';

export const stateChangeValidator = v.union(
  v.object({
    type: v.literal('character_location_changed'),
    characterId: v.string(),
    fromLocationId: v.string(),
    toLocationId: v.string(),
  }),
  v.object({
    type: v.literal('relationship_changed'),
    sourceCharacterId: v.string(),
    targetCharacterId: v.string(),
    trustDelta: v.number(),
    affectionDelta: v.number(),
    resentmentDelta: v.number(),
    fearDelta: v.optional(v.number()),
    dependencyDelta: v.optional(v.number()),
    familiarityDelta: v.optional(v.number()),
    reason: v.string(),
    visibility: v.optional(v.union(v.literal('private'), v.literal('public'))),
  }),
  v.object({
    type: v.literal('fact_created'),
    subjectType: v.union(
      v.literal('world'),
      v.literal('character'),
      v.literal('location'),
      v.literal('item'),
    ),
    subjectId: v.string(),
    predicate: v.string(),
    value: v.union(v.string(), v.number(), v.boolean()),
    visibility: v.union(v.literal('canon'), v.literal('public'), v.literal('private')),
  }),
  v.object({
    type: v.literal('location_state_changed'),
    locationId: v.string(), name: v.string(), description: v.string(), locationType: v.string(),
    capacity: v.number(), connectedLocationIds: v.array(v.string()), active: v.boolean(), reason: v.string(),
  }),
  v.object({
    type: v.literal('character_life_changed'),
    characterId: v.string(),
    alive: v.boolean(),
    reason: v.string(),
  }),
  v.object({
    type: v.literal('character_knowledge_learned'),
    characterId: v.string(),
    factId: v.string(),
    sourceType: v.union(
      v.literal('observed'), v.literal('told'), v.literal('public'),
      v.literal('evidence'), v.literal('inference'), v.literal('memory'),
    ),
    sourceEventId: v.string(),
    beliefValue: v.optional(v.union(v.string(), v.number(), v.boolean())),
    truthStatus: v.optional(v.union(v.literal('true'), v.literal('false'), v.literal('unknown'))),
    confidence: v.optional(v.number()),
    shareability: v.optional(v.union(v.literal('private'), v.literal('trusted'), v.literal('public'))),
    correctsKnowledgeId: v.optional(v.string()),
  }),
  v.object({
    type: v.literal('character_memory_formed'),
    characterId: v.string(),
    content: v.string(),
    interpretation: v.string(),
    importance: v.number(),
    emotionalWeight: v.number(),
    confidence: v.number(),
    visibility: v.union(v.literal('private'), v.literal('trusted'), v.literal('public')),
  }),
  v.object({
    type: v.literal('item_transferred'),
    itemId: v.string(),
    fromOwnerId: v.union(v.string(), v.null()),
    toOwnerId: v.string(),
    reason: v.string(),
  }),
  v.object({
    type: v.literal('character_state_changed'),
    characterId: v.string(),
    field: v.union(
      v.literal('health'), v.literal('emotion'), v.literal('finance'),
      v.literal('occupation'), v.literal('organization_memberships'),
      v.literal('availability'), v.literal('active'),
    ),
    fromValue: v.optional(v.union(v.string(), v.boolean(), v.array(v.string()))),
    toValue: v.union(v.string(), v.boolean(), v.array(v.string())),
    reason: v.string(),
  }),
);

export const proposedByValidator = v.object({
  type: v.union(
    v.literal('system'),
    v.literal('director'),
    v.literal('character'),
    v.literal('admin'),
  ),
  id: v.optional(v.string()),
});

/** Validator for a complete proposed event (used as function args and as the stored payload). */
export const proposedEventArgs = v.object({
  schemaVersion: v.number(),
  worldId: v.string(),
  idempotencyKey: v.string(),
  proposedBy: proposedByValidator,
  worldDay: v.number(),
  timeSlot: v.string(),
  eventType: v.string(),
  locationId: v.optional(v.string()),
  participantIds: v.array(v.string()),
  causedByEventIds: v.array(v.string()),
  publicSummary: v.optional(v.string()),
  stateChanges: v.array(stateChangeValidator),
  metadata: v.optional(v.any()),
});

type PlainObject = Record<string, unknown>;

function isPlainObject(value: unknown): value is PlainObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exactObject(value: unknown, path: string, allowedKeys: readonly string[]): PlainObject {
  if (!isPlainObject(value)) throw new CanonError(canonError('INVALID_EVENT_SHAPE', 'must be a plain object', undefined, path));
  const unknownKeys = Object.keys(value).filter((key) => !allowedKeys.includes(key));
  if (unknownKeys.length) {
    throw new CanonError(canonError('INVALID_EVENT_SHAPE', 'contains unknown fields', { fields: unknownKeys }, path));
  }
  return value;
}

function jsonValue(value: unknown, path: string): JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map((entry, index) => jsonValue(entry, `${path}[${index}]`));
  if (isPlainObject(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, jsonValue(entry, `${path}.${key}`)]));
  }
  throw new CanonError(canonError('INVALID_EVENT_SHAPE', 'metadata must contain JSON-safe values', undefined, path));
}

function normalizeProposedBy(value: unknown): ProposedBy {
  const source = exactObject(value, 'proposedBy', ['type', 'id']);
  const typed = source as ProposedBy;
  return { type: typed.type, ...(typed.id === undefined ? {} : { id: typed.id }) };
}

function normalizeStateChange(value: unknown, index: number): StateChange {
  const path = `stateChanges[${index}]`;
  const source = exactObject(value, path, [
    'type', 'characterId', 'fromLocationId', 'toLocationId', 'sourceCharacterId',
    'targetCharacterId', 'trustDelta', 'affectionDelta', 'resentmentDelta', 'fearDelta',
    'dependencyDelta', 'familiarityDelta', 'reason',
    'subjectType', 'subjectId', 'predicate', 'value', 'visibility',
    'alive', 'factId', 'sourceType', 'sourceEventId', 'beliefValue', 'truthStatus',
    'confidence', 'shareability', 'correctsKnowledgeId', 'content', 'interpretation',
    'importance', 'emotionalWeight', 'itemId', 'fromOwnerId',
    'toOwnerId', 'field', 'fromValue', 'toValue',
  ]);
  const change = source as unknown as StateChange;
  switch (change.type) {
    case 'character_location_changed':
      exactObject(value, path, ['type', 'characterId', 'fromLocationId', 'toLocationId']);
      return { ...change };
    case 'relationship_changed':
      exactObject(value, path, [
        'type', 'sourceCharacterId', 'targetCharacterId', 'trustDelta', 'affectionDelta',
        'resentmentDelta', 'fearDelta', 'dependencyDelta', 'familiarityDelta', 'reason',
        'visibility',
      ]);
      return {
        ...change,
        fearDelta: change.fearDelta ?? 0,
        dependencyDelta: change.dependencyDelta ?? 0,
        familiarityDelta: change.familiarityDelta ?? 0,
        visibility: change.visibility ?? 'private',
      };
    case 'fact_created':
      exactObject(value, path, ['type', 'subjectType', 'subjectId', 'predicate', 'value', 'visibility']);
      return { ...change };
    case 'location_state_changed':
      exactObject(value, path, ['type', 'locationId', 'name', 'description', 'locationType', 'capacity', 'connectedLocationIds', 'active', 'reason']);
      return { ...change, connectedLocationIds: [...change.connectedLocationIds] };
    case 'character_life_changed':
      exactObject(value, path, ['type', 'characterId', 'alive', 'reason']);
      return { ...change };
    case 'character_knowledge_learned':
      exactObject(value, path, [
        'type', 'characterId', 'factId', 'sourceType', 'sourceEventId', 'beliefValue',
        'truthStatus', 'confidence', 'shareability', 'correctsKnowledgeId',
      ]);
      return {
        ...change,
        beliefValue: change.beliefValue ?? change.factId,
        truthStatus: change.truthStatus ?? 'unknown',
        confidence: change.confidence ?? 0.5,
        shareability: change.shareability ?? 'private',
      };
    case 'character_memory_formed':
      exactObject(value, path, [
        'type', 'characterId', 'content', 'interpretation', 'importance',
        'emotionalWeight', 'confidence', 'visibility',
      ]);
      return { ...change };
    case 'item_transferred':
      exactObject(value, path, ['type', 'itemId', 'fromOwnerId', 'toOwnerId', 'reason']);
      return { ...change };
    case 'character_state_changed':
      exactObject(value, path, ['type', 'characterId', 'field', 'fromValue', 'toValue', 'reason']);
      return {
        ...change,
        ...(Array.isArray(change.fromValue) ? { fromValue: [...change.fromValue] } : {}),
        ...(Array.isArray(change.toValue) ? { toValue: [...change.toValue] } : {}),
      };
  }
}

/**
 * Convert unknown provider JSON into the canonical ProposedEvent v1 contract.
 * No provider output may reach the commit boundary without passing this function.
 */
export function normalizeProposedEventOutput(value: unknown): ProposedEvent {
  const structuralError = validateEventStructure(value);
  if (structuralError) throw new CanonError(structuralError);
  const source = exactObject(value, '$', [
    'schemaVersion', 'worldId', 'idempotencyKey', 'proposedBy', 'worldDay', 'timeSlot',
    'eventType', 'locationId', 'participantIds', 'causedByEventIds', 'publicSummary',
    'stateChanges', 'metadata',
  ]) as unknown as ProposedEvent;
  const metadata = source.metadata === undefined
    ? undefined
    : jsonValue(source.metadata, 'metadata') as Record<string, JsonValue>;
  if (metadata !== undefined && (typeof metadata !== 'object' || Array.isArray(metadata) || metadata === null)) {
    throw new CanonError(canonError('INVALID_EVENT_SHAPE', 'metadata must be an object', undefined, 'metadata'));
  }
  return {
    schemaVersion: source.schemaVersion,
    worldId: source.worldId,
    idempotencyKey: source.idempotencyKey,
    proposedBy: normalizeProposedBy(source.proposedBy),
    worldDay: source.worldDay,
    timeSlot: source.timeSlot,
    eventType: source.eventType,
    ...(source.locationId === undefined ? {} : { locationId: source.locationId }),
    participantIds: [...source.participantIds],
    causedByEventIds: [...source.causedByEventIds],
    ...(source.publicSummary === undefined ? {} : { publicSummary: source.publicSummary }),
    stateChanges: source.stateChanges.map(normalizeStateChange),
    ...(metadata === undefined ? {} : { metadata }),
  };
}
