---
id: ART-212
title: The post-commit pipeline reads almost the whole world once per event
status: To Do
assignee: []
created_date: '2026-09-18 19:20'
labels: []
dependencies: []
ordinal: 209000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Successor to ART-210, which fixed a real unbounded read and did not fix this.

After ART-210 was merged and deployed, `drainLivePostCommit` at its DEFAULT batch of 3 events still
exceeds the Convex 16 MB per-transaction read limit for mistwood:

```
Uncaught Error: Too many bytes read in a single function execution (limit: 16777216 bytes)
    at async writeCheckpoint (convex/operations/postCommitOrchestrationFunctions.ts:62:8)
```

The stack names where the budget ran out, not what spent it.

Measured by binary search on the batch size, on the acceptance deployment at Canon sequence 103:

    batch 1   completes, no read-limit warning at all
    batch 2   completes, no read-limit warning at all
    batch 3   17-23 warnings, then fails

Warnings begin at about 13.6 MB, so one event costs roughly 5-6 MB. And the whole world is:

    publishedReadModels        446 rows   3.39 MB
    recapSnapshots             226 rows   1.14 MB
    sceneSimulationRuns        119 rows   0.60 MB
    postCommitCheckpoints     1176 rows   0.53 MB
    canonEvents                104 rows   0.24 MB
    canonSnapshots               2 rows   0.16 MB
    replaySceneCandidates       83 rows   0.14 MB
    storyArcProjectionEvents    91 rows   0.10 MB
                                          ------- about 6.3 MB total

So the pipeline reads close to EVERYTHING the world has, once per accepted event. There is no single
5 MB `.collect()` to delete; this is the shape of the whole of stages 11-21 and it gets worse with
every event, because six of those eight tables grow per event.

What has already been ruled out by measurement, so the next pass does not repeat it:

- `loadWorldState` collects four whole-world `storyArc*` tables plus every `worldCharacters` row on
  a per-event path. It LOOKS like the CLAUDE.md section 9 violation. It is 0.12 MB and memoised
  once per drain.
- `commitReadModelVersion` is already bounded — `findCurrent` plus `loadLastKnownGood`.
- `serveReadModel` was genuinely unbounded and is fixed under ART-210.
- The orchestration itself (`writeCheckpoint`, `runRow`, the per-run checkpoint reads) is run-scoped.

The remaining cost is inside the stage implementations. Instrument rather than guess: the useful
next step is a per-stage byte count, not another reading of the source.

Operationally: the world is healthy and drained by hand at batch 2. It must NOT be promoted to
`public` until this is fixed — `drainAllLivePostCommit` uses the same default of 3, so the cron
would fail on every tick and nothing would advance.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A per-stage measurement identifies which of stages 11-21 spend the per-event read budget, recorded as numbers
- [ ] #2 One accepted event costs a bounded read that does not grow with the number of events the world has already accepted
- [ ] #3 drainLivePostCommit and drainAllLivePostCommit complete at the default batch size against the acceptance deployment
- [ ] #4 A test fails if a stage reintroduces a read proportional to world age, by counting rows rather than by reading the source
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
