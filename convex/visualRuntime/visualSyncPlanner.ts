/**
 * Visual Sync Planner — the Visual Runtime entry point (FR-N010 / ART-114).
 *
 * Turns "who is where, semantically" into "what the viewer draws". One call takes accepted Canon
 * facts plus the seed placements and returns exactly one motion unit per character.
 *
 * Three properties define the module and are each enforced by a test:
 *
 * 1. **It is a function, not a Convex function.** No `ctx`, no database handle, no clock — the
 *    planning instant is an argument. That is what makes AC#4 structural rather than a habit:
 *    there is nowhere for a per-frame coordinate write to go.
 * 2. **It cannot reach Canon.** `AcceptedEventLike` is declared here structurally, so a real
 *    `AcceptedEvent` is assignable without this module importing the type. No Canon import
 *    means no Canon write path, whatever a future edit does.
 * 3. **It is deterministic.** Same inputs, same bytes out. Anchors are seeded, paths are total-
 *    ordered, and timestamps come from the source event rather than from "now".
 *
 * The anchor chain is the part worth understanding. A character's current position depends on
 * where its previous move left it, so the planner replays the character's location facts in
 * sequence order, resolving each arrival anchor with *that fact's own* `worldDay` and
 * `timeSlot`. Keying the whole chain off the current clock instead would make yesterday's
 * arrival point drift every time the world advanced, and the walk in progress would start from
 * a place the character was never drawn standing in. Only the final hop needs an actual path:
 * the earlier ones are history and are used purely to find the origin point.
 */

import {
  hasArrivedAtLocation,
  resolvePublishableLocationZone,
  type LocationVisualBinding,
} from '../visual/locationVisualBinding';
import { selectAmbientAnchor } from './ambientAnchor';
import {
  deriveDirection,
  IDLE_DIRECTION,
  travelDurationMs,
  type MovementTrajectory,
  type TilePoint,
  type TrajectoryWaypoint,
  type VisualRuntimeProblem,
  type VisualRuntimeSnapshot,
} from './motion';
import { compressCollinear, pathLengthTiles, planTilePath } from './pathPlanner';
import { bootstrapAnchor, bootstrapTrajectory, type SeedPlacement } from './seedBootstrap';
import { timeBucketForSlot } from './seededRandom';
import { tileCentre, tileOfPoint, type WalkableGrid } from './walkableGrid';

/**
 * Structural mirror of the fields of a Canon `AcceptedEvent` this planner reads. Declared here
 * rather than imported: a real `AcceptedEvent` satisfies it, and the dependency arrow never
 * points at Canon.
 */
export type AcceptedEventLike = {
  readonly eventId: string;
  readonly sequenceNumber: number;
  readonly worldDay: number;
  readonly timeSlot: string;
  readonly acceptedAt: number;
  readonly stateChanges: readonly StateChangeLike[];
};

export type StateChangeLike = {
  readonly type: string;
  readonly characterId?: string;
  readonly fromLocationId?: string;
  readonly toLocationId?: string;
};

export type VisualRuntimeInput = {
  readonly mapId: string;
  /** The planning instant, supplied by the caller. This module never reads a clock. */
  readonly nowMs: number;
  readonly grid: WalkableGrid;
  readonly bindings: readonly LocationVisualBinding[];
  /** Seed placements act as a default position, never as an override of accepted history. */
  readonly seedPlacements: readonly SeedPlacement[];
  readonly acceptedEvents: readonly AcceptedEventLike[];
};

/**
 * How many target points the planner will try before giving up on a walk: the ambient anchor
 * first, then entry anchors. Bounded because an unbounded retry over a large zone would turn a
 * map authoring mistake into an O(anchors x grid) stall on every read.
 */
export const MAX_PATH_ATTEMPTS = 4;

const LOCATION_CHANGE = 'character_location_changed';

type LocationFact = {
  readonly characterId: string;
  readonly fromLocationId: string | null;
  readonly toLocationId: string;
  readonly worldDay: number;
  readonly timeSlot: string;
  readonly acceptedAt: number;
  readonly sequenceNumber: number;
  readonly eventId: string;
};

