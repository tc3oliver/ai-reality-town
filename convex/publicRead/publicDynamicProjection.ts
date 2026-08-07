/**
 * Public Dynamic Projection — the field-whitelisted motion contract (FR-N003 / ART-115).
 *
 * The Visual Runtime (`convex/visualRuntime/`) decides *what the viewer draws*; this module
 * decides *what the public is allowed to see of that decision*. The two are deliberately
 * separate: the runtime's `MovementTrajectory` carries planning detail (waypoints, the
 * movement phase, the origin location, the map id per unit) that a public client neither
 * needs nor should be handed, and PRD 2.0 §10.4 specifies a narrower unit —
 * `PublicCharacterMotion` — that is exactly what the read-only renderer consumes.
 *
 * Three properties define this module:
 *
 * 1. **It is pure.** No Convex import, no clock, no randomness. `nowMs` is an argument, so
 *    a projection can be re-derived byte-for-byte anywhere.
 * 2. **It publishes by allowlist, not by redaction.** Every published field is named in a
 *    constant and re-checked by {@link assertPublicDynamicProjection} before the payload is
 *    written and again when it is read back. A new runtime field is therefore invisible to
 *    the public by default; someone has to add it here on purpose.
 * 3. **Its root fields are Canon-derived, never clock-derived.** `updatedAt` and
 *    `snapshotSequence` come from the last accepted event. Reading a clock instead would
 *    make an unchanged world produce a different payload on every rebuild, defeating the
 *    read-model store's `contentHash` deduplication and appending a spurious version row
 *    every time the projection was rebuilt.
 */

import type {
  MovementTrajectory,
  VisualRuntimeProblem,
  VisualRuntimeProblemCode,
} from '../visualRuntime/motion';
import type { SeedPlacement } from '../visualRuntime/seedBootstrap';
import {
  planCharacterTrajectories,
  type AcceptedEventLike,
  type VisualRuntimeInput,
} from '../visualRuntime/visualSyncPlanner';

/**
 * Bumped when a published field is added, removed or reinterpreted, so a client holding an
 * older payload can tell that it is reading a contract it does not fully understand.
 */
export const PUBLIC_DYNAMIC_RUNTIME_VERSION = 1;

/**
 * Why a character is where it is. `canon` is an accepted `character_location_changed` fact
 * and `idle` is a standing character (including a seeded one that has never moved).
 * `ambient` (FR-O011 / ART-120) and `replay` (FR-O013 / ART-121) are declared so those tasks
 * widen the client contract rather than redefining it; this module never produces them.
 */
export const PUBLIC_MOTION_TYPES = ['canon', 'ambient', 'idle', 'replay'] as const;
export type PublicMotionType = (typeof PUBLIC_MOTION_TYPES)[number];

export const PUBLIC_ANIMATION_STATES = ['idle', 'walking', 'speaking', 'thinking', 'activity'] as const;
export type PublicAnimationState = (typeof PUBLIC_ANIMATION_STATES)[number];

/** Four facings, because the sprite sheets are packed with four walk cycles. */
export const PUBLIC_DIRECTIONS = ['up', 'down', 'left', 'right'] as const;
export type PublicDirection = (typeof PUBLIC_DIRECTIONS)[number];

export const PUBLIC_WORLD_STATUSES = ['running', 'paused', 'unknown'] as const;
export type PublicWorldStatus = (typeof PUBLIC_WORLD_STATUSES)[number];

/** Map tile coordinates. Pixels belong to the renderer. */
export type PublicPoint = { x: number; y: number };

/** One published motion unit, exactly PRD 2.0 §10.4. */
export type PublicCharacterMotion = {
  characterId: string;
  semanticLocationId: string;
  motionType: PublicMotionType;
  motionSequence: number;
  from: PublicPoint;
  to: PublicPoint;
  startedAt: number;
  arriveAt: number;
  animationState: PublicAnimationState;
  direction: PublicDirection;
  sourceEventIds?: string[];
};

/**
 * The published half of an active scene. Spatial fields (location, participants, arcs) are
 * FR-O003 / ART-122's job and do not exist in reusable form yet, so they are absent rather
 * than invented.
 */
export type PublicActiveScene = {
  title: string;
  summary: string;
  sourceEventIds: string[];
};

export type PublicDynamicProjection = {
  worldId: string;
  mapId: string;
  runtimeVersion: number;
  snapshotSequence: number;
  updatedAt: number;
  worldStatus: PublicWorldStatus;
  characters: PublicCharacterMotion[];
  activeScenes: PublicActiveScene[];
};

