# Publication and Safety Filtering on the Dynamic Surface (FR-P004, ART-132)

Modules: `convex/safety/schema.ts` (the `safetyStatusOverrides` ledger),
`convex/safety/postGeneration.ts` (`resolveEffectiveSafetyLabel`),
`convex/safety/effectiveSafetyLabels.ts` (the classification/override join),
`convex/operations/safetyOverrideFunctions.ts` (the operator command),
`convex/publicRead/activeScenePresentation.ts` (the scene-card gate),
`convex/publicRead/liveStateFunctions.ts` (where the gate is applied at rebuild time),
`convex/publicRead/worldCharacterProjectionFunctions.ts` (the character-fact gate, ART-124),
`convex/publicRead/episodeTimelineProjectionFunctions.ts` (the timeline gate, ART-124),
`convex/simulation/sceneSimulation.ts` (what the classifier examines),
`convex/canon/eventTypes.ts` (`PUBLIC_TEXT_CHARACTER_STATE_FIELDS` / `EXISTENCE_CHARACTER_STATE_FIELDS`),
`convex/simulation/worldDayLive.ts` and `convex/simulation/fakeSceneNarrator.ts` (the provenance
stamp the gate depends on).

The dynamic layer added three new public text surfaces — bubbles, scene cards, the live overlay
— and none of them consulted the post-generation safety classification. That classification had
existed since PRD 1.0, but it was keyed on a Scene id and the public projection is built from
accepted Canon events, which carried no link back to the Scene they came from. There was
therefore no join to make: the gate could not be applied, only asserted.

This task builds the missing link, the missing lifecycle, and the gate itself.

## 1. Scene provenance on accepted events

`postGenerationSafetyClassifications.sourceId` is a Scene id (`…:scene:N`). Accepted events had
nothing of the kind, so `simulate_scenes` now stamps `metadata.sceneId = result.scene.sceneId`
onto every proposal before `validate_structured_output` flattens them
(`withSceneProvenance` in `convex/simulation/worldDayLive.ts`). That stage is the last point
where a `SceneSimulationResult`'s scene and its proposals are co-located — the next stage
discards the scene — so the link has to be recorded there or not at all.

`metadata` rather than a new top-level field: the Canon event contract is fixed by FR-B001, a
new column would have to be back-filled onto every event ever accepted, and an absent
`metadata.sceneId` already has a defined downstream meaning (see §4). `metadata` is validated
only for JSON-safety, so no validator changed, and Canon carries the value verbatim without
interpreting it.

`fakeSceneNarrator.ts` stamps the same key, so the deterministic fixture path exercises the
shape the live orchestrator produces rather than a world where no event has provenance.

On the read side, `sceneEventRows` (`liveStateFunctions.ts`) lifts the value into
`SceneEventLike.sceneId`, reading defensively: anything that is not a non-empty string is
treated as absent. This is the only place `metadata` is read on the public path, and what it
lifts is an identifier, never text — `SceneEventLike` still names `publicSummary` and nothing
else textual, so the resolver's privacy boundary is unchanged.

## 2. The override ledger, and why the classification stays immutable

`postGenerationSafetyClassifications` is written exactly once per classification and is defended
by a conflict check that refuses a reused id carrying different content
(`SAFETY_CLASSIFICATION_CONFLICT`). Making that row mutable so an operator could flip a label
would dissolve the invariant and, worse, destroy the record of what the classifier actually
decided.

So the original row is never touched. Every operator revision is a new row in
`safetyStatusOverrides` (`{ worldId, sourceId, classificationId, label, reason, actor,
createdAt }`, indexed `by_world_source_and_created`), and the effective label is DERIVED:

```
resolveEffectiveSafetyLabel(classification, overrides)
  = the override with the greatest createdAt, if any
  = otherwise the classifier's own label
```

Latest wins, and that is the single definition of it. The ledger is append-only, so a reader
that took the first row, the last inserted, or any row at all would sometimes publish a label an
operator had already revised. Ties on `createdAt` resolve to the LAST row in ledger order — the
row appended second is the later decision, and it is also what `by_world_source_and_created`
returns last, so folding the whole ledger and reading `.order('desc').take(1)` agree. They have
to: one is the rebuild's gate and the other is the override command's verification.

