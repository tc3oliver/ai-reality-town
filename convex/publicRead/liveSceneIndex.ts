/**
 * The Live rebuild's maintained scene index (ART-100).
 *
 * ## The problem this exists for
 *
 * `rebuildLiveProjection` runs after every accepted event and used to read the world's ENTIRE
 * accepted-event log to do it — the largest single term in ART-100's read measurement, and the
 * last O(total canon) read on the post-commit path. Two of its consumers are why:
 *
 *  - `buildVisualReplay` groups every accepted event into scenes, ranks ALL of those scenes by
 *    story importance, takes the top few, and then folds the world's location history around
 *    whichever ones won. The winner can be any day in the world's life, so neither a tail nor a
 *    daily snapshot can answer it.
 *  - `buildActiveScenePresentations` needs the current slot's scenes, and — when the current slot
 *    produced nothing placeable — the single most recent completed scene, which may be far back.
 *
 * Both questions are about SCENES, not events. A world has one scene per (day, slot, location),
 * so an index keyed that way is smaller than the log by the number of events per scene, and more
 * importantly it can be **ranked by a database index** instead of by sorting everything in memory.
 * That is what turns "read all N events and sort" into "take the top three rows".
 *
 * ## Why the ranking is exact rather than approximate
 *
 * `selectReplayGroups` orders by `(score desc, maxSequenceNumber desc, sceneId asc)`. The third
 * key is unreachable: `maxSequenceNumber` is the sequence number of one of the group's own events,
 * every event belongs to exactly one group, and sequence numbers are unique — so no two groups can
 * share one. `(score, maxSequenceNumber)` is therefore already a total order, and a Convex index
 * on `[worldId, score, maxSequenceNumber]` read descending reproduces the comparator exactly
 * rather than approximating it. `liveSceneIndex.test.ts` pins the uniqueness this rests on, so a
 * future change that made two groups share a `maxSequenceNumber` turns red here instead of
 * silently reordering published replays.
 *
 * The current slot is excluded from a replay, and those rows are interleaved with the rest in
 * rank order. The caller knows how many current-slot scenes exist (it reads them anyway, for the
 * active-scene presentation), so taking `REPLAY_MAX_SCENES + thatCount` rows is *provably*
 * enough — at most that many of the rows taken can be discarded. No cap, no page loop, no
 * silently truncated ranking.
 *
 * ## What is stored, and what is deliberately NOT
 *
 * Stored: the scene's identity, its member events' sequence numbers, its story score, and the
 * world's location state immediately before its first event and immediately after its last. All
 * five are **monotone functions of the accepted prefix** — appending an event can add a scene or
 * extend one, and never revises a scene that is already closed.
 *
 * NOT stored, and read fresh on every rebuild instead: the safety gate's withheld set, the
 * excluded-character set, episode publication state, and the events' own text. Every one of those
 * is **retroactive** — an operator override can change the verdict on an arbitrarily old event —
 * so a stored copy would be a published payload that disagrees with the world. That split is the
 * whole safety argument for this index, and the reason it is an index of WHICH events matter
 * rather than a cache of what they say.
 */

import type { SceneEventLike, SceneGroup } from './activeScenePresentation';
import { eventLocationId } from './activeScenePresentation';
import type { LocationFold, ReplayEventLike } from './visualReplay';
import { foldReplayPositions } from './visualReplay';

/** One character's whereabouts, as the index stores a position map. */
export type IndexedPosition = { readonly characterId: string; readonly locationId: string };

/**
 * One scene, as the index keeps it.
 *
 * `positionsBefore` / `positionsAfter` are the running location fold at the instants either side
 * of the scene — exactly what {@link LocationFold} holds, which is why recovering one costs no
 * reads at all. They cover EVERY character the fold knew about, not only this scene's
 * participants: the participant set is derived from the live excluded-character set at rebuild
 * time and so can widen after the scene closed, and a stored subset chosen against yesterday's
 * exclusions would then be missing exactly the character that came back.
 */
export type SceneCandidate = {
  readonly sceneId: string;
  readonly worldDay: number;
  readonly timeSlot: string;
  readonly locationId: string;
  readonly minSequenceNumber: number;
  readonly maxSequenceNumber: number;
  /** Ascending, and the complete membership of the scene. */
  readonly eventSequenceNumbers: readonly number[];
  /** Highest story importance among the scene's events; 0 when none was ever classified. */
  readonly score: number;
  readonly positionsBefore: readonly IndexedPosition[];
  readonly positionsAfter: readonly IndexedPosition[];
};

const toPositions = (positions: ReadonlyMap<string, string>): IndexedPosition[] =>
  [...positions.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([characterId, locationId]) => ({ characterId, locationId }));

const toMap = (positions: readonly IndexedPosition[]): Map<string, string> =>
  new Map(positions.map(({ characterId, locationId }) => [characterId, locationId]));

/** The before/after pair `buildVisualReplay` asks a selection for. */
export function candidateLocationFold(candidate: SceneCandidate): LocationFold {
  return { before: toMap(candidate.positionsBefore), after: toMap(candidate.positionsAfter) };
}

