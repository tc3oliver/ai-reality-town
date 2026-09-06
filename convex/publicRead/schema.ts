import { defineTable } from 'convex/server';
import { v } from 'convex/values';

import { DYNAMIC_INCIDENT_CODES } from './dynamicViewMetrics';
import {
  publicActiveSceneValidator,
  publicCharacterMotionValidator,
} from './publicDynamicProjectionValidators';
import { publicRuntimeSnapshotStatusValidator } from './runtimeSnapshotValidators';

/**
 * Built from the code array rather than written out, so a new Visual Runtime problem code
 * widens the column automatically instead of failing an insert at runtime.
 */
const dynamicIncidentCodeValidator = v.union(
  ...DYNAMIC_INCIDENT_CODES.map((code) => v.literal(code)),
);

/**
 * One `character_location_changed` arrival, as the Visual Runtime's anchor chain reads it
 * (ART-100). Mirrors `LocationFact` in `visualSyncPlanner.ts`; `fromLocationId` is optional here
 * because Convex has no null-vs-absent distinction worth spending a column on.
 */
const locationFactValidator = v.object({
  characterId: v.string(),
  fromLocationId: v.optional(v.string()),
  toLocationId: v.string(),
  worldDay: v.number(),
  timeSlot: v.string(),
  acceptedAt: v.number(),
  sequenceNumber: v.number(),
  eventId: v.string(),
});

/**
 * Publication-gated public read-model store (NFR-001/002/005, §16.3).
 *
 * Public reads consult ONLY this table — never canon, simulation, or any
 * provider — so read availability is isolated from simulation/model failure.
 * Each row is an allowlisted, pre-computed projection snapshot. Versioning +
 * last-known-good retention keep a servable version available when the current
 * one is withheld or fails.
 */
