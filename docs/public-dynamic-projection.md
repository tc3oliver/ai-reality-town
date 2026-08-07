# Public Dynamic Projection

FR-N003 / ART-115. Modules: `convex/publicRead/publicDynamicProjection.ts`,
`convex/publicRead/publicDynamicProjectionValidators.ts`, wired through
`convex/publicRead/liveState.ts` and `liveStateFunctions.ts`.

The Visual Runtime (ART-114) decides *what the viewer draws*. This module decides *what the
public is allowed to see of that decision*. The two are deliberately separate: a
`MovementTrajectory` carries planning detail — waypoints, the movement phase, the origin
location, a per-unit map id — that a public client neither needs nor should be handed, and
PRD 2.0 §10.4 specifies a narrower unit, `PublicCharacterMotion`, which is exactly what the
read-only renderer in `src/components/world/` consumes.

It is a pure function. `buildPublicDynamicProjection(input)` takes seed placements, accepted
events, a runtime context, a world status and an explicit planning instant, and returns a
validated payload. No `ctx`, no database handle, no clock.

## The published contract

### Root

| Field | Meaning |
|---|---|
| `worldId` | The world this projection describes. |
| `mapId` | Which map the coordinates are measured against. Published **once**, at the root — geometry is meaningless across map versions. |
| `runtimeVersion` | `PUBLIC_DYNAMIC_RUNTIME_VERSION`, bumped when a published field is added, removed or reinterpreted. |
| `snapshotSequence` | Last accepted event's `sequenceNumber + 1`, or `0` for a world with no history. |
| `updatedAt` | Last accepted event's `acceptedAt`, or `0`. **Not a clock read** — see below. |
| `worldStatus` | `running` \| `paused` \| `unknown`. The raw `worldSchedules.status`, nothing more. |
| `characters` | One `PublicCharacterMotion` per publishable character, sorted by `characterId`. |
| `activeScenes` | The published episode's key scenes: `title`, `summary`, `sourceEventIds`. |

### Per character (PRD 2.0 §10.4)

| Field | Meaning |
|---|---|
| `characterId`, `semanticLocationId` | Who, and the Canon location the motion ends at. |
| `motionType` | `canon` \| `ambient` \| `idle` \| `replay`. |
| `motionSequence` | Monotonic per character. `0` for a bootstrap, `sequenceNumber + 1` for a fact. |
| `from`, `to` | Tile coordinates. The client interpolates between them. |
| `startedAt`, `arriveAt` | The interpolation window. `arriveAt >= startedAt` always. |
| `animationState`, `direction` | What sprite to draw: one of five states, one of four facings. |
| `sourceEventIds` | Optional. **Omitted**, not empty, when the motion has no provenance. |

Omitting `sourceEventIds` rather than publishing `[]` is what lets a client tell "has never
moved" from "moved, but the provenance was empty".

## The seed-bootstrap-versus-event-override rule

A seed placement is a **default, never an override**. Stated precisely:

- A character with **no** accepted location fact and a seed placement is published at its
  seeded location: `motionType: 'idle'`, `motionSequence: 0`, `from === to`, no
  `sourceEventIds`.
- A character with **at least one** accepted location fact is published from that fact.
  Because Canon sequence numbers start at `0`, an event-derived motion always has
  `motionSequence >= 1`, so it strictly outranks every bootstrap.
- A character with no fact **and** no seed placement is omitted entirely.
- A character whose destination location has no active Location Visual Binding is omitted and
  a runtime problem is recorded. A guessed position would put a character somewhere Canon
  never said they were, so nothing is published at all.

That numeric separation — `0` for bootstrap, `>= 1` for Canon — is defence in depth. The
client's rule is "highest `motionSequence` wins" (`worldViewModel.ts`), and it reaches the
same conclusion the producer did **without having to trust it**.

This module does not implement the precedence itself. It calls `planCharacterTrajectories()`
exactly once, with all seed placements and the whole accepted history together, because the
planner already resolves precedence internally. Re-implementing it here would give the two
layers two chances to disagree.

## The two contract mappings

ART-114's runtime vocabulary is wider than the public one, so two total mapping tables sit at
the boundary. Both are exhaustive records with no default branch, so adding a runtime value
is a compile error here rather than a silent fallthrough.

**Motion type.** `bootstrap` collapses to `idle`; the rest pass through.

| Runtime | Published |
|---|---|
| `bootstrap` | `idle` |
| `canon` | `canon` |
| `ambient` | `ambient` |
| `replay` | `replay` |

To a viewer, a character who has never moved and one who has finished moving are both
standing still. "Bootstrap" is an implementation word the public contract has no room for.

**Direction.** Eight compass points collapse to four facings, because the sprite sheets are
packed with four walk cycles. Diagonals resolve to their **horizontal** component: a character
heading north-east reads better walking east than walking away from the camera.

| Runtime | Published |
|---|---|
| `north` | `up` |
| `south` | `down` |
| `east`, `north-east`, `south-east` | `right` |
| `west`, `north-west`, `south-west` | `left` |

## Why `updatedAt` and `snapshotSequence` are Canon-derived, not clock-read

