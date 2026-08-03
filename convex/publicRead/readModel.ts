/**
 * Public read-model infrastructure — failure-isolated read path (NFR-001/002/005,
 * PRD §16.3).
 *
 * This module serves PRE-COMPUTED, publication-gated snapshots and NEVER reads
 * canon, simulation, or any LLM/provider. That isolation is enforced
 * structurally:
 *   - the architecture boundary (architecture/module-boundaries.json) forbids
 *     publicRead from depending on simulation (where the LLM adapters live), and
 *   - the read path takes no provider dependency whatsoever — it only consults a
 *     {@link PublicReadStore} of already-published snapshots.
 *
 * Consequences:
 *   - Published read data stays available during simulation/model failure (the
 *     snapshots were materialised ahead of time) — AC#1.
 *   - Public reads never invoke LLM generation (there is no generation step on
 *     this path) — AC#3, and LLM-call count is invariant as read volume grows —
 *     AC#6 / §16.3.
 *   - When the current version is withheld or fails, the last-known-good version
 *     is served instead — AC#5.
 *
 * Pure module — no Convex imports, no clock, no randomness. Callers supply the
 * wall-clock `now`; persistence + the public query/mutation wiring live in
 * {@link ./readModelFunctions.ts}.
 */

import type { JsonValue } from '../canon/model';

export type { JsonValue };

export const READ_MODEL_SCHEMA_VERSION = 1;

/**
 * Kinds of published read-models. The set is intentionally open: downstream
 * projection tasks (world, character, episode, arc, relationship, liveState)
 * register their payloads against one of these kinds. The infrastructure is
 * kind-agnostic — it versions, gates, and sanitises any JSON payload.
 */
export const READ_MODEL_KINDS = [
  'world', 'character', 'episode', 'arc', 'relationship', 'liveState', 'timeline',
] as const;
export type ReadModelKind = (typeof READ_MODEL_KINDS)[number];

export function isReadModelKind(value: unknown): value is ReadModelKind {
  return typeof value === 'string' && (READ_MODEL_KINDS as readonly string[]).includes(value);
}

/** Servability of a version. Only `published` is served to visitors. */
export const READ_MODEL_STATUSES = ['publishing', 'published', 'withheld', 'failed'] as const;
export type ReadModelStatus = (typeof READ_MODEL_STATUSES)[number];
export const SERVABLE_STATUS: ReadModelStatus = 'published';

export function isReadModelStatus(value: unknown): value is ReadModelStatus {
  return typeof value === 'string' && (READ_MODEL_STATUSES as readonly string[]).includes(value);
}

export class ReadModelError extends Error {
  constructor(readonly code: string, message: string) {
    super(`[${code}] ${message}`);
    this.name = 'ReadModelError';
  }
}

/**
 * Key patterns that mark a field as private and must never appear in a public
 * payload. Covers private Knowledge, character memory, LLM prompts, raw model
 * output, administrator notes, secrets, and credentials (AC#4). Matching is
 * case-insensitive on the key name, at any nesting depth.
 */
const PRIVATE_KEY_PATTERNS: readonly RegExp[] = [
  /knowledge/i,
  /memor(?:y|ies)/i,
  /prompt/i,
  /raw(?:model)?output/i,
  /rawmodel/i,
  /admin(?:istrator)?notes?/i,
  /secret/i,
  /credential/i,
  /password/i,
  /api[_-]?key/i,
  /token/i,
  /private/i,
];

function isPrivateKey(key: string): boolean {
  return PRIVATE_KEY_PATTERNS.some((pattern) => pattern.test(key));
}

/**
 * Recursively strip private fields from a payload at any depth (AC#4). Arrays
 * are sanitised element-wise; objects drop any key matching a private pattern.
 * Returns a NEW value; never mutates the input. Projection builders remain
 * responsible for pre-filtering domain-private entries (e.g. Canon
 * `visibility: 'private'` state changes); this is the defence-in-depth layer.
 */
