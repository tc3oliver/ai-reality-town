# Publication and Safety Filtering on the Dynamic Surface (FR-P004, ART-132)

Modules: `convex/safety/schema.ts` (the `safetyStatusOverrides` ledger),
`convex/safety/postGeneration.ts` (`resolveEffectiveSafetyLabel`),
`convex/safety/effectiveSafetyLabels.ts` (the classification/override join),
`convex/operations/safetyOverrideFunctions.ts` (the operator command),
`convex/publicRead/activeScenePresentation.ts` (the scene-card gate),
`convex/publicRead/liveStateFunctions.ts` (where the gate is applied at rebuild time),
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
classification's `sourceId`, appends the override row, and runs `rebuildLiveProjection` for the
world. The refresh is what makes AC#3 true: a withhold removes the affected text from the
published projection immediately, not at the next Canon commit. One `operatorAuditLog` entry is
written in the same transaction (capability `safety.override`, target = the scene id).

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
