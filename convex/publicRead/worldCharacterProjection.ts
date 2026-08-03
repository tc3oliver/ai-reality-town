/**
 * Publication-safe World and Character projections (PRD §13.1, §13.2, FR-I005).
 *
 * Pure builders with EXPLICIT field allowlists. The Character projection
 * exposes every allowed FR-I005 field and excludes every forbidden field
 * (privateProfile, privateGoal, plus any Knowledge / memory payload) server-side
 * (AC#2). Both rebuild deterministically from their sources (AC#3). Pure module
 * — no Convex imports, no clock, no randomness, no Canon mutation.
 *
 * Published via the public read-model infrastructure (modelKind `world` /
 * `character`); public reads reuse the generic failure-isolated
 * {@link getPublishedReadModel}.
 */

export const WORLD_CHARACTER_PROJECTION_SCHEMA_VERSION = 1;

export const WORLD_MODEL_KIND = 'world' as const;
export const CHARACTER_MODEL_KIND = 'character' as const;

/** Allowed public World fields (PRD §13.1). */
export const WORLD_ALLOWED_FIELDS = [
  'name', 'description', 'status', 'currentWorldDay', 'currentTimeSlot',
  'simulationMode', 'publicLaunchDay', 'createdAt', 'updatedAt',
] as const;

/** Allowed public Character fields (PRD §13.2 MINUS private fields). */
export const CHARACTER_ALLOWED_FIELDS = [
  'name', 'age', 'occupation', 'publicProfile', 'personality', 'values',
  'publicGoal', 'fear', 'behaviorRules', 'currentLocationId', 'healthState',
  'emotionalState', 'financialState', 'alive', 'active',
] as const;

/** Character fields that must NEVER appear in a public projection (AC#2). */
export const CHARACTER_FORBIDDEN_FIELDS = [
  'privateProfile', 'privateGoal', 'knowledge', 'memory',
] as const;

export type PublicFact = {
  factId: string;
  subjectType: string;
  subjectId: string;
  predicate: string;
  value: string | number | boolean;
  validFromEventId: string;
};

export type WorldProjection = {
  schemaVersion: typeof WORLD_CHARACTER_PROJECTION_SCHEMA_VERSION;
  worldId: string;
  name: string | null;
  description: string | null;
  status: string | null;
  currentWorldDay: number | null;
  currentTimeSlot: string | null;
  simulationMode: string | null;
  publicLaunchDay: number | null;
  createdAt: number | null;
  updatedAt: number | null;
  publicFacts: PublicFact[];
};

export type CharacterProjection = {
  schemaVersion: typeof WORLD_CHARACTER_PROJECTION_SCHEMA_VERSION;
  id: string;
  worldId: string;
  name: string | null;
  age: number | null;
  occupation: string | null;
  publicProfile: string | null;
  personality: string | null;
  values: string | null;
  publicGoal: string | null;
  fear: string | null;
  behaviorRules: string | null;
  currentLocationId: string | null;
  healthState: string | null;
  emotionalState: string | null;
  financialState: string | null;
  alive: boolean;
  active: boolean;
};

export class ProjectionError extends Error {
  constructor(readonly code: string, message: string) {
    super(`[${code}] ${message}`);
    this.name = 'ProjectionError';
  }
}

function pickString(source: Record<string, unknown>, field: string): string | null {
  const value = source[field];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function pickNumber(source: Record<string, unknown>, field: string): number | null {
  const value = source[field];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Build the publication-safe World projection from a world source record + the
 * world's public Canon facts (AC#1). Only {@link WORLD_ALLOWED_FIELDS} are
 * projected; any other keys in `source` are dropped.
 */
export function buildWorldProjection(input: {
  worldId: string;
  source: Record<string, unknown>;
  publicFacts: readonly PublicFact[];
}): WorldProjection {
  if (input.worldId.trim().length === 0) throw new ProjectionError('PROJECTION_INVALID', 'worldId must be non-empty');
  return {
    schemaVersion: WORLD_CHARACTER_PROJECTION_SCHEMA_VERSION,
    worldId: input.worldId,
    name: pickString(input.source, 'name'),
    description: pickString(input.source, 'description'),
    status: pickString(input.source, 'status'),
    currentWorldDay: pickNumber(input.source, 'currentWorldDay'),
    currentTimeSlot: pickString(input.source, 'currentTimeSlot'),
    simulationMode: pickString(input.source, 'simulationMode'),
    publicLaunchDay: pickNumber(input.source, 'publicLaunchDay'),
    createdAt: pickNumber(input.source, 'createdAt'),
    updatedAt: pickNumber(input.source, 'updatedAt'),
    publicFacts: input.publicFacts.map((fact) => ({ ...fact })),
  };
}

/**
 * Build the publication-safe Character projection from a character source
 * record (AC#2). Only {@link CHARACTER_ALLOWED_FIELDS} are projected; forbidden
 * fields (privateProfile, privateGoal, knowledge, memory) are NEVER read, so
 * they cannot leak even if present in the source.
 */
export function buildCharacterProjection(input: {
  worldId: string;
  source: Record<string, unknown>;
}): CharacterProjection {
  if (input.worldId.trim().length === 0) throw new ProjectionError('PROJECTION_INVALID', 'worldId must be non-empty');
  const id = pickString(input.source, 'id');
  if (!id) throw new ProjectionError('PROJECTION_INVALID', 'character source requires a non-empty id');
  const aliveValue = input.source.alive;
  const activeValue = input.source.active;
  return {
    schemaVersion: WORLD_CHARACTER_PROJECTION_SCHEMA_VERSION,
    id,
    worldId: input.worldId,
    name: pickString(input.source, 'name'),
    age: pickNumber(input.source, 'age'),
    occupation: pickString(input.source, 'occupation'),
    publicProfile: pickString(input.source, 'publicProfile'),
    personality: pickString(input.source, 'personality'),
    values: pickString(input.source, 'values'),
    publicGoal: pickString(input.source, 'publicGoal'),
    fear: pickString(input.source, 'fear'),
    behaviorRules: pickString(input.source, 'behaviorRules'),
    currentLocationId: pickString(input.source, 'currentLocationId'),
    healthState: pickString(input.source, 'healthState'),
    emotionalState: pickString(input.source, 'emotionalState'),
    financialState: pickString(input.source, 'financialState'),
    alive: typeof aliveValue === 'boolean' ? aliveValue : true,
    active: typeof activeValue === 'boolean' ? activeValue : true,
  };
}

/** Assert that a projection object contains only allowed keys (used by tests/wiring). */
export function assertNoForbiddenCharacterFields(projection: Record<string, unknown>): void {
  const keys = new Set(Object.keys(projection));
  for (const forbidden of CHARACTER_FORBIDDEN_FIELDS) {
    if (keys.has(forbidden)) {
      throw new ProjectionError('PROJECTION_FORBIDDEN_FIELD', `forbidden field leaked into projection: ${forbidden}`);
    }
  }
}