export function sanitizeForPublic(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map((item) => sanitizeForPublic(item));
  if (value !== null && typeof value === 'object') {
    const out: Record<string, JsonValue> = {};
    for (const [key, entry] of Object.entries(value)) {
      if (isPrivateKey(key)) continue;
      out[key] = sanitizeForPublic(entry);
    }
    return out;
  }
  return value;
}

/** Deterministic stable serialisation (object keys sorted) for idempotency digests. */
function stableStringify(value: JsonValue): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, JsonValue>)[k])}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value);
}

/**
 * Stable digest of a (sanitised) payload, for idempotent writes. djb2 over the
 * stable serialisation — NOT cryptographic; uniqueness is for dedup only.
 */
export function hashPayload(payload: JsonValue): string {
  const text = stableStringify(payload);
  let hash = 5381;
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash * 33) ^ text.charCodeAt(index)) >>> 0;
  }
  return `rmhash:${hash.toString(16)}`;
}

/** A persisted published read-model version. `payload` is already allowlisted. */
export type PublishedReadModel = {
  schemaVersion: typeof READ_MODEL_SCHEMA_VERSION;
  worldId: string;
  modelKind: ReadModelKind;
  /** Stable target reference, e.g. `episode:<worldDay>` or `character:<characterId>`. */
  modelRef: string;
  /** Monotonic per-target version; regeneration allocates the next version. */
  version: number;
  payload: JsonValue;
  status: ReadModelStatus;
  /** Canon event provenance — retained verbatim, never stripped. */
  sourceEventIds: string[];
  /** True for the live version of a target. At most one per (worldId, modelKind, modelRef). */
  isCurrent: boolean;
  /** True for the retained fallback served when the current version is withheld/failed. */
  isLastKnownGood: boolean;
  /** Stable digest of the allowlisted payload, for idempotent writes. */
  contentHash: string;
  createdAt: number;
  publishedAt: number | null;
};

/** A {@link PublishedReadModel} with its store-assigned opaque id. */
export type StoredReadModel = PublishedReadModel & { id: string };

/**
 * Read-only repository surface for the public read path. The Convex query wiring
 * adapts `ctx.db` to this interface; tests supply an in-memory implementation.
 * Crucially, the store exposes ONLY published snapshots — there is no method
 * here that reads canon, simulation, or invokes a provider (AC#1/#3).
 */
export interface PublicReadReadStore {
  loadTargetVersions(worldId: string, modelKind: ReadModelKind, modelRef: string): Promise<readonly StoredReadModel[]>;
}

/**
 * Full repository surface for the projection-writer pipeline (extends the
 * read-only store with write methods). The Convex mutation wiring adapts
 * `ctx.db` to this interface; tests supply an in-memory implementation.
 */
export interface PublicReadStore extends PublicReadReadStore {
  findCurrent(worldId: string, modelKind: ReadModelKind, modelRef: string): Promise<StoredReadModel | null>;
  insertVersion(row: PublishedReadModel): Promise<string>;
  /** Patch an existing row's mutable flags (isCurrent / isLastKnownGood / status / updatedAt). */
  markCurrent(rowId: string, patch: {
    isCurrent: boolean;
    isLastKnownGood: boolean;
    status: ReadModelStatus;
    updatedAt: number;
  }): Promise<void>;
}

export type ServedReadModel = Pick<PublishedReadModel,
  'modelKind' | 'modelRef' | 'version' | 'payload' | 'status' | 'sourceEventIds' | 'contentHash' | 'publishedAt'> & {
  servedFrom: 'current' | 'last_known_good';
};

function toServed(row: StoredReadModel, servedFrom: ServedReadModel['servedFrom']): ServedReadModel {
  return {
    modelKind: row.modelKind, modelRef: row.modelRef, version: row.version, payload: row.payload,
    status: row.status, sourceEventIds: row.sourceEventIds, contentHash: row.contentHash,
    publishedAt: row.publishedAt, servedFrom,
  };
}

