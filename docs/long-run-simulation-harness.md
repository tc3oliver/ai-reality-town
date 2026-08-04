# Deterministic long-run simulation harness

ART-60 implements PRD **NFR-007** and **Section 19.3**: a fixed-seed 7-day and 30-day
simulation whose results are machine-checked, never eyeballed.

`convex/operations/longRunHarness.ts` exports one function:

```ts
const findings = await runLongRunSimulation({ worldDays: 30 });
```

It drives the **real** live pipeline — ART-97's `executeWorldDay` for stages 1–10 and
ART-98's `executePostCommitPipeline` for stages 11–21, for every accepted event, in canon
order — over an in-memory Canon store seeded from the Mistwood production seed, and returns
one typed `LongRunFindings` record.

The harness lives in `convex/operations` because `architecture/module-boundaries.json` makes
`operations` the only module that may depend on `simulation`, `story`, `editorial`/`recaps`,
`publicRead` and `safety` at once; a harness that must inspect episodes, recaps and read
models cannot live under `convex/simulation`.

## The fixed seed

There is no RNG anywhere on the driven path. Every Run ID, Proposed Event idempotency key
and generator choice is derived from `(worldId, worldDay, timeSlot)`, and scene authoring
goes through ART-4's deterministic `FakeWholeSceneProvider` — no network, no API key, no
cost. The seed is therefore the whole of `LongRunSeed`:

| field | value |
| --- | --- |
| `worldId` | `mistwood` |
| `fixtureId` | `mistwood-production-seed-v1` (`convex/canon/mistwoodSeed.ts`) |
| `providerModel` | `fake-whole-scene-v1` |
| `startWorldDay` | `0` |
| `worldDays` | `7` or `30` |
| `timeSlotsPerWorldDay` | `5` |

Reproducibility is **proved, not asserted**: `LongRunFindings.digest` is a canonical digest
of every other field, and the test runs the 7-day scenario twice and requires the two
reports to be byte identical.

## What is machine-checked

| Section 19.3 question | `LongRunFindings` field | Method |
| --- | --- | --- |
| Canon conflicts | `canonConflicts` | Failed world-day / post-commit runs, **plus** an independent re-run of `validateEventStructure` and `validateCanon` over every accepted event against the projection as it stood immediately before it, plus dense sequence numbers and unique idempotency keys. A validation error swallowed inside the pipeline still surfaces here. |
| Replay consistency | `replay` | ART-17 `replayWorldEvents` over the accepted log must reproduce the projection the pipeline itself carried (`equal`), and a second independent replay must match the first (`deterministic`). |
| Arc limits / progress / resolution | `arcs` | FR-F003 `MAX_MAJOR_ACTIVE_ARCS` per end-of-day checkpoint, per-arc projection revisions and lifecycle transitions, and ART-31 `detectArcStagnation` against `ARC_STAGNATION_WORLD_DAYS`. |
| Character appearance | `appearance` | The Director's own `slotsSinceMajorAppearance` input, sampled at every slot, against `MAX_SLOTS_WITHOUT_APPEARANCE` (two full world days), plus characters that never took part in a committed scene, plus the committed `character_location_changed` count (`relocations`) — a world that never relocates anyone is a world where a stranded character can never be reached (ART-101). |
| Repetition | `repetition` | 128-bit FNV-1a digest (`contentDigest`) over the canonical JSON of each scene's **authored prose only**: scene summary, key actions, dialogue lines and Proposed Event public summaries. Scene IDs, run IDs, world day and time slot are excluded on purpose — they are unique by construction and would make every scene trivially distinct. Two scenes sharing a digest told the audience the same thing. A pure-JS digest is used rather than `node:crypto` so the module carries no node builtin. |
| Recap coverage | `recapCoverage` | Every completed world day must have ≥1 accepted event and exactly one episode; every episode must have non-blank title/headline/one-line summary, at least `MIN_EPISODE_SCENES` key scenes and at least one source event. Each episode is then run through ART-35 `validateRecapCoverage` for FR-G004 coverage gaps and spoiler leaks. |
| Token anomalies | `tokens` | **Honestly scoped.** The run is authored by the fake provider, which consumes no real tokens — its counts are derived from payload length. The checks prove the `ProviderTraceMetadata` accounting channel is wired and internally sane (finite, non-negative, non-zero counts; no unexpected retries) and record `realProviderSpendChecked: false`. Real spend-anomaly detection needs the ART-72 provider adapter and is deliberately **not** simulated; no token-tracking mechanism was invented for this task. |
| Safety outcomes | `safety` | Every simulated scene must carry a real `classifyPostGeneration` verdict (ART-54/55) and every episode a safety classification ID. `eventsBypassingSafety` maps each accepted event back to its authoring scene through the `<sceneId>:event:<n>` idempotency key and reports any event whose scene was unclassified or was withheld for review. |

