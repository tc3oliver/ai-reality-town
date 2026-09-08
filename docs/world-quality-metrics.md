# World quality metrics and evaluators (FR-M002)

ART-58 delivers two things: the **evaluator pattern** every FR-M002 evaluator is built
from (`convex/quality/evaluator.ts`), and the **Continuity evaluator v1**
(`convex/quality/continuity.ts`), which measures PRD §16.2's five Canon targets and
composes them into the Continuity Score.

FR-M002 is owned by four tasks, not one. ART-58 is the pattern plus continuity; ART-88
(narrative novelty and dialogue repetition), ART-89 (arc progress, recap coverage,
spoiler violation) and ART-90 (Canon rejection rate, safety withhold rate) are still
pending and build on the same shapes, so an operator reads four evaluators through one
vocabulary and the long-run harness reports them through one report type.

## 1. What an evaluator is here

A **pure function from evidence to a report**. Evidence is what the running system already
produced and persisted: accepted events, Canon snapshots, published text, validation and
safety outcomes. An evaluator never re-runs a model, never proposes an event, and never
writes anything.

That last clause is enforced, not asserted. `architecture/module-boundaries.json` declares
a `quality` module rooted at `convex/quality`, and lists it in
`canonWriteBoundary.forbiddenModules` — naming a Canon write symbol inside
`convex/quality` fails `npm run check:architecture`, so "measuring the world must not
change the world" is a build failure rather than a convention. `quality` may depend on
`canon`, `knowledge`, `story`, `editorial`, `safety`, `simulation`, `observability` and
`shared`, and `operations` may now depend on `quality`.

## 2. The rules every evaluator obeys

**Versioned definition.** `EvaluatorDefinition.version` changes whenever a metric's
numerator, denominator, weights or finding codes change, so two reports can only be
compared when they say the same thing. The definition is data, returned with every report,
because a dashboard reading a rate needs to know what the rate is a rate of.

**No observations is not zero.** Every rate is a `MetricObservation` from
`convex/shared/metricObservation.ts`. Its `rate` is `null` exactly when the denominator is
zero, `status` says `no_observations`, and `meetsTarget` is `null` rather than `true`.
Four of §16.2's targets are exactly `0` or exactly `100%`, so an empty world reporting a
perfect score is the specific lie this rule exists to prevent. `excluded` and
`excludedReason` are the same rule's second half: an observation that *cannot* answer the
question is left out of the denominator and published, not counted as a pass or a fail.

That module was lifted out of `convex/analytics/metrics.ts` by ART-58 rather than copied.
§16.1's product metrics and §16.2's quality metrics need the same rule, and a second copy
would be a second place for it to be wrong. `shared` depends on nothing, so every module
can reach it.

**Findings carry references, never content.** A `QualityFinding` names the accepted event,
snapshot, publication or validation result it came from, by id and code, and nothing else.
Its `detail` is a fixed-vocabulary sentence built from ids and codes. Secret text, private
knowledge, memory content and prompts never enter a report, so a report can be shown to an
operator without a second redaction pass.

**Exactly-once.** Evidence is counted by durable identity: an accepted event by `eventId`,
a day by `worldDay`, a publication by its `contentRef`, a scene by `sceneId`. Every id on
the live path is derived from `(worldId, worldDay, timeSlot)`, so a retried world-day run
or a re-run post-commit pipeline produces the same evidence ids and re-evaluating cannot
double-count. `dedupeFindings` enforces the same at the finding level, keyed on
`(code, subjectId, worldDay)`.

Reports are stamped with `reportDigest`, a two-pass FNV-1a digest over canonical JSON of
the whole body. Two evaluations of the same evidence produce one digest. It is a
reproducibility check, not a secret.

## 3. The Continuity evaluator v1

`evaluatorId: 'continuity'`, `version: 1`. Pure: no Convex, no clock, no randomness, no
I/O. Two entry points do all the work — `evaluateContinuityDay` for one day's evidence,
and `summarizeContinuity` to fold any number of day reports into the metrics and the
score. `evaluateContinuityWindow` chains consecutive days, carrying each day's folded
projection into the next day's origin.