**Keyed on `sourceId`, not `classificationId`.** An operator overriding a label is deciding
about a *scene* ("do not show what happened in the mill at noon"); `sourceId` is that scene's
stable identity, while `classificationId` identifies one classification *run* over it. Keying on
the run would silently orphan the decision the moment a slot retry re-classified the same scene
under a new run id — the content would come back, and nothing would say so. `classificationId`
is still recorded, because which run the operator was reading is part of why they decided what
they did.

Two read paths, and the read budget is why there are two:

- `readEffectiveSafetyLabel(s)` answers "what governs *these* scenes", used by the override
  command to verify its own effect. Always called with a bounded list. It needed a new index,
  `by_world_and_source` on `(worldId, sourceId)`, since the projection knows scene ids and the
  pre-existing indexes were keyed on classification ids.
- `readWithheldSceneLabels` answers "which scenes in this world are refused right now", used by
  the rebuild. A rebuild folds the world's entire accepted history, so asking scene by scene
  would grow without bound as the world ages. That failure mode is the dangerous one: once it
  tripped a transaction limit, `rebuildLiveProjection` would throw, `liveState` would stop
  republishing, the projection would freeze on its last-known-good snapshot, and a *subsequent*
  operator withhold would never reach a viewer. A safety gate whose failure mode is "safety
  updates stop propagating" is worse than no gate, because it looks like one. So the rebuild
  asks the inverted question instead, in reads that do not scale with history: the refused
  classifications (via `by_world_and_label`, so allowed content is never read at all) plus the
  world's overrides. Everything absent from their union is showable.

Where a scene somehow has two classification rows (a re-simulation under a new run id), the
newest wins, ties broken by ascending classification id — decided identically in both paths, so
two rebuilds of an unchanged world cannot disagree.

## 3. The operator command

`overridePostGenerationSafetyLabel` (`convex/operations/safetyOverrideFunctions.ts`) is a public
Convex `mutation` whose FIRST statement is `requireOperator(ctx, 'safety.override', args)`,
following `canonCorrectionFunctions.ts` exactly. `safety.override` is a new `OpsCapability`
reserved for `admin`: releasing content the safety classifier refused is the highest-consequence
publication decision in the system, and an operator trusted to pause a world is not thereby
trusted to make it.

The handler validates the reason, refuses a classification that does not exist, resolves the
classification's `sourceId`, appends the override row, and runs `rebuildLiveProjection` and —
since ART-125 — `rebuildOnboardingSummary` for the world. The refresh is what makes AC#3 true: a
withhold removes the affected text from both published surfaces immediately, not at the next
Canon commit. One `operatorAuditLog` entry is written in the same transaction (capability
`safety.override`, target = the scene id).

**It re-reads, it never echoes.** `createdAt` comes from the caller's `now`, and "latest wins" is
decided by `createdAt`, so a backdated or replayed `now` appends a row that loses the comparison
and changes nothing. Returning the requested label would have reported that as a success while
the content stayed fully public — the worst outcome available to a safety control, because the
operator stops looking. So after appending, the handler asks the ledger what the scene now
resolves to; if that is not what was requested it throws `SAFETY_OVERRIDE_NOT_APPLIED`, rolling
the whole transaction back. A tie on `createdAt` is *not* a backdate and does apply, per the
ordering rule above.

**It reports how much it reached.** The rebuild returns `correlatedEventCount` — how many
accepted events actually carry this scene's provenance stamp. Zero is a real answer (see Known
limitations), and it is surfaced in the result and recorded in the audit row as
`outcome: 'no_op'` with a `…_UNCORRELATED` result code, so an operator can tell a decision that
took effect from one that could not.

The reason is checked before the ledger insert rather than left to `recordAudit`, which rejects
the same thing afterwards. Both rows are in one transaction so a late throw would still roll the
ledger row back, but "the write is undone" is a weaker property than "the write never happened",
and NFR-005 asks that a privileged mutation be reasoned *before* it applies.

Nothing on this path reads or writes `canonEvents`.

## 4. The gate

Applied at REBUILD time, inside `rebuildLiveProjection`, in two places.

**Scene cards.** `buildActiveScenePresentations` takes an optional
`sceneSafetyLabels: ReadonlyMap<string, SceneSafetyLabel>` — carrying only the REFUSED scenes,
since anything absent is showable. A scene group whose events name a refused Scene is presented
with `title: '內容審核中'`, an empty `summary`, and `publicationStatus: 'withheld'`. It keeps
its `sourceEventIds`, `locationId`, `participantCharacterIds`, `arcIds` and timestamps.

