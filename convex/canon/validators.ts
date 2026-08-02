/**
 * Two-layer validation for proposed canon events.
 *
 * - {@link validateEventStructure}: shape of a single event (no projection needed).
 * - {@link validateCanon}: business rules against the current world projection.
 *
 * Pure module. Both functions return the first {@link CanonValidationError} they find, or
 * `null` when valid. Callers branch on `error.code`, never on message text.
 */

import {
  MAX_CAUSED_BY_EVENT_IDS,
  MAX_PARTICIPANTS,
  MAX_PUBLIC_SUMMARY_LENGTH,
  MAX_STATE_CHANGES,
} from '../shared/constants';
import { CanonValidationError, canonError } from '../shared/errors';
import {
  isEventType,
  isCharacterStateField,
  isFactSubjectType,
  isFactVisibility,
  isKnowledgeSourceType,
  isProposedByType,
  isStateChangeType,
  isTimeSlot,
} from './eventTypes';
import type { CanonRuleContext, ProposedEvent, WorldProjection } from './model';

// --- primitive guards -------------------------------------------------------

const isString = (v: unknown): v is string => typeof v === 'string';
const isNonEmptyString = (v: unknown): v is string => isString(v) && v.length > 0;
const isInteger = (v: unknown): v is number =>
  typeof v === 'number' && Number.isInteger(v);
const isFiniteNumber = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v);
const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isPrimitiveValue = (v: unknown): v is string | number | boolean =>
  typeof v === 'string' || (typeof v === 'number' && Number.isFinite(v)) || typeof v === 'boolean';

const REFERENCE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:#|\-]{0,159}$/u;
const isReference = (v: unknown): v is string =>
  isString(v) && REFERENCE_PATTERN.test(v);

function unknownKeyError(
  value: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
): CanonValidationError | null {
  const fields = Object.keys(value).filter((key) => !allowed.includes(key));
  return fields.length === 0
    ? null
    : canonError('INVALID_EVENT_SHAPE', 'object contains unknown fields', { fields }, path);
}

function validateJsonValue(
  value: unknown,
  path: string,
  ancestors: Set<object>,
): CanonValidationError | null {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return null;
  if (typeof value === 'number') {
    return Number.isFinite(value)
      ? null
      : canonError('INVALID_EVENT_SHAPE', 'JSON number must be finite', undefined, path);
  }
  if (typeof value !== 'object' || value === undefined) {
    return canonError('INVALID_EVENT_SHAPE', 'metadata must contain JSON-safe values', undefined, path);
  }
  if (ancestors.has(value)) {
    return canonError('INVALID_EVENT_SHAPE', 'metadata must not contain cycles', undefined, path);
  }
  ancestors.add(value);
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index++) {
      const error = validateJsonValue(value[index], `${path}[${index}]`, ancestors);
      if (error) return error;
    }
  } else {
    for (const [key, entry] of Object.entries(value)) {
      const error = validateJsonValue(entry, `${path}.${key}`, ancestors);
      if (error) return error;
    }
  }
  ancestors.delete(value);
  return null;
}

function hasDuplicates(values: string[]): boolean {
  const seen = new Set<string>();
  for (const v of values) {
    if (seen.has(v)) return true;
    seen.add(v);
  }
  return false;
}

// --- structural validation -------------------------------------------------