The operator query and the long-run harness both call exactly these functions. A number an
operator reads and a number the fixed-seed test asserts are the same computation over
different evidence, not two implementations that agree on the fixture and nowhere else.

### 3.1 The five §16.2 metrics

Every denominator is stated before its target, because a rate over an empty population is
not a passing rate.

| PRD §16.2 name | Metric key | Numerator | Denominator | Target |
| --- | --- | --- | --- | --- |
| 嚴重 Canon 衝突 | `severe_canon_conflicts` | Accepted events carrying at least one severe finding (re-validation, sequence, idempotency, deceased, location) | Accepted events in the window | `0`, `atMost` |
| Event Replay 一致率 | `replay_consistency` | World days whose fold digest equals the stored daily snapshot **and** whose second independent fold equals the first | World days carrying a daily snapshot | `1`, `atLeast` |
| 無來源秘密洩漏 | `unsourced_secret_leaks` | Publications containing a secret or private-fact value with no cited event that made it public | Publications examined | `0`, `atMost` |
| 死者不合理出場 | `deceased_character_appearances` | Accepted events with a participant who was dead at the event's start and is not revived by it | Accepted events in the window | `0`, `atMost` |
| 角色位置衝突 | `character_location_conflicts` | Accepted events whose participants are not at the event's location after its own movements, or that move a character already moved in that slot | Accepted events in the window | `0`, `atMost` |

Days inside the window with accepted events but no daily snapshot are **excluded** from the
replay denominator with the reason recorded, never counted as a failure.

### 3.2 The Continuity Score

`composeScore` builds one weighted composite, `continuity_score`.

| Component | Metric | Weight | Transform |
| --- | --- | --- | --- |
| `canon_integrity` | `severe_canon_conflicts` | 0.30 | `complement` |
| `replay_integrity` | `replay_consistency` | 0.25 | `rate` |
| `secret_integrity` | `unsourced_secret_leaks` | 0.15 | `complement` |
| `deceased_integrity` | `deceased_character_appearances` | 0.15 | `complement` |
| `location_integrity` | `character_location_conflicts` | 0.15 | `complement` |

`rate` uses the metric as it is, for a floor-type metric. `complement` uses `1 - rate`, for
a ceiling-type metric such as conflicts per event. Every component lands in `[0, 1]` where
1 is best.

A component whose metric had no observations contributes nothing and is reported as
`no_observations`. The score is the weighted mean over the components that *measured*
something, renormalised by their weights, and `weightMeasured` against `weightTotal` says
how much of the definition that was. A score built from one component out of five is
visibly not the same score as one built from all five. When nothing measured, the score is
`null`.

### 3.3 Finding codes

| Code | Severity | Meaning |
| --- | --- | --- |
| `SEVERE_CANON_CONFLICT` | severe | Re-validating an accepted event returned a code in `SEVERE_CANON_CODES` |
| `CANON_CONFLICT` | minor | Re-validation returned a Canon code that is not in that set |
| `SEQUENCE_NOT_DENSE` | severe | Sequence numbers inside the day are not dense and ascending |
| `DUPLICATE_IDEMPOTENCY_KEY` | severe | Two accepted events carry one idempotency key |
| `DECEASED_CHARACTER_APPEARANCE` | severe | A participant was dead at the event's start and the event does not revive them |
| `CHARACTER_LOCATION_CONFLICT` | severe | After the event's own movements, a participant is not at the event's location |
| `CHARACTER_DOUBLE_MOVEMENT` | severe | One character was moved by two accepted events in one time slot |
| `REPLAY_SNAPSHOT_MISMATCH` | severe | The fold over the day's events does not reproduce the stored daily snapshot |
| `REPLAY_SNAPSHOT_SEQUENCE_MISMATCH` | severe | The stored snapshot claims a different last sequence number from the day's last event |
| `REPLAY_NONDETERMINISTIC` | severe | Two independent folds of the same events disagree; the reducer is not a pure function |
| `UNSOURCED_SECRET_LEAK` | severe | A publication contains a secret or private value that no cited event made public |

### 3.4 What "severe" means, and why the list is written down

