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

`validateRecapCoverage` returns a `CoverageReport` and never throws on a
violation, so the same result can both gate release and feed the FR-M002
`Recap Coverage` and `Spoiler Violation` world-quality metrics. Only malformed
input throws. `assertRecapCoverage` is the hard-gate wrapper: it throws
`RecapCoverageError` carrying every finding when the candidate is not
releasable.

## Editorial wiring

`convex/recaps/coverageValidationFunctions.ts` provides:

- `getEpisodeCoverageReport` — an internal query returning the report for a
  stored daily Episode. Side-effect free.
- `validateEpisodeCoverageGate` — the pre-release gate the editorial
  publication path calls in place of a bare `validate` transition. It computes
  the report and advances the current publication record `generated` →
  `validated` (through the existing `transitionPublication` primitive, with the
  full audit event) only when the report is releasable; otherwise it throws
  `RecapCoverageError` listing every blocking finding and leaves the record
  untouched.

The gate performs zero Canon writes. Its only write is the publication-record
patch, which governs the visibility of derived content and never edits, deletes,
or supersedes an accepted Canon Event.

Run focused verification with:

```bash
npm test -- --runTestsByPath convex/recaps/coverageValidation.test.ts
```

The suite covers the clean pass path, each acceptance criterion's failure path,
valid explicit exclusions, unjustified exclusions, minor and private
relationship changes that carry no coverage obligation, all four spoiler
classes, report determinism, and malformed input rejection.
