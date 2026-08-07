/**
 * Public Runtime Snapshot — the durable last-valid view and its freshness verdict
 * (FR-N007 / ART-116).
 *
 * ART-115's {@link PublicDynamicProjection} answers *what the world looks like right now*.
 * It is re-derived per accepted Canon event, so a world that stops producing events — a
 * paused schedule, a failed slot, a provider outage — simply stops producing projections.
 * This module answers the two questions that follow from that:
 *
 * 1. **What can we still show?** A snapshot is persisted with its own monotonic
 *    `snapshotSequence`, so the public view keeps rendering the last valid world state with
 *    no simulation running at all.
 * 2. **How honest is it?** {@link classifyRuntimeFreshness} turns elapsed clock into an
 *    explicit `live | delayed | paused | stale` verdict, so a five-hour-old snapshot is
 *    never presented as though it were updating continuously.
 *
 * Three properties define the module:
 *
 * - **It is pure.** No Convex import, no clock, no randomness. `nowMs` is always a
 *   parameter, so a freshness verdict is reproducible and a test can sit at any instant.
 * - **Freshness is never persisted.** The stored `status` is `live | paused` — the two
 *   states the world itself can be in. `delayed` and `stale` are statements about *our
 *   clock*, not about the world, and are computed on every read. There is therefore no
 *   write path that could store a stale snapshot labelled live.
 * - **Sequences only ever move forward.** {@link commitRuntimeSnapshot} allocates
 *   `head + 1` and refuses a source projection that has gone backwards, so a client that
 *   reconnects can never observe a lower sequence than it already saw.
 */

import {
  PUBLIC_ACTIVE_SCENE_FIELDS,
  PUBLIC_ANIMATION_STATES,
  PUBLIC_DIRECTIONS,
  PUBLIC_MOTION_OPTIONAL_FIELDS,
  PUBLIC_MOTION_REQUIRED_FIELDS,
  PUBLIC_MOTION_TYPES,
  type PublicActiveScene,
  type PublicCharacterMotion,
  type PublicDynamicProjection,
  type PublicWorldStatus,
} from './publicDynamicProjection';

export const RUNTIME_SNAPSHOT_SCHEMA_VERSION = 1;

const HOUR_MS = 3_600_000;

/**
 * The longest gap between two consecutive public slots.
 *
 * `convex/simulation/scheduler.ts` starts public slots at 00:00, 06:00, 11:00, 15:00 and
 * 19:00, so the gaps are 6h, 5h, 4h, 4h and 5h. Duplicated rather than imported because
 * `architecture/module-boundaries.json` forbids `publicRead` from depending on
 * `simulation`; a test imports the real `PUBLIC_SLOT_START_MS` (the boundary checker skips
 * `*.test.*`) and fails if a schedule change makes this number wrong, so the duplication
 * cannot rot into a silent misclassification.
 */
export const PUBLIC_SLOT_MAX_GAP_MS = 6 * HOUR_MS;

/**
 * Content younger than one full slot gap is `live`: the world has produced something
 * within the window in which it was supposed to produce something.
 */
export const RUNTIME_SNAPSHOT_LIVE_MAX_AGE_MS = PUBLIC_SLOT_MAX_GAP_MS;

/** One missed slot gap is `delayed`; beyond two, the content is `stale`. */
export const RUNTIME_SNAPSHOT_DELAYED_MAX_AGE_MS = 2 * PUBLIC_SLOT_MAX_GAP_MS;

/**
 * How long a snapshot's *observation* stays trustworthy. The capture cron runs hourly, so
 * an `observedAt` older than this means the capture path itself is down and the recorded
 * `status` is a claim nobody has checked in half a day. Such a snapshot is reported
 * `stale` regardless of how recent its content looks.
 */
export const RUNTIME_SNAPSHOT_OBSERVATION_MAX_AGE_MS = 2 * PUBLIC_SLOT_MAX_GAP_MS;

/** The states the *world* can be in, and therefore the only states worth persisting. */
export const RUNTIME_SNAPSHOT_STATUSES = ['live', 'paused'] as const;
export type PublicRuntimeSnapshotStatus = (typeof RUNTIME_SNAPSHOT_STATUSES)[number];

/** The verdict a client receives. Derived on read; never stored. */
export const RUNTIME_FRESHNESS = ['live', 'delayed', 'paused', 'stale'] as const;
export type PublicRuntimeFreshness = (typeof RUNTIME_FRESHNESS)[number];