PRD §16.2 requires 嚴重 Canon 衝突 = 0 and defines nothing further. `SEVERE_CANON_CODES`
is the definition, and it is versioned with the evaluator: changing it changes what the
target means and must bump `CONTINUITY_EVALUATOR_VERSION`.

A Canon error code is severe when an accepted event carrying it means the accepted
**history contradicts the world** — a dead character acting, a teleport, a movement from a
place the character was not, an unknown reference, a broken sequence, a reused idempotency
key, a rumor that became a fact.

```
IMMUTABLE_WORLD_RULE_VIOLATION   DEAD_CHARACTER_ACTION
TELEPORTATION_NOT_ALLOWED        LOCATION_PRECONDITION_FAILED
CHARACTER_ALREADY_MOVED_THIS_SLOT DUPLICATE_CHARACTER_MOVEMENT
UNKNOWN_CHARACTER_REFERENCE      UNKNOWN_LOCATION_REFERENCE
UNKNOWN_ITEM_REFERENCE           UNKNOWN_EVENT_REFERENCE
UNKNOWN_ORGANIZATION_REFERENCE   SEQUENCE_CONFLICT
SEQUENCE_GAP                     DUPLICATE_SEQUENCE
DUPLICATE_IDEMPOTENCY_KEY        INVALID_LIFE_STATE_CHANGE
ITEM_OWNERSHIP_CONFLICT          KNOWLEDGE_SOURCE_MISSING
RUMOR_CANNOT_BECOME_FACT         RUMOR_SOURCE_NOT_HELD
PARTICIPANT_MISMATCH             INVALID_EVENT_SHAPE
UNSUPPORTED_SCHEMA_VERSION       INVALID_FACT_SUBJECT
CHARACTER_STATE_PRECONDITION_FAILED
```

Codes about review thresholds and relationship deltas are real conflicts too, and are
counted, but as `minor`. They are about degree, not about whether the world's history can
be true.

### 3.5 Every check is independent of the code that accepted the event

CLAUDE.md §9 records that a validator handed its own input is a tautology. None of these
is:

- **Re-validation** re-runs `validateEventStructure` and `validateCanon` against the
  projection as it stood immediately *before* each event, under the world's persisted
  `CanonRuleContext`, with the legal reference set derived independently from
  `deriveEventId(worldId, sequence)` rather than read back from the rows being checked.
- **Deceased** and **location** fold the projection themselves and read the answer out,
  rather than trusting a validator's verdict. Superseding event types are exempt, and a
  character neither Canon nor the seed has placed has no location to conflict with.
- **Replay** compares a fresh fold against what the running system persisted, then folds a
  second time from a cloned origin and requires the two digests to agree.

The rule context comes from `convex/canon/ruleContextReader.ts`, extracted from
`createConvexCanonStore` by ART-58 so the read-only evaluator validates accepted history
under **exactly** the context the commit path validated it under. A second loader, however
similar, would be a second definition of which locations are active and which characters
exist, and the two would drift silently because both would keep returning well-formed
contexts.

### 3.6 The fold origin, and what the replay metric means under each

A day is evaluated by folding its accepted events onto the projection the world had at the
day's start. Where that projection came from is part of the evidence, and `origin.kind`
names it.

| `FoldOriginKind` | Origin | What `replay_consistency` then proves |
| --- | --- | --- |
| `daily_snapshot` | The previous day's `daily` snapshot | Snapshot for day D equals day D's events folded onto the snapshot for day D-1. This is exactly the snapshot-resume-versus-full-replay divergence a resume path can hide |
| `initial_snapshot` | The seeded `initial` snapshot `importWorld` writes, with any pre-window days folded through it | A full replay from the seeded baseline forward reproduces every daily snapshot the system wrote |
| `genesis` | `emptyProjection`, `lastSequenceNumber` `-1`, for a world with no seed rows at all | The same full-replay proof, for an unseeded world |

`emptyProjection` is not a world's baseline — `resolveWorldBaseline` is. Folding from
empty against a seeded world makes the unknown-destination, inactive-destination and
capacity checks pass vacuously, because `projection.locations` is empty and `destination`
is always `undefined`.

### 3.7 Privacy of the leak scan

