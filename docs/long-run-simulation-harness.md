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

## The seeded baseline, and the real snapshot stage

Two stages of the fixture were weaker than production until ART-58, and both weakened the
evidence in ways a passing run could not show.

**The `initial` snapshot is now seeded.** `seededCanonStore` writes the snapshot
`importWorld` writes, built by the same `buildWorldImportPlan` the deployment uses. Without
it every commit in the run validated against `emptyProjection`, where `validateCanon`
skips the unknown-destination, inactive-destination and capacity checks because
`projection.locations` is empty and `destination` is always `undefined` — the exact trap
CLAUDE.md §9 records. The 30-day evidence was measuring a weaker Canon than production
enforces. Every replay in the harness now starts at `resolveWorldBaseline`, never at
`emptyProjection`.

**The daily snapshot stage is now real.** `persistDailySnapshot` binds
`createDailySnapshot` over `CanonBackedSnapshotStore`. It used to be a stub whose comment
cited ART-99 as known-broken; ART-99 had been **Done** long before the harness last
changed, so the comment was stale and the stub was a pipeline stage the evidence silently
skipped. `createDailySnapshot` also asserts the previous snapshot against a full replay, so
a reducer regression now fails a run here as it would in production, and the persisted
snapshots are available to the continuity evaluator as replay evidence.

**The rule context now carries persona anchors.** `mistwoodRuleContext` builds
`characterPersonas` from the same seed rows production reads them from, through
`personaAnchorFromSeed`. They were absent before, and FR-B003's gate treats an absent
anchor as inert, so `assessPersonaDeviations` had nothing to assess for the whole run —
the 30-day evidence never exercised the persona gate at all.

## What is machine-checked

| Section 19.3 question | `LongRunFindings` field | Method |
| --- | --- | --- |
| Canon conflicts | `canonConflicts` | Failed world-day / post-commit runs, **plus** an independent re-run of `validateEventStructure` and `validateCanon` over every accepted event against the projection as it stood immediately before it — folded from the **seeded baseline**, not from `emptyProjection` — plus dense sequence numbers and unique idempotency keys. A validation error swallowed inside the pipeline still surfaces here. |
| Replay consistency | `replay` | `replay.equal` compares the projection the run **carried**, folded incrementally as each slot commits, against a one-shot ART-17 `replayWorldEvents` over the whole accepted log; `deterministic` requires a second independent replay to match the first. Until ART-58 `liveDigest` was itself a full replay recomputed every slot, so `equal` compared the same computation over the same list — an assertion that could not fail. It was described here as an incremental fold before it was one; that description was wrong, and is now true. The two sides agree only if the reducer is a pure function of `(projection, event)`. |
| Continuity (FR-M002 / §16.2) | `continuity` | An `EvaluationReport` from the **same** `convex/quality/continuity.ts` evaluator the operator query runs, over the run's own evidence: the accepted log folded from the seeded baseline, the daily snapshots stage 20 persisted, and the episodes and recap formats the editorial stages published. It reports the five §16.2 Canon targets and the Continuity Score. It is not a restatement of `canonConflicts` and `replay` — those are the harness's own checks, and agreement between two independent computations is the evidence. See [`world-quality-metrics.md`](./world-quality-metrics.md). |
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

## The content seam (ART-92)

`LongRunFindings` is machine-only by design, so it cannot serve PRD Section 19.5's *human*
sampling: a reviewer cannot read a content digest. `runLongRunSimulation` therefore accepts
one optional callback, `onContentSample`, invoked exactly once after the run with the
authored scenes and assembled episodes. It is emitted after the fact and is not an input to
`LongRunFindings.digest`, so it cannot influence the run or its reproducibility.

Its only consumer is `convex/operations/narrativeReviewSample.ts`; see
[`narrative-quality-rubric.md`](./narrative-quality-rubric.md).

## Findings from the fixed seed

The 7-day and 30-day runs are clean on completion rate (100%), Canon conflicts (zero),
replay equality (100%), arc limits, arc progress, arc stagnation (zero arcs past the 14-day
threshold), recap coverage (every world day has canon and exactly one non-empty episode,
zero FR-G004 findings), token-channel sanity and safety (every scene and episode classified,
zero events bypassing safety).

The FR-M002 continuity report is clean over both, and every denominator it uses is
non-empty. Over the 7-day seed:

| Quantity | Value |
| --- | --- |
| Accepted events | 104 |
| World days replay-consistent against a persisted daily snapshot | 7 of 7 |
| Publications examined (7 episodes + 7 recap-format rows) | 14 |
| Severe conflicts, unsourced secret leaks, deceased appearances, location conflicts | 0 |
| Continuity Score | 1.0 across all five components |

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
2. **Content repetition.** 449 scenes over 30 days collapse onto **171** distinct scene
   texts (**61.9%** exact duplicates); 104 scenes over 7 days collapse onto **91** (12.5%).
   The figures previously recorded here — 32 distinct texts and 92.9% duplicates, as one
   number for both run lengths — were two generations stale and are wrong. ART-101
   un-stranded the cast, and ART-164's zh-Hant narrator gave a scene a deterministic
   outcome, stake and per-participant stances as well as a place and a subject, which
   widened the output space far enough that the two run lengths no longer saturate it and
   legitimately differ.

   The residue is the fake author's template space, not the Director. This was previously
   described as "deferred to the ART-72 provider"; **that is no longer accurate** — ART-72
   is Done. The honest statement is that the fixed-seed author is a template by
   construction, and the fix is owned by **ART-88** (novelty and repetition evaluators).
