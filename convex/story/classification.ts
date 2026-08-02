import {
  ARC_EVENT_ROLES,
  type ArcEventClassification,
  type ArcEventMembership,
  type NewArcProposal,
} from './model';

export const MAX_EVENT_ARC_MEMBERSHIPS = 6;
export const MAX_PRIMARY_ARC_MEMBERSHIPS = 2;
export const NEW_ARC_MINIMUM_IMPORTANCE = 0.6;

export class ArcClassificationError extends Error {
  constructor(readonly code: string, message: string, readonly path?: string) {
    super(`[${code}] ${message}`);
    this.name = 'ArcClassificationError';
  }
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ArcClassificationError('ARC_CLASSIFICATION_INVALID_SHAPE', 'expected object', path);
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, keys: string[], path: string): void {
  const allowed = new Set(keys);
  const unknown = Object.keys(value).find((key) => !allowed.has(key));
  if (unknown) throw new ArcClassificationError('ARC_CLASSIFICATION_INVALID_SHAPE', 'unknown field', `${path}.${unknown}`);
}

function text(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ArcClassificationError('ARC_CLASSIFICATION_INVALID_SHAPE', 'expected non-empty text', path);
  }
  return value.trim();
}

function ids(value: unknown, path: string): string[] {
  if (!Array.isArray(value)) throw new ArcClassificationError('ARC_CLASSIFICATION_INVALID_SHAPE', 'expected id array', path);
  const parsed = value.map((entry, index) => text(entry, `${path}[${index}]`));
  if (new Set(parsed).size !== parsed.length) {
    throw new ArcClassificationError('ARC_CLASSIFICATION_INVALID_SHAPE', 'duplicate id', path);
  }
  return parsed;
}

function membership(value: unknown, index: number): ArcEventMembership {
  const path = `memberships[${index}]`;
  const input = record(value, path);
  exactKeys(input, ['arcId', 'primary', 'importance', 'role', 'coreCharacterIdsAdded', 'coreCharacterIdsRemoved'], path);
  if (typeof input.primary !== 'boolean') throw new ArcClassificationError('ARC_CLASSIFICATION_INVALID_SHAPE', 'expected boolean', `${path}.primary`);
  if (typeof input.importance !== 'number' || !Number.isFinite(input.importance) || input.importance < 0 || input.importance > 1) {
    throw new ArcClassificationError('ARC_CLASSIFICATION_INVALID_SHAPE', 'importance must be from 0 to 1', `${path}.importance`);
  }
  if (typeof input.role !== 'string' || !ARC_EVENT_ROLES.includes(input.role as never)) {
    throw new ArcClassificationError('ARC_CLASSIFICATION_INVALID_SHAPE', 'unsupported event role', `${path}.role`);
  }
  const added = ids(input.coreCharacterIdsAdded, `${path}.coreCharacterIdsAdded`);
  const removed = ids(input.coreCharacterIdsRemoved, `${path}.coreCharacterIdsRemoved`);
  if (added.some((id) => removed.includes(id))) {
    throw new ArcClassificationError('ARC_CLASSIFICATION_INVALID_SHAPE', 'character cannot be added and removed', path);
  }
  return {
    arcId: text(input.arcId, `${path}.arcId`), primary: input.primary,
    importance: input.importance, role: input.role as ArcEventMembership['role'],
    coreCharacterIdsAdded: added, coreCharacterIdsRemoved: removed,
  };
}

function newArc(value: unknown): NewArcProposal | null {
  if (value === null) return null;
  const input = record(value, 'newArc');
  exactKeys(input, ['arcId', 'title', 'premise', 'currentQuestion', 'coreCharacterIds'], 'newArc');
  return {
    arcId: text(input.arcId, 'newArc.arcId'), title: text(input.title, 'newArc.title'),
    premise: text(input.premise, 'newArc.premise'),
    currentQuestion: text(input.currentQuestion, 'newArc.currentQuestion'),
    coreCharacterIds: ids(input.coreCharacterIds, 'newArc.coreCharacterIds'),
  };
}