Secret contents and private fact values enter the evaluator as **needles** and leave as
counts and ids. `privateNeedles` collects world secret contents plus every `private` fact
whose value is a string, each at least `MIN_SECRET_NEEDLE_LENGTH` (4) characters — shorter
strings are ambient text and would match everything.

A publication leaks when its text contains a needle and none of its cited accepted events
created a **public** fact containing that needle. The finding names the publication ref,
the secret or fact id, and how many cited events failed to source it. No needle is ever
placed in a finding, a metric, or a digest input.

## 4. The operator query

`getContinuityQualityMetrics` in `convex/operations/worldQualityFunctions.ts`. Declared in
`publicFunctionSurface` as a `query` with gate `operator`, which is what makes adding it an
architectural change rather than a line edit.

It lives in `operations` and not in `quality` for the same reason
`productAnalyticsFunctions.ts` lives in `operations` and not in `analytics`: the gate lives
here. `requireOperator` reads the deployment's operator registry, and `quality` is a pure
module in `canonWriteBoundary.forbiddenModules` — it must not be able to reach the
console's authorization any more than it can reach a Canon write. The evaluator computes,
this file reads evidence rows and applies the gate, and neither knows the other's tables.

**Capability: `world.inspect`.** Reused rather than minted, for the reason ART-47 and
ART-133 reused `schedule.inspect`: a capability is a decision about the operator role
model, and this file reports numbers. It is `world.inspect` because that is what the
FR-K002 proposal review already uses for the same class of evidence, accepted history and
its validation. The gate exists even though the payload is ids and counts, because
「這個世界昨天有幾個 Canon 衝突」 should not be readable by an anonymous caller enumerating
world ids, and a finding names accepted event ids a public reader has no other route to.

### 4.1 Arguments and window bounds

| Argument | Meaning |
| --- | --- |
| operator credentials | `credentialArgs` from `opsConsoleFunctions.ts` |
| `worldId` | Required |
| `toWorldDay` | Optional, inclusive. Defaults to the world's latest accepted day |
| `windowDays` | Optional. Defaults to `DEFAULT_WINDOW_DAYS` (7), clamped to `[1, MAX_WINDOW_DAYS]` (31) |

`fromWorldDay` is `max(0, toWorldDay - windowDays + 1)`.

### 4.2 What is read, and from which index

Everything is index-scoped to the world and to the window.

- The fold origin is **one point read** — `canonSnapshots.by_world_day_and_kind` for the
  `daily` snapshot of the day before the window, else the `initial` snapshot, else genesis
  — so the read does not grow with the world's age. When the window does not start at day
  0 and no `daily` snapshot precedes it, days before the window are folded through the base
  from `canonEvents.by_world_and_day`, bounded by the same limit.
- The window's accepted events come from `canonEvents.by_world_and_day`, and the latest day
  from `canonEvents.by_world_and_sequence`.
- One point read per day with events, for its `daily` snapshot and for its publications:
  `dailyEpisodes`, `episodeRecapFormats` and `episodeShareFormats`, each on
  `by_world_and_day`.
- `worldSecrets.by_world_id` and the seed tables behind `readCanonRuleContext` are
  seed-sized.

`SCAN_LIMIT` is 4,000 accepted events per report. Five slots a day times a handful of
scenes is well under this for the longest window. Reaching it means the world is busier
than the report's bound, and the report says so through `coverage.scanLimitReached` rather
than measuring a prefix and calling it the window. Truncation is never silent.

### 4.3 What the payload never contains

The return is `{ definition, report, origin }`. The definition is the evaluator's metric
and score definitions plus its finding codes with their severities. The report is metric
observations, the composite score, findings, coverage and the digest. The origin says
which kind of origin was chosen, its ref, and how many pre-window events were folded.

No episode prose, no recap text, no secret content, no private fact value, no prompt, and
no memory content appears anywhere in it — only ids, stable codes, counts and rates.

### 4.4 Nothing is persisted

The query writes no run row. There is therefore no run to deduplicate and no
evaluator-version migration to manage: the evidence is the durable record, and the report
is derived from it on every call. Exactly-once is a property of the evidence ids, and the
pure module counts by those ids.

## 5. The same evaluator inside the long-run harness

