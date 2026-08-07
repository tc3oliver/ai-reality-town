/**
 * Initial positions for seeded characters (FR-N010 AC#8 / ART-114).
 *
 * A freshly seeded world has twelve residents and zero accepted location events, because the
 * seed records `initialLocationId` in the character payload and Canon never emits an event to
 * restate it. Without this module those residents would have no publishable position at all
 * until their first accepted event.
 *
 * The fix is derivation, not fabrication: the position is computed on read from the seed
 * payload and the Location Visual Binding. No synthetic `character_location_changed` event is
 * written, because a Canon event that no LLM proposed and no rule accepted would corrupt the
 * append-only history the whole system is audited against.
 */

import type { LocationVisualBinding } from '../visual/locationVisualBinding';
import { selectAmbientAnchor } from './ambientAnchor';
import { IDLE_DIRECTION, type MovementTrajectory, type TilePoint } from './motion';

/**
 * A character's declared starting location, mirrored from the `worldCharacters` seed payload.
 * Taking it as an argument rather than importing the seed keeps this module free of Canon.
 */
export type SeedPlacement = {
  readonly characterId: string;
  readonly initialLocationId: string;
};

/**
 * A bootstrap position exists *before* the world has a day or a time slot, so it cannot key its
 * anchor off either. These fixed values give every seeded character a stable spot that does not
 * move the first time anything else in the world advances.
 */
export const BOOTSTRAP_WORLD_DAY = 0;
export const BOOTSTRAP_TIME_BUCKET = 0;

/**
 * Bootstrap timestamps are fixed rather than "now". A static position that carried the planning
 * instant would differ on every pass, so two consecutive derivations of an unchanged world would
 * publish two different payloads for a character who has not moved.
 */
export const BOOTSTRAP_INSTANT_MS = 0;

/** Below any real event's sequence number, so a first accepted fact always supersedes it. */
export const BOOTSTRAP_MOTION_SEQUENCE = 0;

export function bootstrapAnchor(binding: LocationVisualBinding, characterId: string): TilePoint {
  return selectAmbientAnchor(binding, {
    characterId,
    locationId: binding.locationId,
    worldDay: BOOTSTRAP_WORLD_DAY,
    timeBucket: BOOTSTRAP_TIME_BUCKET,
  });
}

/**
 * A standing character, not a zero-length walk: `from === to`, `idle`, and no source events,
 * so a consumer can tell "has never moved" from "has finished moving".
 */
export function bootstrapTrajectory(
  binding: LocationVisualBinding,
  characterId: string,
  mapId: string,
): MovementTrajectory {
  const anchor = bootstrapAnchor(binding, characterId);
  return {
    characterId,
    mapId,
    motionType: 'bootstrap',
    movementPhase: 'bootstrap',
    from: anchor,
    to: anchor,
    startedAt: BOOTSTRAP_INSTANT_MS,
    arriveAt: BOOTSTRAP_INSTANT_MS,
    direction: IDLE_DIRECTION,
    animationState: 'idle',
    motionSequence: BOOTSTRAP_MOTION_SEQUENCE,
    semanticLocationId: binding.locationId,
    originLocationId: null,
    waypoints: [{ point: anchor, arriveAt: BOOTSTRAP_INSTANT_MS }],
    sourceEventIds: [],
  };
}
