# P0 Canon and Cognition Integration Suite

Owner task: **ART-61**. Requirement IDs: **PRD 19.2 cases 1, 3 and 4** and
**PRD 20 (public test acceptance) criteria 3–6**.

The suite lives in `convex/knowledge/canonCognitionIntegration.test.ts`. It adds no
production domain logic: it drives the existing Canon commit pipeline, validators,
deterministic reducer, replay, snapshots and the cognition read gates end to end.

## Why it lives under `convex/knowledge/`

The scenarios cross Canon and cognition. `architecture/module-boundaries.json` allows
`knowledge` to depend on `canon` and `shared`, and forbids the reverse, so `knowledge` is
the only correct home for a suite that needs both. Tests are colocated with their module,
as described in `docs/DEVELOPMENT.md`.

## Deterministic scenario world

One fixed script is committed through `commitProposedEvent` over `InMemoryCanonStore` for
every test (world `mistwood-p0`, 11 accepted events, world days 1–3):

| Seq | Event | Purpose |
| --- | --- | --- |
| 0 | arrivals (`world_event`) | places Cassia, Rowan, Bram and Delia |
| 1 | Rowan walks to the grove (`movement`) | keeps the later scene location-consistent |
| 2 | private fact created (`discovery`) | the only legal source of the secret |
| 3 | Cassia learns + forms a memory (`discovery`) | `observed` acquisition citing event 2 |
| 4 | Cassia tells Rowan (`conversation`) | `told` sharing citing event 3, plus a relationship change |
| 5, 7, 9 | three ledger transfers (`world_event`) | Cassia → Rowan → Bram → Cassia |
| 6, 8 | Rowan and Bram move (`movement`) | keeps each transfer location-consistent |
| 10 | Bram dies (`world_event`) | the deceased-character boundary |

Determinism comes from three properties: event ids are derived from world plus sequence
number, the reducer never reads a clock or randomness, and the suite pins `Date.now` so the
accepted envelopes (`acceptedAt`) are identical run to run. The shared
`createMistwoodFixture()` fixture (`docs/testing/fixtures.md`) is exercised alongside the
scripted world.

## What each acceptance criterion proves

- **AC #1 — sourced secret acquisition and sharing** (19.2 case 1, public AC 5). Cassia's
  belief cites the accepted fact event; Rowan's belief cites the accepted event in which
  Cassia learned it; `learnedAt` matches the sharing event; every projected belief and
  memory cites an event that exists in accepted history and is declared in the citing
  event's `causedByEventIds`. Unsourced learning is rejected with
  `KNOWLEDGE_SOURCE_MISSING`, an unknown source with `UNKNOWN_EVENT_REFERENCE`, and a
  bystander with `PARTICIPANT_MISMATCH` — each with no write. Cross-character reads fail
  with `KNOWLEDGE_ACCESS_DENIED` / `MEMORY_ACCESS_DENIED`, and the uninvolved character's
  ledger stays empty.
- **AC #2 — deceased characters leave normal scenes** (19.2 case 3, public AC 4). Retrying
  the identical death proposal deduplicates to the same event id and still yields exactly
  one life change. Afterwards a new scene, a movement and a resurrection naming the
  deceased character are all rejected (`DEAD_CHARACTER_ACTION`), while a scene between
  living characters still commits. The same rejection is reproduced against a from-scratch
  full replay projection and against a snapshot-resumed projection.
- **AC #3 — unique item ownership** (19.2 case 4, public AC 6). After three transfers the
  ledger has exactly one canonical owner and one history entry per accepted transfer, each
  citing an accepted event. Eight concurrent retries of one transfer collapse into a single
  accepted event. Two concurrent conflicting transfers from the same owner resolve to one
  acceptance and one `ITEM_OWNERSHIP_CONFLICT`, and two transfers of one item inside a
  single event are rejected.
- **AC #4 — determinism and 100% replay equality**. The whole script is committed twice
  into independent stores and produces byte-identical accepted logs, projections and
  integrity hashes. For all 11 snapshot cut points, `assertSnapshotMatchesHistory` accepts
  the snapshot and the snapshot-resumed replay equals the full replay: the asserted
  equality rate is exactly `1`.
- **Cross-cutting invariants** (public AC 3–6). For every accepted event: located scenes
  only involve characters standing in that location, participants were alive when the event
  was accepted, sequence numbers form a gapless duplicate-free run, and idempotency keys
  are unique. Every projected belief and memory is rooted in an accepted event.

## Commands

Focused evidence:

```bash
npm test -- --runInBand --runTestsByPath convex/knowledge/canonCognitionIntegration.test.ts
```

Full gate:

```bash
npm run check
```

## Deliberate scope boundaries

- P1 rumour propagation and viewer voting are covered separately, not here.
- Deceased-character exclusion is proven at the Canon boundary, which is where it is
  enforced: any proposed scene naming a deceased participant is rejected. Scene *planning*
  filtering in `convex/simulation` is a separate concern and is not asserted by this suite.
- Seven-, thirty- and ninety-world-day runs stay with ART-60 and ART-73.
