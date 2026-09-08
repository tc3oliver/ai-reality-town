# Model-outage degradation ladder (FR-M004 / ART-91)

What a world does when the model, the quota or the provider stops working: six ordered rungs,
each a smaller thing the world is still able to do, and four guarantees that hold identically on
every one of them.

Related: `docs/token-budget-controls.md` (FR-M003, which refuses calls that would breach a cap —
the rung-0 that keeps a budget breach from ever becoming an outage), `docs/model-configuration.md`
§7 (`fallbackModel`, the value rung 2 switches to), `docs/world-day-execution.md` (the stage
sequence every rung still runs), `docs/post-commit-pipeline.md` (the recap pyramid rung 5 defers),
`docs/world-emergency-stop.md` (FR-K001/FR-K006, the other two ways a world stops).

**Not** `docs/dynamic-view-degradation.md`. That is FR-O010, a different ladder in a different
process about a different fault. See §10.

## 1. The ladder

PRD FR-M004 lists six steps in order. `convex/simulation/degradation.ts` is that list, and it is
the only place the order is written down.

| Rung | `level` | What changes | What enforces it |
|---|---|---|---|
| 1 | `normal` | Full authoring. "Retry the same model" is the per-call attempt budget the provider adapter already had; the ladder adds nothing here | `LLM_MAX_ATTEMPTS` in the provider adapter |
| 2 | `compatible_model` | The plan's requested model becomes the module's configured `fallbackModel` (see §11 for how far that reaches today) | `degradedPlan` in `convex/simulation/worldDayLiveFunctions.ts` |
| 3 | `fewer_scenes` | The plan is truncated to `REDUCED_SCENES_PER_SLOT` major scenes, which is 1 | `degradedPlan`, same function |
| 4 | `rules_only` | No provider call at all. The slot proposes deterministic background events derived from world state | `runRulesOnlySlot` + `convex/simulation/rulesOnlyAuthor.ts` |
| 5 | `deferred_summaries` | Rules-only, and the non-obligatory recap tiers are skipped | `DEFERRABLE_RECAP_TYPES` + `deriveRecapTargets` in `convex/operations/postCommitLive.ts` |
| 6 | `paused` | No new simulation is admitted until an operator resumes | The admission gate in `prepareQueuedWorldDaySlot` |

Each rung keeps its predecessors' reductions. A world on `rules_only` is also on fewer scenes,
because climbing back through a rung it never exercised would tell an operator nothing about
whether that rung works. `policyFor` is the whole table, and `degradation.test.ts` asserts all six
flags for all six levels rather than spot-checking them.

## 2. Descending

`advanceDegradation` folds one slot outcome into the world's state. It is pure: no Convex, no
clock, no randomness. Two constants carry the policy.

| Constant | Value | Why |
|---|---|---|
| `FAILURES_BEFORE_ESCALATION` | 2 | One failure is what the per-call retry budget already exists to absorb. Degrading on it would move a world down a rung for a single 500 |
| `REDUCED_SCENES_PER_SLOT` | 1 | 「減少主要場景」 with three scenes still costs three calls |

**At most one rung per decision, and never a skip.** `nextLevel` is a total function on the
ordered list, so rung 3 is reachable only from rung 2. That is a property of the module rather
than of its callers: no caller can request a jump, because there is no argument that would express
one. `degradation.test.ts` walks `normal` to `paused` and requires exactly ten failures.

On escalation the failure count resets, so the new rung gets its own two chances. At `paused`
there is nowhere further to go, so the count keeps rising and the state records it. A paused world
that is still failing is a fact an operator needs.

## 3. What escalates, and what deliberately does not

Only a provider-side failure moves the ladder. `DEGRADATION_TRIGGER_CODES` is the closed set:

```
LLM_HTTP_RETRYABLE   LLM_TIMEOUT              LLM_NETWORK_ERROR
LLM_FREE_ROUTES_EXHAUSTED                     LLM_CONFIG_MISSING
LLM_AUTH_REQUIRED    LLM_CHAT_INCOMPATIBLE
SCENE_SIMULATION_FAILED                       SCENE_AUTHORING_DEFERRED
SCENE_BUDGET_REFUSED SCENE_BUDGET_DEFERRED
```

Every one of them says something about the model, the route or the allowance. Codes that say
something about the **request** are absent on purpose. A Canon rejection, a safety refusal or a
malformed schema moves neither the level nor the counter, because no rung of this ladder makes a
rejected request acceptable, and escalating on one would degrade a world for saying something the
safety gate correctly refused.

