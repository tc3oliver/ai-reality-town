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

## The prompt has to state the Canon rules, not only the schema (ART-197)

Fixing ART-196 got three scenes authored — up from zero — and the slot then failed one stage later:

```
failureStage: validate_canon
errorCode:    PRIVATE_RELATIONSHIP_DISCLOSURE
message:      a private relationship change cannot carry a public summary
```

Same shape as ART-196, one layer further in. `strictObject` derives `required` from `properties`,
so under strict mode **every** property is mandatory — including `publicSummary` on every event. And
`validateCanon` refuses a `relationship_changed` whose `visibility` is `private` on an event that
carries one. `private` is one of the two enum values the schema offers, so the request was again
offering a combination that could never be accepted.

The prompt now states the rules a scene author can actually break with the fields it is given:
participants-only for every `characterId`, `visibility: "public"` on a relationship change, distinct
relationship endpoints, and at least one non-zero delta. Each of these refuses the **whole** scene.

### Two variants the request stopped asking for

| Variant | What Canon requires | What the request supplies |
| --- | --- | --- |
| `character_state_changed` | `fromValue` equal to the character's projected value | nothing about current state |
| `character_knowledge_learned` | `sourceEventId` present in `causedByEventIds` and known | no event ids at all |

Neither could ever be accepted from here, so both produced rejections and nothing else. The prompt
says not to emit them and names the alternatives. That is a real capability loss, recorded as
ART-198 — it is not a claim that the variants are wrong, only that this request cannot support them.

### The worked example, again

ART-196's example used a `character_state_changed` on `emotion`. Legal **structurally** — which is
all `validateEventStructure` checks, and all its test checked — but `validateCanon` compares
`fromValue` against the projection, so it would have been refused in every scene where the
character's emotion was not the literal shown. It is now a `character_memory_formed`, which has
exactly two canon rules and both are satisfied by naming a scene participant.

**The tests now run the example through `validateCanon` against a seeded projection.** Stopping at
`validateEventStructure` is precisely what let the riskier example ship, and the live slot failed at
the stage the tests were not looking at.

## The prompt has to state what the PARSER enforces too (ART-199)

Third failure of the same class, from the live slot after ART-197:

```
mistwood day 5 noon — SCENE_OUTPUT_PROVENANCE_MISMATCH at output_validation
"Proposed Event must remain within the Scene world, slot, and participants"
```

`parseWholeSceneOutput` requires every proposed event to copy the scene's `worldId`, `worldDay` and
`timeSlot` verbatim and to name only its participants. The scene payload carries all four and the
worked example uses them — but nothing said they must be **copied**. ART-197 had stated the
participants rule for `stateChanges`; the event's own `participantIds` is a different field.

Every parser rule that refuses a whole scene is now stated, in one pass rather than one live slot at
a time: the provenance triple, participants across all six narrative collections *and* the event's
own `participantIds`, unique `idempotencyKey`s, non-repeating `continuityWarnings`, at least one
`keyActions` entry. They are inlined as literals for the reason ART-157 gives about destinations — a
value the model must derive from elsewhere in the payload is a value it can derive wrongly.

### The tests assert each rule twice

Once that the parser refuses the violation, once that the prompt states the rule. A prompt sentence
with no parser behind it is decoration; a parser rule the prompt never states is what stopped this
world three times running. The failure mode here has always been one side moving without the other,
so both are pinned in the same test.

## The pattern behind ART-196, ART-197 and ART-199

Three separate stops, one cause: **the request asked for something the system would refuse, and
nothing compared the two.** The schema, the worked example and the prose are the contract the model
sees; `parseWholeSceneOutput`, `validateEventStructure` and `validateCanon` are the contract it is
held to. Nothing tested that they agreed.

They stayed invisible because the deterministic author knows the rules independently of the prompt.
Every suite was green while the prompt told a real model something false — the blind spot ART-157
recorded about itself, three more times.

The tests added across these three tasks are the comparison: they drive the real prompt builder and
put what it produces through the real validators.

## The movement rule has to be true for the character it names (ART-200)

Fourth stop of the same class:

```
mistwood day 5 noon — LOCATION_PRECONDITION_FAILED at validate_canon
"movement fromLocationId does not match current location"
```

