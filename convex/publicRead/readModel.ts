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
  // FR-O013 / ART-121. A kind of its own rather than a field inside `liveState`, for three
  // reasons: a replay-build failure must not be able to take the live map down with it, the
  // two change on completely different cadences (the projection on every commit, the replay
  // only when a slot completes) so sharing a `contentHash` would defeat dedup for both, and
  // ART-132's future withhold handling needs a target it can invalidate on its own.
  'visualReplay',
  // FR-J002 / ART-46. A kind of its own rather than a field on `liveState`, for the same
  // reasons `visualReplay` is one: a consequence-rebuild failure must not take the live map
  // down, and the two change on different cadences (one per world day with a vote, versus
  // every commit), so sharing a `contentHash` would defeat dedup for both.
  'voteConsequence',
  // FR-I007 / ART-44. The scoped relationship graph, per world day. A kind of its own for the
  // same reason as the two above: a graph-rebuild failure must not be able to take the live map
  // down with it, and the two change on different cadences — one row per world day, published
  // while that day is current and then never again, against a live projection rebuilt on every
  // commit — so sharing a `contentHash` would defeat dedup for both.
  'relationshipGraph',
  // FR-I005 / ART-169. One character's viewer-known secrets and dramatic-irony facts. A kind of
  // its own rather than fields on `character`, for a reason the three above do not have: this is
  // the only public payload in the deployment whose contents depend on the EDITORIAL PUBLICATION
  // lifecycle rather than on Canon alone, so it changes on a different trigger from every other
  // model (an administrator publishing an Episode moves it while no event has been accepted).
  // Folding it into `character` would also make a secret-projection defect able to take a
  // character's name and location off the page.
  'viewerKnowledge',
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

/**
 * The one carve-out: keys a NAMED model kind may carry despite matching a pattern above.
 *
 * ART-169 needed it. FR-I005 lists 「觀眾已知秘密」 as a PUBLIC character-page field, so exactly
 * one payload in this deployment lawfully carries the text of a Canon secret — and
 * {@link PRIVATE_KEY_PATTERNS}'s `/secret/i` stripped it silently, leaving the page with a field
 * that was built, published and then deleted on the way into the row.
 *
 * ## Why an exception rather than a rename
 *
 * Renaming the field to something the pattern misses would have worked with no change here, and
 * that is precisely the argument against it: this filter matches KEY NAMES, so a payload can
 * always dodge it by not naming what it carries. A carve-out that is written down, scoped to one
 * kind and pinned by a test is auditable; a payload that quietly avoided the rule is not.
 *
 * ## What still protects the viewer
 *
 * Not this filter, and it never did — it strips honest keys, not secret CONTENT. The rule that a
 * secret may only be published once a `published` Episode revealed it lives in
 * `./viewerKnowledgeProjection.ts`, which proves it per row and redacts anything it cannot. This
 * exception is scoped to that kind so no other projection inherits it: a `character` or `episode`
 * payload naming a key `secret…` is still stripped, which is what `readModel.test.ts` pins.
 */
export const KIND_ALLOWED_PRIVATE_KEYS: Partial<Record<ReadModelKind, readonly string[]>> = {
  viewerKnowledge: ['viewerKnownSecrets', 'secretId', 'omittedSecretCount'],
};

const NO_ALLOWED_KEYS: ReadonlySet<string> = new Set();

/** The allowlist for one kind, as a set. Empty for every kind that has no carve-out. */
export function allowedPrivateKeysFor(modelKind: ReadModelKind): ReadonlySet<string> {
  const allowed = KIND_ALLOWED_PRIVATE_KEYS[modelKind];
  return allowed === undefined ? NO_ALLOWED_KEYS : new Set(allowed);
}

function isPrivateKey(key: string, allowed: ReadonlySet<string>): boolean {
  if (allowed.has(key)) return false;
  return PRIVATE_KEY_PATTERNS.some((pattern) => pattern.test(key));
}

/**
 * Recursively strip private fields from a payload at any depth (AC#4). Arrays
 * are sanitised element-wise; objects drop any key matching a private pattern.
 * Returns a NEW value; never mutates the input. Projection builders remain
 * responsible for pre-filtering domain-private entries (e.g. Canon
 * `visibility: 'private'` state changes); this is the defence-in-depth layer.
 */