`isDegradationTrigger` is conservative in the same direction: an unrecognised code escalates
nothing. A new failure mode therefore has to be added to this set deliberately, which is the safe
default for a mechanism whose bottom rung stops the world.

### The defect this uncovered

`describeWorldDayError` in `convex/simulation/worldDayOrchestration.ts` used to collapse every
error without a Canon-shaped `.error` field into the single string `WORLD_DAY_STAGE_FAILED`. That
was wrong, and it had been wrong since the function was written. A provider outage, a timeout, an
exhausted route chain and a budget refusal all reached `scheduledSlots.errorCode` as the same
generic code, so an operator reading a failed slot could not tell an outage from a malformed
scene, and any ladder built on that field would have escalated on all four or on none.

It now preserves any error's own stable `code`, read off the field rather than by `instanceof`, so
the orchestration module keeps its freedom from provider imports. `SimulationProviderError` and
`SceneSimulationError` both carry one. FR-M004 needs exactly this distinction: only provider-side
codes escalate, and a generic code escalates nothing.

## 4. Recovering

One authored slot recovers one rung. A world pushed down by a transient outage climbs back at the
same speed it fell, and its failure count resets, because the count means "failures at **this**
level".

`paused` is the exception. Nothing recovers from it automatically, because pausing is the rung
that says the automatic responses are exhausted; an operator resuming is the signal that the cause
was addressed. `resumeFromPause` returns the world to `rules_only`, **not** to `normal`. A world
that just failed six ways does not get its full model budget back on one click: handing it one
would put it straight back into the outage it descended through, with the ladder's own counter
reset, so it would have to walk all five escalations again before it returned to the bottom.
Rules-only keeps world time advancing on deterministic events while the next successful authored
slot climbs it back one rung at a time, on evidence rather than on optimism.

## 5. Rung 4: what a rules-only slot may assert

`deriveRulesOnlyEvents` is pure and deterministic in the strict sense. The same context yields the
same events, in the same order, with the same keys. Locations are taken in sorted order, so the
output does not depend on how the caller happened to build the placement list.

**They are proposals, not accepted events.** This is the rung most likely to be built as a bypass:
the cheapest possible implementation writes "rules-derived" events straight into Canon on the
grounds that the rules already guarantee them. Instead they carry derived `idempotencyKey`s of the
form `rules:<worldId>:<worldDay>:<timeSlot>:event:<n>`, pass `validateEventStructure`, and are
committed through `commitProposedEvent`, which runs Canon validation against the projection it
reads. The precedent is FR-J001's viewer-vote environment events, which have always been
proposals.

**They assert only what the world already implies.** One `world_event` per occupied location,
capped at `MAX_RULES_ONLY_EVENTS_PER_SLOT` (2), carrying exactly one public `fact_created` saying
the slot passed at that place. No relationship change, no memory, no knowledge, no rumor: every
one of those would be an interpretation, and there is nothing here qualified to make one. The type
is `world_event` rather than `conversation` because nothing observed anyone talking. Each event
carries `metadata.authoring = 'rules_only'`, so anything downstream can recognise it without
guessing from its shape.

**This is not the deterministic fake narrator.** The fake author invents what people said and what
it meant, and it exists so the pipeline can be exercised without a model. Serving its output
during a real outage would put invented narration into Canon and into the public record with
nothing marking it as such. FR-M004's own wording avoids that by saying 「規則型背景事件」 rather
than 「用便宜的模型寫」. The fake cannot be reached by failure either: `sceneAuthorFor` is a closed
two-value mode with no default, and neither `degradation.ts` nor `rulesOnlyAuthor.ts` names it.

**A quiet slot is not a failed slot.** A rules-only slot that derives nothing, because every
location is vacant, still completes. Failing it would push the ladder down for a world that is
merely quiet.

Rules-only runs in the **transactional** pass, before authoring is considered, because there is
nothing to author and routing it through the action would put an empty network call between the
same two mutations.

## 6. Rung 5: which summaries are deferred, and why `episode` is not

`DEFERRABLE_RECAP_TYPES` is `scene`, `arc`, `season` and `viewer_context`. `episode` is not in it,
and that omission is the whole decision.

The Episode is the day's public record and the thing the coverage gate obliges. Deferring it would
leave a day of Canon that no published content accounts for, which is exactly what PRD §16.2
measures as a coverage failure. Degradation must not manufacture the gap the quality metrics exist
to detect. `deferredSummaries.test.ts` asserts both directions: the deferrable set is exactly those
four, and it does not contain `episode`.