export const PUBLIC_DYNAMIC_ROOT_FIELDS = [
  'worldId', 'mapId', 'runtimeVersion', 'snapshotSequence',
  'updatedAt', 'worldStatus', 'characters', 'activeScenes',
] as const;

export const PUBLIC_MOTION_REQUIRED_FIELDS = [
  'characterId', 'semanticLocationId', 'motionType', 'motionSequence',
  'from', 'to', 'startedAt', 'arriveAt', 'animationState', 'direction',
] as const;

/** Omitted entirely (not `[]`) for a motion with no source event, so "never moved" is legible. */
export const PUBLIC_MOTION_OPTIONAL_FIELDS = ['sourceEventIds'] as const;

export const PUBLIC_ACTIVE_SCENE_FIELDS = ['title', 'summary', 'sourceEventIds'] as const;

/**
 * Field names that must never appear at any depth of a published payload. Two groups:
 * private Canon/LLM data (the §22 leakage boundary), and Visual Runtime planning detail
 * that is real but internal — publishing `waypoints` would leak the collision layer's
 * shape, and `movementPhase` / `originLocationId` / `problems` are simply not part of the
 * §10.4 contract.
 *
 * `mapId` is deliberately absent: it is legal once, at the root, because geometry is
 * meaningless across map versions. It is illegal *inside* a motion, which the per-motion
 * field allowlist already enforces.
 */
export const PUBLIC_DYNAMIC_FORBIDDEN_FIELDS = [
  // Private data.
  'knowledge', 'memory', 'memories', 'prompt', 'rawModelOutput', 'rawOutput',
  'adminNotes', 'secret', 'secretId', 'secretIds', 'credential', 'password',
  'apiKey', 'token', 'privateProfile', 'privateGoal', 'fear', 'dialogue',
  // Runtime-only planning detail.
  'movementPhase', 'originLocationId', 'waypoints', 'problems',
] as const;

export type PublicDynamicProjectionErrorCode =
  | 'PUBLIC_DYNAMIC_INVALID_SHAPE'
  | 'PUBLIC_DYNAMIC_UNKNOWN_FIELD'
  | 'PUBLIC_DYNAMIC_INVALID_VALUE';

export class PublicDynamicProjectionError extends Error {
  constructor(readonly code: PublicDynamicProjectionErrorCode, message: string) {
    super(`[${code}] ${message}`);
    this.name = 'PublicDynamicProjectionError';
  }
}

/**
 * Total, table-driven so a new runtime motion type is a compile error here rather than a
 * silent fallthrough to some default. `bootstrap` becomes `idle`: to a viewer, a character
 * who has never moved and a character who has finished moving are both standing still, and
 * "bootstrap" is an implementation word the public contract has no room for.
 */
const MOTION_TYPE_MAP: Record<MovementTrajectory['motionType'], PublicMotionType> = {
  bootstrap: 'idle',
  canon: 'canon',
  ambient: 'ambient',
  replay: 'replay',
};

/**
 * Eight compass points collapse to four facings. Diagonals resolve to their horizontal
 * component because the sprite sheets animate side-facing walk cycles: a character heading
 * north-east reads better walking east than walking away from the camera.
 */
const DIRECTION_MAP: Record<MovementTrajectory['direction'], PublicDirection> = {
  north: 'up',
  'north-east': 'right',
  east: 'right',
  'south-east': 'right',
  south: 'down',
  'south-west': 'left',
  west: 'left',
  'north-west': 'left',
};

export function toPublicMotionType(motionType: MovementTrajectory['motionType']): PublicMotionType {
  const mapped = MOTION_TYPE_MAP[motionType];
  if (!mapped) {
    throw new PublicDynamicProjectionError(
      'PUBLIC_DYNAMIC_INVALID_VALUE',
      `unmapped runtime motion type: ${String(motionType)}`,
    );
  }
  return mapped;
}

export function toPublicDirection(direction: MovementTrajectory['direction']): PublicDirection {
  const mapped = DIRECTION_MAP[direction];
  if (!mapped) {
    throw new PublicDynamicProjectionError(
      'PUBLIC_DYNAMIC_INVALID_VALUE',
      `unmapped runtime direction: ${String(direction)}`,
    );
  }
  return mapped;
}

/** A `worldCharacters` row as this module reads it. `payload` is `v.any()` in the schema. */
export type WorldCharacterRow = {
  readonly characterId: string;
  readonly payload: unknown;
};