**Recent events and the replay.** `redactWithheldSummaries` drops the `publicSummary` of every
event whose Scene is refused before `buildLiveProjection` and `buildVisualReplay` see them, so
the refused sentence is never written into either read model. Redaction is keyed on `eventId`,
never on a position in a parallel array — index correlation would work today and would start
redacting events against their neighbour's verdict the day anyone put a `.filter()` upstream.

**Episode narration.** Dropping event summaries is not sufficient on its own, and this is the
subtlest part of the gate. A day's episode narrates several events in one key scene, and *both*
the overlay (`narrationForEvents`) and the replay (`resolveEventCardStep`) PREFER that narration
when it exists — and the replay's `episodeScene` branch is gated only on the episode's
publication version and status, which know nothing about scene-level safety. Without a second
redaction, every world day with a published episode would have shown the safe placeholder on the
overlay while the replay narrated the withheld text for the same scene.

`redactWithheldNarration` closes it by neutralising any key scene that narrates a withheld event:
the entry keeps its POSITION in the array and loses its `sourceEventIds`, which makes it
unmatchable and therefore unaddressable. Position matters because the read-time resolver looks a
summary up by index in the real `dailyEpisodes` row — removing the entry would shift every later
index and serve a different scene's text under this one's address. A key scene covering a
withheld event *and* an allowed one is neutralised whole: its text is a joint narration, and
publishing it would publish the withheld half.

Four decisions are worth stating.

*Withheld scenes are shown as placeholders, not hidden.* The map's job is to show where the
world is; a scene vanishing from a location the characters are visibly standing in would be a
worse lie than "this text is under review". `PUBLIC_ACTIVE_SCENE_PUBLICATION_STATUSES` widened
from the single-member `['published']` ART-122 shipped to `['published', 'withheld']`, and both
the hand-written assertion (`assertPublicDynamicProjection`) and the Convex validator
(`publicDynamicProjectionValidators.ts`) accept the new value.

*The gate fails closed on a verdict and open on silence.* A group is withheld when ANY of its
events names a refused Scene — including where a group spans two Scenes and only one was
refused, because the group publishes their summaries joined. But a Scene with NO classification
row resolves to `allow`. Canon carries seed, system and remediation events no post-generation
classifier ever examined; reading their silence as a refusal would blank the map for content
that was never in question.

*Redaction happens at the producer, not the reader.* The public read path serves published
snapshots and nothing else. A read-time filter would leave the refused sentence sitting in the
published payload, where FR-O010's last-known-good fallback would go on serving it long after
the override. Redacting before the write means there is nothing left to filter — which is also
how AC#6 is satisfied: a `canonEventSummary` replay reference resolves out of the `liveState`
model's `recentEvents`, so once the summary is gone the reference silently stops resolving,
exactly as a withheld episode's `episodeScene` reference already does.

*Character motion is untouched.* `toPublicCharacterMotion` and the trajectory planner never see
a safety label; they read accepted events and seed placements. AC#4 is therefore true by
construction — and locked by a regression test that builds the whole projection twice, with and
without a withheld scene, and asserts the `characters` array is byte-identical.

## 4a. The gate also covers character-fact text (ART-124)

ART-132 gated a scene's NARRATIVE text. It did not gate the text a scene writes into a
character's **biography**, and that was a real hole rather than a theoretical one: `publicProfile`,
`publicGoal`, `personality`, `values`, `fear`, `behaviorRules` and `occupation` are all
LLM-writable after world creation, through the generic `fact_created` (on `subjectType:
'character'`) and `character_state_changed` state changes a scene proposes. They land verbatim on
the public character page and, since ART-124, on the character card. A scene classified `withhold`
had its summary suppressed while the biography it wrote in the same breath stayed fully public.

ART-124 closes it with this machinery rather than a second one, in two places:

- **Generation.** `publicText()` in `convex/simulation/sceneSimulation.ts` now also concatenates
  the string `value` of every public-facing `fact_created` on a character and the string `toValue`
  of every `character_state_changed` **whose field actually reaches a public projection field**,
  so the scene's single existing `classifyPostGeneration` call examines them. A `private` fact and
  a non-character subject stay out of scope. This is a widening of the classifier's INPUT, not a
  second classification: there is still exactly one verdict per scene, keyed on the same
  `sceneId`, so an operator override keeps governing the scene as a unit.