Both come from the last accepted event. Reading a clock instead would make an unchanged world
produce a different payload on every rebuild, which defeats the read-model store's
`contentHash` deduplication in `readModel.ts` and appends a spurious version row every time
the projection is rebuilt — turning a cheap idempotent rebuild into unbounded storage growth.

The same reasoning drives two smaller decisions:

- `seedPlacementsFromCharacterRows()` **sorts by `characterId`**, so the payload does not
  inherit Convex's row order.
- `characters` is sorted by `characterId` before publication.

A test pins this directly: two builds at planning instants millions of milliseconds apart,
both past every `arriveAt`, produce byte-identical JSON.

## What is deliberately not published

`PUBLIC_DYNAMIC_FORBIDDEN_FIELDS` names both the private-data fields (the §22 leakage
boundary) and the Visual Runtime planning detail that is real but internal:

| Field | Why it stays internal |
|---|---|
| `waypoints` | Publishing the route would leak the shape of the collision layer. |
| `movementPhase` | Derivable from `startedAt`/`arriveAt`; not part of §10.4. |
| `originLocationId` | Not part of §10.4. The client renders where a character *is*. |
| `problems` | Operator diagnostics. A viewer is not an operator. |
| per-motion `mapId` | Legal once at the root, never repeated per character. |

Publication is by **allowlist, not redaction**: every published field is named in a constant
and re-checked by `assertPublicDynamicProjection()` before the payload is written and again
when it is read back. A field added to `MovementTrajectory` tomorrow is invisible to the
public by default — someone has to add it here on purpose.

Leakage is tested three ways: a recursive key walk for forbidden names at any depth, a raw
substring search of the serialised payload for every character's actual `privateProfile`,
`privateGoal` and `fear` values from the Mistwood seed (which catches a value leaking under an
innocent-looking key), and a fixed-point check against the existing `sanitizeForPublic()`
helper — the projection must have nothing left for the sanitiser to strip.

## Validation, in two layers

`assertPublicDynamicProjection()` is the enforcement point. It runs on the write path and
again on the read path, and it checks things a structural validator cannot express: an
`arriveAt` that precedes its `startedAt`, a repeated `characterId`, a non-integer
`motionSequence`, a point with an extra coordinate.

`publicDynamicProjectionValidators.ts` mirrors the same contract as Convex `v` validators,
kept in a separate file so the pure module stays free of `convex/values` and therefore
importable from a plain-Node test. One is wired as the `returns:` validator on
`getPublicDynamicProjection`. A test pins the two layers against each other — field sets,
optionality, and enum members — so they cannot drift apart.

## Failure handling: the last valid version keeps serving

This is **not** a new mechanism. The projection is published through the existing
`commitReadModelVersion()` path in `readModel.ts` as part of the `liveState` model, so it
inherits the guarantee that infrastructure already provides:

1. `rebuildLiveProjection` commits a new version. The new row is inserted **first**; only then
   is the prior current version demoted to `isLastKnownGood`.
2. If the write throws midway, the previously-current version was never touched and keeps
   serving.
3. If a rebuild is later marked `failed` or `withheld`, `selectServedVersion()` falls back to
   the retained last-known-good.

`getPublicDynamicProjection` is a **query** that reads through the same `serveReadModel` path,
so it picks all of this up for free and adds no write of its own. Reading the projection
causes no mutation anywhere — enforced structurally by a source scan, not just behaviourally.

## Where it is wired

`rebuildLiveProjection` reads `worldCharacters` and `worldSchedules` alongside the rows it
already read, resolves the world's Visual Runtime context (only Mistwood has one today; any
other world publishes `dynamic: null` rather than being drawn on a map never authored for it),
and nests the result under a new `dynamic` field on `LiveProjectionPayload`.

Nested, not merged: `LiveProjectionPayload.characters` is a different, semantic shape —
location ids and aliveness — and collapsing the two would force every existing consumer to
care about motion. `LIVE_PROJECTION_SCHEMA_VERSION` moves from `1` to `2` accordingly.

`src/components/world/worldViewModel.ts` re-exports the motion types from this module rather
than redeclaring them, so consumer and publisher cannot drift.

## Out of scope

None of the following is built here. The contract *accepts* their future values so those tasks
widen it rather than redefining it.

| Not built | Task |
|---|---|
| Snapshot lifecycle and staleness classification (`worldStatus` is the raw schedule status) | FR-N007 / ART-116 |
| Replay payloads — `motionType: 'replay'` validates, but is never produced | FR-O013 / ART-121 |
| Incremental updates — `rebuildLiveProjection` stays a full rebuild | FR-Q003 / ART-100 |
| Ambient movement semantics — `motionType: 'ambient'` validates, but is never produced | FR-O011 / ART-120 |
| Scene spatial fields beyond `title`/`summary`/`sourceEventIds` | FR-O003 / ART-122 |

Fabricating a synthetic Canon event to force a character's visibility is **not permitted** and
is not done: `convex/canon/**` and `convex/schema.ts` are untouched. The seed-bootstrap path is
derivation on read, exactly as `docs/visual-runtime-trajectory-planner.md` describes.