/**
 * Seed placements for the runtime, read defensively: the seed payload is untyped storage, so
 * a row without a usable `initialLocationId` is skipped rather than published at a guessed
 * position. Sorted by `characterId` so the payload does not inherit Convex's row order —
 * an unstable order would change the `contentHash` and append a version row per rebuild.
 */
export function seedPlacementsFromCharacterRows(
  rows: readonly WorldCharacterRow[],
): SeedPlacement[] {
  const placements: SeedPlacement[] = [];
  for (const row of rows) {
    if (typeof row.characterId !== 'string' || row.characterId.length === 0) continue;
    const payload = row.payload;
    if (payload === null || typeof payload !== 'object') continue;
    const initialLocationId = (payload as { initialLocationId?: unknown }).initialLocationId;
    if (typeof initialLocationId !== 'string' || initialLocationId.length === 0) continue;
    placements.push({ characterId: row.characterId, initialLocationId });
  }
  return placements.sort((left, right) => left.characterId.localeCompare(right.characterId));
}

/**
 * Characters that must not be drawn: the dead, and the explicitly deactivated. Folded in
 * sequence order so a later resurrection or reactivation wins over an earlier death.
 *
 * Applied as a post-filter after planning rather than by pruning the seed placements
 * beforehand, because a dead character is still part of the anchor chain that positions the
 * living: removing them from the planner's input would silently change where nobody else
 * stood, whereas removing them from the output only removes them.
 */
export function excludedCharacterIds(events: readonly AcceptedEventLike[]): Set<string> {
  const ordered = [...events].sort((left, right) => left.sequenceNumber - right.sequenceNumber);
  const excluded = new Set<string>();
  for (const event of ordered) {
    for (const change of event.stateChanges) {
      const characterId = change.characterId;
      if (typeof characterId !== 'string' || characterId.length === 0) continue;
      const record = change as { alive?: unknown; field?: unknown; toValue?: unknown };
      if (change.type === 'character_life_changed' && typeof record.alive === 'boolean') {
        if (record.alive) excluded.delete(characterId);
        else excluded.add(characterId);
      } else if (change.type === 'character_state_changed' && record.field === 'active') {
        if (record.toValue === true) excluded.delete(characterId);
        else if (record.toValue === false) excluded.add(characterId);
      }
    }
  }
  return excluded;
}

/**
 * Narrow one runtime trajectory to its published fields. `sourceEventIds` is omitted rather
 * than emptied when the motion has no provenance, which is how a client distinguishes a
 * seeded character who has never moved from one whose move produced no event ids.
 */
export function toPublicCharacterMotion(trajectory: MovementTrajectory): PublicCharacterMotion {
  const motion: PublicCharacterMotion = {
    characterId: trajectory.characterId,
    semanticLocationId: trajectory.semanticLocationId,
    motionType: toPublicMotionType(trajectory.motionType),
    motionSequence: trajectory.motionSequence,
    from: { x: trajectory.from.x, y: trajectory.from.y },
    to: { x: trajectory.to.x, y: trajectory.to.y },
    startedAt: trajectory.startedAt,
    arriveAt: trajectory.arriveAt,
    animationState: trajectory.animationState,
    direction: toPublicDirection(trajectory.direction),
  };
  if (trajectory.sourceEventIds.length > 0) {
    motion.sourceEventIds = [...trajectory.sourceEventIds];
  }
  return motion;
}

export type PublicDynamicProjectionInput = {
  readonly worldId: string;
  /** The planning instant, supplied by the caller. This module never reads a clock. */
  readonly nowMs: number;
  readonly runtime: Pick<VisualRuntimeInput, 'mapId' | 'grid' | 'bindings'>;
  readonly seedPlacements: readonly SeedPlacement[];
  readonly acceptedEvents: readonly AcceptedEventLike[];
  readonly worldStatus: PublicWorldStatus;
  readonly activeScenes: readonly {
    readonly title: string;
    readonly summary: string;
    readonly sourceEventIds: readonly string[];
  }[];
};

