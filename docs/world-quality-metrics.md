# World quality metrics and evaluators (FR-M002)

FR-M002 is owned by four tasks, not one. Three have delivered:

- **ART-58** delivers the **evaluator pattern** every FR-M002 evaluator is built from
  (`convex/quality/evaluator.ts`), and the **Continuity evaluator v1**
  (`convex/quality/continuity.ts`), which measures PRD §16.2's five Canon targets and
  composes them into the Continuity Score.
- **ART-88** delivers the **Narrative evaluator v1** (`convex/quality/narrative.ts`) and
  the similarity module it is built on (`convex/quality/textSimilarity.ts`), which measure
  §16.2's 重複場景比例 plus FR-M002's Character Consistency, Event Novelty and Dialogue
  Repetition.
- **ART-89** delivers the **Story-quality evaluator v1** (`convex/quality/storyQuality.ts`)
  and the exclusion store it reads (`convex/recaps/coverageExclusions.ts`), which measure
  §16.2's 高重要度摘要覆蓋率 plus FR-M002's Arc Progress, Arc Stagnation, Arc Resolution and
  Spoiler Violation.

ART-90 (Canon rejection rate, safety withhold rate) is still pending and builds on the same
shapes, so an operator reads four evaluators through one vocabulary and the long-run harness
reports them through one report type.

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

## 4. The Narrative evaluator v1

`evaluatorId: 'narrative'`, `version: 1`. Pure, like the continuity one: no Convex, no
clock, no randomness, no I/O. One entry point, `evaluateNarrative`, takes one window of
accepted narrative evidence and returns the report. The operator query and the long-run
harness call that one function, so the number the 7- and 30-day gates assert and the number
an operator reads are one computation over different evidence.

### 4.1 The denominator, stated first

`repeated_scene_ratio` is measured over **accepted** scenes: scenes whose Proposed Events
reached Canon, joined to the accepted log through `metadata.sceneId`, which FR-P004 stamps
on every real proposal. The `<sceneId>:event:<n>` idempotency-key prefix is the fallback,
the same join the harness's safety check already uses. A scene's position in accepted order
is the lowest accepted sequence number among its events, so a repeat is charged to the later
scene and an original is never charged for being repeated.

A scene the safety gate withheld never reached an audience. It is left out of both sides of
every ratio, and published as `excluded` with the reason
「scenes withheld by safety review never reached an audience」 rather than folded in as a
pass or a failure. A scene that was authored but whose proposal Canon never accepted is out
for the same reason and is visible in the operator payload as `read` minus `accepted` minus
`withheld`.

ART-60's `repetition.duplicateRate` measured **every authored scene**, and nothing asserted
it. A ratio over a different population is a different number, so this one names its own
population in the metric definition that travels with every report.

### 4.2 The seven metrics

Every denominator is stated before its target, because a rate over an empty population is
not a passing rate.

| PRD name | Metric key | Numerator | Denominator | Target |
| --- | --- | --- | --- | --- |
| 重複場景比例 | `repeated_scene_ratio` | Accepted scenes whose normalised text is an exact **or** near duplicate (Jaccard ≥ 0.8 over identifier-masked character 3-grams) of an earlier accepted scene | Accepted scenes in the window | `0.15`, `atMost` |
| 重複場景比例（完全相同） | `exact_duplicate_scene_ratio` | Accepted scenes whose normalised text is identical to an earlier accepted scene's | Accepted scenes in the window | none, `atMost` |
| 重複場景結構 | `template_reuse_ratio` | Accepted scenes whose structural signature (quoted spans, numbers and identifiers collapsed) matches an earlier accepted scene's | Accepted scenes in the window | none, `atMost` |
| Dialogue Repetition | `dialogue_repetition_ratio` | Dialogue lines that exactly or nearly repeat an earlier line in the window | Dialogue lines in accepted scenes | none, `atMost` |
| Character Consistency（聲音） | `voice_distinctiveness` | Dialogue lines whose normalised text is spoken by exactly one character in the window | Dialogue lines in accepted scenes | none, `atLeast` |
| Character Consistency（人設） | `persona_deviation_rate` | Accepted events carrying at least one FR-B003 persona deviation flag | Accepted events with at least one participant who has a persona anchor | none, `atMost` |
| Event Novelty | `event_novelty_ratio` | Accepted events whose public summary is below `0.6` Jaccard to **every** one of the previous 30 accepted summaries | Accepted events with a public summary, after the first | none, `atLeast` |

Only 重複場景比例 carries a number, because §16.2 is the only place the PRD states one.
FR-M002 names the other three dimensions and sets no threshold, so the report publishes the
rate with its denominator and refuses to invent one. The floors and ceilings in
`longRunHarness.test.ts` — dialogue repetition under 15%, voice above 0.85, novelty above
0.5 — are regression pins on the fixed seed, not PRD targets, and are labelled as such.

A world with no persona anchors reports `persona_deviation_rate` as `no_observations` with
the reason 「the world carries no persona anchors」, and its half of the composite drops out
of the score's measured weight rather than scoring a perfect zero.

### 4.3 Exact, near and template are three different things