function assertTarget(worldId: string, modelKind: ReadModelKind, modelRef: string): void {
  if (worldId.trim().length === 0) throw new ReadModelError('READ_MODEL_INVALID_SHAPE', 'worldId must be non-empty');
  if (!isReadModelKind(modelKind)) throw new ReadModelError('READ_MODEL_INVALID_SHAPE', `unknown model kind: ${String(modelKind)}`);
  if (modelRef.trim().length === 0) throw new ReadModelError('READ_MODEL_INVALID_SHAPE', 'modelRef must be non-empty');
}

/** Build a fresh version record, applying the public allowlist (AC#4). */
export function createReadModelVersion(input: {
  worldId: string;
  modelKind: ReadModelKind;
  modelRef: string;
  version: number;
  payload: JsonValue;
  sourceEventIds: readonly string[];
  status: ReadModelStatus;
  now: number;
}): PublishedReadModel {
  assertTarget(input.worldId, input.modelKind, input.modelRef);
  if (!Number.isSafeInteger(input.version) || input.version < 1) {
    throw new ReadModelError('READ_MODEL_INVALID_SHAPE', 'version must be a positive integer');
  }
  if (!isReadModelStatus(input.status)) {
    throw new ReadModelError('READ_MODEL_INVALID_SHAPE', `unknown status: ${String(input.status)}`);
  }
  if (!Number.isFinite(input.now)) throw new ReadModelError('READ_MODEL_INVALID_SHAPE', 'now must be finite');
  const sourceEventIds = [...new Set(input.sourceEventIds)];
  if (sourceEventIds.some((id) => typeof id !== 'string' || id.length === 0)) {
    throw new ReadModelError('READ_MODEL_INVALID_SHAPE', 'sourceEventIds must be non-empty strings');
  }
  const payload = sanitizeForPublic(input.payload);
  return {
    schemaVersion: READ_MODEL_SCHEMA_VERSION,
    worldId: input.worldId,
    modelKind: input.modelKind,
    modelRef: input.modelRef,
    version: input.version,
    payload,
    status: input.status,
    sourceEventIds,
    isCurrent: true,
    isLastKnownGood: false,
    contentHash: hashPayload(payload),
    createdAt: input.now,
    publishedAt: input.status === SERVABLE_STATUS ? input.now : null,
  };
}

/**
 * Select the version to serve. Prefers the current `published` version; falls
 * back to the retained last-known-good when the current is withheld/failed or
 * still publishing; returns null only if nothing was ever published (AC#1/#5).
 */
export function selectServedVersion(versions: readonly StoredReadModel[]): ServedReadModel | null {
  const current = versions.find((row) => row.isCurrent && row.status === SERVABLE_STATUS);
  if (current) return toServed(current, 'current');
  const lastKnownGood = versions.find((row) => row.isLastKnownGood);
  if (lastKnownGood) return toServed(lastKnownGood, 'last_known_good');
  return null;
}

/**
 * Orchestrate a public read. Reads ONLY published snapshots via the store;
 * performs zero canon reads and zero provider calls (AC#1/#3). The served
 * payload is re-sanitised defensively (AC#4) before return.
 */
export async function serveReadModel(
  store: PublicReadReadStore,
  worldId: string,
  modelKind: ReadModelKind,
  modelRef: string,
): Promise<ServedReadModel | null> {
  assertTarget(worldId, modelKind, modelRef);
  const versions = await store.loadTargetVersions(worldId, modelKind, modelRef);
  const served = selectServedVersion(versions);
  if (!served) return null;
  return { ...served, payload: sanitizeForPublic(served.payload) };
}

export type CommitReadModelResult = {
  version: number;
  contentHash: string;
  status: ReadModelStatus;
  deduplicated: boolean;
};

