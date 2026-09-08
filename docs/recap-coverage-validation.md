# Recap coverage and spoiler validation

`convex/recaps/coverageValidation.ts` implements FR-G004. It is a pre-release
gate: given the Accepted Events of a world day and the recap or Episode
candidate that is about to become public, it reports every coverage gap and
every spoiler violation before the content is released.

The module is pure — no Convex imports, no clock, no randomness. It reads a
derived view of Accepted Events and never writes Canon.

## Inputs

A `CoverageSourceEvent` is the derived view of one Accepted Event: its world
day, its highest Story Arc membership importance, the arcs for which it is the
turning point, its relationship movements (with visibility and magnitude), and
its public and private fact IDs. The wiring layer builds it from `canonEvents`
plus `storyArcEventClassifications`, exactly as `EpisodeSourceEvent` is built.

A `CoverageCandidate` is the content about to go public: the events it cites,
the relationship changes and facts it mentions, the events it deliberately
excludes (each with a reason), its full public text, the world day it releases,
and the first world day of the window it is obliged to cover
(`coverageFromWorldDay`, equal to `worldDay` for a daily Episode).

## What the gate detects

| Finding | Meaning |
| --- | --- |
| `COVERAGE_HIGH_IMPORTANCE_OMITTED` | An Accepted Event whose Story Arc importance reaches `HIGH_IMPORTANCE_THRESHOLD` (0.7) is neither cited nor explicitly excluded (AC#1). |
| `COVERAGE_EXCLUSION_UNJUSTIFIED` | A high-importance event is excluded without a reason; an exclusion must be explicit (AC#1). |
| `COVERAGE_RELATIONSHIP_CHANGE_OMITTED` | A public relationship movement of at least `MAJOR_RELATIONSHIP_DELTA` (20 on the canon −100..100 scale, measured as the largest absolute single-dimension delta) is not mentioned (AC#2). |
| `COVERAGE_TURNING_POINT_OMITTED` | An event that is the turning point of a Story Arc is not mentioned (AC#3). |
| `COVERAGE_SOURCE_NOT_ACCEPTED` | The candidate cites something that resolves to no Accepted Event. |
| `SPOILER_FUTURE_EVENT` | The candidate reveals an event, relationship change, or fact belonging to a world day after the day being released (AC#4). |
| `SPOILER_PRIVATE_RELATIONSHIP` | The candidate reveals a relationship movement that Canon marks private (AC#4). |
| `SPOILER_PRIVATE_FACT` | The candidate reveals a fact that is not a released public fact (AC#4). |
| `SPOILER_UNRELEASED_SECRET` | The candidate's public text contains unreleased world-secret content (AC#4). |

Events before `coverageFromWorldDay` are prior context: citable, never required.
A private relationship movement is never required to be mentioned — mentioning
one is a spoiler violation, not coverage.

`COVERAGE_EXCLUSION_UNJUSTIFIED` was unreachable from ART-35 until ART-89, for
the reason given under `declaredExclusions` below.

`validateRecapCoverage` returns a `CoverageReport` and never throws on a
violation, so the same result can both gate release and feed the FR-M002
`Recap Coverage` and `Spoiler Violation` world-quality metrics. Only malformed
input throws. `assertRecapCoverage` is the hard-gate wrapper: it throws
`RecapCoverageError` carrying every finding when the candidate is not
releasable.

## Editorial wiring

`convex/recaps/coverageValidationFunctions.ts` provides three functions.

- `getEpisodeCoverageReport` — an internal query returning the report for a
  stored daily Episode. Side-effect free.
- `runEpisodeCoverageGate` — the gate the live publication path actually calls,
  an internal mutation, wired into stage 19 of
  `convex/operations/postCommitLive.ts`.
- `getPersistedCoverageReport` — an internal query returning a day's stored
  verdict: releasable, its finding codes, and the error code if the gate could
  not run.

**This document previously described `validateEpisodeCoverageGate` as the gate
the editorial publication path calls. That claim was wrong by the time it was
read.** ART-164 replaced it with `runEpisodeCoverageGate` because the live path
needs a gate that behaves differently in two ways, and ART-89 deleted the old
function once nothing called it.

- **It returns its verdict instead of throwing.** The post-commit publication
  stage is not failure-isolated, so a throw inside it aborts everything after
  it, including `rebuildLiveProjection` and `rebuildOnboardingSummary`. A
  coverage refusal would therefore have stopped a **safety withhold** from
  reaching the public surface. Refusing to publish must never be the reason
  unsafe content stays up.
- **It performs no publication transition.** The removed gate decided *and*
  advanced `generated` → `validated`, which gave the pipeline two owners of the
  publication lifecycle, one of which advanced a record as a side effect of
  being asked a question. `runEpisodeCoverageGate` only answers; the publication
  stage, which already performs every other transition, performs `validate`
  itself when the answer is yes.

The verdict is persisted to `episodeCoverageReports` on **both** outcomes, keyed
on the content ref so a re-run of the same day's pipeline reaches the same
verdict without appending a second report. A gate that recorded only its
refusals would make 「this episode was checked and passed」 indistinguishable
from 「the gate never ran」. When the gate could not run at all — a malformed
candidate, a missing Episode — that is recorded as a refusal carrying
`errorCode`, because 「we could not check」 and 「we checked and it was fine」 must
never look the same to whatever reads the row next.

That table is why the FR-M002 metrics can be honest about a day that never
published: `getStoryQualityMetrics` counts an event as covered only when a
publication whose **persisted** `releasable` is true cites it. See
[`world-quality-metrics.md`](./world-quality-metrics.md) §5.

The gate performs zero Canon writes. Its only writes are the coverage report row
and, in the publication stage, the publication-record patch, which governs the
visibility of derived content and never edits, deletes, or supersedes an
accepted Canon Event.

## `declaredExclusions` now has storage and a writer (ART-89)

§16.2 reads 「至少 95% 的高重要度 Accepted Event 由已發布 recap 覆蓋，**或帶有明確、可審查的排除理由**」.

ART-35 shipped the first half of that machinery and none of the second. The
type (`CoverageExclusion`), the candidate field (`declaredExclusions`) and the
check (`COVERAGE_EXCLUSION_UNJUSTIFIED`) all existed — and every caller in the
repository passed `declaredExclusions: []`. So the check was **unreachable**,
and the clause's exclusion half was satisfied by nothing at all. A candidate
could not carry an exclusion because there was nowhere for an exclusion to come
from.

`convex/recaps/coverageExclusions.ts` and the `coverageExclusions` table are that
storage; `declareRecapExclusion` in
`convex/operations/worldQualityFunctions.ts` is that writer. It is gated on the
existing `safety.override` capability rather than a new one; the argument is in
[`world-quality-metrics.md`](./world-quality-metrics.md) §6.5.

### The rules, and why each is a refusal rather than a normalisation

- **A reason is required, non-blank, and between `MIN_EXCLUSION_REASON_LENGTH`
  (8) and `MAX_EXCLUSION_REASON_LENGTH` (500) characters after trimming.** The
  clause's whole content is 「明確、可審查」; an exclusion without a reason is an
  omission with a note attached. It is refused with
  `COVERAGE_EXCLUSION_INVALID` at declaration rather than stored and reported
  later, because a stored blank would already have removed the event from the
  coverage denominator by the time anyone read it. The length is measured
  against the trimmed text, so padding cannot buy a minimum.
- **The event must be accepted.** An exclusion naming an event Canon never
  accepted excuses nothing, and refusing it
  (`COVERAGE_EXCLUSION_SOURCE_NOT_ACCEPTED`) keeps the exclusion set a subset of
  the denominator it reduces.
- **Append-only, one row per `(worldId, eventId)`.** Re-declaring the same
  reason is a no-op that returns the stored row, so a retried operator action
  cannot create a second reason for one omission. A **different** reason for an
  already-excluded event is refused with `COVERAGE_EXCLUSION_CONFLICT`: the
  record of why something was left out of the public account must not be
  editable in place, for the same reason accepted Canon is not. A second
  declaration is a new decision, and belongs to whatever process supersedes the
  first.

An exclusion never touches Canon. The event stays accepted, stays in Canon and
stays in the world; the row records only that a named operator said, in words,
why it is not in a recap. The evaluator reports the excluded **count** beside the
coverage rate rather than folding exclusions into the numerator, because a world
that excluded everything must not report full coverage.

Run focused verification with:

```bash
npm test -- --runTestsByPath convex/recaps/coverageValidation.test.ts
npm test -- --runTestsByPath convex/recaps/coverageExclusions.test.ts
```

The first suite covers the clean pass path, each acceptance criterion's failure
path, valid explicit exclusions, unjustified exclusions, minor and private
relationship changes that carry no coverage obligation, all four spoiler
classes, report determinism, and malformed input rejection. The second covers
the exclusion rules above: the trimmed reason and the declaring identity as
stored, blank and out-of-range reasons refused, world day `0` accepted, the
same-reason no-op, and the different-reason conflict distinguished from an
invalid declaration by code alone.