function validateStateChangeStructure(change: unknown, path: string): CanonValidationError | null {
  if (!isPlainObject(change)) {
    return canonError('INVALID_EVENT_SHAPE', 'state change must be an object', undefined, path);
  }
  const type = change.type;
  if (!isStateChangeType(type)) {
    return canonError('INVALID_EVENT_SHAPE', 'state change has unknown type', { type }, path);
  }
  switch (type) {
    case 'character_location_changed':
      {
        const error = unknownKeyError(change, ['type', 'characterId', 'fromLocationId', 'toLocationId'], path);
        if (error) return error;
      }
      if (!isReference(change.characterId))
        return canonError('INVALID_EVENT_SHAPE', 'characterId has invalid reference format', undefined, `${path}.characterId`);
      if (!isReference(change.fromLocationId))
        return canonError('INVALID_EVENT_SHAPE', 'fromLocationId has invalid reference format', undefined, `${path}.fromLocationId`);
      if (!isReference(change.toLocationId))
        return canonError('INVALID_EVENT_SHAPE', 'toLocationId has invalid reference format', undefined, `${path}.toLocationId`);
      return null;
    case 'relationship_changed':
      {
        const error = unknownKeyError(change, [
          'type', 'sourceCharacterId', 'targetCharacterId', 'trustDelta', 'affectionDelta',
          'resentmentDelta', 'reason',
        ], path);
        if (error) return error;
      }
      if (!isReference(change.sourceCharacterId))
        return canonError('INVALID_EVENT_SHAPE', 'sourceCharacterId has invalid reference format', undefined, `${path}.sourceCharacterId`);
      if (!isReference(change.targetCharacterId))
        return canonError('INVALID_EVENT_SHAPE', 'targetCharacterId has invalid reference format', undefined, `${path}.targetCharacterId`);
      if (!isFiniteNumber(change.trustDelta))
        return canonError('INVALID_EVENT_SHAPE', 'trustDelta must be a finite number', undefined, `${path}.trustDelta`);
      if (!isFiniteNumber(change.affectionDelta))
        return canonError('INVALID_EVENT_SHAPE', 'affectionDelta must be a finite number', undefined, `${path}.affectionDelta`);
      if (!isFiniteNumber(change.resentmentDelta))
        return canonError('INVALID_EVENT_SHAPE', 'resentmentDelta must be a finite number', undefined, `${path}.resentmentDelta`);
      if (!isNonEmptyString(change.reason))
        return canonError('INVALID_EVENT_SHAPE', 'reason must be a non-empty string', undefined, `${path}.reason`);
      return null;
    case 'fact_created':
      {
        const error = unknownKeyError(change, [
          'type', 'subjectType', 'subjectId', 'predicate', 'value', 'visibility',
        ], path);
        if (error) return error;
      }
      // subjectId emptiness is a *canon* rule (INVALID_FACT_SUBJECT); here we only
      // require it is a string so the canon code path stays reachable/testable.
      if (!isString(change.subjectId))
        return canonError('INVALID_EVENT_SHAPE', 'subjectId must be a string', undefined, `${path}.subjectId`);
      if (change.subjectId.length > 0 && !isReference(change.subjectId))
        return canonError('INVALID_EVENT_SHAPE', 'subjectId has invalid reference format', undefined, `${path}.subjectId`);
      if (!isFactSubjectType(change.subjectType))
        return canonError('INVALID_EVENT_SHAPE', 'subjectType is not supported', { subjectType: change.subjectType }, `${path}.subjectType`);
      if (!isNonEmptyString(change.predicate))
        return canonError('INVALID_EVENT_SHAPE', 'predicate must be a non-empty string', undefined, `${path}.predicate`);
      if (!isPrimitiveValue(change.value))
        return canonError('INVALID_EVENT_SHAPE', 'value must be string | number | boolean', undefined, `${path}.value`);
      if (!isFactVisibility(change.visibility))
        return canonError('INVALID_EVENT_SHAPE', 'visibility is not supported', { visibility: change.visibility }, `${path}.visibility`);
      return null;
    case 'character_life_changed': {
      const error = unknownKeyError(change, ['type', 'characterId', 'alive', 'reason'], path);
      if (error) return error;
      if (!isReference(change.characterId))
        return canonError('INVALID_EVENT_SHAPE', 'characterId has invalid reference format', undefined, `${path}.characterId`);
      if (typeof change.alive !== 'boolean')
        return canonError('INVALID_EVENT_SHAPE', 'alive must be a boolean', undefined, `${path}.alive`);
      if (!isNonEmptyString(change.reason))
        return canonError('INVALID_EVENT_SHAPE', 'reason must be a non-empty string', undefined, `${path}.reason`);
      return null;
    }
    case 'character_knowledge_learned': {
      const error = unknownKeyError(change, ['type', 'characterId', 'factId', 'sourceType', 'sourceEventId'], path);
      if (error) return error;
      if (!isReference(change.characterId))
        return canonError('INVALID_EVENT_SHAPE', 'characterId has invalid reference format', undefined, `${path}.characterId`);
      if (!isReference(change.factId))
        return canonError('INVALID_EVENT_SHAPE', 'factId has invalid reference format', undefined, `${path}.factId`);
      if (!isKnowledgeSourceType(change.sourceType))
        return canonError('INVALID_EVENT_SHAPE', 'sourceType is unsupported', undefined, `${path}.sourceType`);
      if (!isReference(change.sourceEventId))
        return canonError('INVALID_EVENT_SHAPE', 'sourceEventId has invalid reference format', undefined, `${path}.sourceEventId`);
      return null;
    }
    case 'item_transferred': {
      const error = unknownKeyError(change, ['type', 'itemId', 'fromOwnerId', 'toOwnerId', 'reason'], path);
      if (error) return error;
      if (!isReference(change.itemId))
        return canonError('INVALID_EVENT_SHAPE', 'itemId has invalid reference format', undefined, `${path}.itemId`);
      if (change.fromOwnerId !== undefined && !isReference(change.fromOwnerId))
        return canonError('INVALID_EVENT_SHAPE', 'fromOwnerId has invalid reference format', undefined, `${path}.fromOwnerId`);
      if (!isReference(change.toOwnerId))
        return canonError('INVALID_EVENT_SHAPE', 'toOwnerId has invalid reference format', undefined, `${path}.toOwnerId`);
      if (!isNonEmptyString(change.reason))
        return canonError('INVALID_EVENT_SHAPE', 'reason must be a non-empty string', undefined, `${path}.reason`);
      return null;
    }
    case 'character_state_changed': {
      const error = unknownKeyError(change, ['type', 'characterId', 'field', 'fromValue', 'toValue', 'reason'], path);
      if (error) return error;
      if (!isReference(change.characterId))
        return canonError('INVALID_EVENT_SHAPE', 'characterId has invalid reference format', undefined, `${path}.characterId`);
      if (!isCharacterStateField(change.field))
        return canonError('INVALID_EVENT_SHAPE', 'character state field is unsupported', undefined, `${path}.field`);
      const validValue = (value: unknown): boolean => change.field === 'active'
        ? typeof value === 'boolean'
        : change.field === 'organization_memberships'
          ? Array.isArray(value) && value.every(isReference) && !hasDuplicates(value)
          : isNonEmptyString(value);
      if (change.fromValue !== undefined && !validValue(change.fromValue))
        return canonError('INVALID_EVENT_SHAPE', 'fromValue does not match the selected state field', undefined, `${path}.fromValue`);
      if (!validValue(change.toValue))
        return canonError('INVALID_EVENT_SHAPE', 'toValue does not match the selected state field', undefined, `${path}.toValue`);
      if (!isNonEmptyString(change.reason))
        return canonError('INVALID_EVENT_SHAPE', 'reason must be a non-empty string', undefined, `${path}.reason`);
      return null;
    }
    default:
      return canonError('INVALID_EVENT_SHAPE', 'unhandled state change type', { type }, path);
  }
}