export function sanitizeForPublic(
  value: JsonValue,
  allowed: ReadonlySet<string> = NO_ALLOWED_KEYS,
): JsonValue {
  if (Array.isArray(value)) return value.map((item) => sanitizeForPublic(item, allowed));
  if (value !== null && typeof value === 'object') {
    const out: Record<string, JsonValue> = {};
    for (const [key, entry] of Object.entries(value)) {
      if (isPrivateKey(key, allowed)) continue;
      out[key] = sanitizeForPublic(entry, allowed);
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
  /**
   * Retained last-known-good versions for a target. Kept separate from
   * {@link PublicReadReadStore.loadTargetVersions} so a commit does not have to read the
   * target's whole version history: a projection rebuilt on every accepted event would
   * otherwise re-read every prior payload it ever published.
   */
  loadLastKnownGood(worldId: string, modelKind: ReadModelKind, modelRef: string): Promise<readonly StoredReadModel[]>;
  insertVersion(row: PublishedReadModel): Promise<string>;
  /** Patch an existing row's mutable flags (isCurrent / isLastKnownGood / status / updatedAt). */
  markCurrent(rowId: string, patch: {
    isCurrent: boolean;
    isLastKnownGood: boolean;
    status: ReadModelStatus;
    updatedAt: number;
  }): Promise<void>;
  /**
   * The world's automatic publication gate (ART-162): may new versions reach the public surface?
   *
   * On the PORT rather than as an argument to {@link commitReadModelVersion}, and that is the
   * whole design. There are 28 projection writers; making this a parameter would put the same
   * judgement in 28 places, and the twenty-ninth would forget it. Asking the store means the
   * decision is made ONCE, at the boundary every writer already goes through, and a new projection
   * inherits it without knowing it exists.
   *
   * Required rather than optional, for the reason `unmeteredWorldDayBudgetPort` is: an optional
   * gate lets a new binding enforce nothing by omission, which is exactly how `publishEnabled`
   * came to gate nothing in the first place.
   */
  publicationEnabled(worldId: string): Promise<boolean>;
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
  const payload = sanitizeForPublic(input.payload, allowedPrivateKeysFor(input.modelKind));
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
  // The same allowlist the write side applied. A read that used the default would strip the
  // viewer-known secrets back out on the way to the page — the payload would be stored correctly
  // and served empty, which is the harder version of this bug to find.
  return { ...served, payload: sanitizeForPublic(served.payload, allowedPrivateKeysFor(modelKind)) };
}

export type CommitReadModelResult = {
  version: number;
  contentHash: string;
  status: ReadModelStatus;
  deduplicated: boolean;
  /**
   * True when the world's publication gate refused this version (ART-162).
   *
   * Reported rather than thrown: suppression is a configured STATE, not a fault. A world with
   * publication paused should keep simulating, keep committing Canon, and keep deriving Episodes
   * and Recaps — it simply stops showing the results. Throwing would fail the post-commit pipeline
   * and stop all of that.
   *
   * Reported rather than silent, though: a caller that logged "published version 7" for a write
   * that never happened would make a paused world indistinguishable from a broken one.
   */
  suppressed: boolean;
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

  /**
   * THE automatic publication gate (ART-162).
   *
   * Checked before ANYTHING is written, so there is no partial state to reason about: nothing is
   * inserted, nothing is demoted, and the version that is already current keeps serving untouched.
   *
   * That last point is the requirement, not a side effect. A world with publication paused must
   * keep showing its last valid version; a gate that suppressed the INSERT but still demoted the
   * current row would blank the public surface instead of freezing it.
   *
   * The gate can only suppress. There is deliberately no branch here that publishes something the
   * caller did not ask to publish, no path that upgrades a status, and no way to reach this
   * function with content the safety and editorial lifecycles have not already cleared — those run
   * upstream and are unchanged either way.
   */
  if (!await store.publicationEnabled(input.worldId)) {
    const live = await store.findCurrent(input.worldId, input.modelKind, input.modelRef);
    return {
      // The version that IS live, not the one that would have been written. A caller reporting
      // `version` after a suppressed commit is reporting what a reader can actually see.
      version: live?.version ?? 0,
      contentHash: live?.contentHash ?? '',
      status: live?.status ?? input.status,
      deduplicated: false,
      suppressed: true,
    };
  }

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
    return {
      version: current.version, contentHash: current.contentHash, status: current.status,
      deduplicated: true, suppressed: false,
    };
  }

  const retainedFallbacks = await store.loadLastKnownGood(input.worldId, input.modelKind, input.modelRef);
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
  for (const row of retainedFallbacks) {
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

  return {
    version: nextVersion, contentHash: committed.contentHash, status: committed.status,
    deduplicated: false, suppressed: false,
  };
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
