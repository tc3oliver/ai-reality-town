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

## Request schema / parser contract (ART-139)

The JSON Schema sent to the provider (`WHOLE_SCENE_JSON_SCHEMA`) must declare `properties`,
`required`, and `additionalProperties: false` for every nested item type -- `keyActions`,
`dialogueHighlights`, `relationshipChanges`, `knowledgeChanges`, `memories`, `rumors`, and
`proposedEvents` -- mirroring the exact allowed-key list the corresponding parser enforces
(`parseActions`, `parseDialogue`, `parseEventLinked`'s three key-list variants). An
under-declared nested schema (e.g. `{ type: 'object' }` with no `properties`) gives a strict
provider nothing to constrain it to the parser's exact-key contract, so it is free to add or
omit fields the parser then rejects.

Confirmed root cause of the real-provider `SCENE_OUTPUT_INVALID: unsupported schema version`
failure (previously a hypothesis, per ART-106's discovery notes; confirmed live against the
real configured provider for ART-139): the provider omits `schemaVersion` and `sceneId` from
its response entirely, not just type-loosens them. Both are fixed/known-in-advance values --
`schemaVersion` is always the literal `1`; `sceneId` already comes from the request the caller
sent -- rather than model-generated content, so the parser now fills in exactly those two
fields when absent (and still tolerates the numeric string `"1"` for `schemaVersion`
defensively). Every other field, and any present-but-wrong value for these two, still fails
with its own precise field path (`SceneSimulationError.path`) rather than a generic message.
The tightened `WHOLE_SCENE_JSON_SCHEMA` (`properties`/`required`/`additionalProperties: false`
on every nested item) is necessary but was not, on its own, sufficient to make the real
provider emit these two fields -- the parser-side default is still required.

`stateChanges` items inside `proposedEvents` are intentionally left as `{ type: 'object' }` in
the request schema: that field is a 9-variant discriminated union already validated
independently and strictly by `normalizeStateChange` (throws `CanonError` on any mismatch), so
re-encoding the full union into JSON Schema was judged out of proportion to this bug. Separately
(ART-141, follow-up to ART-139): the real provider's `proposedEvents` items themselves are not
reliably schema-conformant even with a tightened request schema -- they were observed missing
nearly every required `ProposedEvent` field, including `stateChanges`, which cannot be defaulted
the way `schemaVersion`/`sceneId` can. That is a distinct, deeper compliance gap, tracked
separately rather than folded into this contract-layer fix.

Run focused verification with:

```bash
npm test -- --runTestsByPath convex/simulation/sceneSimulation.test.ts
```

The suite covers valid output, malformed retries, exhausted retries, transient and
permanent provider errors, provenance rejection, high-risk review routing, and the
absence of Canon/public-write surfaces.