- **Exact duplicate.** The normalised scene text — summary, key actions, dialogue lines and
  Proposed Event public summaries, joined, identifiers masked — is identical to an earlier
  accepted scene's. This is what ART-60's content digest already caught.
- **Near duplicate.** Character 3-gram Jaccard against some earlier accepted scene is at
  least `NEAR_DUPLICATE_SIMILARITY`. This is the case a digest cannot see and a reader can:
  two fills of one template that differ in a single slot are the same scene to a reader and
  two distinct digests to a hash.
- **Template reuse.** The structural signature — the normalised text with every quoted span
  「…」, every number and every identifier collapsed — matches an earlier scene's. A template
  with more slots is a larger output space and is still a template.

**The §16.2 ratio counts exact OR near.** Template reuse is reported beside it with no PRD
target, deliberately: an author can lower the headline ratio by widening its slots, and
`template_reuse_ratio` is what still says the scenes came from one mould when the other two
metrics are clean. Folding it into the headline would let a wider template read as
originality; leaving it out entirely would hide the thing the fixture is most guilty of.

### 4.4 The thresholds are properties of the measure, not of the fixture

| Constant | Value | What it is |
| --- | --- | --- |
| `NEAR_DUPLICATE_SIMILARITY` | `0.8` | The point at which two zh-Hant sentences of this length share most of their 3-grams, i.e. where a reader stops seeing two sentences |
| `NOVELTY_LOOKBACK_EVENTS` | `30` | How many earlier accepted events an event's summary is compared against. Novelty is about recent memory: restating something from six days ago is not the failure the metric is after |
| `NOVEL_EVENT_MAX_SIMILARITY` | `0.6` | Below this against every event in the lookback, an event says something new. Looser than the duplicate threshold on purpose — a summary may legitimately share vocabulary with its neighbours and still carry new information |

None of the three was tuned until the fixed seed passed. They are versioned with
`NARRATIVE_EVALUATOR_VERSION`, and changing one changes what the metric means, so it must
bump the version. The harness test pins the ratio against an **absolute** denominator
(`ACCEPTED_SCENES`, 104 at seven days and 449 at thirty) rather than against whatever the
run produced, so the ratio cannot be improved by authoring fewer scenes.

### 4.5 Finding codes

| Code | Severity | Meaning |
| --- | --- | --- |
| `SCENE_EXACT_DUPLICATE` | severe | An accepted scene's normalised text is identical to an earlier accepted scene's |
| `SCENE_NEAR_DUPLICATE` | severe | An accepted scene is at or above the near-duplicate threshold against an earlier accepted scene |
| `SCENE_TEMPLATE_REUSED` | minor | An accepted scene was written from the same template as an earlier one |
| `DIALOGUE_REPEATED` | minor | A dialogue line repeats, exactly or nearly, an earlier line in the window |
| `VOICE_COLLAPSED` | severe | One normalised line is spoken by two or more different characters: the cast has one voice |
| `EVENT_NOT_NOVEL` | minor | An accepted event's public summary is a near-duplicate of one in the recent lookback |
| `PERSONA_DEVIATION_FLAGGED` | minor | Canon flagged a justified persona deviation on this accepted event. Reported, not judged |

A repeated scene and a collapsed voice are `severe` because both mean the audience is being
shown the same thing twice. Template reuse, a repeated line and a restated event are
`minor`: each is a degree of sameness rather than a duplicate. `PERSONA_DEVIATION_FLAGGED`
is `minor` because it reports a deviation Canon **accepted**; see the next section.

`VOICE_COLLAPSED` names its subject by the FNV-1a digest of the line, and its evidence refs
are the character ids that share it. The line itself never enters the report.

### 4.6 Character consistency is two components, honestly

| Component | Metric | Weight | Transform |
| --- | --- | --- | --- |
| `voice` | `voice_distinctiveness` | 0.5 | `rate` |
| `persona` | `persona_deviation_rate` | 0.5 | `complement` |

The composite is `character_consistency`, built by the same `composeScore` the Continuity
Score uses, so a component with no observations drops its weight instead of contributing a
zero.

The honest reading of the persona half: FR-B003's gate (`assessPersonaDeviations`) is
**structural**. It sees occupation, membership and relationship reversals, never voice, and
it **refuses** an unjustified reversal at the Canon boundary. Accepted history therefore
carries only *flagged, justified* deviations, and `persona_deviation_rate` measures how
often one of those was admitted — not how often a character acted out of character, because
that population cannot exist in accepted history. Reading it as the latter would credit the
author for a gate's work.

`voice_distinctiveness` is the half the gate cannot see. A cast that all speak one sentence
scores zero here whatever the projection says about their occupations, which is exactly the
failure the human review recorded as F-01 before ART-88.

### 4.7 Identifier masking, and why

Every comparison runs over text with the world's identifiers masked to a single token:
character ids, location ids, arc ids and the world id, longest first so `mistwood-hall-annex`
is masked before `mistwood-hall`, plus every run of digits. The id lists come from the
world's own rows, so masking is exact rather than a regex guess at what looks like an id.

