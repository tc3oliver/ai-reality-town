# Whole-scene simulation

`convex/simulation/sceneSimulation.ts` implements FR-C005 after conflict-safe Scene
grouping. One provider request receives the complete `GroupedScene`, including every
participant and source Intent, and returns one structured result for the scene. The
system does not generate a separate complete dialogue for each resident.

## Validated output

The version 1 result requires:

- Scene summary, key actions, and dialogue highlights;
- zero or more versioned Proposed Events;
- relationship, knowledge, memory, and rumor changes linked to a Proposed Event;
- continuity warnings;
- the post-generation safety classification and review disposition.

Runtime validation rejects unknown fields, foreign Scene IDs, non-participants,
cross-world/day/slot Proposed Events, duplicate idempotency keys, invalid Event
schemas, self-relationships, and unlinked derived changes. Proposed Events are
normalized with the shared Canon proposal contract but are not committed or reduced
by this module.

## Retry and safety behavior

Invalid structured output and transient provider failures retry the entire Scene
request within a caller-supplied limit of one to three attempts. Permanent provider
failures stop immediately. A retry never creates a Canon write.

The complete validated narrative content is classified with the post-generation
safety policy. `withhold` and `human_review_required` labels produce
`reviewStatus: required`. The persistence boundary stores only validated structured
results and trace metadata in `sceneSimulationRuns`; it stores no separate raw
provider output and exposes only internal operations queries.

Run focused verification with:

```bash
npm test -- --runTestsByPath convex/simulation/sceneSimulation.test.ts
```

The suite covers valid output, malformed retries, exhausted retries, transient and
permanent provider errors, provenance rejection, high-risk review routing, and the
absence of Canon/public-write surfaces.