- **Projection.** `characterSourceFrom` in `convex/publicRead/worldCharacterProjectionFunctions.ts`
  is where it is enforced. `rebuildCharacterProjection` calls the same bounded
  `readWithheldSceneLabels` sweep the live rebuild uses and passes the refused scene ids into the
  fold; a `fact_created` or narrative `character_state_changed` whose event's `metadata.sceneId`
  is refused is skipped as if it had never been accepted, so the field keeps its last known good
  value — or is absent, where the refused event was the first to write it.

### Which `character_state_changed` fields, and why the answer is not "all of them"

`CHARACTER_STATE_FIELDS` has seven members; `CHARACTER_STATE_FIELD_MAP` publishes five of them.
The gate and the classifier both read a narrower list still —
`PUBLIC_TEXT_CHARACTER_STATE_FIELDS` in `convex/canon/eventTypes.ts`, which is `health`,
`emotion`, `finance` and `occupation`. Two exclusions, for two different reasons:

- `organization_memberships` and `availability` are accepted by Canon and projected **nowhere**.
  Scanning them is not a conservative choice, it is a destructive one: a `withhold` verdict sets
  `reviewStatus: 'required'`, which keeps the ENTIRE scene out of Canon, so a false positive on a
  string no viewer was ever going to see would throw away that scene's unrelated location changes,
  relationship updates and memories with it. (`organization_memberships` is additionally
  constrained by `validators.ts` to an array of references, so it cannot carry prose at all;
  `availability` is free text and is the live risk.)
- `active` **is** published, but it asserts existence rather than describing it. Gating it would
  let a withheld scene RESURRECT a deactivated character — the fold would skip the deactivation,
  the field would keep its previous `true`, and the character projection would contradict
  `excludedCharacterIds`, which reads the same change on the motion path and has no safety input
  at all. It is listed in `EXISTENCE_CHARACTER_STATE_FIELDS` and never gated, exactly as
  `character_location_changed` and `character_life_changed` are never gated: withholding them
  would move a character on the map, or bring one back from the dead, because a sentence about
  them was under review.

Those constants live in `canon` because it is the one module both `simulation` (which classifies)
and `publicRead` (which projects) may depend on; `worldCharacterProjection.test.ts` pins them
against `CHARACTER_STATE_FIELD_MAP` so the two sides cannot drift.

### The timeline surface

`rebuildTimelineProjection` (`convex/publicRead/episodeTimelineProjectionFunctions.ts`) had no
gate either, and it is a public text surface: every entry carries an accepted event's
`publicSummary`, and it is read by the character page's "recent major events" list and by the
character card. A scene an operator withheld went on narrating itself there after
`rebuildLiveProjection` had already removed the same sentence from the dynamic surface. It now
runs the same `readWithheldSceneLabels` sweep and reuses `sceneEventRows` + `withheldEventIds` —
imported from `liveStateFunctions.ts` rather than re-implemented, so the two surfaces cannot
disagree about which events are refused. A refused entry is KEPT and loses only its
`publicSummary` (matching `redactWithheldSummaries`): the event happened, its participants and arc
membership are structural facts the timeline is about, and dropping the row would silently
renumber a public history. `publicSummary: null` was already a handled state on both consumers.

The two conventions above hold unchanged across all three surfaces. An event with no resolvable
`metadata.sceneId` (seed, system and remediation events, plus everything accepted before ART-132
stamped provenance) is not withheld — silence from the classifier means "never in scope", not
"refused". And the gate runs at rebuild time, so the refused text is never written into the
published payload for the last-known-good fallback to keep serving; a later override that releases
the scene republishes the value on the next rebuild without anything being re-simulated.

## 4b. The gate also covers the onboarding summary (ART-125)

`rebuildOnboardingSummary` (`convex/publicRead/onboardingSummaryFunctions.ts`) was the third
instance of the same gap, found when FR-O007 routed the `onboarding:<worldId>` model onto the
live map's story overlay. It is a public text surface built from three ungated inputs, all of
which land in `summaryText`: `publicSummary` read straight off `canonEvents`, `fact_created`
predicates and values harvested off their `stateChanges`, and the day's narration copied straight
off `dailyEpisodes.keyScenes`. A scene an operator had withheld therefore went on introducing the
world with its own refused sentence, to every first-time visitor, on the homepage as well as the
map.

It now runs the same `readWithheldSceneLabels` sweep and reuses `sceneEventRows`,
`withheldEventIds`, `redactWithheldSummaries` and `redactWithheldNarration` — imported from
`liveStateFunctions.ts`, never re-implemented.