/**
 * How many planning problems the runtime reported, and of which kinds.
 *
 * A *sibling* of the projection, never a field of it: `problems` is named in
 * {@link PUBLIC_DYNAMIC_FORBIDDEN_FIELDS} and PRD 2.0 §10.4 has no room for it. A viewer has
 * nothing to do with the fact that a location is unbound; an operator has everything to do
 * with it, and until now the runtime computed these and dropped them on the floor, so a
 * character vanishing from the map left no trace anywhere.
 *
 * Counts rather than the problems themselves: the individual records name `characterId`s,
 * and this value travels back through a mutation result that is easier to keep dull than to
 * keep private.
 *
 * ART-133 (FR-Q001) widened this by exactly one field. `records` carries the per-problem
 * attribution that AC#4 requires — a defect that cannot be traced to a character and a
 * location is not actionable — and `message` is dropped on the way, so what is carried is
 * a strict subset of what `PublicCharacterMotion` already publishes. The destination is
 * `dynamicViewIncidents`, read only through an operator-gated query; `records` never
 * reaches the public payload, which `'problems'` in {@link PUBLIC_DYNAMIC_FORBIDDEN_FIELDS}
 * and `assertPublicDynamicProjection`'s unknown-field refusal both independently prevent.
 */
export type AttributedRuntimeProblem = Omit<VisualRuntimeProblem, 'message'>;

export type RuntimeProblemSummary = {
  readonly total: number;
  readonly byCode: Readonly<Partial<Record<VisualRuntimeProblemCode, number>>>;
  readonly records: readonly AttributedRuntimeProblem[];
};

export type PublicDynamicProjectionResult = {
  readonly projection: PublicDynamicProjection;
  readonly problems: RuntimeProblemSummary;
};

export function summarizeRuntimeProblems(
  problems: readonly VisualRuntimeProblem[],
): RuntimeProblemSummary {
  const byCode: Partial<Record<VisualRuntimeProblemCode, number>> = {};
  const records: AttributedRuntimeProblem[] = [];
  for (const problem of problems) {
    byCode[problem.code] = (byCode[problem.code] ?? 0) + 1;
    // Field by field, not `{ ...problem }` minus a key: this is the one place `message`
    // is discarded, and an explicit construction cannot silently start carrying a field
    // that some future edit adds to `VisualRuntimeProblem`.
    records.push({ code: problem.code, characterId: problem.characterId, locationId: problem.locationId });
  }
  return { total: problems.length, byCode, records };
}

/**
 * Derive the public projection for a world.
 *
 * Seed-vs-event precedence is *not* implemented here — {@link planCharacterTrajectories} is
 * called exactly once with both the seed placements and the whole accepted history, and it
 * already resolves the precedence internally: a character with no accepted location fact
 * gets a bootstrap unit at its seeded location with `motionSequence` 0, and a character with
 * facts gets a Canon-derived unit with `motionSequence` equal to the last fact's sequence
 * number plus one. Since Canon sequence numbers start at 0, an event-derived motion always
 * has `motionSequence >= 1`, so the client's "highest motionSequence wins" rule reaches the
 * same conclusion the producer did without having to trust it. Re-implementing the
 * precedence here would give the two layers two chances to disagree.
 */
export function buildPublicDynamicProjection(
  input: PublicDynamicProjectionInput,
): PublicDynamicProjection {
  return buildPublicDynamicProjectionResult(input).projection;
}

/**
 * The same derivation as {@link buildPublicDynamicProjection}, returning the runtime's
 * problem summary alongside the payload. Callers that publish (and only they) should use
 * this one, so a character the runtime could not place is counted somewhere.
 */
