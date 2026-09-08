/**
 * Canonical event domain model — pure TypeScript types only.
 *
 * This module has NO Convex imports so that the reducer, replay, and all tests can run
 * with no database, no network, and no environment. The Convex schema/validators live
 * in `convex/canon/proposedEvent.ts` and `convex/canon/schema.ts`.
 */

import type {
  EventType,
  CharacterStateField,
  FactSubjectType,
  FactVisibility,
  KnowledgeSourceType,
  KnowledgeTruthStatus,
  KnowledgeShareability,
  ProposedByType,
  RumorStance,
  TimeSlot,
} from './eventTypes';
// Type-only, and deliberately so: `personaDeviation.ts` imports the reducer at runtime, and the
// reducer imports this file for types alone. A value import in either direction would close a
// real cycle; these two erase at compile time and close nothing.
import type { PersonaAnchor } from './personaDeviation';
import { CANON_SCHEMA_VERSION } from '../shared/constants';

export { CANON_SCHEMA_VERSION, CANON_VALIDATION_VERSION, SUPPORTED_SCHEMA_VERSIONS } from '../shared/constants';
export type {
  EventType,
  CharacterStateField,
  FactSubjectType,
  FactVisibility,
  KnowledgeSourceType,
  KnowledgeTruthStatus,
  KnowledgeShareability,
  ProposedByType,
  RumorStance,
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
      /** Additive v1 fields; omitted legacy events normalize/reduce as zero. */
      fearDelta?: number;
      dependencyDelta?: number;
      familiarityDelta?: number;
      reason: string;
      /** Omitted legacy events are private by default. */
      visibility?: 'private' | 'public';
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
      type: 'location_state_changed';
      locationId: string;
      name: string;
      description: string;
      locationType: string;
      capacity: number;
      connectedLocationIds: string[];
      active: boolean;
      reason: string;
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
      beliefValue?: string | number | boolean;
      truthStatus?: KnowledgeTruthStatus;
      confidence?: number;
      shareability?: KnowledgeShareability;
      correctsKnowledgeId?: string;
    }
  | {
      type: 'character_memory_formed';
      characterId: string;
      content: string;
      interpretation: string;
      importance: number;
      emotionalWeight: number;
      confidence: number;
      visibility: KnowledgeShareability;
    }
  | {
      type: 'item_transferred';
      itemId: string;
      fromOwnerId: string | null;
      toOwnerId: string;
      reason: string;
    }
  | {
      type: 'character_state_changed';
      characterId: string;
      field: CharacterStateField;
      fromValue?: string | boolean | string[];
      toValue: string | boolean | string[];
      reason: string;
    }
  | {
      type: 'organization_state_changed';
      organizationId: string;
      name: string;
      description: string;
      organizationType: string;
      headquartersLocationId: string | null;
      active: boolean;
      reason: string;
    }
  /**
   * FR-E005. A character starts a rumor.
   *
   * The claim is REQUIRED and is fact-SHAPED without being a fact: subject, predicate and the
   * value the rumor asserts. That shape is what makes 客觀真假 derivable — the projection can
   * compare the claim against Canon instead of asking the author whether their own rumor is
   * true. A `claimedValue` that happens to match Canon does not create, imply or become a
   * `fact_created`; see `RUMOR_CANNOT_BECOME_FACT` in `validators.ts`.
   *
   * `sourceType` is the originator's own provenance and may be anything EXCEPT `told`: at an
   * origin there is, by definition, nobody who told them. Propagation pins `told` and does not
   * take it from the proposer at all.
   */
  | {
      type: 'rumor_originated';
      rumorId: string;
      originCharacterId: string;
      content: string;
      claimSubjectType: FactSubjectType;
      claimSubjectId: string;
      claimPredicate: string;
      claimedValue: string | number | boolean;
      confidence: number;
      shareability: KnowledgeShareability;
      /** Omitted legacy events normalize to `inference`. Never `told` — see above. */
      sourceType?: Exclude<KnowledgeSourceType, 'told'>;
    }
  /**
   * FR-E005. One hop: `fromCharacterId` tells `toCharacterId`.
   *
   * `content`/`claimedValue` are what the TELLER said this time. Identical to the version they
   * hold means the rumor travelled intact; different means it mutated, and a new version is
   * authored with the teller named as its author and their version as its parent. Prior versions
   * are never rewritten, so "who said what, when" survives every distortion.
   *
   * The teller must already hold the rumor. That single rule is what makes a propagation CHAIN
   * a chain rather than a set of unrelated sightings.
   */
  | {
      type: 'rumor_propagated';
      rumorId: string;
      fromCharacterId: string;
      toCharacterId: string;
      content: string;
      claimedValue: string | number | boolean;
      confidence: number;
    }
  /** FR-E005. A holder changes what they make of a rumor they already hold. */
  | {
      type: 'rumor_belief_changed';
      rumorId: string;
      characterId: string;
      stance: RumorStance;
      confidence: number;
    }
  /**
   * FR-E005 「已知更正」. A correction is APPENDED to the chain and supersedes nothing in place:
   * the version it corrects keeps its original content, because "who believed the wrong version,
   * and for how long" is the question this feature exists to answer.
   *
   * It deliberately does NOT change anybody's belief. A correction being known to the world is
   * not the same as every character having heard and accepted it; that takes its own
   * `rumor_propagated` and `rumor_belief_changed` events, which is the honest model of how a
   * correction actually spreads.
   */
  | {
      type: 'rumor_corrected';
      rumorId: string;
      /** `null` for a world/system correction, which only an admin or system may propose. */
      correctingCharacterId: string | null;
      correctedContent: string;
      correctedValue: string | number | boolean;
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
  organizationIds?: string[];
  locationConnections?: Record<string, string[]>;
  initialCharacterAlive?: Record<string, boolean>;
  initialItemOwners?: Record<string, string>;
  /**
   * Where the seed placed each character (ART-58). Canon itself never validates against it — a
   * character with no `characterLocations` entry is "being placed" by their first movement — but
   * the continuity evaluator needs it to say where a participant was BEFORE they ever moved, and
   * carrying it here keeps the seed's initial state in one context rather than two.
   */
  initialCharacterLocations?: Record<string, string>;
  knownEventIds?: string[];
  /**
   * FR-B003 seeded persona anchors, keyed by character id. Optional and absent-means-inert, like
   * every other reference set here: a world with no anchors (unseeded, or seeded by an older
   * bundle) commits exactly as it did before persona detection existed.
   */
  characterPersonas?: Record<string, PersonaAnchor>;
  /**
   * `eventId -> participantIds` for accepted events, supplied alongside `knownEventIds` by the
   * commit pipeline out of events it has already loaded. FR-B003 uses it to tell a cited cause
   * that materially involved a character from one that merely exists.
   */
  knownEventParticipantIds?: Record<string, readonly string[]>;
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
  fear: number;
  dependency: number;
  familiarity: number;
  lastUpdatedEventId: string;
};

