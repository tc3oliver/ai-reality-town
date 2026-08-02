/**
 * Canonical event domain model — pure TypeScript types only.
 *
 * This module has NO Convex imports so that the reducer, replay, and all tests can run
 * with no database, no network, and no environment. The Convex schema/validators live
 * in `convex/canon/proposedEvent.ts` and `convex/canon/schema.ts`.
 */

import type {
  EventType,
  FactSubjectType,
  FactVisibility,
  KnowledgeSourceType,
  ProposedByType,
  TimeSlot,
} from './eventTypes';
import { CANON_SCHEMA_VERSION } from '../shared/constants';

export { CANON_SCHEMA_VERSION, CANON_VALIDATION_VERSION, SUPPORTED_SCHEMA_VERSIONS } from '../shared/constants';
export type {
  EventType,
  FactSubjectType,
  FactVisibility,
  KnowledgeSourceType,
  ProposedByType,
  TimeSlot,
} from './eventTypes';

/** Who/what proposed the event. */
export type ProposedBy = {
  type: ProposedByType;
  id?: string;
};

/**
 * A change to canonical world state. A discriminated union — the `type` field selects
 * the variant and its required fields. The core canon change is never an untyped bag;
 * `metadata` on the event carries non-core extras.
 */
export type StateChange =
  | {
      type: 'character_location_changed';
      characterId: string;
      fromLocationId: string;
      toLocationId: string;
    }
  | {
      type: 'relationship_changed';
      sourceCharacterId: string;
      targetCharacterId: string;
      trustDelta: number;
      affectionDelta: number;
      resentmentDelta: number;
      reason: string;
    }
  | {
      type: 'fact_created';
      subjectType: FactSubjectType;
      subjectId: string;
      predicate: string;
      value: string | number | boolean;
      visibility: FactVisibility;
    }
  | {
      type: 'character_life_changed';
      characterId: string;
      alive: boolean;
      reason: string;
    }
  | {
      type: 'character_knowledge_learned';
      characterId: string;
      factId: string;
      sourceType: KnowledgeSourceType;
      sourceEventId: string;
    }
  | {
      type: 'item_transferred';
      itemId: string;
      fromOwnerId?: string;
      toOwnerId: string;
      reason: string;
    };

/** A proposal submitted by a simulation provider (LLM, director, system, admin). */
export type ProposedEvent = {
  schemaVersion: typeof CANON_SCHEMA_VERSION;
  worldId: string;
  idempotencyKey: string;

  proposedBy: ProposedBy;

  worldDay: number;
  timeSlot: TimeSlot;
  eventType: EventType;

  locationId?: string;
  participantIds: string[];
  causedByEventIds: string[];
  publicSummary?: string;

  stateChanges: StateChange[];
  metadata?: Record<string, JsonValue>;
};

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export type ImmutableRuleEnforcement =
  | { type: 'narrative_only' }
  | { type: 'forbid_event_type'; eventType: EventType }
  | { type: 'max_event_participants'; maximum: number };

export type CanonImmutableRule = {
  id: string;
  description: string;
  enforcement: ImmutableRuleEnforcement;
};

/** Immutable world rules loaded by the commit pipeline and read by Canon validation. */
export type CanonRuleContext = {
  worldId: string;
  rules: CanonImmutableRule[];
  characterIds?: string[];
  locationIds?: string[];
  itemIds?: string[];
  locationConnections?: Record<string, string[]>;
  initialCharacterAlive?: Record<string, boolean>;
  initialItemOwners?: Record<string, string>;
  knownEventIds?: string[];
};

/** An accepted, immutable, append-only canonical event. */
export type AcceptedEvent = ProposedEvent & {
  /** Stable identity derived from world + sequence. */
  eventId: string;
  /** Server time at acceptance (commit step only; never read inside the reducer). */
  acceptedAt: number;
  /** Monotonic per-world sequence number. */
  sequenceNumber: number;
  /** Which validation rule set accepted this event. */
  validationVersion: string;
  /** Trace that proposed/committed this event; retained for audit and never inferred. */
  traceId: string;
};

/** A derived relationship between two characters in the projection. */
export type RelationshipState = {
  trust: number;
  affection: number;
  resentment: number;
};

/** A fact projected from accepted events. */
export type ProjectedFact = {
  subjectType: string;
  subjectId: string;
  predicate: string;
  value: string | number | boolean;
  visibility: string;
  sourceEventId: string;
};

/**
 * Foundation world projection — derived *only* from ordered accepted events. This is a
 * foundation read model, not a complete world state.
 */
export type WorldProjection = {
  worldId: string;
  /** Sequence number of the last event applied; -1 means "no events yet". */
  lastSequenceNumber: number;
  characterLocations: Record<string, string>;
  characterAlive: Record<string, boolean>;
  lastCharacterMovement: Record<string, { worldDay: number; timeSlot: TimeSlot; eventId: string }>;
  itemOwners: Record<string, string>;
  characterKnowledge: Record<string, string[]>;
  relationships: Record<string, RelationshipState>;
  facts: ProjectedFact[];
};

/** A projection with no events applied yet (the starting point for replay). */
export function emptyProjection(worldId: string): WorldProjection {
  return {
    worldId,
    lastSequenceNumber: -1,
    characterLocations: {},
    characterAlive: {},
    lastCharacterMovement: {},
    itemOwners: {},
    characterKnowledge: {},
    relationships: {},
    facts: [],
  };
}