`viewer_context` is deferred because it is the per-world onboarding summary, and a viewer arriving
during an outage is better served by yesterday's than by nothing.

**There is no backfill queue, and none is needed.** Skipping a tier leaves its cursor untouched,
so the next healthy run covers the same range and the pyramid closes itself. The cursor **is** the
backlog. `deferredSummaries.test.ts` proves this against the real recap stage rather than asserting
it: a deferred tier asks for no snapshot at all, its cursor is unmoved afterwards, and the
`episode` tier is generated over the same range in both the healthy and the degraded run.

`deriveRecapTargets` takes `deferSummaries` as a parameter defaulting to `false`, so every
pre-ART-91 caller is unchanged. The live pipeline supplies it through `defersSummaries` on the
post-commit port, which reads the degradation state. The state lives in a `simulation` table, and
`operations` reads it through the same kind of port boundary it reads every other capability
through.

## 7. Rung 6 is a third, separate stop

A world can be stopped three ways, and all three can be true at once. Each is released only by its
own action.

| Stop | What it stops | Released by |
|---|---|---|
| `world.pause` (FR-K001) | The scheduler reserving new slots. The existing queue still drains | Resuming the schedule |
| Kill switch (FR-K006) | The executor claiming any slot, including queued ones | Clearing the emergency stop |
| `paused` (FR-M004 rung 6) | Admission of new simulation, because the world's automatic responses to a provider outage are exhausted | `resumeDegradation` |

The rung-6 check sits in `prepareQueuedWorldDaySlot` **before the slot is claimed**, immediately
after the FR-K001/FR-K006 assertion, for the same reason that one is early: a slot claimed and then
refused has burned a lease and left a `running` row behind. It throws
`WORLD_DEGRADATION_PAUSED`, so the driver's per-world catch reports which of the three stops
applied.

## 8. The four invariants, and where each is enforced

FR-M004 forbids skipping Canon Validation, Safety Validation, Idempotency and Event Persistence.
The ladder cannot skip them because it does not run them. `degradation.ts` returns a **level**, and
every level's events travel the same path.

| Invariant | Where it still runs on every rung |
|---|---|
| Canon Validation | `validate_canon` in the world-day stages; for rung 4, inside `commitProposedEvent` |
| Safety Validation | The post-commit safety gate, unchanged and upstream of publication |
| Idempotency | Derived keys: authored proposals from `(worldId, worldDay, timeSlot)`, rules-only from the same triple plus an index |
| Event Persistence | `commit_accepted_events`, the only writer on either path |

Keeping the decision pure is what makes this checkable rather than merely stated: a rung that
bypassed a gate would have to be written somewhere else entirely, and `degradationFunctions.ts` —
the only Convex surface the ladder owns — writes two rows about the world's operating mode and
touches no Canon table, no publication and no read model.

## 9. Traceability and the operator surface

`worldDegradationStates` holds exactly one row per world: the current rung, the consecutive
failures counted at it, and where it last moved. `worldDegradationTransitions` is append-only, for
the reason `safetyStatusOverrides` is separate from the classification it revises — how a world got
here must not be editable by the thing that moves it.

A `transitionId` is derived from `(worldId, worldDay, timeSlot, kind)` and inserted only if absent,
so a retried slot re-reaches the same decision and records one move rather than one per attempt.
**Replaying a slot therefore cannot walk the ladder.** That is AC#2, and it is enforced in
`degradationFunctions.ts` rather than in the pure module, because it is a property of the store.

The ladder is fed from `authorAndSettle` in
`convex/simulation/providers/liveWorldDayActions.ts`, and only from there, because that is the one
place that knows whether the **provider** worked. The finishing mutation sees only whether the
scenes it needed were present, which is the same symptom for an outage and for a slot never
authored. The outcome is recorded before the slot is settled, so a world whose provider has now
failed twice is already on the next rung when the next tick claims it. A `settled` slot that
**completed** feeds the ladder too, since that is what recovers a rung.

Two operator functions, both in `convex/operations/worldQualityFunctions.ts`:

- **`getDegradationStatus`**, gated on `world.inspect`. Returns the level, the full `policyFor`
  table for that level, the consecutive failure count, the last trigger code, and the most recent
  transitions, newest first, bounded to at most 200.