Identifiers are unique by construction. Left in, they make two scenes at different places
trivially distinct, and the §16.2 ratio would read zero for an author emitting one sentence
with the names swapped — the same reason ART-60's digest excluded them. Masking rather than
deleting keeps the sentence's shape, so a name-shaped hole still separates two grams that
were never adjacent. `narrative.test.ts` asserts both directions: a repeat that masking
catches and an unmasked run misses, and a false near-duplicate that two scenes sharing a
long cast list produce when the ids are left in.

### 4.8 Text similarity

`convex/quality/textSimilarity.ts` is the measure, and it holds no thresholds: it returns
numbers, and what counts as "near" is a metric definition versioned with the evaluator that
owns it. It is pure and carries no node builtin, so the same code runs inside a Convex query
and inside the harness.

- **Normalisation** (`normalizeNarrative`). Identifiers and digits masked, whitespace and
  punctuation dropped. Deterministic and idempotent. Two sentences that differ only in a
  comma are one sentence.
- **Character 3-gram shingles** (`shingles`) and **Jaccard** (`jaccard`). Character n-grams
  because the prose is zh-Hant, where words are not whitespace-delimited; three is the
  smallest window at which two unrelated sentences stop sharing most of their grams. The
  shingles are a set, windowed over code points rather than UTF-16 units. Two empty sets are
  identical; one empty set is disjoint.
- **Structural signature** (`structuralSignature`). The masked text with every 「…」 and
  every `"…"` span collapsed, hashed to a 16-hex-digit grouping key. What remains is the
  template.
- **`nearestEarlier`** returns, for each text, the most similar **earlier** text at or above
  a threshold, ties broken toward the earliest index. Earlier means lower index, and the
  caller orders by accepted sequence, which is what charges a repeat to the copy.

The last one is the reason a 30-day window is tractable. A naive scan is quadratic in the
number of dialogue lines, and thirty days produce thousands. `nearestEarlier` builds an
inverted index from gram to the earlier texts containing it, and only scores candidates
sharing at least `ceil(s·a / (1 + s))` grams with the current text of size `a`. That bound
is derived, not tuned: `shared / (a + b - shared) ≥ s` with `shared ≤ min(a, b)` implies
`shared ≥ s·a / (1 + s)`, so a candidate below it **cannot** reach the threshold and
skipping it changes no answer. A test drives a pair just above the threshold to prove the
pruning does not drop it.

## 5. The Story-quality evaluator v1

`evaluatorId: 'story_quality'`, `version: 1`. Pure, like the other two: no Convex, no clock,
no randomness, no I/O. One entry point, `evaluateStoryQuality`, takes one window of arc,
recap and publication evidence and returns the report. The operator query and the long-run
harness call that one function, so the number the 7-day gate asserts and the number an
operator reads are one computation over different evidence.

### 5.1 The five metrics

Every denominator is stated before its target, because a rate over an empty population is
not a passing rate.

| PRD name | Metric key | Numerator | Denominator | Target |
| --- | --- | --- | --- | --- |
| 高重要度摘要覆蓋率 | `recap_coverage` | High-importance accepted events cited by at least one **releasable** published content in the window | High-importance accepted events in the window, less those excluded with a reason and those on a day whose published content is not due yet | `0.95`, `atLeast` |
| Spoiler Violation | `spoiler_violation_rate` | Published contents whose persisted FR-G004 verdict carries a spoiler-category finding | Published contents with a persisted coverage verdict in the window | `0`, `atMost` |
| Arc Progress | `arc_progress_rate` | Active-family arcs that appended at least one projection revision inside the window | Active-family arcs alive during the window | none, `atLeast` |
| Arc Stagnation | `arc_stagnation_rate` | Active-family arcs whose last progress is at least the stagnation threshold before the window end | Active-family arcs alive during the window | `0`, `atMost` |
| Arc Resolution | `arc_resolution_evidence` | Arcs reaching a terminal status carrying **both** an outcome and at least one consequence | Arcs reaching a terminal status in the window | `1`, `atLeast` |

Only 高重要度摘要覆蓋率 carries a PRD number, because §16.2 is the only place the PRD states
one. Spoiler Violation and Arc Stagnation are zero-targets because a spoiler that reached an
audience and an arc that stopped moving are both failures at any rate above nothing. Arc
Progress publishes its rate and refuses to invent a floor: FR-M002 names the dimension and
sets no threshold.

High importance is `HIGH_IMPORTANCE_THRESHOLD` (0.7), imported from
`convex/editorial/episode.ts` — the same constant the Episode builder and the FR-G004 gate
use. A metric measuring coverage against a different threshold from the one the composer
obeys would disagree with it for every event between the two numbers.

### 5.2 The denominator is Canon, never the episodes

`recap_coverage`'s denominator is the high-importance **accepted events** of the window,
read from `canonEvents` by index and classified through `storyArcEventClassifications`. It
is not the events the episodes happen to cite.

This matters here more than anywhere else in the repository. `buildDailyEpisode` **throws**
`EPISODE_IMPORTANT_EVENT_MISSING` when an Episode omits a high-importance event, so an
Episode that would have failed coverage never gets stored at all. A coverage ratio computed
over stored episodes therefore reads 100% by construction and could not fail — precisely the
tautology CLAUDE.md §9 warns about, and precisely the shape of the defect described in §5.4
below. Reading Canon independently is what makes the days that produced no publishable
episode — withheld, failed, gate-refused — count as uncovered, which is the whole signal
§16.2 is asking for.

