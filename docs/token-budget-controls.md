# Token budget, rate and concurrency controls (FR-M003 / ART-59)

FR-M003 asks for six things: a daily token cap, a per-module cap, a per-model cap, a maximum
concurrency, a retry budget, and an over-budget degradation strategy. PRD §16.3 then asks for five
measurements over the resulting traffic. This document records what is **enforced**, what is only
**measured**, and — for the two §16.3 ratios — which of the two each one actually is in this
deployment.

## 1. The ART-52 boundary

ART-52 (FR-K005) shipped the **configuration** layer and said so in its own header: the eight
per-module settings are stored, versioned, authorized, audited and readable, and nothing there
spends or meters. ART-59 is the **enforcement** half.

The per-module cap is **delegated, not copied**:

| FR-M003 dimension | Where the limit lives |
| ----------------- | --------------------- |
| 每模組上限 (per module) | ART-52's `moduleModelConfigs.dailyTokenBudget`, read through `resolveModuleConfig` |
| 每日 Token 上限 (per world day) | `tokenBudgetPolicies.worldDailyTokenBudget` |
| 每模型上限 (per model) | `tokenBudgetPolicies.modelDailyTokenBudgets` |
| 最大並行數 (concurrency) | `tokenBudgetPolicies.maxConcurrentCalls` |
| Retry 預算 | `tokenBudgetPolicies.retryTokenBudget` (+ the §16.3 share ceiling) |
| 超額降級策略 | `tokenBudgetPolicies.overBudgetStrategy` |

The five new dimensions have no home in a per-module row — `maxConcurrentCalls` is world-wide, and
a per-**model** cap is keyed on a model id rather than on a module, so a row per module would store
the same model map four times and let the copies disagree. The per-module cap stays where ART-52
put it, so a console change to it takes effect in enforcement without a second write.
`tokenBudgetEnforcement.test.ts` drives the delegation seam directly, so replacing it with a copy
fails a named test.

## 2. Where enforcement sits

```
worldDayLive.simulate_scenes
  └─ simulateWholeScene            ← owns the semantic retry loop
       └─ runBudgetedAttempt       ← ONE reservation per ATTEMPT
            ├─ gate.reserve()      → evaluateReservation (pure) → tokenBudgetLedger + counters
            ├─ provider.structuredChat(decision.model)
            └─ gate.settle()       → the provider's own reported usage
```

Gating per **attempt** rather than per scene is the whole reason the retry budget is a limit at
all: gating the outer call would offer the accountant one reservation for a scene that made three
provider calls, and the second and third — the retries the budget exists to bound — would never be
counted.

**Reserve, then settle.** The reservation is taken before the call with an upper bound (the
configured `maxTokens`); the real spend is booked after it from `ProviderTraceMetadata`. Booking at
reservation time would charge the bound rather than the spend; freeing the concurrency slot at
reservation time would make 最大並行數 unenforceable. Every granted reservation is settled or
released on every exit path including the throw path — a leaked in-flight count would permanently
consume one of `maxConcurrentCalls` for the world day.

**Known limitation, stated rather than hidden.** The reservation excludes prompt tokens, because
counting them before the call needs a tokenizer for the configured model and there is none in the
Convex runtime. A limit can therefore be crossed by up to one call's prompt before it binds. The
settlement is exact, so the day's totals and every subsequent decision are correct.

## 3. Determinism (AC#2)

`evaluateReservation` is a pure function of `(policy, moduleDailyTokenBudget, counters, request)`.
No clock, no randomness, no I/O. `now` reaches only `tokenBudgetLedger.recordedAt`.

Limits are checked in the fixed `BUDGET_LIMITS` order and the first breach in that order is the
`boundLimit`, so two evaluations of the same inputs name the same limit and select the same
strategy. **Every** breach is reported in `breachedLimits`, not only the binding one: a caller told
about one limit would fix it and be refused again immediately.

Day rollover is **structural**. Counters are keyed on `(worldId, worldDay)`, so the first call of a
new world day is evaluated against a zeroed record. Nothing runs at midnight and nothing reads a
clock to decide which budget applies — a calendar-day budget would put `Date.now()` in the decision
and let two replays of the same run disagree.

### The over-budget strategy

`refuse` is the floor and the default. `defer_to_next_world_day` refuses with a distinguishable
error code. `downgrade_to_fast_model` is carried out as a **single** re-reservation against the
configured fast class, and falls back to `refuse` **with a recorded reason** when it cannot be
carried out:

| Situation | Fallback reason |
| --------- | --------------- |
| No `fastModelClass` configured | `no_fast_model_configured` |
| The call is already on the fast class | `already_on_fast_model` |
| The breach is `concurrency` | `concurrency_is_not_relieved_by_a_cheaper_model` |

One hop, no ordering. FR-M004's ladder — retry the same model, then a compatible model, then fewer
scenes — is **ART-91**, which depends on this task. Building a second hop here would be ART-91's
ladder under another name.