export type RuntimeSnapshotErrorCode =
  | 'RUNTIME_SNAPSHOT_INVALID_SHAPE'
  | 'RUNTIME_SNAPSHOT_UNKNOWN_FIELD'
  | 'RUNTIME_SNAPSHOT_INVALID_VALUE';

export class RuntimeSnapshotError extends Error {
  constructor(readonly code: RuntimeSnapshotErrorCode, message: string) {
    super(`[${code}] ${message}`);
    this.name = 'RuntimeSnapshotError';
  }
}

export type PublicRuntimeSnapshot = {
  schemaVersion: typeof RUNTIME_SNAPSHOT_SCHEMA_VERSION;
  worldId: string;
  runtimeVersion: number;
  /** This table's own counter. Starts at 1 and only ever increases. */
  snapshotSequence: number;
  /** The source `PublicDynamicProjection.snapshotSequence`. `0` for a world with no history. */
  sourceRuntimeSequence: number;
  status: PublicRuntimeSnapshotStatus;
  mapId: string;
  characterStates: PublicCharacterMotion[];
  activeSceneStates: PublicActiveScene[];
  /** The source projection's `updatedAt` — Canon-derived, not a clock read. */
  contentUpdatedAt: number;
  contentHash: string;
  createdAt: number;
  /** When a capture last confirmed this content and status were still current. */
  observedAt: number;
  isCurrent: boolean;
};

/** A {@link PublicRuntimeSnapshot} with its store-assigned opaque id. */
export type StoredRuntimeSnapshot = PublicRuntimeSnapshot & { id: string };

export const RUNTIME_SNAPSHOT_FIELDS = [
  'schemaVersion', 'worldId', 'runtimeVersion', 'snapshotSequence', 'sourceRuntimeSequence',
  'status', 'mapId', 'characterStates', 'activeSceneStates', 'contentUpdatedAt',
  'contentHash', 'createdAt', 'observedAt', 'isCurrent',
] as const;

/**
 * Read-only surface for the public query. Exposes the head snapshot and nothing else —
 * there is no method here that could reach Canon, a schedule, or a provider.
 */
export interface RuntimeSnapshotReadStore {
  loadCurrent(worldId: string): Promise<StoredRuntimeSnapshot | null>;
}

/** Full surface for the capture path. */
export interface RuntimeSnapshotStore extends RuntimeSnapshotReadStore {
  insertSnapshot(row: PublicRuntimeSnapshot): Promise<string>;
  /** Clear `isCurrent` on a superseded head. */
  demote(rowId: string): Promise<void>;
  /** Record that a capture re-observed this snapshot's content unchanged. */
  touchObservedAt(rowId: string, observedAt: number): Promise<void>;
}

/**
 * The thresholds the verdict was computed against, published alongside it.
 *
 * A Convex query does not re-run because a clock ticked — it re-runs when its data
 * changes. A client holding a `live` envelope would therefore keep displaying `live`
 * indefinitely if it trusted the field alone. Shipping the thresholds and the two ages
 * lets the client re-derive the verdict locally as its own clock advances, using exactly
 * the rules in {@link classifyRuntimeFreshness}.
 */
export type PublicRuntimeSnapshotThresholds = {
  liveMaxAgeMs: number;
  delayedMaxAgeMs: number;
  observationMaxAgeMs: number;
};

export type PublicRuntimeSnapshotEnvelope = {
  worldId: string;
  runtimeVersion: number;
  snapshotSequence: number;
  sourceRuntimeSequence: number;
  status: PublicRuntimeSnapshotStatus;
  freshness: PublicRuntimeFreshness;
  mapId: string;
  characterStates: PublicCharacterMotion[];
  activeSceneStates: PublicActiveScene[];
  contentUpdatedAt: number;
  createdAt: number;
  observedAt: number;
  contentAgeMs: number;
  observationAgeMs: number;
  thresholds: PublicRuntimeSnapshotThresholds;
};

export const RUNTIME_SNAPSHOT_ENVELOPE_FIELDS = [
  'worldId', 'runtimeVersion', 'snapshotSequence', 'sourceRuntimeSequence', 'status',
  'freshness', 'mapId', 'characterStates', 'activeSceneStates', 'contentUpdatedAt',
  'createdAt', 'observedAt', 'contentAgeMs', 'observationAgeMs', 'thresholds',
] as const;