### 5.3 What counts as covered, and the three ways an event leaves the denominator

A high-importance accepted event is covered when a **releasable** published content in the
window cites it. Releasable is the persisted FR-G004 verdict
(`episodeCoverageReports.releasable`), so an Episode the coverage gate refused covers
nothing — it never reached an audience. The cited set is the verdict's own
`coveredEventIds`, which is the set of high-importance events the candidate actually
accounted for, not everything it happened to mention.

An event leaves the denominator in exactly three ways.

1. **Excluded with a reason.** A declared exclusion carrying non-blank text removes the
   event from both sides, and the **count** travels with the report through
   `MetricObservation.excluded` and `excludedReason`. §16.2 says 「covered **or** carries an
   explicit reviewable exclusion reason」, and a metric that folded exclusions into the
   numerator would report a world that excluded everything as fully covered. The operator's
   own words are **not** in the report — `excludedReason` is a fixed-vocabulary sentence
   naming how many were excluded and why they left, and the text itself is read from
   `coverageExclusions` by whoever is reviewing the omission. Findings carry references,
   never content, and an operator-authored string is content.
2. **On a day that is not due yet.** `pendingWorldDays` names the newest world day, whose
   Episode is composed on the next day's first commit (§5.4). Its events are excluded with
   a reason rather than counted as uncovered: an observation that cannot yet answer the
   question is not an observation that answered it badly. It is ART-47's rule for a
   retention cohort that has not aged far enough. A world that stops forever leaves its last
   day excluded permanently, and the excluded count says so.
3. **Nothing else.** An exclusion whose reason is blank does **not** leave the denominator.
   It stays in, and `EXCLUSION_WITHOUT_REASON` is reported against it, because §16.2 asks
   for a reviewable reason and a blank one is not one.

A day carrying accepted events and no releasable published content is named as
`WORLD_DAY_UNPUBLISHED` rather than left to be inferred from a rate. That day is where
uncovered events come from, and the finding carries every publication that was attempted
with the code that stopped it.

### 5.4 A world day is over when the world has moved past it

The defect ART-89 found is the reason this section exists, and it is worth stating plainly
because the old rule read as reasonable.

A world day used to be treated as **complete** the moment one accepted event carried the
final time slot. The post-commit pipeline runs once per accepted event, so the *first* event
of a day's final slot marked the day complete, the episode stage assembled that day's
Episode from the events accepted so far, and Episodes are idempotent per world day — so the
rest of that slot reached no Episode, no recap and no publication. For every day of every
world.

Nothing failed. The FR-G004 coverage gate obliges an Episode to cite the events of its own
day **as the Episode saw them**, so an Episode built from a partial day passed its own
check. This is the same tautology §5.2 is built to avoid, one layer down.

Measured over the fixed 7-day seed, the cost was 14 of 96 high-importance Accepted Events
permanently uncovered, and §16.2's coverage clause sitting at 85.4%.

`completedWorldDaysOf` in `convex/operations/postCommitLiveFunctions.ts` now admits a day
only when `day < latestWorldDay`. That is the only rule Canon can state honestly: a world
day is finished when a later day has accepted an event, and until then the day may still
commit more. The cost is that the newest day's Episode is due on the next day's first commit
rather than on its own last slot, which is what a daily recap means anyway. In production the
next cron tick composes it.

**The daily snapshot keeps the old condition, under its own name.**
`PostCommitWorldState.latestWorldDayFinalSlotStarted` is the snapshot stage's flag, and it is
deliberately not the episode stage's. `createDailySnapshot` refuses a past day once later
events exist, so a snapshot may only be taken while its day is still the latest — the final
slot is the last moment at which that day can be both complete and current. An Episode has
the opposite requirement: it must wait until the day cannot gain another event, which is only
knowable once the world has moved past it. Two stages were asking different questions through
one flag, and stage 20 of `convex/operations/postCommitLive.ts` now reads its own.

### 5.5 Which stagnation threshold, and why

`ARC_STAGNATION_WORLD_DAYS` (14, from `convex/story/resolution.ts`) — the constant
`detectArcStagnation` uses and the one the harness reports. The post-commit ladder carries
its own downgrade and wind-down constants for remediation; those decide *what to do about* a
stagnant arc, not *whether it is* stagnant, and a metric measured against them would disagree
with the detector for every arc between the two numbers. See
[`arc-stagnation-resolution.md`](./arc-stagnation-resolution.md).

An arc is in the active family when `isActiveArcStatus` says so — emerging through climax.
Terminal means `resolved` or `archived`, and the resolution evidence is read from the arc's
last `storyArcResolutionDecisions` row whose `resultingStatus` is terminal, never from the
lifecycle alone: ART-163 records that arcs once reached `resolved` carrying nothing at all.

### 5.6 Finding codes

