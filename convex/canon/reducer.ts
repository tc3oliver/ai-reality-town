/**
 * Deterministic world reducer.
 *
 * PURE FUNCTION CONTRACT — verified by tests:
 *  - never mutates the input projection or the input event;
 *  - never reads a database, environment variable, clock, or unseeded randomness;
 *  - never calls Convex or any external API;
 *  - applies state changes in a fixed order (declaration order within the event);
 *  - relationship keys are produced by a single fixed function;
 *  - fails loudly on world mismatch, unsupported schema, sequence gaps or duplicates.
 *
 * This is NOT a Convex mutation — it must run with no Convex runtime present.
 */

import { RELATIONSHIP_MAX, RELATIONSHIP_MIN, SUPPORTED_SCHEMA_VERSIONS } from '../shared/constants';
import { CanonError, canonError } from '../shared/errors';
import { relationshipKey } from '../shared/ids';
import type {
  AcceptedEvent,
  CharacterCurrentState,
  CharacterKnowledgeRecord,
  CharacterMemoryRecord,
  RelationshipHistoryEntry,
  RelationshipState,
  WorldProjection,
} from './model';

function clampRelationship(value: number): number {
  if (value < RELATIONSHIP_MIN) return RELATIONSHIP_MIN;
  if (value > RELATIONSHIP_MAX) return RELATIONSHIP_MAX;
  return value;
}

/**
 * Apply a single accepted event to a projection, returning a NEW projection.
 * Throws {@link CanonError} on integrity violations (world/schema/sequence).
 */