- **`resumeDegradation`**, gated on `world.resume`. The existing FR-K001 capability for restarting
  a stopped world, applied to a different stop rather than given a new name. It writes an
  `operatorAuditLog` row either way, with `DEGRADATION_RESUMED` when it moved the world and
  `DEGRADATION_NOT_PAUSED` when the world was not on rung 6.

Every field on a transition is an id, a level, a code or a number. Never a payload.

## 10. This is not the dynamic-view ladder

`docs/dynamic-view-degradation.md` documents FR-O010 / ART-127, and the two are easy to confuse
because both are called a degradation ladder and both have rungs. They share nothing.

| | FR-M004 (this doc) | FR-O010 |
|---|---|---|
| Fault | The model, the quota or the provider is unavailable | The browser cannot draw the map: no WebGL, or the renderer threw |
| Where | Convex, server-side | The viewer's browser |
| State | Persisted per world in `worldDegradationStates` | Derived per render by `resolveDegradationLevel`, never latched |
| Effect | Less is generated, and eventually nothing is | The same published data is drawn a simpler way |
| Exit | A successful authored slot, or an operator | The next render, once the renderer works |

FR-O010's rungs change **presentation only**; no rung of it changes what Canon contains or what is
published. FR-M004's rungs change **what the world generates**; no rung of it changes how the
client draws anything. PRD §13 requires them to coexist, and the PRD 2.0 matrix records FR-O010 as
`New` with its own task for that reason. A world on rung 5 of this ladder is still served at rung 1
of that one, which is the point of AC#4: the public keeps its last known good content.

## 11. Known limits

- **Rung 2 substitutes the plan's requested model, and that id does not reach the provider call's
  `model` override.** `degradedPlan` replaces `plan.requestedModel`, which travels to the FR-M003
  budget reservation and to the finishing mutation's `deploymentModelId`. The id sent on the wire
  comes from `plan.options.model`, built by `wholeSceneOptionsFor` and untouched by `degradedPlan`,
  and `simulateWholeScene` sends an override only when the budget gate *changed* the model relative
  to the reservation — which a degraded plan does not make it do. So a world on rung 2 today meters
  its calls against the fallback model while still calling the model it was already calling. Rung 2
  is not a no-op, since the reservation is what a per-model cap binds on, but the wire-level switch
  is not there yet and no test asserts one.
- **Nothing exercises rung 2 or rung 3 end to end.** `degradation.test.ts` proves the policy table
  says what those rungs mean, and `degradationIntegration.test.ts` drives a total outage, where the
  fallback would fail as well. The plan-level substitution itself is covered only by the policy
  flags.
- **The ladder is fed only from the live action path.** A world advanced through
  `runQueuedWorldDaySlot` alone, as the deterministic and long-run harnesses do, records no slot
  outcome and therefore never moves. That is correct for a fake-provider run, which has no provider
  to be down, but it does mean the ladder is inert on any path that does not go through
  `authorAndSettle`.

## 12. Evidence

Four suites, in increasing scope.

- **`convex/simulation/degradation.test.ts`** — the state machine. The rung order matches PRD
  §16.3, ten failures walk the whole ladder, `FAILURES_BEFORE_ESCALATION` is a threshold and not a
  comment, Canon and safety codes escalate nothing even in bulk, recovery is one rung per authored
  slot, `resumeFromPause` returns to `rules_only`, transition ids re-derive, and no rung
  un-reduces something a higher rung reduced.
- **`convex/simulation/rulesOnlyAuthor.test.ts`** — rung 4's contract. Determinism independent of
  input order, derived keys distinct across world, day and slot, the per-slot cap, structural
  validation, Canon validation against the **seeded** baseline at every time slot, exactly one
  public `fact_created` and nothing else, and a publishable zh-Hant summary within the public
  budget.
- **`convex/operations/deferredSummaries.test.ts`** — rung 5, against the real recap stage: the
  deferrable set, the `episode` exemption, the same episode range in both cases, no snapshot
  requested for a deferred tier, and the untouched cursor that is the backfill.
- **`convex/operations/degradationIntegration.test.ts`** — AC#3, AC#4 and AC#5 against ART-60's
  real fixture, reusing `createLongRunFixture` rather than a parallel harness. A total provider
  outage leaves the public last-known-good payload and version unchanged; the ladder descends on
  the outcomes the real pipeline produced rather than on hand-written ones; rules-only events
  commit through the real validation and dedupe on retry; recovery climbs one rung per authored
  slot; and admission is refused at rung 6, resuming to `rules_only`.
