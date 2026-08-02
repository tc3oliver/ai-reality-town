# Conflict-safe scene grouping

ART-21 implements PRD FR-C004.

Accepted character intents from one persisted Director Run and world time slot are
grouped deterministically when they share a location and related Arc/participant/target
context. Each grouped scene retains every source Intent ID, its participants, location,
Arc IDs, combined trigger, and dramatic pressure. Stable sorting makes retries produce
the same scene identities and ordering.

A character may submit only one actionable Intent and may participate in only one major
scene per slot. Cross-run, cross-slot, duplicate, missing, and conflicting Intents are
rejected before persistence. A connected scene is limited to six participants; overflow
Intents are explicitly deferred with `SCENE_PARTICIPANT_LIMIT`. Previously downgraded or
wait Intents are also retained as deferred decisions rather than silently discarded.

Grouping reads only persisted validated Intents, is idempotent by `groupingRunId`, and
cannot commit or reduce Canon state.

Focused verification:

```bash
npm test -- --runTestsByPath convex/simulation/sceneGrouping.test.ts
```