export const RUNTIME_SNAPSHOT_THRESHOLDS: PublicRuntimeSnapshotThresholds = {
  liveMaxAgeMs: RUNTIME_SNAPSHOT_LIVE_MAX_AGE_MS,
  delayedMaxAgeMs: RUNTIME_SNAPSHOT_DELAYED_MAX_AGE_MS,
  observationMaxAgeMs: RUNTIME_SNAPSHOT_OBSERVATION_MAX_AGE_MS,
};

export type RuntimeFreshnessInput = {
  readonly status: PublicRuntimeSnapshotStatus;
  readonly sourceRuntimeSequence: number;
  readonly contentUpdatedAt: number;
  readonly createdAt: number;
  readonly observedAt: number;
  readonly nowMs: number;
};

export type RuntimeFreshnessVerdict = {
  freshness: PublicRuntimeFreshness;
  contentAgeMs: number;
  observationAgeMs: number;
};

/**
 * The instant the content is measured from.
 *
 * A world with no accepted events has `PublicDynamicProjection.updatedAt === 0`, because
 * that field is the last event's `acceptedAt` and there is no last event. Measuring age
 * from the Unix epoch would report a world seeded five minutes ago as decades old, so a
 * zero-history snapshot is measured from when it was captured instead. `sourceRuntimeSequence`
 * (not `contentUpdatedAt === 0`) is the discriminator: it is `0` exactly when there is no
 * history, whereas a real event could in principle carry any timestamp.
 */
function effectiveContentAt(input: Pick<RuntimeFreshnessInput, 'sourceRuntimeSequence' | 'contentUpdatedAt' | 'createdAt'>): number {
  return input.sourceRuntimeSequence > 0 ? input.contentUpdatedAt : input.createdAt;
}

/**
 * Classify how much a client should trust a snapshot, as an ordered first-match-wins
 * decision tree:
 *
 * 1. `paused` wins over everything. A paused world is not broken and not behind — it is
 *    stopped on purpose, and its content is exactly as current as it will ever be. Ageing
 *    it into `stale` would report an intentional state as a fault.
 * 2. An observation older than {@link RUNTIME_SNAPSHOT_OBSERVATION_MAX_AGE_MS} is `stale`
 *    whatever the content says. The capture path is what keeps `status` true; if it has
 *    not run in half a day, we do not know whether the world is still running, and
 *    claiming `live` would be a guess.
 * 3. Content within one slot gap is `live`.
 * 4. Content within two slot gaps is `delayed` — one missed slot, plausibly recoverable.
 * 5. Anything older is `stale`.
 */
export function classifyRuntimeFreshness(input: RuntimeFreshnessInput): RuntimeFreshnessVerdict {
  if (!Number.isFinite(input.nowMs)) {
    throw new RuntimeSnapshotError('RUNTIME_SNAPSHOT_INVALID_SHAPE', 'nowMs must be finite');
  }
  const observationAgeMs = Math.max(0, input.nowMs - input.observedAt);
  const contentAgeMs = Math.max(0, input.nowMs - effectiveContentAt(input));

  const freshness = ((): PublicRuntimeFreshness => {
    if (input.status === 'paused') return 'paused';
    if (observationAgeMs >= RUNTIME_SNAPSHOT_OBSERVATION_MAX_AGE_MS) return 'stale';
    if (contentAgeMs < RUNTIME_SNAPSHOT_LIVE_MAX_AGE_MS) return 'live';
    if (contentAgeMs < RUNTIME_SNAPSHOT_DELAYED_MAX_AGE_MS) return 'delayed';
    return 'stale';
  })();

  return { freshness, contentAgeMs, observationAgeMs };
}

/** Deterministic stable serialisation (object keys sorted) for the content digest. */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const entries = Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

export type RuntimeSnapshotContentInput = {
  readonly sourceRuntimeSequence: number;
  readonly status: PublicRuntimeSnapshotStatus;
  readonly mapId: string;
  readonly characterStates: readonly PublicCharacterMotion[];
  readonly activeSceneStates: readonly PublicActiveScene[];
};

/**
 * Digest of everything a viewer would actually see, and nothing else.
 *
 * Timestamps are excluded on purpose: the hourly capture cron re-observes an idle world
 * whose content has not changed, and if the clock were in the hash every heartbeat would
 * append a row and burn a sequence number. Excluding them turns that heartbeat into a
 * single `observedAt` patch. djb2 — not cryptographic; uniqueness is for dedup only.
 */
