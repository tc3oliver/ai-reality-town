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
  isFactSubjectType,
  isFactVisibility,
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
  typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean';

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
      if (!isNonEmptyString(change.characterId))
        return canonError('INVALID_EVENT_SHAPE', 'characterId must be a non-empty string', undefined, `${path}.characterId`);
      if (!isNonEmptyString(change.fromLocationId))
        return canonError('INVALID_EVENT_SHAPE', 'fromLocationId must be a non-empty string', undefined, `${path}.fromLocationId`);
      if (!isNonEmptyString(change.toLocationId))
        return canonError('INVALID_EVENT_SHAPE', 'toLocationId must be a non-empty string', undefined, `${path}.toLocationId`);
      return null;
    case 'relationship_changed':
      if (!isNonEmptyString(change.sourceCharacterId))
        return canonError('INVALID_EVENT_SHAPE', 'sourceCharacterId must be a non-empty string', undefined, `${path}.sourceCharacterId`);
      if (!isNonEmptyString(change.targetCharacterId))
        return canonError('INVALID_EVENT_SHAPE', 'targetCharacterId must be a non-empty string', undefined, `${path}.targetCharacterId`);
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
      // subjectId emptiness is a *canon* rule (INVALID_FACT_SUBJECT); here we only
      // require it is a string so the canon code path stays reachable/testable.
      if (!isString(change.subjectId))
        return canonError('INVALID_EVENT_SHAPE', 'subjectId must be a string', undefined, `${path}.subjectId`);
      if (!isFactSubjectType(change.subjectType))
        return canonError('INVALID_EVENT_SHAPE', 'subjectType is not supported', { subjectType: change.subjectType }, `${path}.subjectType`);
      if (!isNonEmptyString(change.predicate))
        return canonError('INVALID_EVENT_SHAPE', 'predicate must be a non-empty string', undefined, `${path}.predicate`);
      if (!isPrimitiveValue(change.value))
        return canonError('INVALID_EVENT_SHAPE', 'value must be string | number | boolean', undefined, `${path}.value`);
      if (!isFactVisibility(change.visibility))
        return canonError('INVALID_EVENT_SHAPE', 'visibility is not supported', { visibility: change.visibility }, `${path}.visibility`);
      return null;
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

  // schemaVersion — type first (shape), then membership (version policy).
  if (!isInteger(event.schemaVersion)) {
    return canonError('INVALID_EVENT_SHAPE', 'schemaVersion must be an integer', undefined, 'schemaVersion');
  }
  if (event.schemaVersion !== 1) {
    return canonError('UNSUPPORTED_SCHEMA_VERSION', 'only schemaVersion 1 is supported', {
      schemaVersion: event.schemaVersion,
    }, 'schemaVersion');
  }

  if (!isNonEmptyString(event.worldId))
    return canonError('INVALID_EVENT_SHAPE', 'worldId must be a non-empty string', undefined, 'worldId');
  if (!isNonEmptyString(event.idempotencyKey))
    return canonError('INVALID_EVENT_SHAPE', 'idempotencyKey must be a non-empty string', undefined, 'idempotencyKey');

  if (!isPlainObject(event.proposedBy))
    return canonError('INVALID_EVENT_SHAPE', 'proposedBy must be an object', undefined, 'proposedBy');
  if (!isProposedByType(event.proposedBy.type))
    return canonError('INVALID_EVENT_SHAPE', 'proposedBy.type is not supported', { type: event.proposedBy.type }, 'proposedBy.type');
  if (event.proposedBy.id !== undefined && !isNonEmptyString(event.proposedBy.id))
    return canonError('INVALID_EVENT_SHAPE', 'proposedBy.id must be a non-empty string when present', undefined, 'proposedBy.id');

  if (!isInteger(event.worldDay) || event.worldDay < 0)
    return canonError('INVALID_EVENT_SHAPE', 'worldDay must be a non-negative integer', undefined, 'worldDay');
  if (!isTimeSlot(event.timeSlot))
    return canonError('INVALID_EVENT_SHAPE', 'timeSlot is not supported', { timeSlot: event.timeSlot }, 'timeSlot');
  if (!isEventType(event.eventType))
    return canonError('INVALID_EVENT_SHAPE', 'eventType is not supported', { eventType: event.eventType }, 'eventType');

  const remediationTypes = new Set(['correction', 'compensation', 'retcon']);
  if (remediationTypes.has(event.eventType as string) && event.proposedBy.type !== 'admin')
    return canonError('INVALID_EVENT_SHAPE', 'remediation events must be proposed by an administrator', undefined, 'proposedBy.type');

  if (event.locationId !== undefined && !isNonEmptyString(event.locationId))
    return canonError('INVALID_EVENT_SHAPE', 'locationId must be a non-empty string when present', undefined, 'locationId');

  // participantIds — non-empty strings, bounded, no empties, no duplicates.
  if (!Array.isArray(event.participantIds))
    return canonError('INVALID_EVENT_SHAPE', 'participantIds must be an array', undefined, 'participantIds');
  if (event.participantIds.length > MAX_PARTICIPANTS)
    return canonError('INVALID_EVENT_SHAPE', 'too many participants', { count: event.participantIds.length, max: MAX_PARTICIPANTS }, 'participantIds');
  for (const p of event.participantIds) {
    if (!isNonEmptyString(p))
      return canonError('INVALID_EVENT_SHAPE', 'participantIds must not contain empty strings', undefined, 'participantIds');
  }
  if (hasDuplicates(event.participantIds as string[]))
    return canonError('INVALID_EVENT_SHAPE', 'participantIds must not contain duplicates', undefined, 'participantIds');

  // causedByEventIds — non-empty strings, bounded, no self-reference.
  if (!Array.isArray(event.causedByEventIds))
    return canonError('INVALID_EVENT_SHAPE', 'causedByEventIds must be an array', undefined, 'causedByEventIds');
  if (event.causedByEventIds.length > MAX_CAUSED_BY_EVENT_IDS)
    return canonError('INVALID_EVENT_SHAPE', 'too many causedByEventIds', { count: event.causedByEventIds.length, max: MAX_CAUSED_BY_EVENT_IDS }, 'causedByEventIds');
  for (const c of event.causedByEventIds) {
    if (!isNonEmptyString(c))
      return canonError('INVALID_EVENT_SHAPE', 'causedByEventIds must not contain empty strings', undefined, 'causedByEventIds');
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

  if (event.metadata !== undefined && !isPlainObject(event.metadata))
    return canonError('INVALID_EVENT_SHAPE', 'metadata must be an object', undefined, 'metadata');

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

  for (let i = 0; i < event.stateChanges.length; i++) {
    const change = event.stateChanges[i];
    const path = `stateChanges[${i}]`;

    if (change.type === 'relationship_changed') {
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
      continue;
    }

    if (change.type === 'fact_created') {
      if (change.subjectId.length === 0) {
        return canonError('INVALID_FACT_SUBJECT', 'fact subjectId must not be empty', undefined, path);
      }
      continue;
    }
  }

  return null;
}