`runLongRunSimulation` calls `evaluateContinuityWindow` over the run's own evidence and
returns it as `LongRunFindings.continuity`. The origin is the seeded `initial_snapshot`,
the snapshots are the ones the real daily-snapshot stage persisted, and the publications
are the episodes and recap formats the editorial stages produced.

This is **not** a restatement of the harness's own `canonConflicts` and `replay` fields.
Those are the harness's independent checks; agreement between two independent computations
is the evidence, and disagreement is a finding. The 7-day test asserts that the count of
severe continuity findings equals the count of harness Canon conflicts.

Over the fixed 7-day seed the report is clean, and every denominator is non-empty:

| Quantity | Value |
| --- | --- |
| Accepted events (all four event-denominated metrics) | 104 |
| World days replay-consistent | 7 of 7 |
| Publications examined (7 episodes + 7 recap-format rows) | 14 |
| Unsourced secret leaks, severe conflicts, deceased appearances, location conflicts | 0 |
| Continuity Score | 1.0, `weightMeasured` 1.0 of `weightTotal` 1.0 |

See [`long-run-simulation-harness.md`](./long-run-simulation-harness.md).

## 6. How ART-88, ART-89 and ART-90 plug in

A new evaluator is a new file under `convex/quality/` and four decisions, none of which
require touching the pattern:

1. **Declare it.** Export an `EvaluatorDefinition` with an `evaluatorId`, a `version`, a
   `MetricDefinition` per metric carrying its PRD name, numerator, denominator, target and
   direction, an optional `CompositeScoreDefinition`, and a `findingCodes` record typed
   `satisfies Record<string, FindingSeverity>` so a code cannot exist without a severity.
2. **Observe.** Build every rate through `observeMetric(definition, numerator, denominator,
   excluded, excludedReason)`. Do not divide by hand; the `denominator > 0` branch in
   `observeRate` is the whole point of the module.
3. **Compose.** If the evaluator has a score, call `composeScore(definition, metrics)`.
   Weights need not sum to 1; `weightMeasured` and `weightTotal` are reported either way.
4. **Finish.** Return through `finishReport({ evaluatorId, evaluatorVersion, worldId,
   window, metrics, score, findings, coverage })`, which stamps `schemaVersion` and the
   digest. Run findings through `dedupeFindings` first.

Then add one read surface and one harness field: a query in `convex/operations/` gated on
an existing capability and declared in `publicFunctionSurface`, and a field on
`LongRunFindings` beside `continuity`. `EvidenceKind` already carries the kinds the other
three need — `scene`, `arc`, `coverage_report`, `safety_classification`, `world_day_run` —
so their findings reference evidence in the same vocabulary.

## 7. Verification

- `convex/quality/evaluator.test.ts` pins the shared contract (zero denominator ⇒
  `no_observations`, never `0%`; score renormalisation; finding dedupe; digest stability).
- `convex/quality/continuity.test.ts` drives every finding code from hand-built accepted events
  over the seeded Mistwood baseline — clean day, empty window, deceased appearance and its revival
  exception, location conflict and double movement, severe versus minor Canon conflict, sequence
  gap and duplicate key, snapshot match / hash mismatch / sequence mismatch, unsourced leak and its
  sourced exception, window chaining, digest determinism — and asserts the secret text never
  appears in a report.
- `convex/operations/longRunHarness.test.ts` asserts the whole report over the fixed 7-day
  and 30-day seeds: evaluator id and version, window, coverage, every metric's numerator
  *and* denominator, the score, and agreement with the harness's independent checks.
- `convex/publicRead/publicReadOnlyGuarantee.test.ts` pins `getContinuityQualityMetrics` in
  `publicFunctionSurface`; declared must equal found, exhaustively.
- `npm run check:architecture` fails the build if `convex/quality` names a Canon write
  symbol, or if any module reaches `quality` without declaring it.

```bash
npm run check
npm test -- --runTestsByPath convex/quality/evaluator.test.ts convex/quality/continuity.test.ts
npm test -- --runTestsByPath convex/operations/longRunHarness.test.ts
npm run test:longrun   # the 30-day gate, ART60_LONG_RUN=1
```