export function hashRuntimeSnapshotContent(input: RuntimeSnapshotContentInput): string {
  const text = stableStringify({
    sourceRuntimeSequence: input.sourceRuntimeSequence,
    status: input.status,
    mapId: input.mapId,
    characterStates: input.characterStates,
    activeSceneStates: input.activeSceneStates,
  });
  let hash = 5381;
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash * 33) ^ text.charCodeAt(index)) >>> 0;
  }
  return `rshash:${hash.toString(16)}`;
}

/**
 * Map the schedule's view of a world onto a persistable snapshot status.
 *
 * `unknown` becomes `paused`, not `live`. `unknown` means the schedule row could not be
 * read, and the one thing we must never do on missing information is tell a visitor the
 * world is updating. `paused` is the honest fail-closed answer: something has stopped.
 */
const WORLD_STATUS_MAP: Record<PublicWorldStatus, PublicRuntimeSnapshotStatus> = {
  running: 'live',
  paused: 'paused',
  unknown: 'paused',
};

export function toRuntimeSnapshotStatus(worldStatus: PublicWorldStatus): PublicRuntimeSnapshotStatus {
  const mapped = WORLD_STATUS_MAP[worldStatus];
  if (!mapped) {
    throw new RuntimeSnapshotError(
      'RUNTIME_SNAPSHOT_INVALID_VALUE',
      `unmapped world status: ${String(worldStatus)}`,
    );
  }
  return mapped;
}

export type BuildRuntimeSnapshotInput = {
  readonly worldId: string;
  readonly dynamic: PublicDynamicProjection;
  readonly worldStatus: PublicWorldStatus;
  readonly snapshotSequence: number;
  readonly now: number;
};

/**
 * Narrow a validated {@link PublicDynamicProjection} into a snapshot row.
 *
 * `worldStatus` is taken as an argument rather than read off `dynamic.worldStatus`: the
 * projection may be a last-known-good rebuilt before the world was paused, and the whole
 * point of the capture cron is to record the schedule's status *now*.
 */
export function buildRuntimeSnapshot(input: BuildRuntimeSnapshotInput): PublicRuntimeSnapshot {
  if (input.worldId.trim().length === 0) {
    throw new RuntimeSnapshotError('RUNTIME_SNAPSHOT_INVALID_SHAPE', 'worldId must be non-empty');
  }
  if (!Number.isFinite(input.now)) {
    throw new RuntimeSnapshotError('RUNTIME_SNAPSHOT_INVALID_SHAPE', 'now must be finite');
  }
  const status = toRuntimeSnapshotStatus(input.worldStatus);
  const characterStates = input.dynamic.characters.map((motion) => ({ ...motion }));
  const activeSceneStates = input.dynamic.activeScenes.map((scene) => ({
    title: scene.title,
    summary: scene.summary,
    sourceEventIds: [...scene.sourceEventIds],
  }));

  const snapshot: PublicRuntimeSnapshot = {
    schemaVersion: RUNTIME_SNAPSHOT_SCHEMA_VERSION,
    worldId: input.worldId,
    runtimeVersion: input.dynamic.runtimeVersion,
    snapshotSequence: input.snapshotSequence,
    sourceRuntimeSequence: input.dynamic.snapshotSequence,
    status,
    mapId: input.dynamic.mapId,
    characterStates,
    activeSceneStates,
    contentUpdatedAt: input.dynamic.updatedAt,
    contentHash: hashRuntimeSnapshotContent({
      sourceRuntimeSequence: input.dynamic.snapshotSequence,
      status,
      mapId: input.dynamic.mapId,
      characterStates,
      activeSceneStates,
    }),
    createdAt: input.now,
    observedAt: input.now,
    isCurrent: true,
  };
  assertPublicRuntimeSnapshot(snapshot);
  return snapshot;
}

export type CommitRuntimeSnapshotReason = 'captured' | 'deduplicated' | 'source_regressed';

export type CommitRuntimeSnapshotResult = {
  snapshotSequence: number;
  sourceRuntimeSequence: number;
  contentHash: string;
  captured: boolean;
  reason: CommitRuntimeSnapshotReason;
};

export type CommitRuntimeSnapshotInput = {
  readonly worldId: string;
  readonly dynamic: PublicDynamicProjection;
  readonly worldStatus: PublicWorldStatus;
  readonly now: number;
};