| Code | Severity | Meaning |
| --- | --- | --- |
| `HIGH_IMPORTANCE_EVENT_UNCOVERED` | severe | A high-importance accepted event no releasable published content cites, and no exclusion covers |
| `EXCLUSION_WITHOUT_REASON` | severe | A declared exclusion whose reason is blank: an omission without a reviewable justification |
| `SPOILER_VIOLATION` | severe | A published content whose persisted FR-G004 verdict carries a spoiler-category finding |
| `WORLD_DAY_UNPUBLISHED` | minor | A world day that produced accepted events but no releasable published content at all |
| `ARC_STAGNANT` | severe | An active arc that has not advanced a projection revision for the stagnation threshold |
| `ARC_WITHOUT_PROGRESS` | minor | An active arc that advanced no revision inside the window |
| `ARC_RESOLVED_WITHOUT_EVIDENCE` | severe | An arc that reached a terminal status carrying no outcome or no consequence |

The severities split on whether the audience or the record is already wrong. An uncovered
event, a blank exclusion reason, a released spoiler, a stalled arc and a verdictless
resolution are each a thing that has already happened to the public account. An unpublished
day and an arc quiet for one window are states that may still be resolved on the next commit,
so they are `minor` and are reported as context for the rates rather than as failures.

Findings carry event ids, arc ids, content refs and finding codes. Recap prose, secret text
and private knowledge never enter: the spoiler metric reads the persisted verdict's **codes**,
not the text that produced them.

### 5.7 The Story Health composite

`composeScore` builds one weighted composite, `story_health`.

| Component | Metric | Weight | Transform |
| --- | --- | --- | --- |
| `coverage` | `recap_coverage` | 0.40 | `rate` |
| `spoiler_safety` | `spoiler_violation_rate` | 0.30 | `complement` |
| `arc_progress` | `arc_progress_rate` | 0.20 | `rate` |
| `arc_pacing` | `arc_stagnation_rate` | 0.10 | `complement` |

Coverage and spoiler safety carry 70% of the weight between them because they are the two
components about what the audience was actually shown; the arc pair is about the story's
pacing, which is a slower and more forgiving signal. `arc_resolution_evidence` is reported
and **not** in the composite: it is a correctness gate on a small, bursty population — some
windows close no arc at all — and averaging it into a health score would let a window that
resolved nothing look the same as one that resolved everything properly.

A component whose metric had no observations contributes nothing and reports
`no_observations`, and `weightMeasured` against `weightTotal` says how much of the definition
the score was built from, exactly as with the Continuity Score.

## 6. The operator queries

All three live in `convex/operations/worldQualityFunctions.ts`, declared in
`publicFunctionSurface` with gate `operator`, which is what makes adding any of them an
architectural change rather than a line edit.

| Query | Evaluator | Delivered by |
| --- | --- | --- |
| `getContinuityQualityMetrics` | `convex/quality/continuity.ts` | ART-58 |
| `getNarrativeQualityMetrics` | `convex/quality/narrative.ts` | ART-88 |
| `getStoryQualityMetrics` | `convex/quality/storyQuality.ts` | ART-89 |

One **mutation** shares the file, `declareRecapExclusion` (ART-89, §6.5). It is the only
write in the FR-M002 surface, and it writes nothing an evaluator computes — it writes the
operator's words.

They live in `operations` and not in `quality` for the same reason
`productAnalyticsFunctions.ts` lives in `operations` and not in `analytics`: the gate lives
here. `requireOperator` reads the deployment's operator registry, and `quality` is a pure
module in `canonWriteBoundary.forbiddenModules` — it must not be able to reach the
console's authorization any more than it can reach a Canon write. The evaluator computes,
this file reads evidence rows and applies the gate, and neither knows the other's tables.

**Capability: `world.inspect`, for all three queries.** Reused rather than minted, for the reason ART-47
and ART-133 reused `schedule.inspect`: a capability is a decision about the operator role
model, and this file reports numbers. It is `world.inspect` because that is what the
FR-K002 proposal review already uses for the same class of evidence, accepted history and
its validation. The gate exists even though the payload is ids and counts, because
「這個世界昨天有幾個 Canon 衝突」 should not be readable by an anonymous caller enumerating
world ids, and a finding names accepted event ids a public reader has no other route to.
The narrative query needs the gate for a second reason: it reads a world's scene prose to
compute its numbers, and however little of that prose reaches the payload, the read itself
belongs behind the console.

### 6.1 Arguments and window bounds

All three queries take the same four arguments and derive the window the same way.

| Argument | Meaning |
| --- | --- |
| operator credentials | `credentialArgs` from `opsConsoleFunctions.ts` |
| `worldId` | Required |
| `toWorldDay` | Optional, inclusive. Defaults to the world's latest accepted day |
| `windowDays` | Optional. Defaults to `DEFAULT_WINDOW_DAYS` (7), clamped to `[1, MAX_WINDOW_DAYS]` (31) |

`fromWorldDay` is `max(0, toWorldDay - windowDays + 1)`.

### 6.2 What `getContinuityQualityMetrics` reads, and from which index

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

### 6.3 What `getNarrativeQualityMetrics` reads, and from which index