/**
 * Accepted events arrive in whatever order the caller read them; sequence number is the only
 * ordering Canon guarantees is total, so the fold is defined against it rather than `acceptedAt`.
 */
function collectLocationFacts(events: readonly AcceptedEventLike[]): readonly LocationFact[] {
  const facts: LocationFact[] = [];
  for (const event of events) {
    for (const change of event.stateChanges) {
      if (change.type !== LOCATION_CHANGE) continue;
      if (!change.characterId || !change.toLocationId) continue;
      facts.push({
        characterId: change.characterId,
        fromLocationId: change.fromLocationId ?? null,
        toLocationId: change.toLocationId,
        worldDay: event.worldDay,
        timeSlot: event.timeSlot,
        acceptedAt: event.acceptedAt,
        sequenceNumber: event.sequenceNumber,
        eventId: event.eventId,
      });
    }
  }
  return facts.sort((left, right) => left.sequenceNumber - right.sequenceNumber);
}

function anchorForFact(
  binding: LocationVisualBinding,
  characterId: string,
  fact: LocationFact,
): TilePoint {
  return selectAmbientAnchor(binding, {
    characterId,
    locationId: binding.locationId,
    worldDay: fact.worldDay,
    timeBucket: timeBucketForSlot(fact.timeSlot),
  });
}

function buildWaypoints(
  points: readonly TilePoint[],
  startedAt: number,
): readonly TrajectoryWaypoint[] {
  let travelled = 0;
  return points.map((point, index) => {
    if (index > 0) {
      travelled += Math.abs(point.x - points[index - 1].x) + Math.abs(point.y - points[index - 1].y);
    }
    return { point, arriveAt: startedAt + travelDurationMs(travelled) };
  });
}

/**
 * Tries the seeded ambient anchor, then the zone's entry anchors. An entry anchor is by
 * definition the mouth of a road into the zone, so if anything inside is reachable at all it is.
 */
function planRoute(
  grid: WalkableGrid,
  origin: TilePoint,
  binding: LocationVisualBinding,
  preferredTarget: TilePoint,
): { readonly target: TilePoint; readonly tiles: readonly TilePoint[] } | null {
  const candidates: TilePoint[] = [preferredTarget, ...binding.entryAnchors];
  const startTile = tileOfPoint(origin);
  for (const candidate of candidates.slice(0, MAX_PATH_ATTEMPTS)) {
    const result = planTilePath(grid, startTile, tileOfPoint(candidate));
    if (result.found) {
      const tiles = compressCollinear(result.tiles).map(tileCentre);
      // The first and last points are snapped back to the anchors themselves so the published
      // endpoints are the authored standing positions, not merely the tiles containing them.
      return {
        target: candidate,
        tiles: [origin, ...tiles.slice(1, -1), candidate],
      };
    }
  }
  return null;
}

function unboundLocationProblem(characterId: string, locationId: string): VisualRuntimeProblem {
  return {
    code: 'VISUAL_RUNTIME_UNBOUND_LOCATION',
    characterId,
    locationId,
    message: `location ${locationId} has no active Location Visual Binding, so no position can be published`,
  };
}

/**
 * Derives one motion unit per character.
 *
 * Cases, in the order they are decided:
 * - no accepted location fact and a seed placement -> a static bootstrap position (AC#8);
 * - a last fact whose target is unbound -> no trajectory plus a problem, because publishing a
 *   guess would put a character somewhere Canon never said they were;
 * - a last fact still under way at `nowMs` -> a walking trajectory along the planned route;
 * - a last fact already complete at `nowMs` -> a settled idle unit at the destination;
 * - a last fact with no walkable route -> a settled idle unit at the destination plus a problem.
 *   The character appears where Canon says they are, but no walk is animated through a wall.
 */