export function reduceWorldEvent(
  projection: WorldProjection,
  event: AcceptedEvent,
): WorldProjection {
  if (event.worldId !== projection.worldId) {
    throw new CanonError(
      canonError(
        'SEQUENCE_CONFLICT',
        'event worldId does not match projection worldId',
        { eventWorldId: event.worldId, projectionWorldId: projection.worldId },
      ),
    );
  }

  if (!SUPPORTED_SCHEMA_VERSIONS.includes(event.schemaVersion)) {
    throw new CanonError(
      canonError('UNSUPPORTED_SCHEMA_VERSION', 'reducer cannot apply unsupported schemaVersion', {
        schemaVersion: event.schemaVersion,
        supported: [...SUPPORTED_SCHEMA_VERSIONS],
      }),
    );
  }

  const expected = projection.lastSequenceNumber + 1;
  if (event.sequenceNumber < expected) {
    throw new CanonError(
      canonError('DUPLICATE_SEQUENCE', 'event sequence number has already been applied', {
        sequenceNumber: event.sequenceNumber,
        lastApplied: projection.lastSequenceNumber,
      }),
    );
  }
  if (event.sequenceNumber > expected) {
    throw new CanonError(
      canonError('SEQUENCE_GAP', 'event sequence number skips ahead of the projection', {
        sequenceNumber: event.sequenceNumber,
        expected,
      }),
    );
  }

  // Structural copies — input objects are never mutated.
  const characterLocations = { ...projection.characterLocations };
  const characterAlive = { ...projection.characterAlive };
  const characterStates: Record<string, CharacterCurrentState> = Object.fromEntries(
    Object.entries(projection.characterStates).map(([id, state]) => [id, {
      ...state,
      ...(state.organizationMemberships === undefined ? {} : { organizationMemberships: [...state.organizationMemberships] }),
    }]),
  );
  const lastCharacterMovement = Object.fromEntries(
    Object.entries(projection.lastCharacterMovement).map(([id, movement]) => [id, { ...movement }]),
  );
  const itemOwners = { ...projection.itemOwners };
  const characterKnowledge: Record<string, CharacterKnowledgeRecord[]> = Object.fromEntries(
    Object.entries(projection.characterKnowledge).map(([id, records]) => [id, records.map((record) => ({
      ...record,
      learnedAt: { ...record.learnedAt },
    }))]),
  );
  const characterMemories: Record<string, CharacterMemoryRecord[]> = Object.fromEntries(
    Object.entries(projection.characterMemories ?? {}).map(([id, records]) => [id, records.map((record) => ({
      ...record,
      createdAt: { ...record.createdAt },
    }))]),
  );
  const relationships: Record<string, RelationshipState> = { ...projection.relationships };
  const relationshipHistory: Record<string, RelationshipHistoryEntry[]> = Object.fromEntries(
    Object.entries(projection.relationshipHistory ?? {}).map(([key, entries]) => [key, entries.map((entry) => ({ ...entry }))]),
  );
  const facts = projection.facts.slice();

  for (const [changeIndex, change] of event.stateChanges.entries()) {
    switch (change.type) {
      case 'character_location_changed': {
        characterLocations[change.characterId] = change.toLocationId;
        lastCharacterMovement[change.characterId] = {
          worldDay: event.worldDay,
          timeSlot: event.timeSlot,
          eventId: event.eventId,
        };
        characterStates[change.characterId] = {
          ...characterStates[change.characterId],
          currentLocationId: change.toLocationId,
          lastUpdatedEventId: event.eventId,
        };
        break;
      }
      case 'relationship_changed': {
        const key = relationshipKey(change.sourceCharacterId, change.targetCharacterId);
        const prev = relationships[key] ?? {
          trust: 0, affection: 0, resentment: 0, fear: 0, dependency: 0, familiarity: 0,
          lastUpdatedEventId: event.eventId,
        };
        relationships[key] = {
          trust: clampRelationship(prev.trust + change.trustDelta),
          affection: clampRelationship(prev.affection + change.affectionDelta),
          resentment: clampRelationship(prev.resentment + change.resentmentDelta),
          fear: clampRelationship((prev.fear ?? 0) + (change.fearDelta ?? 0)),
          dependency: clampRelationship((prev.dependency ?? 0) + (change.dependencyDelta ?? 0)),
          familiarity: Math.max(0, clampRelationship((prev.familiarity ?? 0) + (change.familiarityDelta ?? 0))),
          lastUpdatedEventId: event.eventId,
        };
        relationshipHistory[key] = [...(relationshipHistory[key] ?? []), {
          sourceCharacterId: change.sourceCharacterId,
          targetCharacterId: change.targetCharacterId,
          trustDelta: change.trustDelta,
          affectionDelta: change.affectionDelta,
          resentmentDelta: change.resentmentDelta,
          fearDelta: change.fearDelta ?? 0,
          dependencyDelta: change.dependencyDelta ?? 0,
          familiarityDelta: change.familiarityDelta ?? 0,
          reason: change.reason,
          visibility: change.visibility ?? 'private',
          sourceEventId: event.eventId,
          sequenceNumber: event.sequenceNumber,
          worldDay: event.worldDay,
          timeSlot: event.timeSlot,
        }];
        break;
      }
      case 'fact_created': {
        facts.push({
          subjectType: change.subjectType,
          subjectId: change.subjectId,
          predicate: change.predicate,
          value: change.value,
          visibility: change.visibility,
          sourceEventId: event.eventId,
        });
        break;
      }
      case 'character_life_changed': {
        characterAlive[change.characterId] = change.alive;
        characterStates[change.characterId] = {
          ...characterStates[change.characterId],
          alive: change.alive,
          ...(!change.alive ? { active: false } : {}),
          lastUpdatedEventId: event.eventId,
        };
        break;
      }
      case 'character_knowledge_learned': {
        const known = characterKnowledge[change.characterId] ?? [];
        const knowledgeId = `${event.eventId}:knowledge:${changeIndex}`;
        const corrected = change.correctsKnowledgeId === undefined
          ? known.map((record) => ({ ...record, learnedAt: { ...record.learnedAt } }))
          : known.map((record) => record.knowledgeId === change.correctsKnowledgeId
            ? { ...record, learnedAt: { ...record.learnedAt }, correctedByKnowledgeId: knowledgeId }
            : { ...record, learnedAt: { ...record.learnedAt } });
        corrected.push({
          knowledgeId,
          characterId: change.characterId,
          factId: change.factId,
          beliefValue: change.beliefValue ?? change.factId,
          truthStatus: change.truthStatus ?? 'unknown',
          confidence: change.confidence ?? 0.5,
          sourceType: change.sourceType,
          sourceEventId: change.sourceEventId,
          learnedAt: { worldDay: event.worldDay, timeSlot: event.timeSlot, eventId: event.eventId },
          shareability: change.shareability ?? 'private',
          ...(change.correctsKnowledgeId === undefined ? {} : { correctsKnowledgeId: change.correctsKnowledgeId }),
        });
        characterKnowledge[change.characterId] = corrected;
        break;
      }
      case 'character_memory_formed': {
        const memories = characterMemories[change.characterId] ?? [];
        characterMemories[change.characterId] = [...memories.map((memory) => ({
          ...memory, createdAt: { ...memory.createdAt },
        })), {
          memoryId: `${event.eventId}:memory:${changeIndex}`,
          characterId: change.characterId,
          content: change.content,
          interpretation: change.interpretation,
          importance: change.importance,
          emotionalWeight: change.emotionalWeight,
          confidence: change.confidence,
          visibility: change.visibility,
          sourceEventId: event.eventId,
          createdAt: { worldDay: event.worldDay, timeSlot: event.timeSlot, eventId: event.eventId },
        }];
        break;
      }
      case 'item_transferred': {
        itemOwners[change.itemId] = change.toOwnerId;
        break;
      }
      case 'character_state_changed': {
        const key = change.field === 'organization_memberships' ? 'organizationMemberships' : change.field;
        const value = Array.isArray(change.toValue) ? [...change.toValue] : change.toValue;
        characterStates[change.characterId] = {
          ...characterStates[change.characterId],
          [key]: value,
          lastUpdatedEventId: event.eventId,
        };
        break;
      }
      default: {
        // Exhaustiveness guard — an unknown change type is a code/contract bug.
        const _exhaustive: never = change;
        throw new CanonError(
          canonError('INVALID_EVENT_SHAPE', 'reducer encountered an unknown state change type', {
            change: _exhaustive as unknown,
          }),
        );
      }
    }
  }

  return {
    worldId: projection.worldId,
    lastSequenceNumber: event.sequenceNumber,
    characterLocations,
    characterAlive,
    characterStates,
    lastCharacterMovement,
    itemOwners,
    characterKnowledge,
    characterMemories,
    relationships,
    relationshipHistory,
    facts,
  };
}