export function parseArcEventClassification(value: unknown): ArcEventClassification {
  const input = record(value, 'classification');
  exactKeys(input, ['schemaVersion', 'worldId', 'sourceEventId', 'sourceEventSequenceNumber', 'memberships', 'newArc'], 'classification');
  if (input.schemaVersion !== 1) throw new ArcClassificationError('ARC_CLASSIFICATION_UNSUPPORTED_VERSION', 'schema version must be 1', 'schemaVersion');
  if (!Number.isSafeInteger(input.sourceEventSequenceNumber) || (input.sourceEventSequenceNumber as number) < 0) {
    throw new ArcClassificationError('ARC_CLASSIFICATION_INVALID_SHAPE', 'sequence must be non-negative integer', 'sourceEventSequenceNumber');
  }
  if (!Array.isArray(input.memberships) || input.memberships.length === 0 || input.memberships.length > MAX_EVENT_ARC_MEMBERSHIPS) {
    throw new ArcClassificationError('ARC_CLASSIFICATION_MEMBERSHIP_LIMIT', `memberships must contain 1-${MAX_EVENT_ARC_MEMBERSHIPS} arcs`, 'memberships');
  }
  const memberships = input.memberships.map(membership);
  if (new Set(memberships.map(({ arcId }) => arcId)).size !== memberships.length) {
    throw new ArcClassificationError('ARC_CLASSIFICATION_INVALID_SHAPE', 'duplicate arc membership', 'memberships');
  }
  if (memberships.filter(({ primary }) => primary).length > MAX_PRIMARY_ARC_MEMBERSHIPS) {
    throw new ArcClassificationError('ARC_CLASSIFICATION_PRIMARY_LIMIT', `at most ${MAX_PRIMARY_ARC_MEMBERSHIPS} primary arcs`, 'memberships');
  }
  const proposed = newArc(input.newArc);
  if (proposed) {
    const linked = memberships.find(({ arcId }) => arcId === proposed.arcId);
    if (!linked) throw new ArcClassificationError('ARC_CLASSIFICATION_INVALID_NEW_ARC', 'new arc must be a membership', 'newArc.arcId');
    if (linked.role !== 'inciting_incident') throw new ArcClassificationError('ARC_CLASSIFICATION_INVALID_NEW_ARC', 'new arc must use inciting incident role', 'newArc.arcId');
    if (linked.importance < NEW_ARC_MINIMUM_IMPORTANCE) {
      throw new ArcClassificationError('ARC_CLASSIFICATION_LOW_IMPORTANCE_NEW_ARC', 'low-importance events cannot create arcs', 'memberships');
    }
  }
  return {
    schemaVersion: 1, worldId: text(input.worldId, 'worldId'),
    sourceEventId: text(input.sourceEventId, 'sourceEventId'),
    sourceEventSequenceNumber: input.sourceEventSequenceNumber as number,
    memberships, newArc: proposed,
  };
}

export function validateArcClassificationReferences(
  classification: ArcEventClassification,
  existingArcIds: ReadonlySet<string>,
  characterIds: ReadonlySet<string>,
): void {
  for (const item of classification.memberships) {
    if (!existingArcIds.has(item.arcId) && classification.newArc?.arcId !== item.arcId) {
      throw new ArcClassificationError('ARC_CLASSIFICATION_UNKNOWN_ARC', 'arc does not exist', 'memberships');
    }
    for (const characterId of [...item.coreCharacterIdsAdded, ...item.coreCharacterIdsRemoved]) {
      if (!characterIds.has(characterId)) throw new ArcClassificationError('ARC_CLASSIFICATION_UNKNOWN_CHARACTER', 'character does not exist', 'memberships');
    }
  }
  for (const characterId of classification.newArc?.coreCharacterIds ?? []) {
    if (!characterIds.has(characterId)) throw new ArcClassificationError('ARC_CLASSIFICATION_UNKNOWN_CHARACTER', 'character does not exist', 'newArc.coreCharacterIds');
  }
}