export function planCharacterTrajectories(input: VisualRuntimeInput): VisualRuntimeSnapshot {
  const facts = collectLocationFacts(input.acceptedEvents);
  const factsByCharacter = new Map<string, LocationFact[]>();
  for (const fact of facts) {
    const existing = factsByCharacter.get(fact.characterId);
    if (existing) existing.push(fact);
    else factsByCharacter.set(fact.characterId, [fact]);
  }

  const seedByCharacter = new Map<string, SeedPlacement>();
  const characterIds: string[] = [];
  for (const placement of input.seedPlacements) {
    if (seedByCharacter.has(placement.characterId)) continue;
    seedByCharacter.set(placement.characterId, placement);
    characterIds.push(placement.characterId);
  }
  const known = new Set(characterIds);
  for (const fact of facts) {
    if (known.has(fact.characterId)) continue;
    known.add(fact.characterId);
    characterIds.push(fact.characterId);
  }

  const trajectories: MovementTrajectory[] = [];
  const problems: VisualRuntimeProblem[] = [];
  const bindingFor = (locationId: string): LocationVisualBinding | undefined =>
    resolvePublishableLocationZone(input.bindings, locationId);

  for (const characterId of characterIds) {
    const characterFacts = factsByCharacter.get(characterId) ?? [];

    if (characterFacts.length === 0) {
      const placement = seedByCharacter.get(characterId);
      if (!placement) continue;
      const binding = bindingFor(placement.initialLocationId);
      if (!binding) {
        problems.push(unboundLocationProblem(characterId, placement.initialLocationId));
        continue;
      }
      trajectories.push(bootstrapTrajectory(binding, characterId, input.mapId));
      continue;
    }

    const lastFact = characterFacts[characterFacts.length - 1];
    const targetBinding = bindingFor(lastFact.toLocationId);
    if (!targetBinding) {
      problems.push(unboundLocationProblem(characterId, lastFact.toLocationId));
      continue;
    }

    const origin = resolveOrigin({
      characterId,
      characterFacts,
      seedPlacement: seedByCharacter.get(characterId),
      bindingFor,
      targetBinding,
      problems,
    });
    const preferredTarget = anchorForFact(targetBinding, characterId, lastFact);
    const route = planRoute(input.grid, origin, targetBinding, preferredTarget);
    const startedAt = lastFact.acceptedAt;
    const motionSequence = lastFact.sequenceNumber + 1;

    if (!route) {
      problems.push({
        code: 'VISUAL_RUNTIME_NO_PATH',
        characterId,
        locationId: lastFact.toLocationId,
        message: `no walkable route to ${lastFact.toLocationId}; the character is placed at the destination without an animated walk`,
      });
      trajectories.push(
        settledTrajectory({
          characterId,
          mapId: input.mapId,
          fact: lastFact,
          target: preferredTarget,
          startedAt,
          arriveAt: startedAt,
          motionSequence,
        }),
      );
      continue;
    }

    const duration = travelDurationMs(pathLengthTiles(route.tiles));
    const arriveAt = startedAt + duration;

    if (input.nowMs >= arriveAt) {
      trajectories.push(
        settledTrajectory({
          characterId,
          mapId: input.mapId,
          fact: lastFact,
          target: route.target,
          startedAt,
          arriveAt,
          motionSequence,
        }),
      );
      continue;
    }

    trajectories.push({
      characterId,
      mapId: input.mapId,
      motionType: 'canon',
      movementPhase: 'in-transit',
      from: origin,
      to: route.target,
      startedAt,
      arriveAt,
      direction: deriveDirection(origin, route.target),
      animationState: 'walking',
      motionSequence,
      semanticLocationId: lastFact.toLocationId,
      originLocationId: lastFact.fromLocationId,
      waypoints: buildWaypoints(route.tiles, startedAt),
      sourceEventIds: [lastFact.eventId],
    });
  }

  return {
    mapId: input.mapId,
    generatedAtMs: input.nowMs,
    trajectories,
    problems,
  };
}

/**
 * Walks the anchor chain to find where the last hop starts from. The seed placement is the
 * chain's head when the character has one; otherwise the first fact's declared origin is. If
 * neither resolves — an unbound origin, or a character Canon introduced mid-history — the walk
 * starts at the destination zone's own entry anchor, which is the only point that is certainly
 * both walkable and on a road into the zone.
 */
