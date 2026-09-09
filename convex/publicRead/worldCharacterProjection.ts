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

/**
 * Allowed public Character fields.
 *
 * ## §13.2 is the DATA MODEL. FR-I005 is the public list.
 *
 * This constant used to be documented as "PRD §13.2 MINUS private fields", and that framing is
 * what let two fields through (ART-175). §13.2 enumerates the whole Character record — public and
 * private together — so subtracting the four fields that are OBVIOUSLY private leaves everything
 * nobody stopped to think about. FR-I005 is the list that says what a viewer may see, it is
 * exhaustive, and it is the one this allowlist answers to:
 *
 *   姓名與圖像 · 年齡與職業 · 公開背景 · 目前狀態 · 公開目標 · 主要關係 ·
 *   最近重大事件 · 所屬 Arc · 觀眾已知秘密 · 角色不知道但觀眾知道的資訊
 *
 * Two fields were removed on that reading, and both were being served to anonymous clients while
 * being rendered by nothing:
 *
 *  - **`behaviorRules`** — model-steering instructions. Mistwood's seeded value is
 *    `['Act only on known or reasonably inferred information.', 'Protect the private goal unless
 *    pressure makes disclosure credible.']`. The second rule is prompt material, and it tells any
 *    reader the character HAS a private goal they are concealing. FR-I005 forbids Prompt outright.
 *  - **`fear`** — a character's vulnerability, seeded beside `privateGoal`, and on neither of
 *    FR-I005's lists.
 *
 * `personality` and `values` are also outside FR-I005's enumeration and are KEPT, because the page
 * renders them under 「特質」. That is a product decision about what the page shows, not a privacy
 * defect, and conflating the two would have made this change unreviewable.
 *
 * `sanitizeForPublic` could not have caught either one — its key patterns match neither name — so
 * this allowlist is the only guard, which is why the fix is here rather than downstream.
 */
export const CHARACTER_ALLOWED_FIELDS = [
  'name', 'age', 'occupation', 'publicProfile', 'personality', 'values',
  'publicGoal', 'currentLocationId', 'healthState',
  'emotionalState', 'financialState', 'alive', 'active',
] as const;

/**
 * Character fields that must NEVER appear in a public projection (AC#2).
 *
 * `fear` and `behaviorRules` joined the list at ART-175. Being absent from
 * {@link CHARACTER_ALLOWED_FIELDS} is already enough to keep them out — the builder reads named
 * fields and copies no object — but naming them here is what makes a later re-addition a
 * deliberate act rather than an oversight, and it is what
 * {@link assertNoForbiddenCharacterFields} checks.
 */
export const CHARACTER_FORBIDDEN_FIELDS = [
  'privateProfile', 'privateGoal', 'knowledge', 'memory', 'fear', 'behaviorRules',
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
