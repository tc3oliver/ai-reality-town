/**
 * Snapshot foundation: persist a projection at a sequence number and resume replay from it.
 *
 * Pure module. Building a snapshot clones the projection so callers cannot mutate the
 * stored copy. {@link replayFromSnapshot} validates the snapshot is self-consistent
 * before resuming.
 */

import { CanonError, canonError } from '../shared/errors';
import { replayWorldEvents } from './replay';
import type { AcceptedEvent, RelationshipHistoryEntry, RelationshipState, WorldProjection } from './model';

export const CANON_SNAPSHOT_VERSION = 1 as const;

/** A persisted projection plus the sequence number it was taken at. */
export type CanonSnapshot = {
  snapshotVersion: typeof CANON_SNAPSHOT_VERSION;
  worldId: string;
  worldDay: number;
  lastSequenceNumber: number;
  projection: WorldProjection;
  projectionHash: string;
  /** When the snapshot was created (commit step only; not read during replay). */
  createdAt: number;
};

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
}

/** Stable canonical representation independent of database object-key ordering. */
export function serializeProjectionDeterministically(projection: WorldProjection): string {
  return canonicalJson(projection);
}

/** Stable integrity checksum over the complete deterministic projection payload. */
export function projectionIntegrityHash(projection: WorldProjection): string {
  const value = serializeProjectionDeterministically(projection);
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `fnv1a32:${hash.toString(16).padStart(8, '0')}`;
}

/** Deep-ish structural clone of a projection (records are shallow-copied; facts array copied). */
export function cloneProjection(projection: WorldProjection): WorldProjection {
  const relationships: Record<string, RelationshipState> = {};
  for (const key of Object.keys(projection.relationships)) {
    relationships[key] = { ...projection.relationships[key] };
  }
  const relationshipHistory: Record<string, RelationshipHistoryEntry[]> = Object.fromEntries(
    Object.entries(projection.relationshipHistory ?? {}).map(([key, entries]) => [key, entries.map((entry) => ({ ...entry }))]),
  );
  return {
    worldId: projection.worldId,
    lastSequenceNumber: projection.lastSequenceNumber,
    characterLocations: { ...projection.characterLocations },
    characterAlive: { ...projection.characterAlive },
    characterStates: Object.fromEntries(
      Object.entries(projection.characterStates).map(([id, state]) => [id, {
        ...state,
        ...(state.organizationMemberships === undefined ? {} : { organizationMemberships: [...state.organizationMemberships] }),
      }]),
    ),
    lastCharacterMovement: Object.fromEntries(
      Object.entries(projection.lastCharacterMovement).map(([id, movement]) => [id, { ...movement }]),
    ),
    itemOwners: { ...projection.itemOwners },
    characterKnowledge: Object.fromEntries(
      Object.entries(projection.characterKnowledge).map(([id, records]) => [id, records.map((record) => ({
        ...record,
        learnedAt: { ...record.learnedAt },
      }))]),
    ),
    characterMemories: Object.fromEntries(
      Object.entries(projection.characterMemories ?? {}).map(([id, records]) => [id, records.map((record) => ({
        ...record,
        createdAt: { ...record.createdAt },
      }))]),
    ),
    relationships,
    relationshipHistory,
    facts: projection.facts.map((f) => ({ ...f })),
  };
}

/** Build an immutable snapshot from a projection. The input is not retained by reference. */
export function buildSnapshot(projection: WorldProjection, createdAt: number, worldDay = 0): CanonSnapshot {
  if (!Number.isSafeInteger(worldDay) || worldDay < 0 || !Number.isFinite(createdAt)) {
    throw new CanonError(canonError('SNAPSHOT_DAY_CONFLICT', 'snapshot timing metadata is invalid', { worldDay, createdAt }));
  }
  const storedProjection = cloneProjection(projection);
  return {
    snapshotVersion: CANON_SNAPSHOT_VERSION,
    worldId: projection.worldId,
    worldDay,
    lastSequenceNumber: projection.lastSequenceNumber,
    projection: storedProjection,
    projectionHash: projectionIntegrityHash(storedProjection),
    createdAt,
  };
}

export function validateSnapshot(snapshot: CanonSnapshot): void {
  if (snapshot.snapshotVersion !== CANON_SNAPSHOT_VERSION) {
    throw new CanonError(canonError('UNSUPPORTED_SNAPSHOT_VERSION', 'snapshot version is not supported', {
      snapshotVersion: snapshot.snapshotVersion, supported: CANON_SNAPSHOT_VERSION,
    }));
  }
  if (!Number.isSafeInteger(snapshot.worldDay) || snapshot.worldDay < 0 || !Number.isFinite(snapshot.createdAt)) {
    throw new CanonError(canonError('SNAPSHOT_CORRUPT', 'snapshot timing metadata is invalid'));
  }
  if (projectionIntegrityHash(snapshot.projection) !== snapshot.projectionHash) {
    throw new CanonError(canonError('SNAPSHOT_CORRUPT', 'snapshot projection integrity check failed'));
  }
  if (snapshot.projection.worldId !== snapshot.worldId
      || snapshot.projection.lastSequenceNumber !== snapshot.lastSequenceNumber) {
    throw new CanonError(canonError('SNAPSHOT_CORRUPT', 'snapshot envelope does not match its projection'));
  }
}

/**
 * Resume replay from a snapshot. The snapshot's projection must be self-consistent
 * (matching worldId and lastSequenceNumber). `laterEvents` must continue the sequence
 * strictly after the snapshot.
 */
export function replayFromSnapshot(
  snapshot: CanonSnapshot,
  laterEvents: AcceptedEvent[],
): WorldProjection {
  validateSnapshot(snapshot);
  const projection = snapshot.projection;
  // Clone so the snapshot's stored projection is never mutated by replay.
  return replayWorldEvents(cloneProjection(projection), laterEvents);
}
