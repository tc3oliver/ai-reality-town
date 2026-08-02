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
import type { AcceptedEvent, RelationshipState, WorldProjection } from './model';

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
  const lastCharacterMovement = Object.fromEntries(
    Object.entries(projection.lastCharacterMovement).map(([id, movement]) => [id, { ...movement }]),
  );
  const itemOwners = { ...projection.itemOwners };
  const characterKnowledge = Object.fromEntries(
    Object.entries(projection.characterKnowledge).map(([id, facts]) => [id, [...facts]]),
  );
  const relationships: Record<string, RelationshipState> = { ...projection.relationships };
  const facts = projection.facts.slice();

  for (const change of event.stateChanges) {
    switch (change.type) {
      case 'character_location_changed': {
        characterLocations[change.characterId] = change.toLocationId;
        lastCharacterMovement[change.characterId] = {
          worldDay: event.worldDay,
          timeSlot: event.timeSlot,
          eventId: event.eventId,
        };
        break;
      }
      case 'relationship_changed': {
        const key = relationshipKey(change.sourceCharacterId, change.targetCharacterId);
        const prev = relationships[key] ?? { trust: 0, affection: 0, resentment: 0 };
        relationships[key] = {
          trust: clampRelationship(prev.trust + change.trustDelta),
          affection: clampRelationship(prev.affection + change.affectionDelta),
          resentment: clampRelationship(prev.resentment + change.resentmentDelta),
        };
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
        break;
      }
      case 'character_knowledge_learned': {
        const known = characterKnowledge[change.characterId] ?? [];
        characterKnowledge[change.characterId] = known.includes(change.factId)
          ? [...known]
          : [...known, change.factId];
        break;
      }
      case 'item_transferred': {
        itemOwners[change.itemId] = change.toOwnerId;
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
    lastCharacterMovement,
    itemOwners,
    characterKnowledge,
    relationships,
    facts,
  };
}
