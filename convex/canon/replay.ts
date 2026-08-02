/**
 * Deterministic replay of accepted events onto a projection.
 *
 * Pure module: no Convex, network, clock, or randomness. Identical input always yields
 * identical output. Replay does NOT silently reorder events — a gap, duplicate, or
 * out-of-order sequence is a hard error so broken inputs are never masked.
 */

import { reduceWorldEvent } from './reducer';
import type { AcceptedEvent, WorldProjection } from './model';

/**
 * Fold an ordered list of accepted events onto an initial projection.
 *
 * - validates worldId consistency across the projection and every event;
 * - enforces strict sequence ordering (gap → SEQUENCE_GAP, repeat → DUPLICATE_SEQUENCE);
 * - never sorts or filters the input;
 * - never mutates the input projection or events;
 * - an empty event list returns an equivalent (unmutated) projection.
 */
export function replayWorldEvents(
  initialProjection: WorldProjection,
  events: AcceptedEvent[],
): WorldProjection {
  let projection = initialProjection;
  for (const event of events) {
    // reduceWorldEvent returns a fresh object; the input projection is never mutated.
    projection = reduceWorldEvent(projection, event);
  }
  return projection;
}