export function buildPublicDynamicProjectionResult(
  input: PublicDynamicProjectionInput,
): PublicDynamicProjectionResult {
  if (input.worldId.trim().length === 0) {
    throw new PublicDynamicProjectionError('PUBLIC_DYNAMIC_INVALID_SHAPE', 'worldId must be non-empty');
  }
  if (!Number.isFinite(input.nowMs)) {
    throw new PublicDynamicProjectionError('PUBLIC_DYNAMIC_INVALID_SHAPE', 'nowMs must be finite');
  }

  const snapshot = planCharacterTrajectories({
    mapId: input.runtime.mapId,
    nowMs: input.nowMs,
    grid: input.runtime.grid,
    bindings: input.runtime.bindings,
    seedPlacements: input.seedPlacements,
    acceptedEvents: input.acceptedEvents,
  });

  const excluded = excludedCharacterIds(input.acceptedEvents);
  const characters = snapshot.trajectories
    .filter((trajectory) => !excluded.has(trajectory.characterId))
    .map(toPublicCharacterMotion)
    .sort((left, right) => left.characterId.localeCompare(right.characterId));

  const lastEvent = [...input.acceptedEvents]
    .sort((left, right) => left.sequenceNumber - right.sequenceNumber)
    .at(-1);

  const projection: PublicDynamicProjection = {
    worldId: input.worldId,
    mapId: input.runtime.mapId,
    runtimeVersion: PUBLIC_DYNAMIC_RUNTIME_VERSION,
    snapshotSequence: lastEvent ? lastEvent.sequenceNumber + 1 : 0,
    updatedAt: lastEvent ? lastEvent.acceptedAt : 0,
    worldStatus: input.worldStatus,
    characters,
    activeScenes: input.activeScenes.map((scene) => ({
      title: scene.title,
      summary: scene.summary,
      sourceEventIds: [...scene.sourceEventIds],
    })),
  };
  assertPublicDynamicProjection(projection);
  return { projection, problems: summarizeRuntimeProblems(snapshot.problems) };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertExactFields(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[],
  path: string,
): void {
  for (const field of required) {
    if (!(field in value)) {
      throw new PublicDynamicProjectionError(
        'PUBLIC_DYNAMIC_INVALID_SHAPE',
        `${path} is missing required field ${field}`,
      );
    }
  }
  const allowed = new Set<string>([...required, ...optional]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw new PublicDynamicProjectionError(
        'PUBLIC_DYNAMIC_UNKNOWN_FIELD',
        `${path} carries field ${key}, which the public contract does not publish`,
      );
    }
  }
}

function assertFiniteNumber(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new PublicDynamicProjectionError('PUBLIC_DYNAMIC_INVALID_VALUE', `${path} must be a finite number`);
  }
  return value;
}

function assertNonEmptyString(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new PublicDynamicProjectionError('PUBLIC_DYNAMIC_INVALID_VALUE', `${path} must be a non-empty string`);
  }
  return value;
}

function assertEnum<T extends string>(value: unknown, allowed: readonly T[], path: string): T {
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    throw new PublicDynamicProjectionError(
      'PUBLIC_DYNAMIC_INVALID_VALUE',
      `${path} must be one of ${allowed.join(' | ')}`,
    );
  }
  return value as T;
}

function assertPoint(value: unknown, path: string): void {
  if (!isPlainObject(value)) {
    throw new PublicDynamicProjectionError('PUBLIC_DYNAMIC_INVALID_SHAPE', `${path} must be an object`);
  }
  assertExactFields(value, ['x', 'y'], [], path);
  assertFiniteNumber(value.x, `${path}.x`);
  assertFiniteNumber(value.y, `${path}.y`);
}

function assertSourceEventIds(value: unknown, path: string): void {
  if (!Array.isArray(value)) {
    throw new PublicDynamicProjectionError('PUBLIC_DYNAMIC_INVALID_SHAPE', `${path} must be an array`);
  }
  value.forEach((entry, index) => assertNonEmptyString(entry, `${path}[${index}]`));
}

function assertCharacterMotion(value: unknown, path: string): void {
  if (!isPlainObject(value)) {
    throw new PublicDynamicProjectionError('PUBLIC_DYNAMIC_INVALID_SHAPE', `${path} must be an object`);
  }
  assertExactFields(value, PUBLIC_MOTION_REQUIRED_FIELDS, PUBLIC_MOTION_OPTIONAL_FIELDS, path);
  assertNonEmptyString(value.characterId, `${path}.characterId`);
  assertNonEmptyString(value.semanticLocationId, `${path}.semanticLocationId`);
  assertEnum(value.motionType, PUBLIC_MOTION_TYPES, `${path}.motionType`);
  assertEnum(value.animationState, PUBLIC_ANIMATION_STATES, `${path}.animationState`);
  assertEnum(value.direction, PUBLIC_DIRECTIONS, `${path}.direction`);
  const motionSequence = assertFiniteNumber(value.motionSequence, `${path}.motionSequence`);
  if (!Number.isSafeInteger(motionSequence) || motionSequence < 0) {
    throw new PublicDynamicProjectionError(
      'PUBLIC_DYNAMIC_INVALID_VALUE',
      `${path}.motionSequence must be a non-negative integer`,
    );
  }
  assertPoint(value.from, `${path}.from`);
  assertPoint(value.to, `${path}.to`);
  const startedAt = assertFiniteNumber(value.startedAt, `${path}.startedAt`);
  const arriveAt = assertFiniteNumber(value.arriveAt, `${path}.arriveAt`);
  if (arriveAt < startedAt) {
    throw new PublicDynamicProjectionError(
      'PUBLIC_DYNAMIC_INVALID_VALUE',
      `${path}.arriveAt must not precede startedAt`,
    );
  }
  if (value.sourceEventIds !== undefined) {
    assertSourceEventIds(value.sourceEventIds, `${path}.sourceEventIds`);
  }
}