Scene prose lives only in `sceneSimulationRuns.result`, a `v.any()` LLM-blob table. CLAUDE.md
§9 forbids `.collect()`ing a whole world on that kind of table, so the read is index-scoped
to the slot: `sceneSimulationRuns.by_grouping_run` for each `(worldDay, timeSlot)` in the
window, where the grouping run id is derived from the slot. That is `days × 5` point-range
reads, never a world-wide sweep, and it is bounded by the same window as the event scan.

- The window's accepted events come from `canonEvents.by_world_and_day`, and the latest day
  from `canonEvents.by_world_and_sequence`. They supply the scene join, the persona fold and
  the novelty denominator.
- `worldCharacters`, `worldLocations` and `storyArcLifecycles` are read by world index. They
  are seed-sized, and they supply both the identifier list to mask and the persona anchors
  (`personaAnchorFromSeed`, the same reader the commit path uses).
- The fold origin for the persona half is the **same** `resolveFoldOrigin` the continuity
  query uses, so the two evaluators agree on where the window began rather than each
  deciding for itself.

`coverage.scanLimitReached` is set when either the event scan or the scene scan hits
`SCAN_LIMIT`. Truncation is never silent on either read.

### 6.4 What `getStoryQualityMetrics` reads, and from which index

Every read is index-scoped to the world and to the window, and every one is bounded by the
same `SCAN_LIMIT`.

- The window's accepted events come from `canonEvents.by_world_and_day`, and the latest day
  from `canonEvents.by_world_and_sequence`. Event ids are **derived** through
  `deriveEventId(worldId, sequenceNumber)` rather than read back from the rows, so the
  denominator's identity does not depend on a stored string.
- Importance comes from `storyArcEventClassifications.by_world`, folded to the highest
  membership importance per source sequence number. An event no arc classified has
  importance 0 and is not in the denominator.
- The coverage numerator and the whole spoiler denominator come from
  `episodeCoverageReports.by_world_and_day` — the **persisted** FR-G004 verdicts, not a
  re-run of the gate. A spoiler is counted from the verdict's finding codes whose category
  is `spoiler`.
- Exclusions come from `coverageExclusions.by_world_and_day` (§6.5).
- Arcs come from `storyArcLifecycles`, `storyArcProjectionEvents` and
  `storyArcResolutionDecisions`, each by world index. They are arc-sized, not event-sized.

`coverage.scanLimitReached` is set when **any** of those seven reads hits the limit.
Truncation is never silent.

The query returns `thresholds` — `{ highImportance, stagnationWorldDays }` — beside the
report, so an operator reading a rate can see the two constants it was measured under
without opening the source.

### 6.5 `declareRecapExclusion`, and why it reuses `safety.override`

§16.2 lets a high-importance event be either covered **or** carry an explicit, reviewable
exclusion reason. `declareRecapExclusion` is the writer for the second half; the storage is
the `coverageExclusions` table, and the rules live in the pure
`convex/recaps/coverageExclusions.ts`. See
[`recap-coverage-validation.md`](./recap-coverage-validation.md) for the rules themselves
and for what was missing before ART-89.

It is gated on **`safety.override`**, an existing capability, rather than a new one. Minting
a capability is a decision about the operator role model, and this repository reuses unless
the thing governed is genuinely different — the reasoning ART-47 and ART-58 used for
`schedule.inspect` and `world.inspect`. `safety.override` is the nearest fit on the merits:
both are an operator overruling an automated gate about what the public record contains, and
both are append-only ledgers rather than edits.

It is also the safe direction of reuse. `safety.override` is an `admin` capability — the
highest-consequence publication decision in the system — and declaring an exclusion is
strictly smaller than releasing content a classifier withheld. Reusing a *more* privileged
capability for a *less* consequential action cannot grant anyone a power they did not already
have. The reverse would.

Two properties are worth stating because they are what keep the metric honest:

- **The named event must be accepted.** The handler parses the sequence number out of the
  event id, point-reads `canonEvents.by_world_and_sequence`, then **re-derives** the id from
  the row and compares, so a malformed id cannot resolve to a real event by accident. An
  exclusion naming an event Canon never accepted would put the exclusion set outside the
  denominator it reduces.
- **It is not a Canon write.** The event stays accepted and stays in the world. Both
  outcomes — a fresh declaration and a deduplicated re-declaration — are written to the
  operator audit log with a distinct result code.

### 6.6 The payloads, and what they never contain

`getContinuityQualityMetrics` returns `{ definition, report, origin }`. The origin says
which kind of origin was chosen, its ref, and how many pre-window events were folded.

`getNarrativeQualityMetrics` returns `{ definition, report, scenes }`, where `scenes` is
`{ read, accepted, withheld }`. That triple exists so the denominator is checkable from
outside the evaluator: `accepted` must equal `repeated_scene_ratio`'s denominator, and
`read − accepted − withheld` is the scenes Canon never accepted. A ratio whose denominator
cannot be audited is a number an operator has to take on faith.

`getStoryQualityMetrics` returns `{ definition, report, thresholds }`, for the same reason:
`recap_coverage`'s denominator means nothing without the importance threshold it was
selected by, and `arc_stagnation_rate`'s numerator means nothing without the day gap it was
measured against.

In all three, the definition is the evaluator's metric and score definitions plus its finding
codes with their severities, and the report is metric observations, the composite score,
findings, coverage and the digest.