/** Internal causal history. Reasons may contain secrets and are never a public read model. */
export type RelationshipHistoryEntry = {
  sourceCharacterId: string;
  targetCharacterId: string;
  trustDelta: number;
  affectionDelta: number;
  resentmentDelta: number;
  fearDelta: number;
  dependencyDelta: number;
  familiarityDelta: number;
  reason: string;
  visibility: 'private' | 'public';
  sourceEventId: string;
  sequenceNumber: number;
  worldDay: number;
  timeSlot: TimeSlot;
};

/** A fact projected from accepted events. */
export type ProjectedFact = {
  factId: string;
  subjectType: FactSubjectType;
  subjectId: string;
  predicate: string;
  value: string | number | boolean;
  visibility: FactVisibility;
  validFromEventId: string;
  validUntilEventId: string | null;
  /** Backward-compatible provenance alias for readers migrating to validFromEventId. */
  sourceEventId: string;
};

export type ProjectedEnvironmentValue = {
  key: string;
  value: string | number | boolean;
  visibility: FactVisibility;
  validFromEventId: string;
  validUntilEventId: string | null;
};

export type ProjectedLocation = {
  locationId: string;
  name: string;
  description: string;
  locationType: string;
  capacity: number;
  connectedLocationIds: string[];
  active: boolean;
  lastUpdatedEventId: string;
};