function resolveOrigin(args: {
  readonly characterId: string;
  readonly characterFacts: readonly LocationFact[];
  readonly seedPlacement: SeedPlacement | undefined;
  readonly bindingFor: (locationId: string) => LocationVisualBinding | undefined;
  readonly targetBinding: LocationVisualBinding;
  readonly problems: VisualRuntimeProblem[];
}): TilePoint {
  const { characterId, characterFacts, seedPlacement, bindingFor, targetBinding, problems } = args;
  const firstFact = characterFacts[0];
  let current: TilePoint | null = null;

  if (seedPlacement) {
    const seedBinding = bindingFor(seedPlacement.initialLocationId);
    if (seedBinding) {
      current = bootstrapAnchor(seedBinding, characterId);
    } else {
      problems.push(unboundLocationProblem(characterId, seedPlacement.initialLocationId));
    }
  }
  if (!current && firstFact.fromLocationId) {
    const originBinding = bindingFor(firstFact.fromLocationId);
    if (originBinding) current = anchorForFact(originBinding, characterId, firstFact);
    else problems.push(unboundLocationProblem(characterId, firstFact.fromLocationId));
  }

  // Every hop but the last only moves the chain head forward; no path is planned for them.
  for (let index = 0; index < characterFacts.length - 1; index++) {
    const fact = characterFacts[index];
    const binding = bindingFor(fact.toLocationId);
    if (!binding) {
      problems.push(unboundLocationProblem(characterId, fact.toLocationId));
      continue;
    }
    current = anchorForFact(binding, characterId, fact);
  }

  return current ?? targetBinding.entryAnchors[0];
}

/**
 * `from === to` at the destination: the motion is over, so there is nothing left to
 * interpolate and a client joining late draws the character standing still in the right place.
 *
 * `motionType` is `ambient` rather than `canon` (FR-O011 / ART-120). It is an *eligibility*
 * signal, not a position: the character has finished a Canon walk and is standing inside its
 * zone, which is exactly the state PRD 2.0 §9.1.2 permits in-zone drift for. The drift itself
 * is never published — it is re-derived on the client from the same seeded primitives this
 * module uses, because a stored payload only changes when Canon commits (roughly five times a
 * day) and baking a minute-cadence position into it would defeat the read model's
 * `contentHash` deduplication and append a version row per minute. See
 * `docs/ambient-and-environmental-animation.md`.
 *
 * Deliberately *not* extended to {@link bootstrapTrajectory}: a seeded character who has never
 * moved keeps `motionType: 'bootstrap'` (public `idle`), so "this character has no accepted
 * history" stays a legible, separately-testable state rather than being folded into "standing
 * about". The client's ambient gate treats both as eligible, so nothing is lost visually.
 */
function settledTrajectory(args: {
  readonly characterId: string;
  readonly mapId: string;
  readonly fact: LocationFact;
  readonly target: TilePoint;
  readonly startedAt: number;
  readonly arriveAt: number;
  readonly motionSequence: number;
}): MovementTrajectory {
  return {
    characterId: args.characterId,
    mapId: args.mapId,
    motionType: 'ambient',
    movementPhase: 'arrived',
    from: args.target,
    to: args.target,
    startedAt: args.startedAt,
    arriveAt: args.arriveAt,
    direction: IDLE_DIRECTION,
    animationState: 'idle',
    motionSequence: args.motionSequence,
    semanticLocationId: args.fact.toLocationId,
    originLocationId: args.fact.fromLocationId,
    waypoints: [{ point: args.target, arriveAt: args.arriveAt }],
    sourceEventIds: [args.fact.eventId],
  };
}

/**
 * Invariant check used by tests and by callers that want to assert before publishing: every
 * destination must actually lie inside the zone it claims, so "arrived" never means "near".
 */
export function trajectoryEndsInsideItsZone(
  trajectory: MovementTrajectory,
  bindings: readonly LocationVisualBinding[],
): boolean {
  const binding = resolvePublishableLocationZone(bindings, trajectory.semanticLocationId);
  return binding !== undefined && hasArrivedAtLocation(binding, trajectory.to);
}
