---
id: ART-210
title: The public read path collects every version a target ever published
status: Blocked
assignee: []
created_date: '2026-09-18 18:27'
updated_date: '2026-09-18 19:20'
labels: []
dependencies:
  - ART-212
ordinal: 207000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found while draining post-commit on the acceptance deployment after two live slots.

```
Uncaught Error: Too many bytes read in a single function execution (limit: 16777216 bytes).
```

`drainLivePostCommit` at its DEFAULT batch of 3 events now exceeds the Convex 16 MB per-transaction
read limit for mistwood. One event at a time still works, so the world was drained by hand — but
`drainAllLivePostCommit`, which the cron calls, uses the same default. The moment the world is
promoted to `public` the post-commit pipeline would fail on every tick, and nothing would advance.

Measured on the acceptance deployment, not guessed. Whole-world reads for mistwood:

    publishedReadModels           415 rows   3.19 MB     <- and growing one row per rebuild
      timeline|timeline:mistwood   82 rows   1.48 MB
      liveState|live:mistwood      33 rows   0.40 MB
      world|world:mistwood         14 rows   0.29 MB
    canonEvents                    99 rows   0.24 MB
    storyArc* + worldCharacters   127 rows   0.12 MB

Total distinct data is about 3.5 MB, so 13.5 MB is the SAME rows read several times over. The
repeated read is `serveReadModel`, which calls `loadTargetVersions` — a `.collect()` of every
version a target ever published — and then uses exactly two of those rows: the current one and the
last-known-good one. Both already have their own indexes (`by_current`, `by_lkg`) and both are used
elsewhere in the same file.

Every internal caller pays it per event: `publishedEventSummaries`, `resolveDisplayName` (once per
character), the runtime snapshot reader. So does every public page view.

This is the CLAUDE.md section 9 rule — never `.collect()` a whole world on a per-event path — and
the cost grows with the world every time it publishes anything, which is on every accepted event.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 serveReadModel reads a bounded number of rows per target, independent of how many versions that target has ever published
- [x] #2 The unbounded read is REMOVED from the port rather than left available beside the bounded one
- [x] #3 The served result is unchanged: current-if-servable, else last-known-good-if-servable, else null, with the same sanitisation
- [x] #4 A test fails if a whole-version-history read is reintroduced, by counting what the store was asked for rather than by reading the implementation
- [ ] #5 drainLivePostCommit completes at its default batch size against a world with the acceptance deployments version history
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 All acceptance criteria are satisfied
- [ ] #2 Relevant automated tests are added or updated
- [ ] #3 Typecheck passes
- [ ] #4 Lint passes
- [ ] #5 Relevant tests pass
- [ ] #6 Build passes when applicable
- [ ] #7 No known regression is introduced
- [ ] #8 No secret or credential is committed
- [ ] #9 Documentation is updated
- [ ] #10 PRD traceability is updated when applicable
- [ ] #11 Implementation notes are complete
- [ ] #12 Final summary includes verification evidence
- [ ] #13 Changes are committed and pushed
- [ ] #14 Pull request is merged or explicitly blocked
<!-- DOD:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. `PublicReadReadStore` loses `loadTargetVersions` and gains the two bounded reads
   `findCurrent` and `loadLastKnownGood`, which `PublicReadStore` already declares. Removing the
   unbounded method rather than adding a bounded sibling is the point: a port that still offers the
   whole history is a port someone reaches for again.

2. `serveReadModel` asks for the current row and the last-known-good rows and hands
   `selectServedVersion` exactly those, in that priority order. The selection rule itself does not
   change — it is what decides servability and it is right.

3. `readStore` (the query adapter) picks up the `by_current` / `by_lkg` index lookups that
   `writeStore` already uses; `writeStore` keeps only its write half.

4. `longRunHarness` implements the two bounded methods over its in-memory rows.

5. A counting-store test asserts serveReadModel reads at most the current row plus the
   last-known-good rows for a target with many versions. Counting what the store was ASKED for,
   not reading the implementation, so a reintroduced `.collect()` is caught by behaviour.

6. Fault injection: put the whole-history read back and watch the counting test fail by name.

7. npm run check, PR, auto-merge, deploy acceptance, then drain at the DEFAULT batch size and
   confirm it no longer exceeds the read limit.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Diagnosis

  Guessed wrong first. `loadWorldState` collects four whole-world `storyArc*` tables plus every
  `worldCharacters` row on a per-event path, which reads exactly like the CLAUDE.md section 9
  violation — and measuring it gave 0.12 MB across 127 rows, memoised once per drain. It was not
  the cause.

  Measuring the rest settled it: every distinct byte the drain can touch is about 3.5 MB, so 13.5 MB
  of reads is the same rows re-read. `serveReadModel` -> `loadTargetVersions` was the repetition:
  a `.collect()` of a target’s whole version history, of which it used two rows.

    publishedReadModels           415 rows   3.19 MB
      timeline|timeline:mistwood   82 rows   1.48 MB   <- +1 version per accepted event
      liveState|live:mistwood      33 rows   0.40 MB
      world|world:mistwood         14 rows   0.29 MB
    canonEvents                    99 rows   0.24 MB
    storyArc* + worldCharacters   127 rows   0.12 MB

  Callers paying it once per event: publishedEventSummaries, resolveDisplayName (per character),
  the runtime snapshot reader. Plus every public page view.

Fault injection

  1. A history-proportional read reintroduced inside serveReadModel ->
     "reads the same number of rows for three versions and for three hundred" FAILS. The other two
     bound cases still pass, which is the point of having the count case: a caller can abuse a
     bounded method without ever naming an unbounded one.
  2. The two bounded reads concatenated in the reverse order -> NOTHING failed.

  Injection 2 caught a defect in my own comment rather than in the code. It claimed the current row
  had to be offered first "because the selection rule is a find". `selectServedVersion` makes two
  passes keyed on the FLAGS, so position is irrelevant. The comment was corrected to say so, and the
  case now asserts the stronger property — either order serves the current version.

Gate

  npm run check exits 0: 281 suites, 4935 tests (ART-209 baseline 280 / 4927; +1 suite, +8 tests).

Post-deploy verification: the fix is real and it is NOT sufficient.

  `serveReadModel` was genuinely unbounded and is now bounded — proven by the counting test and by
  the injection that fails it. Public read P95 over the real acceptance transport tightened from
  249 ms / 345 ms max to 247 ms / 253 ms max (n=40 each).

  But AC#5 does NOT hold. After merge and deploy, `drainLivePostCommit` at the DEFAULT batch of 3
  still exceeds the 16 MB read limit on mistwood. Binary search on the batch size at Canon 103:
  batch 1 and batch 2 complete with no read-limit warning at all; batch 3 warns 17-23 times and
  fails. One event costs roughly 5-6 MB against a world holding about 6.3 MB in total.

  So the pipeline reads close to everything, once per event, and `serveReadModel` was one
  repetition among several. The remaining cost is inside the stage implementations and needs a
  per-stage measurement rather than another reading of the source. Carried to ART-212 with the
  table sizes and with what measurement has already ruled out.

  AC#5 is left UNCHECKED rather than reworded. The claim it makes is the one that matters
  operationally, and it is false today.
<!-- SECTION:NOTES:END -->