export const publicReadTables = {
  publishedReadModels: defineTable({
    schemaVersion: v.literal(1),
    worldId: v.string(),
    modelKind: v.union(
      v.literal('world'), v.literal('character'), v.literal('episode'),
      v.literal('arc'), v.literal('relationship'), v.literal('liveState'), v.literal('timeline'),
      v.literal('visualReplay'), v.literal('voteConsequence'),
      v.literal('relationshipGraph'),
    ),
    modelRef: v.string(),
    version: v.number(),
    // Allowlisted public projection JSON. Private fields are stripped before
    // insert by the pure layer; the query re-sanitises defensively on read.
    payload: v.any(),
    status: v.union(
      v.literal('publishing'), v.literal('published'),
      v.literal('withheld'), v.literal('failed'),
    ),
    sourceEventIds: v.array(v.string()),
    // True for the live version of a target. Exactly one current per
    // (worldId, modelKind, modelRef) is maintained by the wiring.
    isCurrent: v.boolean(),
    // True for the retained fallback served when current is withheld/failed.
    isLastKnownGood: v.boolean(),
    contentHash: v.string(),
    createdAt: v.number(),
    publishedAt: v.optional(v.number()),
    updatedAt: v.number(),
  })
    .index('by_current', ['worldId', 'modelKind', 'modelRef', 'isCurrent'])
    .index('by_target_and_version', ['worldId', 'modelKind', 'modelRef', 'version'])
    .index('by_status', ['worldId', 'modelKind', 'status'])
    .index('by_lkg', ['worldId', 'modelKind', 'modelRef', 'isLastKnownGood']),

  /**
   * Durable public runtime snapshots (FR-N007, PRD 2.0 §14.3).
   *
   * Separate from `publishedReadModels` on purpose: a snapshot needs a wall-clock
   * `observedAt` that advances when a heartbeat re-observes unchanged content, which a
   * `contentHash`-deduplicated payload cannot carry without either polluting the hash
   * (a new row every heartbeat) or silently dropping the observation.
   *
   * `status` is `live | paused` only. `delayed` and `stale` are derived at read time from
   * elapsed clock, never written, so no row can claim to be fresher than it is.
   *
   * Deliberately absent from `TablesToVacuum` in `convex/crons.ts`: vacuuming by
   * `_creationTime` would delete a long-paused world's only remaining snapshot.
   */
  publicRuntimeSnapshots: defineTable({
    schemaVersion: v.literal(1),
    worldId: v.string(),
    runtimeVersion: v.number(),
    /** This table's own monotonic counter, starting at 1. Never regresses. */
    snapshotSequence: v.number(),
    /** The Canon-derived `PublicDynamicProjection.snapshotSequence` this was built from. */
    sourceRuntimeSequence: v.number(),
    status: publicRuntimeSnapshotStatusValidator,
    mapId: v.string(),
    characterStates: v.array(publicCharacterMotionValidator),
    activeSceneStates: v.array(publicActiveSceneValidator),
    /** The source projection's `updatedAt` — Canon-derived, not a clock read. */
    contentUpdatedAt: v.number(),
    contentHash: v.string(),
    createdAt: v.number(),
    /** Last time a capture confirmed this content and status were still current. */
    observedAt: v.number(),
    /** True for the head snapshot. Exactly one per world. */
    isCurrent: v.boolean(),
  })
    .index('by_world_and_current', ['worldId', 'isCurrent'])
    .index('by_world_and_sequence', ['worldId', 'snapshotSequence']),

  /**
   * Attributed dynamic-view defects (FR-Q001, PRD 2.0 §12 Epic Q).
   *
   * SPARSE and per-occurrence: a healthy world writes nothing here. FR-Q001 AC#4 requires
   * a mismatch to be locatable to a character, a location and a sequence, and a count
   * cannot do that — so each defect gets its own row carrying exactly the identifiers that
   * are already published in `PublicCharacterMotion`.
   *
   * PRIVACY: the writable field set is the allowlist `DYNAMIC_INCIDENT_FIELDS`, enforced
   * by `assertDynamicViewIncident` before every insert. `VisualRuntimeProblem.message` —
   * the one free-text field on the source record — is deliberately not a column here.
   *
   * Vacuumed on the standard two-week retention (`TablesToVacuum` in `convex/crons.ts`):
   * these are diagnostics, and a defect nobody looked at for a fortnight is not evidence.
   */
  dynamicViewIncidents: defineTable({
    schemaVersion: v.literal(1),
    worldId: v.string(),
    code: dynamicIncidentCodeValidator,
    characterId: v.string(),
    /** Where the runtime put the character, or tried to. */
    locationId: v.string(),
    /** Where Canon says the character is. Set only for `CANON_RUNTIME_LOCATION_MISMATCH`. */
    canonLocationId: v.optional(v.string()),
    /** Absent when no motion was published, e.g. an unbound location. */
    motionSequence: v.optional(v.number()),
    snapshotSequence: v.number(),
    detectedAt: v.number(),
  })
    .index('by_world_and_time', ['worldId', 'detectedAt'])
    .index('by_world_and_code', ['worldId', 'code', 'detectedAt'])
    .index('by_world_and_character', ['worldId', 'characterId', 'detectedAt']),

  /**
   * Dense per-world rollup: exactly one row per world, patched in place.
   *
   * The counterpart to `dynamicViewIncidents`. Latency is kept as a histogram rather than
   * a sample list so storage is O(worlds), not O(rebuilds) — a world that runs for a year
   * costs the same row it did on day one, and P95 is derived at read time from the bucket
   * bounds.
   *
   * Deliberately absent from `TablesToVacuum`, for the same reason as
   * `publicRuntimeSnapshots`: this is a world's only metrics row, and vacuuming by
   * `_creationTime` would delete a long-quiet world's entire history rather than trimming
   * it.
   */
  dynamicViewMetricRollups: defineTable({
    schemaVersion: v.literal(1),
    worldId: v.string(),
    rebuildCount: v.number(),
    /** One counter per `LATENCY_BUCKET_BOUNDS_MS` bound, plus a final overflow bucket. */
    latencyBuckets: v.array(v.number()),
    latencyMaxMs: v.number(),
    /** One entry per `DYNAMIC_INCIDENT_CODES` code, always present, cumulative. */
    incidentCountsByCode: v.record(v.string(), v.number()),
    lastRebuildAt: v.number(),
    lastSnapshotSequence: v.number(),
    updatedAt: v.number(),
  }).index('by_world', ['worldId']),

  /**
   * The Live rebuild's resume point (ART-100). One row per world.
   *
   * `rebuildLiveProjection` runs after every accepted event and used to read the world's whole
   * accepted-event log to derive four last-write-wins folds. This row is those folds, so the
   * rebuild reads only the events since `lastSequenceNumber`.
   *
   * A DERIVED artifact and nothing else: it is folded from accepted Canon and can be discarded
   * and rebuilt from it at any time (`rebuildLiveProjection` with `rebuildFromScratch`). It is
   * never an input to Canon, and losing it costs one expensive rebuild, not a fact.
   *
   * NOT resumed from a `canonSnapshots` row, and that is load-bearing rather than incidental:
   * `locations` is one of `SEED_BASELINE_FIELDS`, so a Canon snapshot's copy carries the world's
   * imported seed locations — which the Live projection has never published, because it folds
   * from empty over `location_state_changed` alone. See `liveFold.ts`.
   */
  liveRebuildCheckpoints: defineTable({
    schemaVersion: v.literal(1),
    worldId: v.string(),
    /** The highest accepted-event sequence number folded into this row. */
    lastSequenceNumber: v.number(),
    fold: v.object({
      locations: v.array(v.object({
        locationId: v.string(), name: v.string(), description: v.string(),
        locationType: v.string(), active: v.boolean(),
      })),
      positionByCharacter: v.array(v.object({ characterId: v.string(), locationId: v.string() })),
      aliveByCharacter: v.array(v.object({ characterId: v.string(), alive: v.boolean() })),
      knownCharacters: v.array(v.string()),
      excludedCharacterIds: v.array(v.string()),
      lastSequenceNumber: v.number(),
    }),
    /**
     * The Visual Replay's own location fold, kept separately from `fold.positionByCharacter`
     * because the two apply DIFFERENT rules: the replay refuses an arrival with no
     * `toLocationId`, the Live fold records it. Merging them would be a silent behaviour change
     * in one of the two published payloads. See `foldReplayPositions`.
     */
    replayPositions: v.array(v.object({ characterId: v.string(), locationId: v.string() })),
    /**
     * The Visual Runtime's anchor chain, compressed to its outcome per character.
     *
     * `bindingsFingerprint` is the reason this can be stored at all: the anchors below were
     * resolved against the map's compiled-in bindings, so editing the map invalidates them. A
     * rebuild compares the fingerprint against the runtime it is about to plan with and starts
     * from Canon when they differ, rather than publishing positions derived from a map that no
     * longer exists. See `visualSyncPlanner.ts`.
     *
     * Optional because a world with no Visual Runtime (every world but Mistwood today) plans no
     * motion at all, so there is no chain to fold.
     */
    motionFold: v.optional(v.object({
      factCharacterIds: v.array(v.string()),
      characters: v.array(v.object({
        characterId: v.string(),
        firstFact: locationFactValidator,
        lastFact: locationFactValidator,
        lastBoundHopAnchor: v.optional(v.object({ x: v.number(), y: v.number() })),
        unboundHopLocationIds: v.array(v.string()),
      })),
      lastSequenceNumber: v.number(),
      bindingsFingerprint: v.string(),
    })),
    updatedAt: v.number(),
  }).index('by_world', ['worldId']),

  /**
   * One row per scene — the set of accepted events sharing (worldDay, timeSlot, locationId) —
   * carrying what the Visual Replay needs to rank and rebuild it without reading the log (ART-100).
   *
   * `by_world_and_rank` exists to reproduce `selectReplayGroups`' comparator with a database read
   * instead of an in-memory sort of every scene. Read descending, it yields `(score desc,
   * maxSequenceNumber desc)` — the comparator's first two keys, and the third is unreachable
   * because no two scenes can share a `maxSequenceNumber`. See `liveSceneIndex.ts`.
   *
   * Derived, like `liveRebuildCheckpoints`, and rebuildable from Canon for the same reason.
   */
  replaySceneCandidates: defineTable({
    schemaVersion: v.literal(1),
    worldId: v.string(),
    /** `${worldDay}:${timeSlot}:${locationId}` — the id ART-122 publishes for the same scene. */
    sceneId: v.string(),
    worldDay: v.number(),
    timeSlot: v.string(),
    locationId: v.string(),
    minSequenceNumber: v.number(),
    maxSequenceNumber: v.number(),
    eventSequenceNumbers: v.array(v.number()),
    /** Highest story importance among the scene's events, 0 when none was classified. */
    score: v.number(),
    positionsBefore: v.array(v.object({ characterId: v.string(), locationId: v.string() })),
    positionsAfter: v.array(v.object({ characterId: v.string(), locationId: v.string() })),
    updatedAt: v.number(),
  })
    .index('by_world_and_scene', ['worldId', 'sceneId'])
    .index('by_world_and_rank', ['worldId', 'score', 'maxSequenceNumber'])
    .index('by_world_and_sequence', ['worldId', 'maxSequenceNumber']),
};