/**
 * Rebuild the {@link SceneGroup} the pure builders take, from an index row plus the scene's own
 * events.
 *
 * `events` is filtered to the row's membership rather than trusted to match it, and the result is
 * ordered by sequence number — the order `groupSceneEvents` produces when fed an ascending log,
 * which is what every downstream `presentGroup`/`resolveSceneSpatials` comparison is against.
 */
export function candidateToGroup(
  candidate: SceneCandidate,
  eventsBySequence: ReadonlyMap<number, SceneEventLike>,
): SceneGroup | null {
  const members = candidate.eventSequenceNumbers
    .map((sequenceNumber) => eventsBySequence.get(sequenceNumber))
    .filter((event): event is SceneEventLike => event !== undefined)
    .sort((left, right) => left.sequenceNumber - right.sequenceNumber);
  if (members.length === 0) return null;
  return {
    worldDay: candidate.worldDay,
    timeSlot: candidate.timeSlot,
    locationId: candidate.locationId,
    events: members,
    maxSequenceNumber: candidate.maxSequenceNumber,
  };
}

export type SceneIndexFoldResult = {
  /** Every candidate the tail created or extended, keyed by `sceneId`. Untouched rows are absent. */
  readonly touched: Map<string, SceneCandidate>;
  /** The running location fold after the tail, for the caller to checkpoint. */
  readonly positions: Map<string, string>;
};

/**
 * Fold a tail of accepted events into the index.
 *
 * `prior` holds only the candidates the caller already has for scenes the tail touches; a scene the
 * tail does not mention is not read and not returned. `priorPositions` is the running location fold
 * as of the last event BEFORE the tail — which is exactly the `positionsAfter` of whatever scene
 * closed last, and exactly what the checkpoint stores.
 *
 * The fold advances one event at a time because `positionsBefore` is the state at the instant
 * before a scene's FIRST event: batching the tail's arrivals and applying them at the end would
 * record a new scene as starting from where the world ended up, which is where a participant is
 * standing after they walked in rather than before.
 */
export function foldSceneCandidates(args: {
  readonly prior: ReadonlyMap<string, SceneCandidate>;
  readonly events: readonly (SceneEventLike & ReplayEventLike)[];
  readonly priorPositions: ReadonlyMap<string, string>;
  readonly importanceOf: (sequenceNumber: number) => number;
}): SceneIndexFoldResult {
  const touched = new Map<string, SceneCandidate>();
  let positions = new Map(args.priorPositions);

  const ordered = [...args.events].sort((left, right) => left.sequenceNumber - right.sequenceNumber);
  for (const event of ordered) {
    const locationId = eventLocationId(event);
    // Unplaceable events are dropped, exactly as `groupSceneEvents` drops them. They still move
    // the position fold: a `character_location_changed` with no resolvable scene location is
    // still an arrival, and the next scene's `positionsBefore` has to know about it.
    if (locationId === undefined) {
      positions = foldReplayPositions(positions, [event]);
      continue;
    }
    const sceneId = `${event.worldDay}:${event.timeSlot}:${locationId}`;
    const existing = touched.get(sceneId) ?? args.prior.get(sceneId) ?? null;
    const score = Math.max(existing?.score ?? 0, args.importanceOf(event.sequenceNumber));

    // Read BEFORE the event's own arrivals are applied — see the docblock.
    const positionsBefore = existing ? existing.positionsBefore : toPositions(positions);
    positions = foldReplayPositions(positions, [event]);

    touched.set(sceneId, {
      sceneId,
      worldDay: event.worldDay,
      timeSlot: event.timeSlot,
      locationId,
      minSequenceNumber: Math.min(existing?.minSequenceNumber ?? event.sequenceNumber, event.sequenceNumber),
      maxSequenceNumber: Math.max(existing?.maxSequenceNumber ?? event.sequenceNumber, event.sequenceNumber),
      // Deduplicated and re-sorted rather than appended: a rebuild replayed over a tail it has
      // already folded (an operator re-running the rebuild, say) must not list an event twice,
      // because `candidateToGroup` would then hand the builders a duplicated event.
      eventSequenceNumbers: [...new Set([...(existing?.eventSequenceNumbers ?? []), event.sequenceNumber])]
        .sort((left, right) => left - right),
      score,
      positionsBefore,
      positionsAfter: toPositions(positions),
    });
  }

  return { touched, positions };
}

/**
 * The scene ids the tail's events belong to, so the caller can read exactly those index rows
 * before folding rather than reading the world's.
 *
 * Shares {@link eventLocationId} with the fold above, so "which scene is this event in" has one
 * answer: a second rule here would read the wrong row and then create a duplicate scene beside it.
 */
export function sceneIdsOfEvents(events: readonly SceneEventLike[]): string[] {
  const ids = new Set<string>();
  for (const event of events) {
    const locationId = eventLocationId(event);
    if (locationId !== undefined) ids.add(`${event.worldDay}:${event.timeSlot}:${locationId}`);
  }
  return [...ids];
}