No episode prose, no scene text, no dialogue line, no recap text, no secret content, no
private fact value, no prompt and no memory content appears anywhere in any of them — only
ids, stable codes, counts and rates. `narrative.test.ts` drives a finding of every code and
asserts that not one word of the prose it was computed from appears in the report.

### 6.7 Nothing is persisted

No query writes a run row. There is therefore no run to deduplicate and no
evaluator-version migration to manage: the evidence is the durable record, and the report
is derived from it on every call. Exactly-once is a property of the evidence ids, and the
pure modules count by those ids.

`declareRecapExclusion` is not an exception to this. It persists an operator's *evidence* —
a reason for an omission — and no report and no rate. The next call to
`getStoryQualityMetrics` derives its numbers from that row like any other evidence.

## 7. The same evaluators inside the long-run harness

`runLongRunSimulation` calls `evaluateContinuityWindow`, `evaluateNarrative` and
`evaluateStoryQuality` over the run's own evidence and returns them as
`LongRunFindings.continuity`, `LongRunFindings.narrative` and
`LongRunFindings.storyQuality`. The continuity origin is the seeded `initial_snapshot`, the
snapshots are the ones the real daily-snapshot stage persisted, and the publications are the
episodes and recap formats the editorial stages produced. The narrative evidence is the
run's own authored scenes, joined to the accepted log by the same `metadata.sceneId` join
the operator query uses, with the run's withheld scenes marked withheld.

The story-quality evidence is the run's accepted log with the arc classifications it
recorded, the coverage verdicts `runEpisodeCoverageGate` persisted, and the arc lifecycles,
projections and resolution decisions the run produced. Two of its inputs are set
deliberately and are worth naming:

- **`exclusions: []`.** A deterministic run has no operator, so it declares no exclusions.
  Its coverage rate is the unassisted one, which is the honest baseline for §16.2 — a
  fixture that could excuse its own gaps would measure nothing.
- **`pendingWorldDays: [latestAcceptedWorldDay]`.** A run that stops mid-world leaves
  exactly one day whose Episode is not due yet (§5.4). Its events are excluded with a reason
  rather than counted as uncovered.

This is **not** a restatement of the harness's own `canonConflicts`, `replay`, `repetition`,
`arcs` and `recapCoverage` fields. Those are the harness's independent checks; agreement
between two independent computations is the evidence, and disagreement is a finding. The
7-day test asserts that the count of severe continuity findings equals the count of harness
Canon conflicts.

Over the fixed 7-day seed all three reports are clean, and every denominator is non-empty:

| Quantity | Value |
| --- | --- |
| Accepted events (all four event-denominated continuity metrics) | 104 |
| World days replay-consistent | 7 of 7 |
| Publications examined (6 episodes + 6 recap-format rows) | 12 |
| Unsourced secret leaks, severe conflicts, deceased appearances, location conflicts | 0 |
| Continuity Score | 1.0, `weightMeasured` 1.0 of `weightTotal` 1.0 |
| Accepted scenes (every scene-denominated narrative metric) | 104 |
| Repeated scenes (exact or near) | 0 of 104 |
| Exact duplicates, template reuse | 0, 0 |
| Repeated dialogue lines | 2 of 348 (0.6%) |
| Lines spoken by exactly one character | 348 of 348 |
| Accepted events carrying a persona deviation flag | 0 of 104 |
| Novel events | 81 of 103 (78.6%) |
| World days whose recap formats the composer refused | 0 |
| High-importance events covered (§16.2 高重要度摘要覆蓋率) | 81 of 81 (100%) |
| High-importance events excluded as not-yet-due | 15 |
| Published contents carrying a spoiler finding | 0 of 6 |
| Active arcs that advanced a revision (Arc Progress) | 3 of 3 |
| Active arcs past the 14-day stagnation threshold | 0 of 3 |
| Terminal arcs carrying an outcome and a consequence | 3 of 3 |
| Story Health | 1.0 |

Coverage is 81 of 81 rather than 81 of 96 because the seventh day's 15 high-importance
events are on the newest day, whose Episode is due on the next day's first commit. Before
ART-89's completion-rule fix (§5.4) the same seed measured **85.4%**: 14 of 96 events were
permanently uncovered, and nothing reported it.

**The publication count in that table said 14 before ART-89, and that was wrong.** Six days
publish, not seven, because the newest day's Episode is not due; the continuity evaluator's
publication denominator is `2 × (worldDays − 1)`. The replay row is still 7 of 7, and the
contrast is the point: a daily snapshot is taken for every day including the newest, because
`latestWorldDayFinalSlotStarted` is its condition and it may only fire while the day is
current (§5.4).

Over the 30-day seed the repeated-scene ratio is **0 of 449**, against the §16.2 ceiling of
15%; exact duplicates and template reuse are zero; event novelty is 309 of 448 (69%); and
no world day's recap formats were refused. Dialogue repetition stays under 15% and voice
distinctiveness above 0.85 on that seed, which is what the harness test pins rather than a
figure quoted here.

See [`long-run-simulation-harness.md`](./long-run-simulation-harness.md).