ART-157's rule ends *"fromLocationId must be `<scene.locationId>`"*. That is true only when every
participant is standing at the scene's location — and **a scene groups characters by intent while
Canon tracks position**. Nothing makes the two agree. For a participant projected elsewhere the
prompt was instructing a value `validateCanon` refuses, and the scene-level destination list was
computed from the scene's location, so even a corrected origin would then have failed
`TELEPORTATION_NOT_ALLOWED`.

`participantMovementFor` derives each participant's own origin and the destinations legal **from
it**. `legalDestinationsFrom` always could compute this; it was only ever called with the scene's
location. One computation settles four canon rules:

| Rule | How |
| --- | --- |
| `LOCATION_PRECONDITION_FAILED` (origin) | the origin *is* the projected location |
| `TELEPORTATION_NOT_ALLOWED` | destinations are that origin's own connections |
| `UNKNOWN_LOCATION_REFERENCE` | inactive and full destinations are filtered out |
| `LOCATION_PRECONDITION_FAILED` (no-op) | the origin is excluded, so a move always moves |

A participant who cannot move is told so by name. A character absent from a list of who *may* move
is a character the model reads as unconstrained — the same reasoning ART-157 gives for stating the
empty case explicitly.

The worked example follows the character it **names**: that character's own origin and their own
first destination, or no movement at all when they have none. Combining `participantIds[0]` with the
scene's location and the scene-level list was the ART-196 failure in another form — an example that
could not be accepted.

The ART-157 scene-level rule is kept for callers that supply no positions, which is how every pure
scene-parsing test calls it. This adds precision where it is available and removes nothing.

## Identifiers the author cannot know (ART-201)

Fifth stop of the same class:

```
mistwood day 5 afternoon — UNKNOWN_EVENT_REFERENCE at validate_canon
"causal event does not exist"
```

`validateCanon` checks `causedByEventIds` against the world's known event ids. A scene author is
given none; the worked example carries `[]` and nothing said it had to stay empty.

The four earlier tasks each fixed one instance of the same question, one live slot at a time. The
rest are stated together:

| Field | What Canon checks | What the prompt now says |
| --- | --- | --- |
| `causedByEventIds` | every id is a known event | must be `[]` |
| `locationId` | the location exists | must be the scene's location |
| `fact_created` subject | character / location / item existence; a `world` subject must equal the event's `worldId` | a scene participant, the scene's location, or the world id |
| rumor claim subject | the same existence checks | the same rule |
| `item_transferred`, `location_state_changed`, `organization_state_changed` | a real entity id plus its current recorded state, with every property mandatory under strict mode | not emittable |

The last row is the same judgement ART-197 made about `character_state_changed`: the request stops
asking for what it cannot supply the context for, rather than asking and collecting rejections.
Making them usable is separate work — ART-198.

Each test pairs the prompt sentence with the validator that enforces it. A rule stated to the model
with no validator behind it is decoration; a validator the prompt never mentions is what stopped
this world five times running.

## A field with one valid value is not asked for (ART-203)

ART-201 told the model in prose that `causedByEventIds` must be empty. The next live slot obeyed and
committed six events — the first successful live slot in this repository. The one after it did not:

```
mistwood day 5 night — UNKNOWN_EVENT_REFERENCE at validate_canon
"causal event does not exist"
```

A rule that holds only as often as the model chooses to follow it is not a rule.

`causedByEventIds` is removed from `proposedEventItem`, so the request stops **demanding** a field a
scene author can never fill, and `parseWholeSceneOutput` fills `[]` when it is absent — exactly the
treatment ART-139 gave `schemaVersion` and `sceneId`, fields whose only valid value the caller
already knows.

### The schema and the example do different jobs, and must agree

The schema stops demanding the field; the worked example still shows `causedByEventIds: []`, which
is the value to write if one is written at all. An instruction that contradicted the example would
be worse than either alone.

### What is filled, and what is not

| Case | Behaviour | Why |
| --- | --- | --- |
| field omitted | filled with `[]` | a parse: the caller knows the only valid value |
| field supplied | left alone, validated, refused if invented | a repair that changes meaning would make a hallucination invisible |

No validation threshold is lowered. Canon's rule is unchanged and still enforced.