/**
 * Validate the shape of a single proposed event. Returns the first error or `null`.
 * Does not touch any projection, database, clock, or randomness.
 */
export function validateEventStructure(event: unknown): CanonValidationError | null {
  if (!isPlainObject(event)) {
    return canonError('INVALID_EVENT_SHAPE', 'event must be a plain object');
  }
  {
    const error = unknownKeyError(event, [
      'schemaVersion', 'worldId', 'idempotencyKey', 'proposedBy', 'worldDay', 'timeSlot',
      'eventType', 'locationId', 'participantIds', 'causedByEventIds', 'publicSummary',
      'stateChanges', 'metadata',
    ], '$');
    if (error) return error;
  }

  // schemaVersion — type first (shape), then membership (version policy).
  if (!isInteger(event.schemaVersion)) {
    return canonError('INVALID_EVENT_SHAPE', 'schemaVersion must be an integer', undefined, 'schemaVersion');
  }
  if (event.schemaVersion !== 1) {
    return canonError('UNSUPPORTED_SCHEMA_VERSION', 'only schemaVersion 1 is supported', {
      schemaVersion: event.schemaVersion,
    }, 'schemaVersion');
  }

  if (!isReference(event.worldId))
    return canonError('INVALID_EVENT_SHAPE', 'worldId has invalid reference format', undefined, 'worldId');
  if (!isReference(event.idempotencyKey))
    return canonError('INVALID_EVENT_SHAPE', 'idempotencyKey has invalid key format', undefined, 'idempotencyKey');

  if (!isPlainObject(event.proposedBy))
    return canonError('INVALID_EVENT_SHAPE', 'proposedBy must be an object', undefined, 'proposedBy');
  {
    const error = unknownKeyError(event.proposedBy, ['type', 'id'], 'proposedBy');
    if (error) return error;
  }
  if (!isProposedByType(event.proposedBy.type))
    return canonError('INVALID_EVENT_SHAPE', 'proposedBy.type is not supported', { type: event.proposedBy.type }, 'proposedBy.type');
  if (event.proposedBy.id !== undefined && !isReference(event.proposedBy.id))
    return canonError('INVALID_EVENT_SHAPE', 'proposedBy.id has invalid reference format', undefined, 'proposedBy.id');

  if (!Number.isSafeInteger(event.worldDay) || (event.worldDay as number) < 0)
    return canonError('INVALID_EVENT_SHAPE', 'worldDay must be a non-negative safe integer', undefined, 'worldDay');
  if (!isTimeSlot(event.timeSlot))
    return canonError('INVALID_EVENT_SHAPE', 'timeSlot is not supported', { timeSlot: event.timeSlot }, 'timeSlot');
  if (!isEventType(event.eventType))
    return canonError('INVALID_EVENT_SHAPE', 'eventType is not supported', { eventType: event.eventType }, 'eventType');

  const remediationTypes = new Set(['correction', 'compensation', 'retcon']);
  if (remediationTypes.has(event.eventType as string) && event.proposedBy.type !== 'admin')
    return canonError('INVALID_EVENT_SHAPE', 'remediation events must be proposed by an administrator', undefined, 'proposedBy.type');

  if (event.locationId !== undefined && !isReference(event.locationId))
    return canonError('INVALID_EVENT_SHAPE', 'locationId has invalid reference format', undefined, 'locationId');

  // participantIds — non-empty strings, bounded, no empties, no duplicates.
  if (!Array.isArray(event.participantIds))
    return canonError('INVALID_EVENT_SHAPE', 'participantIds must be an array', undefined, 'participantIds');
  if (event.participantIds.length > MAX_PARTICIPANTS)
    return canonError('INVALID_EVENT_SHAPE', 'too many participants', { count: event.participantIds.length, max: MAX_PARTICIPANTS }, 'participantIds');
  for (const p of event.participantIds) {
    if (!isReference(p))
      return canonError('INVALID_EVENT_SHAPE', 'participantIds contain an invalid reference', undefined, 'participantIds');
  }
  if (hasDuplicates(event.participantIds as string[]))
    return canonError('INVALID_EVENT_SHAPE', 'participantIds must not contain duplicates', undefined, 'participantIds');

  // causedByEventIds — non-empty strings, bounded, no self-reference.
  if (!Array.isArray(event.causedByEventIds))
    return canonError('INVALID_EVENT_SHAPE', 'causedByEventIds must be an array', undefined, 'causedByEventIds');
  if (event.causedByEventIds.length > MAX_CAUSED_BY_EVENT_IDS)
    return canonError('INVALID_EVENT_SHAPE', 'too many causedByEventIds', { count: event.causedByEventIds.length, max: MAX_CAUSED_BY_EVENT_IDS }, 'causedByEventIds');
  for (const c of event.causedByEventIds) {
    if (!isReference(c))
      return canonError('INVALID_EVENT_SHAPE', 'causedByEventIds contain an invalid reference', undefined, 'causedByEventIds');
    if (c === event.idempotencyKey)
      return canonError('INVALID_EVENT_SHAPE', 'causedByEventIds must not reference the event itself', { idempotencyKey: c }, 'causedByEventIds');
  }
  if (remediationTypes.has(event.eventType as string) && event.causedByEventIds.length === 0)
    return canonError('INVALID_EVENT_SHAPE', 'remediation events must reference corrected events', undefined, 'causedByEventIds');

  if (event.publicSummary !== undefined) {
    if (!isString(event.publicSummary))
      return canonError('INVALID_EVENT_SHAPE', 'publicSummary must be a string', undefined, 'publicSummary');
    if (event.publicSummary.length > MAX_PUBLIC_SUMMARY_LENGTH)
      return canonError('INVALID_EVENT_SHAPE', 'publicSummary too long', { length: event.publicSummary.length, max: MAX_PUBLIC_SUMMARY_LENGTH }, 'publicSummary');
  }

  // stateChanges — non-empty, bounded, each well-formed.
  if (!Array.isArray(event.stateChanges))
    return canonError('INVALID_EVENT_SHAPE', 'stateChanges must be an array', undefined, 'stateChanges');
  if (event.stateChanges.length === 0)
    return canonError('INVALID_EVENT_SHAPE', 'stateChanges must not be empty', undefined, 'stateChanges');
  if (event.stateChanges.length > MAX_STATE_CHANGES)
    return canonError('INVALID_EVENT_SHAPE', 'too many stateChanges', { count: event.stateChanges.length, max: MAX_STATE_CHANGES }, 'stateChanges');
  for (let i = 0; i < event.stateChanges.length; i++) {
    const err = validateStateChangeStructure(event.stateChanges[i], `stateChanges[${i}]`);
    if (err) return err;
  }

  if (event.metadata !== undefined) {
    if (!isPlainObject(event.metadata))
      return canonError('INVALID_EVENT_SHAPE', 'metadata must be an object', undefined, 'metadata');
    const error = validateJsonValue(event.metadata, 'metadata', new Set<object>());
    if (error) return error;
  }

  return null;
}