/**
 * Capture a snapshot, or record that nothing changed.
 *
 * Three outcomes, in the order they are decided:
 *
 * - **`source_regressed`** — the incoming projection is built from an older Canon position
 *   than the head already published. That happens when the read-model store falls back to
 *   a last-known-good version, and publishing it would walk the runtime sequence backwards
 *   for every client watching. The head is left alone.
 * - **`deduplicated`** — the content digest matches the head. Only `observedAt` is patched,
 *   which is what makes the hourly heartbeat cheap and keeps the sequence stable.
 * - **`captured`** — a new head at `head.snapshotSequence + 1`.
 *
 * The new row is inserted *before* the old head is demoted, mirroring
 * `commitReadModelVersion`: if the insert fails, the previous head is still `isCurrent`
 * and still serving, rather than the world having no readable snapshot at all.
 */
export async function commitRuntimeSnapshot(
  store: RuntimeSnapshotStore,
  input: CommitRuntimeSnapshotInput,
): Promise<CommitRuntimeSnapshotResult> {
  if (input.worldId.trim().length === 0) {
    throw new RuntimeSnapshotError('RUNTIME_SNAPSHOT_INVALID_SHAPE', 'worldId must be non-empty');
  }
  if (!Number.isFinite(input.now)) {
    throw new RuntimeSnapshotError('RUNTIME_SNAPSHOT_INVALID_SHAPE', 'now must be finite');
  }

  const head = await store.loadCurrent(input.worldId);

  if (head && input.dynamic.snapshotSequence < head.sourceRuntimeSequence) {
    return {
      snapshotSequence: head.snapshotSequence,
      sourceRuntimeSequence: head.sourceRuntimeSequence,
      contentHash: head.contentHash,
      captured: false,
      reason: 'source_regressed',
    };
  }

  const next = buildRuntimeSnapshot({
    worldId: input.worldId,
    dynamic: input.dynamic,
    worldStatus: input.worldStatus,
    snapshotSequence: (head?.snapshotSequence ?? 0) + 1,
    now: input.now,
  });

  if (head && head.contentHash === next.contentHash) {
    await store.touchObservedAt(head.id, input.now);
    return {
      snapshotSequence: head.snapshotSequence,
      sourceRuntimeSequence: head.sourceRuntimeSequence,
      contentHash: head.contentHash,
      captured: false,
      reason: 'deduplicated',
    };
  }

  await store.insertSnapshot(next);
  if (head) await store.demote(head.id);

  return {
    snapshotSequence: next.snapshotSequence,
    sourceRuntimeSequence: next.sourceRuntimeSequence,
    contentHash: next.contentHash,
    captured: true,
    reason: 'captured',
  };
}

/**
 * Serve the head snapshot with its freshness verdict. Read-only: this is the whole public
 * read path, and it touches one table and one clock argument.
 */
export async function serveRuntimeSnapshot(
  store: RuntimeSnapshotReadStore,
  worldId: string,
  nowMs: number,
): Promise<PublicRuntimeSnapshotEnvelope | null> {
  if (worldId.trim().length === 0) {
    throw new RuntimeSnapshotError('RUNTIME_SNAPSHOT_INVALID_SHAPE', 'worldId must be non-empty');
  }
  const head = await store.loadCurrent(worldId);
  if (!head) return null;
  assertPublicRuntimeSnapshot(head);

  const verdict = classifyRuntimeFreshness({
    status: head.status,
    sourceRuntimeSequence: head.sourceRuntimeSequence,
    contentUpdatedAt: head.contentUpdatedAt,
    createdAt: head.createdAt,
    observedAt: head.observedAt,
    nowMs,
  });

  return {
    worldId: head.worldId,
    runtimeVersion: head.runtimeVersion,
    snapshotSequence: head.snapshotSequence,
    sourceRuntimeSequence: head.sourceRuntimeSequence,
    status: head.status,
    freshness: verdict.freshness,
    mapId: head.mapId,
    characterStates: head.characterStates,
    activeSceneStates: head.activeSceneStates,
    contentUpdatedAt: head.contentUpdatedAt,
    createdAt: head.createdAt,
    observedAt: head.observedAt,
    contentAgeMs: verdict.contentAgeMs,
    observationAgeMs: verdict.observationAgeMs,
    thresholds: { ...RUNTIME_SNAPSHOT_THRESHOLDS },
  };
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
      throw new RuntimeSnapshotError(
        'RUNTIME_SNAPSHOT_INVALID_SHAPE',
        `${path} is missing required field ${field}`,
      );
    }
  }
  const allowed = new Set<string>([...required, ...optional]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw new RuntimeSnapshotError(
        'RUNTIME_SNAPSHOT_UNKNOWN_FIELD',
        `${path} carries field ${key}, which the snapshot contract does not publish`,
      );
    }
  }
}