## 8. How ART-90 plugs in

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
`LongRunFindings` beside `continuity`, `narrative` and `storyQuality`. `EvidenceKind`
already carries the kinds ART-90 needs — `safety_classification`, `world_day_run` — so its
findings reference evidence in the same vocabulary. ART-88 and ART-89 are what show the
pattern holds beyond its first use: each added an evaluator, a query and a harness field,
and neither changed a line of `evaluator.ts`.

## 9. Verification

- `convex/quality/evaluator.test.ts` pins the shared contract (zero denominator ⇒
  `no_observations`, never `0%`; score renormalisation; finding dedupe; digest stability).
- `convex/quality/continuity.test.ts` drives every finding code from hand-built accepted events
  over the seeded Mistwood baseline — clean day, empty window, deceased appearance and its revival
  exception, location conflict and double movement, severe versus minor Canon conflict, sequence
  gap and duplicate key, snapshot match / hash mismatch / sequence mismatch, unsourced leak and its
  sourced exception, window chaining, digest determinism — and asserts the secret text never
  appears in a report.
- `convex/quality/textSimilarity.test.ts` pins the measure itself: masking to one token rather
  than deletion, longest identifier first, digits in either script, idempotence; shingles as a
  set windowed over code points; Jaccard's empty-set cases and its symmetry; a structural
  signature equal across two texts differing only inside 「…」, a number or an identifier, and
  unequal when a clause outside the slots differs; and, for `nearestEarlier`, that the first
  text is never charged, that the later of two identical texts is, that a tie breaks toward the
  earliest index, and that the inverted-index pruning does not drop a pair just above the
  threshold.
- `convex/quality/narrative.test.ts` drives every finding code from hand-built scenes: copies
  charged and the original spared; a near duplicate that a digest cannot see, reported as near
  and counted once; template reuse reported beside a clean ratio; the denominator excluding
  withheld and unaccepted scenes and reporting what it left out; a window of only withheld
  scenes measuring *nothing* rather than zero; a repeated line that does not collapse a voice
  and a shared line that does; the composite over voice alone when no anchors exist; persona
  flags read from the seed's own anchors rather than a literal; and the fault-injection pair
  that proves masking is load-bearing — a repeat masking catches and an unmasked run misses,
  and a false near-duplicate that appears when identifiers are left in.
- `convex/quality/storyQuality.test.ts` drives every finding code from hand-built evidence,
  and pins the four things the metric could otherwise get wrong quietly: a denominator read
  from Canon reporting 3 of 4 while the stored episodes are complete; a refused publication
  covering nothing and naming the day with the code that refused it; an exclusion honoured
  only when its reason is non-blank, with the blank case both reported *and* left in the
  denominator; and the pending day excluded rather than charged, then charged once its
  content is due. It also asserts the threshold is read as *at least*, that stagnation fires
  at exactly the threshold and not a day before, that a world with no active arc measures
  nothing rather than a perfect pace, that the composite's value is hand-computable from its
  four weights, and that neither the operator's exclusion reason nor any other prose reaches
  a report.
- `convex/recaps/coverageExclusions.test.ts` pins the exclusion rules: the trimmed reason and
  the declaring identity are what is stored; blank, short and over-long reasons are refused;
  the minimum is measured against trimmed text rather than padding; a re-declaration of the
  same reason is a no-op; and a *different* reason for an already-excluded event is refused
  with `COVERAGE_EXCLUSION_CONFLICT`, distinguishable by code from an invalid declaration.
- `convex/operations/postCommitWorldState.test.ts` pins the completion rule that §5.4
  describes: the latest day is never finished however far into it the world has got, it
  becomes finished exactly when a later day accepts an event, and `finalSlotStarted` still
  answers the snapshot's separate question over the same events.
- `convex/operations/longRunHarness.test.ts` asserts all three whole reports over the fixed
  7-day and 30-day seeds: evaluator id and version, window, coverage, every metric's
  numerator *and* denominator, the score, agreement with the harness's independent checks,
  and `recapCoverage.recapFormatFailures` empty. The coverage denominator is asserted
  non-empty *before* the rate, and `excluded` is asserted greater than zero with a reason
  mentioning the not-yet-due day, so a run that excluded everything could not read as a pass.
- `convex/publicRead/publicReadOnlyGuarantee.test.ts` pins `getContinuityQualityMetrics`,
  `getNarrativeQualityMetrics`, `getStoryQualityMetrics` and `declareRecapExclusion` in
  `publicFunctionSurface`; declared must equal found, exhaustively.
- `npm run check:architecture` fails the build if `convex/quality` names a Canon write
  symbol, or if any module reaches `quality` without declaring it.

```bash
npm run check
npm test -- --runTestsByPath convex/quality/evaluator.test.ts convex/quality/continuity.test.ts
npm test -- --runTestsByPath convex/quality/textSimilarity.test.ts convex/quality/narrative.test.ts
npm test -- --runTestsByPath convex/quality/storyQuality.test.ts convex/recaps/coverageExclusions.test.ts
npm test -- --runTestsByPath convex/operations/postCommitWorldState.test.ts
npm test -- --runTestsByPath convex/operations/longRunHarness.test.ts
npm run test:longrun   # the 30-day gate, ART60_LONG_RUN=1
```
