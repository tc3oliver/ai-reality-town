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

## The request schema does not bind the provider (ART-141)

The configured gateway (`https://llm.shouri.app/v1`, `LLM_MODEL=auto`) accepts
`response_format: { type: 'json_schema', json_schema: { strict: true, ... } }` and returns HTTP
200, but **does not enforce the schema at all**. This was established live on 2026-08-06: a
request carrying only the `proposedEvents` sub-schema came back as an entirely invented
`{ sceneId, participants, narrative, outcome, dramaticTension }` document with no overlap with
the requested shape. Every field that previously looked "honored" was really the model inferring
intent from self-describing names echoed back from the scene payload.

That explains the ART-141 symptom exactly. `proposedEvents` is a Canon concept the model cannot
infer from the scene payload, so it invented its own idea of an event -- observed shapes were
`{ eventId, publicSummary, trigger }` and `{ eventId, publicSummary, probability }`. Fully
specifying the request schema (including expanding `stateChanges` into its complete
per-variant `anyOf` -- ten variants at the time, fourteen since ART-28 added the four rumor
verbs) changed nothing on its own; the model returned the same invented shape.

The fix is therefore to carry the contract **in the prompt**. `wholeSceneSystemPrompt` serialises
`WHOLE_SCENE_JSON_SCHEMA` into the system message, adds a worked `proposedEvents` example derived
from the scene being simulated, and disambiguates the scene-level `memories`/`knowledgeChanges`/
`rumors` notes from the `character_memory_formed` state change they otherwise get confused with.
The schema remains the single source of truth and is serialised from it, so prompt and schema
cannot drift. `WHOLE_SCENE_JSON_SCHEMA` is still sent as `response_format` for providers that do
honour it, and every object node in it is strict-mode conformant -- `strictObject` derives
`required` from `properties` so that invariant cannot regress. `metadata` and
`correctsKnowledgeId` are deliberately absent from the request: an open-ended object is
inexpressible under strict mode and both are optional in the Canon contract. `sourceType` on
`rumor_originated` is absent for the same reason and one more: a scene author has no better
answer than the `inference` the normalizer already supplies.

ART-28 sharpened the same disambiguation one step further, because the two things share a word.
A `rumors` note is narrative colour and changes nothing; a rumor the world tracks exists only as
`rumor_*` entries inside `stateChanges`, and only once Canon accepts them. The prompt now says
so outright, along with the two rules a scene author is most likely to trip: a character may
only pass on a rumor an earlier accepted change actually gave them, and an event carrying a
`rumor_*` change must not also carry a `fact_created` for the same subject and predicate.

Measured against the real provider after the fix: 6/6 consecutive runs produced
`proposedEvents` items carrying all twelve contract fields and well-formed `stateChanges`,
including `character_location_changed` for a travel-shaped scene, and median latency fell from
~66s to ~8s. `LLM_MODEL=auto` is *not* implicated -- the gap is the gateway's structured-output
implementation, not model selection -- so no deployment change is recommended.

Provider output remains untrusted regardless: `normalizeProposedEventOutput` and
`normalizeStateChange` still validate every event at the Canon boundary, and the prompt is a
compliance aid, never a substitute for that check.

Run focused verification with:

```bash
npm test -- --runTestsByPath convex/simulation/sceneSimulation.test.ts
```

The suite covers valid output, malformed retries, exhausted retries, transient and
permanent provider errors, provenance rejection, high-risk review routing, and the
absence of Canon/public-write surfaces.

## The worked example must be an event Canon accepts (ART-196)

The prompt ends by showing the model one example Proposed Event — "A well-formed item for this
scene looks like: …". For scenes whose location had no legal destination, that example was invalid
in two independent ways:

- `stateChanges: []` — `validateEventStructure` refuses an event that changes nothing.
- `eventType: 'interaction'` — not in `EVENT_TYPES`, and never was.

So the single worked example the model was given could not be committed under any circumstances,
and the model copied it. Every live slot authored on the acceptance deployment failed with
`[INVALID_EVENT_SHAPE] stateChanges must not be empty`, which is what stopped the Mistwood world.

ART-157 emptied the array for a good reason: it had stopped the example demonstrating a movement to
a destination Canon would reject. Replacing an illegal movement with an illegal *event* went
unnoticed for the reason ART-157's own notes give — the deterministic author knows the canon rules
independently of the prompt, so every suite stayed green while the prompt told a real model
something false. Only the movement branch had ever been put through Canon by anything.

The no-destination example now demonstrates a `character_state_changed` on `emotion`. That change
is legal in **every** scene — it needs no destination, no second participant and no prior canon — so
there is no scene for which it is the wrong thing to show.

The rule is stated three times over, because once was demonstrably not enough: in the example, in
the schema (`stateChanges` carries `minItems: 1`, and the schema is serialized into the prompt
verbatim), and in prose. No validation threshold was relaxed — the model was being asked for
something invalid, and it is now asked correctly.

`convex/simulation/wholeScenePromptCanonLegality.test.ts` runs the real prompt builder, recovers the
example from the string the model actually receives, and puts it through `validateEventStructure` —
the same function that refused the live slot. Asserting against a copy of the example would only
have proved the copy was legal.

### Two smaller defects found with it

- **A canon refusal was not retried.** A refusal raised as a `SceneSimulationError` got a second
  sample; one raised as a `CanonError` by `normalizeProposedEventOutput` did not, although both mean
  "the provider answered and the answer was refused" and both already counted as `output_rejected`
  against §16.2. The retry path and the metric disagreed about the same event.
- **A canon refusal was counted twice.** The guard against double-reporting asked whether the error
  was the scene parser's own class, rather than whether the provider had answered — so every canon
  refusal was recorded as `output_rejected` *and* as `provider_failed`, and §16.2's provider-failure
  dimension has been counting model-output refusals as outages. The question is answered by
  `attemptTrace`, which exists only once a call has returned.

See `docs/authoring-failure-diagnosis.md` for how the failure was made legible enough to find.