## Running it

```bash
# 7-day scenario, part of the normal suite (~6 s per run)
npm test -- --runTestsByPath convex/operations/longRunHarness.test.ts

# 30-day scenario, gated
npm run test:longrun
```

The 30-day scenario is gated behind `ART60_LONG_RUN=1` because it takes about five minutes:
each of its 449 accepted events drives a full post-commit pipeline whose public read-model
rebuilds replay the whole accepted log, the O(n²) cost already documented in
[`post-commit-pipeline.md`](./post-commit-pipeline.md) and tracked as ART-100. Putting it in
`npm run check` would multiply the default suite's runtime; `npm run test:longrun` runs both
scenarios.

A 90-day run is explicitly **out of scope** here and is owned by **ART-73**.

## Findings from the fixed seed

The 7-day and 30-day runs are clean on completion rate (100%), Canon conflicts (zero),
replay equality (100%), arc limits, arc progress, arc stagnation (zero arcs past the 14-day
threshold), recap coverage (every world day has canon and exactly one non-empty episode,
zero FR-G004 findings), token-channel sanity and safety (every scene and episode classified,
zero events bypassing safety).

Character appearance (FR-C002) is now among the clean checks. It was ART-60's first
finding and is kept described here because the harness is what proved it and what guards it:
five of the twelve seeded characters — `lin-yingxue`, `su-meizhen`, `luo-shan`,
`tang-ruoxi`, `wu-zhen` — are placed alone by the seed, and under the original live
Director none of them ever took part in a committed scene in 30 world days
(`maxSlotsSinceMajorAppearance` 150, 700 threshold violations).
`generateDirectorPlanCandidate` only planned scenes at locations holding two or more
characters, and no committed scene ever emitted `character_location_changed`, so a character
the seed stranded could neither be cast nor move. ART-101 fixed the live candidate
generator; the harness now asserts `neverAppeared` is empty, `violations` is empty,
`maxSlotsSinceMajorAppearance` stays inside the ceiling, and `relocations` is non-zero with
those exact five characters relocated — so the starvation cannot come back unnoticed.

Two gaps remain, reported rather than hidden. The tests assert them, so a change in either
fails loudly and has to be re-triaged.

1. **Arc lockstep (FR-F004 / Section 16.2).** The portfolio holds exactly three major arcs
   at every checkpoint, never breaching the FR-F003 limit, but because every event carries
   identical importance under the fake author, all three are opened and advanced together
   and resolve on the same day. On the changeover day — one world day in five — all three
   replacements are still `emerging`, so the strict `isActiveArcStatus` count is zero.
   `unresolvedMajorByWorldDay` stays in the 1–3 band throughout; `activeMajorByWorldDay`
   does not. Uniform importance is a property of the no-cost tier, so this needs re-measuring
   against the ART-72 provider before it can be called a production defect.
2. **Content repetition.** 449 scenes over 30 days collapse onto 32 distinct scene texts
   (92.9% exact duplicates). ART-101's un-stranded cast widened the output space from twelve
   texts and lowered the duplicate rate from 97.3%, but the residue is the fake author's
   template space, not the Director, and is deferred to the ART-72 provider.
