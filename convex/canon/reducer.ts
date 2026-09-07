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
  KnowledgeShareability,
  KnowledgeSourceType,
  RelationshipHistoryEntry,
  RelationshipState,
  RumorChainState,
  RumorStance,
  WorldProjection,
} from './model';
import {
  claimKey,
  deriveObjectiveTruthStatus,
  heldRumorRecord,
  rumorClaimKey,
  withDerivedRumorFields,
} from './rumorChain';

/**
 * Copy a rumor chain deeply enough that nothing the fold appends can reach the input projection.
 *
 * Every array is rebuilt rather than shared. `versions` and `corrections` in particular: the
 * whole point of FR-E005's append-only history is that a distortion cannot reach back and rewrite
 * what an earlier version said, and a shared array reference is exactly how that would happen
 * without anybody writing code that looks wrong.
 */
function cloneRumorChain(chain: RumorChainState): RumorChainState {
  return {
    ...chain,
    claim: { ...chain.claim },
    versions: chain.versions.map((version) => ({ ...version, createdAt: { ...version.createdAt } })),
    propagationChain: chain.propagationChain.map((hop) => ({ ...hop })),
    corrections: chain.corrections.map((correction) => ({ ...correction })),
  };
}

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
  const itemOwnershipHistory = Object.fromEntries(
    Object.entries(projection.itemOwnershipHistory ?? {}).map(([id, entries]) => [id, entries.map((entry) => ({ ...entry }))]),
  );
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
  const facts = projection.facts.map((fact) => ({ ...fact }));
  const worldEnvironment = Object.fromEntries(
    Object.entries(projection.worldEnvironment ?? {}).map(([key, value]) => [key, { ...value }]),
  );
  const environmentHistory = Object.fromEntries(
    Object.entries(projection.environmentHistory ?? {}).map(([key, values]) => [key, values.map((value) => ({ ...value }))]),
  );
  const locations = Object.fromEntries(
    Object.entries(projection.locations ?? {}).map(([id, location]) => [id, { ...location, connectedLocationIds: [...location.connectedLocationIds] }]),
  );
  const locationOccupancy: Record<string, string[]> = Object.fromEntries(
    Object.keys(locations).map((id) => [id, []]),
  );
  for (const [characterId, locationId] of Object.entries(characterLocations)) {
    locationOccupancy[locationId] = [...(locationOccupancy[locationId] ?? []), characterId].sort();
  }
  const organizations = Object.fromEntries(
    Object.entries(projection.organizations ?? {}).map(([id, organization]) => [id, { ...organization }]),
  );
  const organizationMembers: Record<string, string[]> = Object.fromEntries(
    Object.keys(organizations).map((id) => [id, []]),
  );
  for (const [characterId, state] of Object.entries(characterStates)) {
    for (const organizationId of state.organizationMemberships ?? []) {
      organizationMembers[organizationId] = [...(organizationMembers[organizationId] ?? []), characterId].sort();
    }
  }
  const organizationMembershipHistory = Object.fromEntries(
    Object.entries(projection.organizationMembershipHistory ?? {}).map(([id, entries]) => [id, entries.map((entry) => ({
      ...entry, addedOrganizationIds: [...entry.addedOrganizationIds], removedOrganizationIds: [...entry.removedOrganizationIds],
    }))]),
  );
  const rumors: Record<string, RumorChainState> = Object.fromEntries(
    Object.entries(projection.rumors ?? {}).map(([id, chain]) => [id, cloneRumorChain(chain)]),
  );

  const occurredAt = { worldDay: event.worldDay, timeSlot: event.timeSlot, eventId: event.eventId };
  /** Rumors this event touched, and fact keys it re-versioned — both drive the derived-field pass below. */
  const touchedRumorIds = new Set<string>();
  const revisedFactKeys = new Set<string>();

  /**
   * Record what one character now holds about one rumor, IN THE KNOWLEDGE LEDGER (FR-E005).
   *
   * There is no second store of per-character rumor belief, and this function is why. A rumor a
   * character carries is knowledge they carry: it has a source, a confidence, a shareability and
   * an authorization story, and the ledger already owns all four. Writing it anywhere else would
   * mean two answers to "what does this character know", and the day they disagreed the
   * authorized read would be the one that was wrong.
   *
   * Supersession reuses the ledger's own correction link rather than overwriting: the previous
   * record keeps its content and gains `correctedByKnowledgeId`, so "believed v1 until slot 3,
   * then heard v2" is still readable afterwards.
   */
  const recordRumorHolding = (input: {
    changeIndex: number;
    characterId: string;
    chain: RumorChainState;
    versionId: string;
    claimedValue: string | number | boolean;
    stance: RumorStance;
    confidence: number;
    sourceType: KnowledgeSourceType;
    shareability: KnowledgeShareability;
  }): void => {
    const known = characterKnowledge[input.characterId] ?? [];
    const knowledgeId = `${event.eventId}:knowledge:${input.changeIndex}`;
    const prior = known.find((record) =>
      record.rumorId === input.chain.rumorId && record.correctedByKnowledgeId === undefined);
    const next = known.map((record) => record.knowledgeId === prior?.knowledgeId
      ? { ...record, learnedAt: { ...record.learnedAt }, correctedByKnowledgeId: knowledgeId }
      : { ...record, learnedAt: { ...record.learnedAt } });
    next.push({
      knowledgeId,
      characterId: input.characterId,
      /**
       * Deliberately NOT a canon fact id. A rumor's claim is exactly the thing Canon has not
       * established, so pointing this at a real `fact_created` id would assert the fact exists.
       * `rumor:<id>` names the claim without conceding it, and cannot collide with the
       * `<eventId>:fact:<n>` ids the fact projection mints.
       */
      factId: `rumor:${input.chain.rumorId}`,
      beliefValue: input.claimedValue,
      // Objective standing AT THE MOMENT OF LEARNING, asked of Canon rather than of the author.
      // The chain carries the current answer; this records the one the world could have given
      // when this character heard it, which is what a misconception is made of.
      truthStatus: deriveObjectiveTruthStatus(facts, input.chain.claim, input.claimedValue),
      confidence: input.confidence,
      sourceType: input.sourceType,
      sourceEventId: event.eventId,
      learnedAt: { ...occurredAt },
      shareability: input.shareability,
      ...(prior === undefined ? {} : { correctsKnowledgeId: prior.knowledgeId }),
      rumorId: input.chain.rumorId,
      rumorVersionId: input.versionId,
      rumorStance: input.stance,
    });
    characterKnowledge[input.characterId] = next;
  };

  for (const [changeIndex, change] of event.stateChanges.entries()) {
    switch (change.type) {
      case 'character_location_changed': {
        if (characterLocations[change.characterId]) {
          locationOccupancy[change.fromLocationId] = (locationOccupancy[change.fromLocationId] ?? [])
            .filter((id) => id !== change.characterId);
        }
        locationOccupancy[change.toLocationId] = [...new Set([
          ...(locationOccupancy[change.toLocationId] ?? []), change.characterId,
        ])].sort();
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
      case 'location_state_changed': {
        locations[change.locationId] = {
          locationId: change.locationId, name: change.name, description: change.description,
          locationType: change.locationType, capacity: change.capacity,
          connectedLocationIds: [...change.connectedLocationIds], active: change.active,
          lastUpdatedEventId: event.eventId,
        };
        locationOccupancy[change.locationId] ??= [];
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
        const factId = `${event.eventId}:fact:${changeIndex}`;
        // Noted so the derived-field pass can re-ask Canon about every rumor claiming this
        // subject and predicate. A rumor becoming provably true or false is the world settling
        // the matter, and it happens here rather than in any rumor event.
        revisedFactKeys.add(claimKey(change.subjectType, change.subjectId, change.predicate));
        for (const existing of facts) {
          if (existing.validUntilEventId === null
            && existing.subjectType === change.subjectType
            && existing.subjectId === change.subjectId
            && existing.predicate === change.predicate) {
            existing.validUntilEventId = event.eventId;
          }
        }
        facts.push({
          factId,
          subjectType: change.subjectType,
          subjectId: change.subjectId,
          predicate: change.predicate,
          value: change.value,
          visibility: change.visibility,
          validFromEventId: event.eventId,
          validUntilEventId: null,
          sourceEventId: event.eventId,
        });
        if (change.subjectType === 'world' && change.subjectId === event.worldId) {
          const previous = environmentHistory[change.predicate] ?? [];
          const closed = previous.map((entry) => entry.validUntilEventId === null
            ? { ...entry, validUntilEventId: event.eventId }
            : { ...entry });
          const environment = {
            key: change.predicate, value: change.value, visibility: change.visibility,
            validFromEventId: event.eventId, validUntilEventId: null,
          };
          environmentHistory[change.predicate] = [...closed, environment];
          worldEnvironment[change.predicate] = { ...environment };
        }
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
        itemOwnershipHistory[change.itemId] = [...(itemOwnershipHistory[change.itemId] ?? []), {
          itemId: change.itemId, fromOwnerId: change.fromOwnerId, toOwnerId: change.toOwnerId,
          reason: change.reason, sourceEventId: event.eventId, sequenceNumber: event.sequenceNumber,
          worldDay: event.worldDay, timeSlot: event.timeSlot,
        }];
        break;
      }
      case 'character_state_changed': {
        const key = change.field === 'organization_memberships' ? 'organizationMemberships' : change.field;
        const value = Array.isArray(change.toValue) ? [...change.toValue] : change.toValue;
        const previousMemberships = change.field === 'organization_memberships'
          ? [...(characterStates[change.characterId]?.organizationMemberships ?? [])]
          : [];
        characterStates[change.characterId] = {
          ...characterStates[change.characterId],
          [key]: value,
          lastUpdatedEventId: event.eventId,
        };
        if (change.field === 'organization_memberships') {
          const previous = previousMemberships;
          const next = change.toValue as string[];
          const addedOrganizationIds = next.filter((id) => !previous.includes(id)).sort();
          const removedOrganizationIds = previous.filter((id) => !next.includes(id)).sort();
          for (const organizationId of removedOrganizationIds) {
            organizationMembers[organizationId] = (organizationMembers[organizationId] ?? []).filter((id) => id !== change.characterId);
          }
          for (const organizationId of addedOrganizationIds) {
            organizationMembers[organizationId] = [...new Set([...(organizationMembers[organizationId] ?? []), change.characterId])].sort();
          }
          organizationMembershipHistory[change.characterId] = [...(organizationMembershipHistory[change.characterId] ?? []), {
            characterId: change.characterId, addedOrganizationIds, removedOrganizationIds,
            reason: change.reason, sourceEventId: event.eventId, sequenceNumber: event.sequenceNumber,
            worldDay: event.worldDay, timeSlot: event.timeSlot,
          }];
        }
        break;
      }
      case 'organization_state_changed': {
        organizations[change.organizationId] = {
          organizationId: change.organizationId, name: change.name, description: change.description,
          organizationType: change.organizationType, headquartersLocationId: change.headquartersLocationId,
          active: change.active, lastUpdatedEventId: event.eventId,
        };
        organizationMembers[change.organizationId] ??= [];
        break;
      }
      case 'rumor_originated': {
        if (rumors[change.rumorId]) {
          // Reached only if canon validation was skipped: re-originating would replace a chain
          // and take its whole propagation history with it, which is a deletion wearing an
          // append's clothes.
          throw new CanonError(canonError('RUMOR_ALREADY_EXISTS', 'rumor already exists in this world', {
            rumorId: change.rumorId,
          }));
        }
        const versionId = `${event.eventId}:rumorversion:${changeIndex}`;
        const chain: RumorChainState = {
          rumorId: change.rumorId,
          originCharacterId: change.originCharacterId,
          originEventId: event.eventId,
          claim: {
            subjectType: change.claimSubjectType,
            subjectId: change.claimSubjectId,
            predicate: change.claimPredicate,
          },
          versions: [{
            versionId,
            content: change.content,
            claimedValue: change.claimedValue,
            authoredByCharacterId: change.originCharacterId,
            derivedFromVersionId: null,
            createdAt: { ...occurredAt },
          }],
          currentVersionId: versionId,
          // The origin IS a hop, with nobody on the other end. Recording it here rather than as a
          // special case means "how did this character come to hold it" has one answer shape for
          // every holder, including the first.
          propagationChain: [{
            hopIndex: 0,
            fromCharacterId: null,
            toCharacterId: change.originCharacterId,
            versionId,
            sourceEventId: event.eventId,
            sequenceNumber: event.sequenceNumber,
            worldDay: event.worldDay,
            timeSlot: event.timeSlot,
          }],
          corrections: [],
          knownCorrectionId: null,
          objectiveTruthStatus: 'unknown',
          credibility: 0,
          shareability: change.shareability,
          lastUpdatedEventId: event.eventId,
        };
        rumors[change.rumorId] = chain;
        recordRumorHolding({
          changeIndex,
          characterId: change.originCharacterId,
          chain,
          versionId,
          claimedValue: change.claimedValue,
          // An originator holds what they started. Whether they BELIEVE it is a separate
          // question with its own event: a liar starting a rumor they know to be false is a
          // `rumor_belief_changed` to `rejects`, which is a thing the record should show
          // explicitly rather than a thing inferred from an origin flag.
          stance: 'believes',
          confidence: change.confidence,
          sourceType: change.sourceType ?? 'inference',
          shareability: change.shareability,
        });
        touchedRumorIds.add(change.rumorId);
        break;
      }
      case 'rumor_propagated': {
        const chain = rumors[change.rumorId];
        if (!chain) {
          throw new CanonError(canonError('RUMOR_NOT_FOUND', 'rumor does not exist in this world', {
            rumorId: change.rumorId,
          }));
        }
        const senderRecord = heldRumorRecord(characterKnowledge, change.fromCharacterId, change.rumorId);
        const senderVersion = senderRecord?.rumorVersionId === undefined
          ? undefined
          : chain.versions.find(({ versionId }) => versionId === senderRecord.rumorVersionId);
        if (!senderVersion) {
          // The chain rule, enforced where it cannot be bypassed. Without it a rumor is a set of
          // unconnected sightings and 傳播鏈 means nothing.
          throw new CanonError(canonError('RUMOR_SOURCE_NOT_HELD', 'the telling character does not hold this rumor', {
            rumorId: change.rumorId, characterId: change.fromCharacterId,
          }));
        }
        const mutated = senderVersion.content !== change.content
          || senderVersion.claimedValue !== change.claimedValue;
        const versionId = mutated ? `${event.eventId}:rumorversion:${changeIndex}` : senderVersion.versionId;
        if (mutated) {
          // Appended, with the teller named as author and their own version as parent. The
          // parent's content is untouched, so the distortion is visible as a diff rather than
          // as an absence.
          chain.versions = [...chain.versions, {
            versionId,
            content: change.content,
            claimedValue: change.claimedValue,
            authoredByCharacterId: change.fromCharacterId,
            derivedFromVersionId: senderVersion.versionId,
            createdAt: { ...occurredAt },
          }];
          chain.currentVersionId = versionId;
        }
        chain.propagationChain = [...chain.propagationChain, {
          hopIndex: chain.propagationChain.length,
          fromCharacterId: change.fromCharacterId,
          toCharacterId: change.toCharacterId,
          versionId,
          sourceEventId: event.eventId,
          sequenceNumber: event.sequenceNumber,
          worldDay: event.worldDay,
          timeSlot: event.timeSlot,
        }];
        chain.lastUpdatedEventId = event.eventId;
        const priorHolding = heldRumorRecord(characterKnowledge, change.toCharacterId, change.rumorId);
        recordRumorHolding({
          changeIndex,
          characterId: change.toCharacterId,
          chain,
          versionId,
          claimedValue: change.claimedValue,
          // Hearing it again does not change your mind. A listener who already doubts keeps
          // doubting; only a `rumor_belief_changed` moves a stance, and a first hearing starts
          // at `believes` with whatever confidence the telling carried — a sceptical listener is
          // a believer at 0.1, not a separate stance.
          stance: priorHolding?.rumorStance ?? 'believes',
          confidence: change.confidence,
          // Pinned, not taken from the proposer: being told IS the source type, and letting a
          // propagation claim `observed` would forge first-hand provenance for hearsay.
          sourceType: 'told',
          shareability: chain.shareability,
        });
        touchedRumorIds.add(change.rumorId);
        break;
      }
      case 'rumor_belief_changed': {
        const chain = rumors[change.rumorId];
        if (!chain) {
          throw new CanonError(canonError('RUMOR_NOT_FOUND', 'rumor does not exist in this world', {
            rumorId: change.rumorId,
          }));
        }
        const prior = heldRumorRecord(characterKnowledge, change.characterId, change.rumorId);
        if (!prior || prior.rumorVersionId === undefined) {
          throw new CanonError(canonError('RUMOR_SOURCE_NOT_HELD', 'character holds no version of this rumor', {
            rumorId: change.rumorId, characterId: change.characterId,
          }));
        }
        const heldVersion = chain.versions.find(({ versionId }) => versionId === prior.rumorVersionId);
        recordRumorHolding({
          changeIndex,
          characterId: change.characterId,
          chain,
          // Changing your mind does not change which version you heard. Re-pointing the holder
          // at `currentVersionId` here is precisely the merge AC#2 forbids: it would quietly
          // upgrade a character to a wording nobody ever told them.
          versionId: prior.rumorVersionId,
          claimedValue: heldVersion?.claimedValue ?? prior.beliefValue,
          stance: change.stance,
          confidence: change.confidence,
          // Their provenance is unchanged: they still know it the way they came to know it.
          sourceType: prior.sourceType,
          shareability: prior.shareability,
        });
        touchedRumorIds.add(change.rumorId);
        break;
      }
      case 'rumor_corrected': {
        const chain = rumors[change.rumorId];
        if (!chain) {
          throw new CanonError(canonError('RUMOR_NOT_FOUND', 'rumor does not exist in this world', {
            rumorId: change.rumorId,
          }));
        }
        // Appended. Nothing in `versions` is edited, and no holder's belief moves: a correction
        // being ON THE RECORD is not the same as every character having heard it, and modelling
        // it as an instant town-wide update would delete the interesting part of FR-E005.
        chain.corrections = [...chain.corrections, {
          correctionId: `${event.eventId}:rumorcorrection:${changeIndex}`,
          correctsVersionId: chain.currentVersionId,
          content: change.correctedContent,
          correctedValue: change.correctedValue,
          issuedByCharacterId: change.correctingCharacterId,
          reason: change.reason,
          sourceEventId: event.eventId,
          worldDay: event.worldDay,
          timeSlot: event.timeSlot,
        }];
        chain.knownCorrectionId = `${event.eventId}:rumorcorrection:${changeIndex}`;
        chain.lastUpdatedEventId = event.eventId;
        touchedRumorIds.add(change.rumorId);
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

  /**
   * The derived pass (FR-E005 客觀真假 + 可信程度).
   *
   * Runs after every state change, not inside the rumor cases, because both derived values
   * depend on state a LATER change in the same event can still move: a `fact_created` can settle
   * a claim, and a `rumor_belief_changed` can change who counts as a believer. Deriving inside
   * the case would publish an answer computed from half an event.
   *
   * Scoped to what this event could have affected — the rumors it touched, plus any whose claim
   * a `fact_created` re-versioned. Recomputing every rumor in the world on every event would be
   * an unbounded per-event cost for a world that has been running long enough to have rumors.
   */
  if (touchedRumorIds.size > 0 || revisedFactKeys.size > 0) {
    for (const rumorId of Object.keys(rumors).sort()) {
      const chain = rumors[rumorId];
      if (!touchedRumorIds.has(rumorId) && !revisedFactKeys.has(rumorClaimKey(chain))) continue;
      rumors[rumorId] = withDerivedRumorFields(chain, facts, characterKnowledge);
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
    itemOwnershipHistory,
    characterKnowledge,
    characterMemories,
    relationships,
    relationshipHistory,
    facts,
    worldEnvironment,
    environmentHistory,
    locations,
    locationOccupancy,
    organizations,
    organizationMembers,
    organizationMembershipHistory,
    rumors,
  };
}