function assertActiveScene(value: unknown, path: string): void {
  if (!isPlainObject(value)) {
    throw new PublicDynamicProjectionError('PUBLIC_DYNAMIC_INVALID_SHAPE', `${path} must be an object`);
  }
  assertExactFields(value, PUBLIC_ACTIVE_SCENE_FIELDS, [], path);
  if (typeof value.title !== 'string') {
    throw new PublicDynamicProjectionError('PUBLIC_DYNAMIC_INVALID_VALUE', `${path}.title must be a string`);
  }
  if (typeof value.summary !== 'string') {
    throw new PublicDynamicProjectionError('PUBLIC_DYNAMIC_INVALID_VALUE', `${path}.summary must be a string`);
  }
  assertSourceEventIds(value.sourceEventIds, `${path}.sourceEventIds`);
}

/**
 * Validate a projection field by field. Called before publishing and again when serving, so
 * a payload that was persisted before a contract change cannot be handed to a client that
 * only knows the current one.
 */
export function assertPublicDynamicProjection(value: unknown): asserts value is PublicDynamicProjection {
  if (!isPlainObject(value)) {
    throw new PublicDynamicProjectionError('PUBLIC_DYNAMIC_INVALID_SHAPE', 'projection must be an object');
  }
  assertExactFields(value, PUBLIC_DYNAMIC_ROOT_FIELDS, [], 'projection');
  assertNonEmptyString(value.worldId, 'projection.worldId');
  assertNonEmptyString(value.mapId, 'projection.mapId');
  const runtimeVersion = assertFiniteNumber(value.runtimeVersion, 'projection.runtimeVersion');
  if (!Number.isSafeInteger(runtimeVersion) || runtimeVersion < 1) {
    throw new PublicDynamicProjectionError(
      'PUBLIC_DYNAMIC_INVALID_VALUE',
      'projection.runtimeVersion must be a positive integer',
    );
  }
  const snapshotSequence = assertFiniteNumber(value.snapshotSequence, 'projection.snapshotSequence');
  if (!Number.isSafeInteger(snapshotSequence) || snapshotSequence < 0) {
    throw new PublicDynamicProjectionError(
      'PUBLIC_DYNAMIC_INVALID_VALUE',
      'projection.snapshotSequence must be a non-negative integer',
    );
  }
  const updatedAt = assertFiniteNumber(value.updatedAt, 'projection.updatedAt');
  if (updatedAt < 0) {
    throw new PublicDynamicProjectionError('PUBLIC_DYNAMIC_INVALID_VALUE', 'projection.updatedAt must not be negative');
  }
  assertEnum(value.worldStatus, PUBLIC_WORLD_STATUSES, 'projection.worldStatus');

  if (!Array.isArray(value.characters)) {
    throw new PublicDynamicProjectionError('PUBLIC_DYNAMIC_INVALID_SHAPE', 'projection.characters must be an array');
  }
  const seen = new Set<string>();
  value.characters.forEach((motion, index) => {
    const path = `projection.characters[${index}]`;
    assertCharacterMotion(motion, path);
    const characterId = (motion as PublicCharacterMotion).characterId;
    if (seen.has(characterId)) {
      throw new PublicDynamicProjectionError(
        'PUBLIC_DYNAMIC_INVALID_VALUE',
        `${path} repeats characterId ${characterId}; one character must have exactly one motion`,
      );
    }
    seen.add(characterId);
  });

  if (!Array.isArray(value.activeScenes)) {
    throw new PublicDynamicProjectionError('PUBLIC_DYNAMIC_INVALID_SHAPE', 'projection.activeScenes must be an array');
  }
  value.activeScenes.forEach((scene, index) => assertActiveScene(scene, `projection.activeScenes[${index}]`));
}

/**
 * Pull the dynamic projection out of a served `liveState` payload and re-validate it. A
 * payload that predates the `dynamic` field yields `null` rather than throwing: an older
 * last-known-good version is still worth serving, the client just gets no motion from it.
 */
export function selectPublicDynamicProjection(payload: unknown): PublicDynamicProjection | null {
  if (!isPlainObject(payload)) return null;
  const dynamic = payload.dynamic;
  if (dynamic === undefined || dynamic === null) return null;
  assertPublicDynamicProjection(dynamic);
  return dynamic;
}