/**
 * Commit a new published read-model version (the projection-writer primitive;
 * called by downstream projection tasks and the editorial pipeline).
 *
 * - Idempotent: a repeat write with the same (target, contentHash, status) for
 *   the current version returns the existing version without appending a new row.
 * - Last-known-good preserving: the prior current version, if it was published,
 *   becomes the fallback; any older fallback is cleared so at most one
 *   last-known-good exists per target (AC#5). The Canon history is never touched.
 */
export async function commitReadModelVersion(
  store: PublicReadStore,
  input: {
    worldId: string;
    modelKind: ReadModelKind;
    modelRef: string;
    payload: JsonValue;
    sourceEventIds: readonly string[];
    status: ReadModelStatus;
    now: number;
  },
): Promise<CommitReadModelResult> {
  assertTarget(input.worldId, input.modelKind, input.modelRef);
  const next = createReadModelVersion({
    worldId: input.worldId,
    modelKind: input.modelKind,
    modelRef: input.modelRef,
    version: 1,
    payload: input.payload,
    sourceEventIds: input.sourceEventIds,
    status: input.status,
    now: input.now,
  });

  const current = await store.findCurrent(input.worldId, input.modelKind, input.modelRef);
  if (current && current.contentHash === next.contentHash && current.status === next.status) {
    return { version: current.version, contentHash: current.contentHash, status: current.status, deduplicated: true };
  }

  const all = await store.loadTargetVersions(input.worldId, input.modelKind, input.modelRef);
  const nextVersion = current ? current.version + 1 : 1;
  const committed: PublishedReadModel = { ...next, version: nextVersion };

  // Insert the new current version FIRST. If the projection write fails here
  // (e.g. simulation/publication outage), the currently-serving version is left
  // untouched and keeps serving — AC#1/#7 failure isolation. Demotion of the
  // prior current and clearing of older fallbacks happen only after the new
  // version is durably stored.
  await store.insertVersion(committed);

  // Demote the prior current. If it was published, it becomes the new fallback.
  if (current) {
    await store.markCurrent(current.id, {
      isCurrent: false,
      isLastKnownGood: current.status === SERVABLE_STATUS,
      status: current.status,
      updatedAt: input.now,
    });
  }
  // Clear any older fallback so exactly one last-known-good remains.
  for (const row of all) {
    if (row.id === current?.id) continue;
    if (row.isLastKnownGood) {
      await store.markCurrent(row.id, {
        isCurrent: row.isCurrent,
        isLastKnownGood: false,
        status: row.status,
        updatedAt: input.now,
      });
    }
  }

  return { version: nextVersion, contentHash: committed.contentHash, status: committed.status, deduplicated: false };
}

/**
 * Invalidate (withhold or fail) the current version while preserving the
 * last-known-good fallback (AC#5). The current version is marked non-current
 * and non-servable; reads then fall back to the retained prior published
 * version. If no fallback exists, subsequent reads return null (the content is
 * genuinely unavailable) — the Canon history is still never touched.
 */
export async function invalidateReadModel(
  store: PublicReadStore,
  input: {
    worldId: string;
    modelKind: ReadModelKind;
    modelRef: string;
    status: Exclude<ReadModelStatus, 'published' | 'publishing'>;
    now: number;
  },
): Promise<{ invalidatedVersion: number | null }> {
  assertTarget(input.worldId, input.modelKind, input.modelRef);
  if (input.status !== 'withheld' && input.status !== 'failed') {
    throw new ReadModelError('READ_MODEL_INVALID_SHAPE', 'invalidation status must be withheld or failed');
  }
  const current = await store.findCurrent(input.worldId, input.modelKind, input.modelRef);
  if (!current) return { invalidatedVersion: null };
  await store.markCurrent(current.id, {
    isCurrent: false,
    isLastKnownGood: false,
    status: input.status,
    updatedAt: input.now,
  });
  return { invalidatedVersion: current.version };
}