export type ItemOwnershipHistoryEntry = {
  itemId: string;
  fromOwnerId: string | null;
  toOwnerId: string;
  reason: string;
  sourceEventId: string;
  sequenceNumber: number;
  worldDay: number;
  timeSlot: TimeSlot;
};

export type ProjectedOrganization = {
  organizationId: string;
  name: string;
  description: string;
  organizationType: string;
  headquartersLocationId: string | null;
  active: boolean;
  lastUpdatedEventId: string;
};

export type OrganizationMembershipHistoryEntry = {
  characterId: string;
  addedOrganizationIds: string[];
  removedOrganizationIds: string[];
  reason: string;
  sourceEventId: string;
  sequenceNumber: number;
  worldDay: number;
  timeSlot: TimeSlot;
};

export type CharacterCurrentState = {
  currentLocationId?: string;
  health?: string;
  emotion?: string;
  finance?: string;
  occupation?: string;
  organizationMemberships?: string[];
  availability?: string;
  alive?: boolean;
  active?: boolean;
  lastUpdatedEventId: string;
};

export type CharacterKnowledgeRecord = {
  knowledgeId: string;
  characterId: string;
  factId: string;
  beliefValue: string | number | boolean;
  truthStatus: KnowledgeTruthStatus;
  confidence: number;
  sourceType: KnowledgeSourceType;
  sourceEventId: string;
  learnedAt: { worldDay: number; timeSlot: TimeSlot; eventId: string };
  shareability: KnowledgeShareability;
  correctsKnowledgeId?: string;
  correctedByKnowledgeId?: string;
  /**
   * FR-E005 rumor provenance. Present only on records the rumor verbs produced.
   *
   * This is the reason there is no separate "who holds which rumor" table. A rumor a character
   * holds IS knowledge they hold, with a source and a confidence, and the ledger already answers
   * "what does this character know, and how do they know it" with authorization attached. A
   * parallel store would answer the same question a second time, and the two would eventually
   * disagree about a character who was told something and then died.
   *
   * `rumorVersionId` is what makes AC#2 representable: two characters can hold the SAME
   * `rumorId` at DIFFERENT versions, with different stances and different confidence, and
   * nothing anywhere merges them.
   */
  rumorId?: string;
  rumorVersionId?: string;
  rumorStance?: RumorStance;
};

/**
 * One authored wording of a rumor. Immutable once written — a distortion appends, a correction
 * appends, and neither edits.
 */
export type RumorVersionRecord = {
  versionId: string;
  content: string;
  claimedValue: string | number | boolean;
  /** Who first said it this way: the originator, or the teller who changed it in the retelling. */
  authoredByCharacterId: string;
  derivedFromVersionId: string | null;
  createdAt: { worldDay: number; timeSlot: TimeSlot; eventId: string };
};

/** One telling. `fromCharacterId` is `null` exactly once per rumor: at its origin. */
export type RumorPropagationHop = {
  hopIndex: number;
  fromCharacterId: string | null;
  toCharacterId: string;
  /** The version the receiver came away holding. */
  versionId: string;
  sourceEventId: string;
  sequenceNumber: number;
  worldDay: number;
  timeSlot: TimeSlot;
};