A budget refusal is **not retried**: retrying would spend the retry budget arguing with the limit
that just refused the call. It reaches `scheduledSlots.errorCode` as `SCENE_BUDGET_REFUSED` or
`SCENE_BUDGET_DEFERRED` — a stable code, via the `{ error: { code, message } }` shape
`describeWorldDayError` already recognises for `CanonError`, so an operator can tell "over budget"
from "the provider broke" without guessing.

## 4. The audit trail (AC#2 "audited")

Two records, and neither replaces the other:

- **`operatorAuditLog`** — that a human changed the budget, and why.
- **`tokenBudgetLedger`** — what the system then did with it: one append-only row per reservation
  decision, granted or refused, carrying the bound limit, every breached limit, the selected
  strategy, and **the counter snapshot the decision was measured against**. Counters move; a
  refusal explained by "the world was at 990k of 1M" is unreconstructable a day later from live
  counters, so the snapshot travels with the decision.

Secret-safe by construction: the row carries **no free text**. Every string on it is either an
identifier or a member of a closed enumeration, asserted structurally in `tokenBudget.test.ts` so
that a string field added later fails the test until it is one or the other.

`tokenBudgetCounters` is the one mutable row ART-59 owns, and deliberately so: a counter is a
running total, and appending a row per token would make the per-attempt read an unbounded scan.
The audit of how the total moved is the ledger; the two reconcile because every ledger row names
the snapshot it saw.

Reservation, settlement and release are each **idempotent** on the decision id
(`tokenBudgetLedger.resolution`), because a Convex mutation can be retried and a second evaluation
could otherwise flip a refusal into a grant, or book one provider call's tokens twice.

## 5. §16.3: what is enforced and what is measured

### Retry tokens ≤ 10% of total (§16.3, AC#4)

**Enforceable, and measured; not enforced by default.**

Setting `maxRetryTokenShare` makes the threshold hold by construction: a retry whose tokens would
push the day's share past the ceiling is refused. The evaluation includes the request on both
sides — `(retry + spend) / (total + spend) <= ceiling` — which is the only formulation that can
hold as an invariant.

It is **not** on by default, and the reason is a real property of share ceilings rather than an
oversight: at the start of a world day total spend is 0, so the very first retry of the day always
computes a share of 1.0 and would be refused however healthy the day went on to be. With a 10%
ceiling a retry needs at least 9× its own cost already spent that day before it can be granted.
Defaulting it on would turn "retry once after a transient provider failure" — the behaviour ART-74
AC#1 pins — into a refusal. So the default is to **measure** it, and a deployment that wants the
hard ceiling configures it.

Evidence: `longRunHarness.test.ts` measures the share over the fixed-seed 7-day run with a
non-empty denominator (the numerator is 0 there, because the deterministic author never fails);
`tokenBudgetEnforcement.test.ts` measures it over a run with an **injected transient provider
failure**, so the numerator is positive; `tokenBudget.test.ts` proves the ceiling refuses a retry
that would breach it, and that the threshold assertion fails at 20%.

### >80% of low-importance work on the fast model (§16.3, AC#5)

**Enforceable by routing, and honestly unmeasurable in this deployment.**

`routeModelForWork` sends every `low`-importance request to the configured fast class — there is no
other branch — so whenever the sample is non-empty the share is 1.0 by construction.