function assertFiniteNumber(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new RuntimeSnapshotError('RUNTIME_SNAPSHOT_INVALID_VALUE', `${path} must be a finite number`);
  }
  return value;
}

function assertNonNegativeInteger(value: unknown, path: string): number {
  const numeric = assertFiniteNumber(value, path);
  if (!Number.isSafeInteger(numeric) || numeric < 0) {
    throw new RuntimeSnapshotError('RUNTIME_SNAPSHOT_INVALID_VALUE', `${path} must be a non-negative integer`);
  }
  return numeric;
}

function assertNonEmptyString(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new RuntimeSnapshotError('RUNTIME_SNAPSHOT_INVALID_VALUE', `${path} must be a non-empty string`);
  }
  return value;
}

function assertEnum<T extends string>(value: unknown, allowed: readonly T[], path: string): T {
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    throw new RuntimeSnapshotError(
      'RUNTIME_SNAPSHOT_INVALID_VALUE',
      `${path} must be one of ${allowed.join(' | ')}`,
    );
  }
  return value as T;
}

function assertPoint(value: unknown, path: string): void {
  if (!isPlainObject(value)) {
    throw new RuntimeSnapshotError('RUNTIME_SNAPSHOT_INVALID_SHAPE', `${path} must be an object`);
  }
  assertExactFields(value, ['x', 'y'], [], path);
  assertFiniteNumber(value.x, `${path}.x`);
  assertFiniteNumber(value.y, `${path}.y`);
}

function assertSourceEventIds(value: unknown, path: string): void {
  if (!Array.isArray(value)) {
    throw new RuntimeSnapshotError('RUNTIME_SNAPSHOT_INVALID_SHAPE', `${path} must be an array`);
  }
  value.forEach((entry, index) => assertNonEmptyString(entry, `${path}[${index}]`));
}

/**
 * Validate one carried motion. The field allowlist and the enums are ART-115's exported
 * constants, not copies: a snapshot must publish exactly the §10.4 unit, and pinning it to
 * the source of that contract is what stops the two drifting apart.
 */
function assertCharacterState(value: unknown, path: string): void {
  if (!isPlainObject(value)) {
    throw new RuntimeSnapshotError('RUNTIME_SNAPSHOT_INVALID_SHAPE', `${path} must be an object`);
  }
  assertExactFields(value, PUBLIC_MOTION_REQUIRED_FIELDS, PUBLIC_MOTION_OPTIONAL_FIELDS, path);
  assertNonEmptyString(value.characterId, `${path}.characterId`);
  assertNonEmptyString(value.semanticLocationId, `${path}.semanticLocationId`);
  assertEnum(value.motionType, PUBLIC_MOTION_TYPES, `${path}.motionType`);
  assertEnum(value.animationState, PUBLIC_ANIMATION_STATES, `${path}.animationState`);
  assertEnum(value.direction, PUBLIC_DIRECTIONS, `${path}.direction`);
  assertNonNegativeInteger(value.motionSequence, `${path}.motionSequence`);
  assertPoint(value.from, `${path}.from`);
  assertPoint(value.to, `${path}.to`);
  const startedAt = assertFiniteNumber(value.startedAt, `${path}.startedAt`);
  const arriveAt = assertFiniteNumber(value.arriveAt, `${path}.arriveAt`);
  if (arriveAt < startedAt) {
    throw new RuntimeSnapshotError('RUNTIME_SNAPSHOT_INVALID_VALUE', `${path}.arriveAt must not precede startedAt`);
  }
  if (value.sourceEventIds !== undefined) {
    assertSourceEventIds(value.sourceEventIds, `${path}.sourceEventIds`);
  }
}