export type RumorCorrectionRecord = {
  correctionId: string;
  /** Derived, never authored: a correction addresses whatever the current version was. */
  correctsVersionId: string;
  content: string;
  correctedValue: string | number | boolean;
  issuedByCharacterId: string | null;
  reason: string;
  sourceEventId: string;
  worldDay: number;
  timeSlot: TimeSlot;
};

/**
 * A rumor's world-level record: the six things FR-E005 names, and nothing a character owns.
 *
 * Per-character belief is deliberately absent — it lives in `characterKnowledge`, keyed by
 * `rumorId`. What is here is what the WORLD can say about the rumor; what a character makes of
 * it is theirs.
 */
export type RumorChainState = {
  rumorId: string;
  /** 原始來源. */
  originCharacterId: string;
  originEventId: string;
  claim: { subjectType: FactSubjectType; subjectId: string; predicate: string };
  versions: RumorVersionRecord[];
  /** 當前版本 — the most recently authored wording, not "the one everyone holds". */
  currentVersionId: string;
  /** 傳播鏈, in the order it happened. */
  propagationChain: RumorPropagationHop[];
  /** 已知更正, appended. */
  corrections: RumorCorrectionRecord[];
  knownCorrectionId: string | null;
  /**
   * 客觀真假 — DERIVED by comparing the current version's claim against Canon, never authored.
   * `unknown` while Canon has said nothing about the claim, which is most rumors most of the time.
   */
  objectiveTruthStatus: KnowledgeTruthStatus;
  /** 可信程度 — DERIVED from what its holders currently make of it. See `rumorChain.ts`. */
  credibility: number;
  shareability: KnowledgeShareability;
  lastUpdatedEventId: string;
};

export type CharacterMemoryRecord = {
  memoryId: string;
  characterId: string;
  content: string;
  interpretation: string;
  importance: number;
  emotionalWeight: number;
  confidence: number;
  visibility: KnowledgeShareability;
  sourceEventId: string;
  createdAt: { worldDay: number; timeSlot: TimeSlot; eventId: string };
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
  characterStates: Record<string, CharacterCurrentState>;
  lastCharacterMovement: Record<string, { worldDay: number; timeSlot: TimeSlot; eventId: string }>;
  itemOwners: Record<string, string>;
  itemOwnershipHistory: Record<string, ItemOwnershipHistoryEntry[]>;
  characterKnowledge: Record<string, CharacterKnowledgeRecord[]>;
  characterMemories: Record<string, CharacterMemoryRecord[]>;
  relationships: Record<string, RelationshipState>;
  relationshipHistory: Record<string, RelationshipHistoryEntry[]>;
  facts: ProjectedFact[];
  /** Current world-subject facts keyed by predicate. */
  worldEnvironment: Record<string, ProjectedEnvironmentValue>;
  /** All environment versions retained for audit/replay. */
  environmentHistory: Record<string, ProjectedEnvironmentValue[]>;
  locations: Record<string, ProjectedLocation>;
  locationOccupancy: Record<string, string[]>;
  organizations: Record<string, ProjectedOrganization>;
  organizationMembers: Record<string, string[]>;
  organizationMembershipHistory: Record<string, OrganizationMembershipHistoryEntry[]>;
  /** FR-E005 rumor chains, keyed by rumorId. Derived only from accepted events. */
  rumors: Record<string, RumorChainState>;
};

/** A projection with no events applied yet (the starting point for replay). */
export function emptyProjection(worldId: string): WorldProjection {
  return {
    worldId,
    lastSequenceNumber: -1,
    characterLocations: {},
    characterAlive: {},
    characterStates: {},
    lastCharacterMovement: {},
    itemOwners: {},
    itemOwnershipHistory: {},
    characterKnowledge: {},
    characterMemories: {},
    relationships: {},
    relationshipHistory: {},
    facts: [],
    worldEnvironment: {},
    environmentHistory: {},
    locations: {},
    locationOccupancy: {},
    organizations: {},
    organizationMembers: {},
    organizationMembershipHistory: {},
    rumors: {},
  };
}
