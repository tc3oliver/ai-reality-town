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
```

The suite covers accepted-only provenance, public Fact enforcement, important-event
coverage, secret rejection, quiet days, safety withholding, and Canon failure
isolation.
