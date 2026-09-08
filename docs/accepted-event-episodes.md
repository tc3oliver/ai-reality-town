# Accepted-event daily episodes

`convex/editorial/` owns the FR-G001 daily Episode candidate. An Episode is an
editorial projection, never a Canon write: generation reads one world's accepted
`canonEvents` for one world day and persists the result in `dailyEpisodes`.

## Contract and provenance

- At most one `dailyEpisodes` row is created per `(worldId, worldDay)`; repeated
  generation returns the existing result.
- Every Episode, scene, relationship change, and public Fact reference is checked
  against that day's accepted source set. Proposed Events are not valid inputs.
- The Episode includes its number, title, headline, one-line summary, three to five
  key scenes, relationship changes, new and resolved questions, related Arc and
  character IDs, a next-Episode tease, and immutable source Event IDs.
- Every source whose Story Arc classification importance is at least `0.7` must be
  cited. More than five important events may share the same scene; the scene limit
  does not weaken coverage.
- A day with no accepted public development produces a clearly labelled quiet-day
  Episode with no invented Event or Fact references.

## When a day's Episode appears (ART-89)

**A world day gets its Episode once the world has moved past it** — once a later
world day has accepted an event. That is `completedWorldDaysOf` in
`convex/operations/postCommitLiveFunctions.ts`, and it is the only completion
rule Canon can state honestly: until a later day exists, the day may still
commit more events.

The consequence is worth stating plainly, because it changes when a reader sees
a day's Episode. **The newest world day has no Episode yet.** Its Episode is
composed on the next day's first commit; in production that is the next cron
tick, a few minutes later. A world that stops running leaves its last day
without one permanently, and the FR-M002 coverage metric excludes that day with
a reason rather than counting its events as uncovered.

**The previous rule was wrong, and the way it was wrong was invisible.** A day
used to count as complete the moment one accepted event carried the final time
slot. The post-commit pipeline runs once per accepted event, so the *first*
event of a day's final slot marked the day complete, this module assembled that
day's Episode from the events accepted so far, and the at-most-one-row-per-day
contract above meant the assembly never happened again. The rest of that slot
reached no Episode, no recap and no publication, for every day of every world.

Nothing failed, because the FR-G004 coverage gate obliges an Episode to cite the
events of its own day **as the Episode saw them** — so an Episode built from a
partial day passed its own check. Measured over the fixed 7-day seed, 14 of 96
high-importance Accepted Events were permanently uncovered and §16.2's coverage
clause sat at 85.4%. See
[`world-quality-metrics.md`](./world-quality-metrics.md) §5.4 and
[`recap-coverage-validation.md`](./recap-coverage-validation.md).

The **daily canon snapshot** keeps the old condition under its own name,
`latestWorldDayFinalSlotStarted`, because it needs the opposite thing:
`createDailySnapshot` refuses a past day once later events exist, so a snapshot
may only be taken while its day is still the latest. The final slot is the last
moment at which that day can be both complete and current. Two pipeline stages
were asking different questions through one flag.

## Disclosure and failure isolation

Only public canonical Facts and public relationship changes may be selected. The
candidate validator also rejects text matching unpublished world-secret content.
The complete public candidate is then passed through post-generation safety
classification. Withheld candidates store no raw Episode text.

Validation or generation failure writes a `failed` editorial record with a stable
error code. It does not call the Canon commit path, mutate an accepted Event, or
change a world projection. Episode publication remains a separate later workflow.

## Verification

Run the focused FR-G001 suite with:

```bash
npm test -- --runTestsByPath convex/editorial/episode.test.ts
npm test -- --runTestsByPath convex/operations/postCommitWorldState.test.ts
```

The first suite covers accepted-only provenance, public Fact enforcement,
important-event coverage, secret rejection, quiet days, safety withholding, and
Canon failure isolation. The second pins the completion rule: the latest day is
never finished however far into it the world has got, it becomes finished
exactly when a later day accepts an event, and `finalSlotStarted` still answers
the snapshot's separate question over the same events.
