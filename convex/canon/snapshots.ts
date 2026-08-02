/**
 * Snapshot foundation: persist a projection at a sequence number and resume replay from it.
 *
 * Pure module. Building a snapshot clones the projection so callers cannot mutate the
 * stored copy. {@link replayFromSnapshot} validates the snapshot is self-consistent
 * before resuming.
 */

import { CanonError, canonError } from '../shared/errors';
import { replayWorldEvents } from './replay';
import type { AcceptedEvent, RelationshipState, WorldProjection } from './model';

/** A persisted projection plus the sequence number it was taken at. */
export type CanonSnapshot = {
  worldId: string;
  lastSequenceNumber: number;
  projection: WorldProjection;
  /** When the snapshot was created (commit step only; not read during replay). */
  createdAt: number;
};

/** Deep-ish structural clone of a projection (records are shallow-copied; facts array copied). */
export function cloneProjection(projection: WorldProjection): WorldProjection {
  const relationships: Record<string, RelationshipState> = {};
  for (const key of Object.keys(projection.relationships)) {
    relationships[key] = { ...projection.relationships[key] };
  }
  return {
    worldId: projection.worldId,
    lastSequenceNumber: projection.lastSequenceNumber,
    characterLocations: { ...projection.characterLocations },
    relationships,
    facts: projection.facts.map((f) => ({ ...f })),
  };
}

/** Build an immutable snapshot from a projection. The input is not retained by reference. */
export function buildSnapshot(projection: WorldProjection, createdAt: number): CanonSnapshot {
  return {
    worldId: projection.worldId,
    lastSequenceNumber: projection.lastSequenceNumber,
    projection: cloneProjection(projection),
    createdAt,
  };
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
  const projection = snapshot.projection;
  if (projection.worldId !== snapshot.worldId) {
    throw new CanonError(
      canonError('SEQUENCE_CONFLICT', 'snapshot worldId does not match its projection', {
        snapshotWorldId: snapshot.worldId,
        projectionWorldId: projection.worldId,
      }),
    );
  }
  if (projection.lastSequenceNumber !== snapshot.lastSequenceNumber) {
    throw new CanonError(
      canonError('SEQUENCE_CONFLICT', 'snapshot lastSequenceNumber does not match its projection', {
        snapshot: snapshot.lastSequenceNumber,
        projection: projection.lastSequenceNumber,
      }),
    );
  }
  // Clone so the snapshot's stored projection is never mutated by replay.
  return replayWorldEvents(cloneProjection(projection), laterEvents);
}