function assertActiveSceneState(value: unknown, path: string): void {
  if (!isPlainObject(value)) {
    throw new RuntimeSnapshotError('RUNTIME_SNAPSHOT_INVALID_SHAPE', `${path} must be an object`);
  }
  assertExactFields(value, PUBLIC_ACTIVE_SCENE_FIELDS, [], path);
  if (typeof value.title !== 'string') {
    throw new RuntimeSnapshotError('RUNTIME_SNAPSHOT_INVALID_VALUE', `${path}.title must be a string`);
  }
  if (typeof value.summary !== 'string') {
    throw new RuntimeSnapshotError('RUNTIME_SNAPSHOT_INVALID_VALUE', `${path}.summary must be a string`);
  }
  assertSourceEventIds(value.sourceEventIds, `${path}.sourceEventIds`);
}

/**
 * Validate a snapshot field by field. Run before a row is written and again when one is
 * read back, so a row persisted under an older contract cannot reach a client that only
 * knows the current one.
 *
 * A store row carries an `id` the pure contract does not, so it is accepted as the single
 * optional field rather than forcing every caller to strip it first.
 */
export function assertPublicRuntimeSnapshot(value: unknown): asserts value is PublicRuntimeSnapshot {
  if (!isPlainObject(value)) {
    throw new RuntimeSnapshotError('RUNTIME_SNAPSHOT_INVALID_SHAPE', 'snapshot must be an object');
  }
  assertExactFields(value, RUNTIME_SNAPSHOT_FIELDS, ['id'], 'snapshot');

  if (value.schemaVersion !== RUNTIME_SNAPSHOT_SCHEMA_VERSION) {
    throw new RuntimeSnapshotError(
      'RUNTIME_SNAPSHOT_INVALID_VALUE',
      `snapshot.schemaVersion must be ${RUNTIME_SNAPSHOT_SCHEMA_VERSION}`,
    );
  }
  assertNonEmptyString(value.worldId, 'snapshot.worldId');
  assertNonEmptyString(value.mapId, 'snapshot.mapId');
  assertNonEmptyString(value.contentHash, 'snapshot.contentHash');
  assertEnum(value.status, RUNTIME_SNAPSHOT_STATUSES, 'snapshot.status');

  const runtimeVersion = assertNonNegativeInteger(value.runtimeVersion, 'snapshot.runtimeVersion');
  if (runtimeVersion < 1) {
    throw new RuntimeSnapshotError('RUNTIME_SNAPSHOT_INVALID_VALUE', 'snapshot.runtimeVersion must be a positive integer');
  }
  const snapshotSequence = assertNonNegativeInteger(value.snapshotSequence, 'snapshot.snapshotSequence');
  if (snapshotSequence < 1) {
    throw new RuntimeSnapshotError('RUNTIME_SNAPSHOT_INVALID_VALUE', 'snapshot.snapshotSequence must start at 1');
  }
  assertNonNegativeInteger(value.sourceRuntimeSequence, 'snapshot.sourceRuntimeSequence');
  assertNonNegativeInteger(value.contentUpdatedAt, 'snapshot.contentUpdatedAt');
  assertNonNegativeInteger(value.createdAt, 'snapshot.createdAt');
  assertNonNegativeInteger(value.observedAt, 'snapshot.observedAt');

  if (typeof value.isCurrent !== 'boolean') {
    throw new RuntimeSnapshotError('RUNTIME_SNAPSHOT_INVALID_VALUE', 'snapshot.isCurrent must be a boolean');
  }

  if (!Array.isArray(value.characterStates)) {
    throw new RuntimeSnapshotError('RUNTIME_SNAPSHOT_INVALID_SHAPE', 'snapshot.characterStates must be an array');
  }
  const seen = new Set<string>();
  value.characterStates.forEach((motion, index) => {
    const path = `snapshot.characterStates[${index}]`;
    assertCharacterState(motion, path);
    const characterId = (motion as PublicCharacterMotion).characterId;
    if (seen.has(characterId)) {
      throw new RuntimeSnapshotError(
        'RUNTIME_SNAPSHOT_INVALID_VALUE',
        `${path} repeats characterId ${characterId}; one character must have exactly one motion`,
      );
    }
    seen.add(characterId);
  });

  if (!Array.isArray(value.activeSceneStates)) {
    throw new RuntimeSnapshotError('RUNTIME_SNAPSHOT_INVALID_SHAPE', 'snapshot.activeSceneStates must be an array');
  }
  value.activeSceneStates.forEach((scene, index) =>
    assertActiveSceneState(scene, `snapshot.activeSceneStates[${index}]`));
}