/**
 * Validate canon business rules against the current projection. Assumes the event has
 * already passed structural validation. Returns the first error or `null`.
 */
export function validateCanon(
  event: ProposedEvent,
  projection: WorldProjection,
  ruleContext?: CanonRuleContext | null,
): CanonValidationError | null {
  if (ruleContext && ruleContext.worldId !== event.worldId) {
    return canonError('IMMUTABLE_WORLD_RULE_VIOLATION', 'rule context belongs to a different world', {
      eventWorldId: event.worldId,
      ruleWorldId: ruleContext.worldId,
    });
  }
  const knownCharacters = ruleContext?.characterIds ? new Set(ruleContext.characterIds) : null;
  const knownLocations = ruleContext?.locationIds ? new Set(ruleContext.locationIds) : null;
  const knownItems = ruleContext?.itemIds ? new Set(ruleContext.itemIds) : null;
  const knownOrganizations = ruleContext?.organizationIds ? new Set(ruleContext.organizationIds) : null;
  const knownEvents = ruleContext?.knownEventIds ? new Set(ruleContext.knownEventIds) : null;
  const alive = (characterId: string): boolean =>
    projection.characterAlive[characterId]
      ?? ruleContext?.initialCharacterAlive?.[characterId]
      ?? true;

  if (event.locationId !== undefined && knownLocations && !knownLocations.has(event.locationId)) {
    return canonError('UNKNOWN_LOCATION_REFERENCE', 'event location does not exist', { locationId: event.locationId }, 'locationId');
  }
  for (const characterId of event.participantIds) {
    if (knownCharacters && !knownCharacters.has(characterId)) {
      return canonError('UNKNOWN_CHARACTER_REFERENCE', 'event participant does not exist', { characterId }, 'participantIds');
    }
    if (!alive(characterId)) {
      return canonError('DEAD_CHARACTER_ACTION', 'dead characters cannot participate in normal events', { characterId }, 'participantIds');
    }
  }
  if (knownEvents) {
    for (const eventId of event.causedByEventIds) {
      if (!knownEvents.has(eventId)) {
        return canonError('UNKNOWN_EVENT_REFERENCE', 'causal event does not exist', { eventId }, 'causedByEventIds');
      }
    }
  }
  for (const rule of ruleContext?.rules ?? []) {
    if (rule.enforcement.type === 'forbid_event_type' && rule.enforcement.eventType === event.eventType) {
      return canonError('IMMUTABLE_WORLD_RULE_VIOLATION', 'event type is forbidden by an immutable world rule', {
        ruleId: rule.id,
        eventType: event.eventType,
      });
    }
    if (rule.enforcement.type === 'max_event_participants' && event.participantIds.length > rule.enforcement.maximum) {
      return canonError('IMMUTABLE_WORLD_RULE_VIOLATION', 'event exceeds immutable participant limit', {
        ruleId: rule.id,
        maximum: rule.enforcement.maximum,
        actual: event.participantIds.length,
      });
    }
  }
  const participants = new Set(event.participantIds);

  // Detect a character moved more than once within the same event.
  const movedCharacters = new Set<string>();
  const changedLifeCharacters = new Set<string>();
  const transferredItems = new Set<string>();
  const changedCharacterStateFields = new Set<string>();

  for (let i = 0; i < event.stateChanges.length; i++) {
    const change = event.stateChanges[i];
    const path = `stateChanges[${i}]`;

    if (change.type === 'relationship_changed') {
      if (knownCharacters && (!knownCharacters.has(change.sourceCharacterId) || !knownCharacters.has(change.targetCharacterId))) {
        return canonError('UNKNOWN_CHARACTER_REFERENCE', 'relationship character does not exist', undefined, path);
      }
      if (change.sourceCharacterId === change.targetCharacterId) {
        return canonError('INVALID_RELATIONSHIP_TARGET', 'relationship source and target must differ', undefined, path);
      }
      if (change.trustDelta === 0 && change.affectionDelta === 0 && change.resentmentDelta === 0) {
        return canonError('INVALID_RELATIONSHIP_DELTA', 'relationship delta must not be all zero', undefined, path);
      }
      if (!participants.has(change.sourceCharacterId) || !participants.has(change.targetCharacterId)) {
        return canonError('PARTICIPANT_MISMATCH', 'relationship characters must be event participants', undefined, path);
      }
      continue;
    }

    if (change.type === 'character_location_changed') {
      if (knownCharacters && !knownCharacters.has(change.characterId)) {
        return canonError('UNKNOWN_CHARACTER_REFERENCE', 'moved character does not exist', { characterId: change.characterId }, path);
      }
      if (knownLocations && (!knownLocations.has(change.fromLocationId) || !knownLocations.has(change.toLocationId))) {
        return canonError('UNKNOWN_LOCATION_REFERENCE', 'movement references an unknown location', {
          fromLocationId: change.fromLocationId,
          toLocationId: change.toLocationId,
        }, path);
      }
      if (movedCharacters.has(change.characterId)) {
        return canonError('DUPLICATE_CHARACTER_MOVEMENT', 'a character may move at most once per event', { characterId: change.characterId }, path);
      }
      movedCharacters.add(change.characterId);

      if (!participants.has(change.characterId)) {
        return canonError('PARTICIPANT_MISMATCH', 'a moved character must be an event participant', { characterId: change.characterId }, path);
      }

      // Movement precondition: an already-placed character must move FROM their current
      // location. A character with no current location is being placed (spawn); its
      // fromLocationId is recorded but not matched against the projection.
      const current = projection.characterLocations[change.characterId];
      if (current !== undefined && current !== change.fromLocationId) {
        return canonError('LOCATION_PRECONDITION_FAILED', 'movement fromLocationId does not match current location', {
          characterId: change.characterId,
          expected: current,
          actual: change.fromLocationId,
        }, path);
      }
      if (current !== undefined && current === change.toLocationId) {
        return canonError('LOCATION_PRECONDITION_FAILED', 'movement must change the character location', {
          characterId: change.characterId,
          locationId: current,
        }, path);
      }
      const lastMovement = projection.lastCharacterMovement[change.characterId];
      if (lastMovement?.worldDay === event.worldDay && lastMovement.timeSlot === event.timeSlot) {
        return canonError('CHARACTER_ALREADY_MOVED_THIS_SLOT', 'character already moved during this world time slot', {
          characterId: change.characterId,
          priorEventId: lastMovement.eventId,
        }, path);
      }
      if (current !== undefined && current !== change.toLocationId && ruleContext?.locationConnections) {
        const connected = ruleContext.locationConnections[current] ?? [];
        if (!connected.includes(change.toLocationId)) {
          return canonError('TELEPORTATION_NOT_ALLOWED', 'destination is not connected to the current location', {
            characterId: change.characterId,
            fromLocationId: current,
            toLocationId: change.toLocationId,
          }, path);
        }
      }
      continue;
    }

    if (change.type === 'fact_created') {
      if (change.subjectId.length === 0) {
        return canonError('INVALID_FACT_SUBJECT', 'fact subjectId must not be empty', undefined, path);
      }
      if (change.subjectType === 'character' && knownCharacters && !knownCharacters.has(change.subjectId)) {
        return canonError('UNKNOWN_CHARACTER_REFERENCE', 'fact character subject does not exist', { subjectId: change.subjectId }, path);
      }
      if (change.subjectType === 'location' && knownLocations && !knownLocations.has(change.subjectId)) {
        return canonError('UNKNOWN_LOCATION_REFERENCE', 'fact location subject does not exist', { subjectId: change.subjectId }, path);
      }
      if (change.subjectType === 'item' && knownItems && !knownItems.has(change.subjectId)) {
        return canonError('UNKNOWN_ITEM_REFERENCE', 'fact item subject does not exist', { subjectId: change.subjectId }, path);
      }
      continue;
    }

    if (change.type === 'character_life_changed') {
      if (knownCharacters && !knownCharacters.has(change.characterId)) {
        return canonError('UNKNOWN_CHARACTER_REFERENCE', 'life-state character does not exist', { characterId: change.characterId }, path);
      }
      if (alive(change.characterId) === change.alive) {
        return canonError('INVALID_LIFE_STATE_CHANGE', 'life-state change must alter the current state', { characterId: change.characterId }, path);
      }
      if (change.alive) {
        return canonError('INVALID_LIFE_STATE_CHANGE', 'resurrection is not a normal Canon transition', { characterId: change.characterId }, path);
      }
      if (!participants.has(change.characterId)) {
        return canonError('PARTICIPANT_MISMATCH', 'life-state character must be an event participant', { characterId: change.characterId }, path);
      }
      if (changedLifeCharacters.has(change.characterId)) {
        return canonError('INVALID_LIFE_STATE_CHANGE', 'character life state may change at most once per event', { characterId: change.characterId }, path);
      }
      changedLifeCharacters.add(change.characterId);
      continue;
    }

    if (change.type === 'character_knowledge_learned') {
      if (knownCharacters && !knownCharacters.has(change.characterId)) {
        return canonError('UNKNOWN_CHARACTER_REFERENCE', 'knowledge character does not exist', { characterId: change.characterId }, path);
      }
      if (!participants.has(change.characterId)) {
        return canonError('PARTICIPANT_MISMATCH', 'knowledge character must be an event participant', { characterId: change.characterId }, path);
      }
      if ((knownEvents && !knownEvents.has(change.sourceEventId)) || !event.causedByEventIds.includes(change.sourceEventId)) {
        return canonError('KNOWLEDGE_SOURCE_MISSING', 'knowledge must cite an existing causal source event', {
          characterId: change.characterId,
          sourceEventId: change.sourceEventId,
        }, path);
      }
      continue;
    }

    if (change.type === 'item_transferred') {
      if (transferredItems.has(change.itemId)) {
        return canonError('ITEM_OWNERSHIP_CONFLICT', 'an item may transfer at most once per event', { itemId: change.itemId }, path);
      }
      transferredItems.add(change.itemId);
      if (knownItems && !knownItems.has(change.itemId)) {
        return canonError('UNKNOWN_ITEM_REFERENCE', 'transferred item does not exist', { itemId: change.itemId }, path);
      }
      if (knownCharacters && (!knownCharacters.has(change.toOwnerId) || (change.fromOwnerId !== undefined && !knownCharacters.has(change.fromOwnerId)))) {
        return canonError('UNKNOWN_CHARACTER_REFERENCE', 'item transfer owner does not exist', undefined, path);
      }
      const currentOwner = projection.itemOwners[change.itemId]
        ?? ruleContext?.initialItemOwners?.[change.itemId];
      if (currentOwner !== undefined && change.fromOwnerId !== currentOwner) {
        return canonError('ITEM_OWNERSHIP_CONFLICT', 'item transfer source is not the unique current owner', {
          itemId: change.itemId,
          expectedOwnerId: currentOwner,
          actualOwnerId: change.fromOwnerId,
        }, path);
      }
      if (currentOwner === change.toOwnerId) {
        return canonError('ITEM_OWNERSHIP_CONFLICT', 'item is already owned by the target character', {
          itemId: change.itemId,
          ownerId: currentOwner,
        }, path);
      }
      continue;
    }

    if (change.type === 'character_state_changed') {
      if (knownCharacters && !knownCharacters.has(change.characterId)) {
        return canonError('UNKNOWN_CHARACTER_REFERENCE', 'state character does not exist', { characterId: change.characterId }, path);
      }
      if (!participants.has(change.characterId)) {
        return canonError('PARTICIPANT_MISMATCH', 'state character must be an event participant', { characterId: change.characterId }, path);
      }
      const stateFieldKey = `${change.characterId}:${change.field}`;
      if (changedCharacterStateFields.has(stateFieldKey)) {
        return canonError('INVALID_CHARACTER_STATE_CHANGE', 'a character state field may change at most once per event', {
          characterId: change.characterId, field: change.field,
        }, path);
      }
      changedCharacterStateFields.add(stateFieldKey);
      if (change.field === 'active' && change.toValue === true
          && event.stateChanges.some((candidate) => candidate.type === 'character_life_changed'
            && candidate.characterId === change.characterId && !candidate.alive)) {
        return canonError('INVALID_CHARACTER_STATE_CHANGE', 'a death event cannot leave the character active', {
          characterId: change.characterId,
        }, path);
      }
      if (change.field === 'organization_memberships' && knownOrganizations) {
        for (const organizationId of change.toValue as string[]) {
          if (!knownOrganizations.has(organizationId)) {
            return canonError('UNKNOWN_ORGANIZATION_REFERENCE', 'organization membership does not exist', { organizationId }, path);
          }
        }
      }
      const state = projection.characterStates[change.characterId];
      const fieldKey = change.field === 'organization_memberships' ? 'organizationMemberships' : change.field;
      const current = state?.[fieldKey];
      const equal = (left: unknown, right: unknown): boolean => Array.isArray(left) && Array.isArray(right)
        ? left.length === right.length && left.every((entry, index) => entry === right[index])
        : left === right;
      if (change.fromValue !== undefined && !equal(current, change.fromValue)) {
        return canonError('CHARACTER_STATE_PRECONDITION_FAILED', 'fromValue does not match projected character state', {
          characterId: change.characterId, field: change.field,
        }, path);
      }
      if (equal(current, change.toValue)) {
        return canonError('INVALID_CHARACTER_STATE_CHANGE', 'state change must alter the projected value', {
          characterId: change.characterId, field: change.field,
        }, path);
      }
      continue;
    }
  }

  return null;
}