But **this deployment produces no low-importance LLM work.** The only LLM call path is whole-scene
simulation, and `parseAndValidateDirectorPlan` admits at most `MAX_MAJOR_SCENES_PER_SLOT` **major**
scenes per slot; `director_plan`, `character_intent` and `editorial` are deterministic algorithms
with no provider at all (ART-52's `MODULES_WITH_PROVIDER_CONSUMERS`). The denominator is therefore
empty by construction, and `summarizeResourceUsage` reports the share as `null` with a stated
reason rather than as a number. A ratio over an empty sample is not 0 and it is not 1; reporting
either would be a fabricated measurement. This follows the `value: null` + `reason` discipline
`dynamicViewMetricsFunctions.ts` already established.

**The >80% threshold is therefore not evidenced by production traffic in this deployment.** The
routing mechanism is shipped and proven over a non-empty synthetic sample in `tokenBudget.test.ts`,
including that the assertion fails at 70% and at exactly 80% (the PRD says "higher than", not "at
least").

### Public reads add no LLM call (§16.3, AC#3)

**Structurally zero, and provably so.** `BUDGET_ORIGINS` is a closed enumeration with no
public-read member, and a reservation is a **write**: every anonymous-gated function in the public
surface policy is a Convex query, which can neither write nor schedule. Two tests keep the zero a
proof rather than an assumption — `tokenBudget.test.ts` pins the enumeration exhaustively, and
`tokenBudgetEnforcement.test.ts` scans every file under `convex/publicRead` and `convex/viewer` for
any reference to the enforcement surface. That scan is needed because the dependency policy does
allow `publicRead → shared`, so nothing in the boundary file alone stops a public read module
importing the accountant.

### Outage availability and daily cap compliance (§16.3, AC#3)

Refusals are counted **per limit**, with every limit present in the map so a zero is a measured
zero. Daily cap compliance is reported per world day, naming the days over cap; with no cap
configured it is `null` with a reason, not `true` — "complied with no limit" and "complied with a
limit" are different statements and a dashboard cannot tell a green tick apart from a missing one.

## 6. Concurrency: enforced, but not reachable today

`maxConcurrentCalls` is enforced by `evaluateReservation` and proven by unit tests that interleave
reservations. It **cannot currently bind on the live path**, because `runQueuedWorldDaySlot`
executes one slot's scenes sequentially inside a single Convex mutation, so `inFlight` is only ever
0 or 1. This is recorded rather than presented as coverage: the limit is real, and the deployment
does not yet produce the concurrency it bounds.

## 7. Operator surface

| Function | Capability | Role |
| -------- | ---------- | ---- |
| `setTokenBudgetPolicy` | `budget.write` | `admin` |
| `inspectTokenBudget` | `budget.inspect` | `viewer` |
| `listTokenBudgetLedger` | `budget.inspect` | `viewer` |
| `describeTokenBudgetDefaults` | `budget.inspect` | `viewer` |

`budget.*` is separated from `model_config.*` for the reason `dynamic.pause` is separated from
`world.pause`: they govern different things. Model configuration decides **how** a world is
authored; a budget decides **whether** it is authored at all today — setting
`worldDailyTokenBudget` below the day's cost stops the world producing scenes, which is closer to a
pause than to a configuration change.

All four go through `requireOperator`/`recordAudit` from `opsConsoleFunctions`, inheriting the
whole gate. None is on the public read path, and none could usefully be: `sanitizeForPublic` strips
every key matching `/token/i`, so a payload carrying `totalTokens` would be silently emptied.

An unconfigured world resolves to `TOKEN_BUDGET_POLICY_DEFAULTS` — every limit `null` — so ART-59
changes nothing for a world nobody has configured. A stored policy that no longer validates
resolves to the defaults too rather than throwing, and reports `source: 'default'`: a malformed
policy must not be able to stop a world simulating, and the fallback has to be visible.

## 8. Deployment notes, and the one failure that would be silent

No new environment variable. `worldDayLiveFunctions.ts` binds `deploymentModelId` to
`FAKE_SCENE_MODEL` because that is the model the live path actually calls —
`createWorldDayStageHandlers` is invoked there without a provider argument and defaults to the
deterministic `FakeWholeSceneProvider`.

**ART-72, injecting a real adapter, must repoint that binding in the same change.** If it does
not, the reservation keys on `FAKE_SCENE_MODEL` while the real model spends: the per-model cap
meters a bucket nothing spends from, and **every other signal keeps looking healthy** — slots
complete, the ledger fills with granted decisions, daily totals move, and the cap simply never
binds. That is the only failure in this subsystem whose symptom is silence, so it is defended
twice rather than documented once.

**Build time — `convex/simulation/sceneBudgetProviderPin.test.ts`.** Pins that the live entry
point still constructs its stage handlers with exactly one top-level argument, and that the meter
is pointed at `FAKE_SCENE_MODEL`. Injecting a provider there fails the build, and the failure
message *is* the instruction: repoint `deploymentModelId` or the cap will meter the wrong model.
The argument counter is depth-aware — the real call contains a nested comma — and a test asserts
the counter would actually see a second argument, so the pin cannot pass because it counts wrong.

**Run time — `BudgetSettlement.reportedModel`.** The provider's own reported model
(`ProviderTraceMetadata.model`) is compared against the metered key at the moment the tokens are
booked, which is the only moment both ids exist. A divergence increments
`tokenBudgetCounters.modelMeteringMismatches`, is recorded per decision as
`tokenBudgetLedger.settledModel` next to the `model` it was metered under, and surfaces on the
report as `modelMeteringMismatches` with `MODEL_METERING_MISMATCH_REASON` naming both known
causes. This catches what a source pin structurally cannot see: a gateway that answers with a
different model id from the one it was asked for.

A mismatch is **counted, not thrown**. A gateway answering with a pinned revision of the requested
model (`gpt-4o` → `gpt-4o-2024-08-06`) is legitimate, and throwing would take the world down over
a naming convention. The tokens stay booked under the **metered** key, so the cap that was
evaluated is the cap that is charged and the reservation and the settlement cannot disagree about
which limit they were about.

This is deliberately *not* a log line. A durable tally and a per-decision record are queryable and
survive; a `console.warn` in a Convex mutation is visible only to whoever happens to be reading
function logs at the time, which for a silent failure is nobody.

## 9. Tests

| File | What it proves |
| ---- | -------------- |
| `convex/shared/tokenBudget.test.ts` | the pure decision: all five limits, determinism, strategy selection, day rollover, the audit record, and both §16.3 ratios over non-empty samples |
| `convex/operations/tokenBudgetEnforcement.test.ts` | the decision reaches the provider call, through the real pipeline, with a negative control for every enforcement case |
| `convex/operations/longRunHarness.test.ts` | the §16.3 report over the fixed-seed 7-day run, measured by the accountant that enforced it |
| `convex/simulation/sceneBudgetProviderPin.test.ts` | the ART-72 landmine at build time: a provider injected into the live path without repointing the meter breaks the build (§8) |