| Field | How it is gated |
| --- | --- |
| `majorEvent` | picked from the redacted event array, so a refused event carries no summary and the pick falls through to the next showable one |
| `facts` | events whose scene is refused are skipped outright — `redactWithheldSummaries` drops only `publicSummary`, and §4a is why a fact's predicate and value are classifier-visible text |
| `scene` | `redactWithheldNarration` neutralises a key scene narrating a refused event, and the pick falls through to the next non-empty scene |

Unlike the timeline, this surface **skips and re-picks** rather than keeping the entry and nulling
its text. The timeline is a public history where dropping a row silently renumbers it; this is a
"here is one event worth knowing about" pick with no positions and no addressing, and leading the
world's introduction with `(無摘要)` would be strictly worse than leading with the best showable
event.

**The override now refreshes it too.** `overridePostGenerationSafetyLabel` runs
`rebuildOnboardingSummary` beside `rebuildLiveProjection`, in the same transaction, and reports
both refreshes in its result. Gating the rebuild alone would have left the refused sentence
published until the next natural Canon commit — which on a paused or finished world never comes,
so the operator would watch the dynamic surface go clean while the world's own introduction kept
quoting the text they had just withheld.

### Not yet covered by this gate

Two consumers of the same class remain ungated. They are pre-existing rather than introduced by
ART-124 or ART-125, and they are recorded here so a future task can pick them up rather than
rediscover them:

- `relationshipArcProjectionFunctions.ts` also publishes character-derived text without consulting
  the safety labels;
- `worldCharacterProjection.ts`'s `publicFacts` carries `fact_created` values for **non-character**
  subjects (world, location, item), which the widened classifier scan does not examine and the
  projection gate does not filter.

Note also that `overridePostGenerationSafetyLabel` refreshes `rebuildLiveProjection` and
`rebuildOnboardingSummary` only. The character and timeline projections pick the new verdict up on
their next rebuild — which the post-commit orchestrator runs on the next accepted event — rather
than within the override's own transaction. Fanning the override out to a per-character rebuild
would make an admin mutation's cost scale with the cast, so it was left to the existing rebuild
cadence deliberately. The onboarding summary is a single, world-scoped, bounded rebuild, which is
why it could join the transaction where the per-character ones could not.

## 5. Traceability (AC#5)

Every public string on the dynamic surface still resolves to an accepted event or a published
summary. The withheld placeholder is a constant, not derived content, and the scene carrying it
keeps its `sourceEventIds` — a public string with no provenance is precisely what the criterion
forbids, whatever the string says.

## 6. Observability

`rebuildLiveProjection` returns `withheldSceneCount` alongside `activeSceneCount`. A rebuild
that withheld everything and one that withheld nothing are otherwise indistinguishable from
outside, and the difference is the whole point of the gate.

## 7. Module boundary note

`architecture/module-boundaries.json` gained `safety` in `publicRead`'s `mayDependOn`. `safety`
depends only on `shared`, so there is no cycle, and `viewer` already depended on it. The
alternative — duplicating the label semantics inside `publicRead` — would have given the two
layers two chances to disagree about what "withheld" means.

`activeScenePresentation.ts` still imports nothing from `safety`: it declares `SceneSafetyLabel`
structurally, the same way it declares `SceneEventLike`, because FR-O013's replay builder pins
that module's whole dependency closure and refuses anything under `convex/safety/`.
`liveStateFunctions.ts` is where the two meet.

## 8. Known limitations

- The override is per **classification**, which for a simulated scene is per **Scene**. There is
  no per-event or per-sentence override; the Scene is the unit the classifier judged.
- Episode-level publication (`publicationRecords`) remains a separate lifecycle, gated
  separately in `visualReplayFunctions.ts`. The two are not unified, and a scene can be withheld
  while the episode narrating it is published — in which case the scene card shows the
  placeholder rather than borrowing the episode's approved words.
- **Override effectiveness is scoped to scenes committed after this feature shipped.** Events
  accepted before it carry no `metadata.sceneId`, so nothing correlates them to a
  classification and overriding that classification changes nothing observable. This is
  deliberate and there is no backfill migration: no production traffic predates the feature, so
  there is nothing real to back-fill. What the system does *not* do is claim otherwise — the
  mutation returns `correlatedEventCount`, and an override that reaches no committed event is
  audited with `outcome: 'no_op'` and a `…_UNCORRELATED` result code rather than a blank
  success. Their text was in any case already gated at generation time by
  `reviewStatus === 'required'`, which keeps a refused scene out of Canon entirely; what this
  task adds is the ability to change that verdict *after* the fact.
