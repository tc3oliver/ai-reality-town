# Dynamic view observability reference

**Requirement:** FR-Q001 (PRD 2.0 §12 Epic Q) · **Task:** ART-133

PRD 2.0 §18.1 sets two numbers to exactly zero and §12 names eleven metrics that must be
"at least recorded". Four of the eleven cannot be recorded the way the other seven are.
This document explains which, why, and what was built instead.

The design decision worth stating up front: **an unmeasurable metric is declared
unmeasured, not faked as a zero.** A permanent `0` and a healthy measurement of zero look
identical on a dashboard and mean opposite things, and an operator would act on the
difference. PRD FR-Q007 explicitly sanctions marking a metric 未量測 rather than estimating
it, and that is what the `provenance` field on every registry entry does.

## The eleven metrics

Declared in `convex/publicRead/dynamicViewMetrics.ts` (`DYNAMIC_VIEW_METRICS`), read
through `inspectDynamicViewMetrics`.

| # | PRD name | Key | Provenance | Owner |
|---|---|---|---|---|
| 1 | Runtime Projection 更新延遲 | `runtimeProjectionLatency` | `server_measured` | — |
| 2 | Snapshot 年齡 | `snapshotAge` | `server_measured` | — |
| 3 | Active Viewer 數量 | `activeViewerCount` | `client_external` | ART-136 |
| 4 | Renderer Error Rate | `rendererErrorRate` | `client_external` | ART-137 |
| 5 | Canon／Runtime Location Mismatch | `canonRuntimeLocationMismatch` | `server_measured` | — |
| 6 | Missing Character Binding | `missingCharacterBinding` | `server_measured` | — |
| 7 | Missing Location Binding | `missingLocationBinding` | `server_measured` | — |
| 8 | Public Mutation Attempt | `publicMutationAttempts` | `structural_zero` | — |
| 9 | Viewer-triggered LLM Call Count | `viewerTriggeredLlmCalls` | `structural_zero` | — |
| 10 | 降級模式使用率 | `degradationModeUsage` | `pending_feature` | ART-127 |
| 11 | Replay 播放次數與跳過率 | `replayPlaySkipCounts` | `pending_feature` | ART-121 |

Eleven, not twelve: the PRD's final item is one metric carrying two counters
("播放次數與跳過率"), not two metrics.

### What each provenance means

- **`server_measured`** — derived from something this deployment can see. Returns a value.
- **`structural_zero`** — the value is zero because the architecture makes a non-zero value
  unrepresentable, not because a counter happens to read zero.
- **`client_external`** — genuinely unmeasurable from the server. Returns `null` and a
  `reason`, plus the task that owns closing the gap.
- **`pending_feature`** — the feature being measured does not exist yet. Returns `null`,
  a `reason`, and the owning task. No table column, no counter, no logic — the registry
  entry exists so the owning task populates a declared slot instead of inventing a new
  contract, the same way `PUBLIC_MOTION_TYPES` already reserves `'replay'`.

## Why two metrics are `client_external`

Active viewer count and renderer error rate both require the **browser to report**: a
session is only observable where the session is, and a renderer error is only observable
where the renderer runs. Any such reporting is a write from the client.

`readOnlyClientBoundary` in `architecture/module-boundaries.json` forbids every client
write primitive — `useMutation`, `useAction`, `useConvex`, and every Convex client class
outside the single provider shim — and `convex/publicRead/publicReadOnlyGuarantee.test.ts`
(ART-128 / FR-O009) asserts the shipped bundle reaches exactly one Convex function, a
query. Adding a reporting mutation would not be an extension of that guarantee; it would
be a hole in it.

So these are not built. ART-136 and ART-137 own whatever mechanism eventually collects
them — most likely an external analytics sink rather than a Convex write path, which is
also FR-Q007's territory.

## Why anonymous denials are not durably recorded

FR-Q001 AC#3 asks that public mutation attempts be "rejected and recorded". The rejection
half is proven adversarially by ART-128's suite: every public mutation is invoked with no
identity and with forged credentials against a `db` proxy that throws on any access, so a
denial that consulted a row would fail the build.

The recording half runs into a constraint the operations console already documented
(`convex/operations/opsConsoleFunctions.ts`, `docs/simulation-operations-console.md`):

1. **A Convex mutation is transactional.** A row written on the path to a rejection is
   rolled back *by that same rejection*. A durable per-attempt table therefore cannot
   work — not "is hard", cannot.
2. **An unauthenticated caller who could append a row per attempt would have an
   unauthenticated storage-exhaustion vector.** Even if (1) were solvable, this would be a
   worse problem than the one it solved.

ART-133 does not quietly reverse that decision. Instead the operator response carries:

- `successfulPublicMutations: 0` — structural, proven by iterating the public function
  surface policy and asserting no `gate: 'anonymous'` entry is a mutation. Adding an
  anonymous mutation later breaks the build rather than silently making this a lie.
- `anonymousDenialsDurable: null` with an explicit `reason`. The limitation is *declared*,
  which is what makes it visible; an absent field would let a reader assume zero.
- `operatorRefusals` — the count of `outcome: 'refused'` rows already defined in the
  `operatorAuditLog` schema. These are *authorized-but-refused* commands and are genuinely
  durable, because they are recorded on a path that does not throw. ART-133 only counts
  them; broadening which call sites write them belongs to ART-134.

Denied anonymous attempts remain observable in the Convex function logs, which is the
existing documented mechanism.

## What is genuinely new

Two of the five `server_measured` metrics required a detector that did not exist.

**Canon/runtime location mismatch** (`convex/publicRead/canonRuntimeMismatch.ts`). "Where
is this character" is answered twice, independently: the Canon reducer folds
`character_location_changed` facts into `characterLocations`, and the Visual Sync Planner
folds the same events into a trajectory whose `semanticLocationId` is what gets published.
They agree today, and ART-117 proved the planner is *self-consistent* — which is not the
same as being in agreement with Canon. Nothing compared the two until now, so a divergence
would have shown a character standing somewhere Canon never said they were, with no error
anywhere. That is exactly §18.1's "unhandled drift".

A character **absent** from `characterLocations` is not a mismatch. Canon records a
location only once a character moves, so a seeded character who has never moved has no
entry while the planner still publishes them at their seeded position. Treating that as
drift would make every fresh world report twelve faults on day one.

**Missing character binding** (`convex/visualRuntime/characterBindings.ts`). The planner
only ever consults `LocationVisualBinding`; it never asks whether a character has a
sprite. A character with no `CharacterVisualBinding` was planned, published, and then
failed silently in the browser. The check deliberately lives *outside*
`planCharacterTrajectories`: a missing location binding makes a position underivable, so
withholding the motion is right, but a missing sprite does not — the character is still at
a real place, and suppressing the motion would turn a presentation gap into a
Canon-visible one.

**Missing location binding** was already computed (`VISUAL_RUNTIME_UNBOUND_LOCATION`) and
summarised to counts only. FR-Q001 AC#4 needs the attribution that was being discarded.

## Storage

Two tables, in `convex/publicRead/schema.ts`, split on purpose.

`dynamicViewIncidents` is **sparse and per-occurrence**. A healthy world writes nothing.
AC#4 requires a defect to be locatable to a character, a location and a sequence, and a
counter cannot do that. Vacuumed on the standard two-week retention
(`TablesToVacuum` in `convex/crons.ts`): these are diagnostics, and a defect nobody looked
at for a fortnight is not evidence.

`dynamicViewMetricRollups` is **dense and bounded** — exactly one row per world, patched in
place. It is deliberately *not* vacuumed, for the same reason `publicRuntimeSnapshots` is
not: it holds a world's only metrics row, and vacuuming by `_creationTime` would delete a
long-quiet world's entire history rather than trimming it.

### Latency histogram

`LATENCY_BUCKET_BOUNDS_MS = [250, 1000, 2500, 5000, 15000, 60000]`, plus an overflow
bucket, so seven counters per world.

A histogram rather than a sample list: storage stays O(worlds) however long a world runs,
and P95 is derived at read time. `5000` is PRD 2.0's stated P95 target, so the objective
and a bucket edge are the same number and a regression appears as samples crossing one
boundary.

The cost is resolution. A quantile is reported as **a bucket bound**, not an interpolated
value — the samples are gone, so any finer number would be invented. A quantile that lands
in the overflow bucket has no upper bound and reports `null`; `maxMs` is the honest answer
there.

Latency is measured as `now - dynamic.updatedAt`, and `updatedAt` is the last accepted
event's `acceptedAt`. This is therefore **end-to-end** — Canon fact to published
projection — not the handler's own duration. A world with no accepted history has
`snapshotSequence === 0` and no fact to measure from, so it records `0` rather than the
distance to the Unix epoch.

## AC#5: the field allowlist

`DYNAMIC_INCIDENT_FIELDS` is the complete set of fields a persisted incident may carry, and
`assertDynamicViewIncident` runs before every insert. It throws on two independent grounds,
because they fail for different reasons:

- an **unknown** field is contract drift — someone widened the row;
- a **forbidden** field (anything in `PUBLIC_DYNAMIC_FORBIDDEN_FIELDS`, checked recursively
  at any depth) is a leak — someone widened what the row carries.

Either throw rolls the whole rebuild back, because the metrics commit runs inside
`rebuildLiveProjection`'s transaction. Publishing a projection while silently discarding
the record of what was wrong with it is the one outcome worth failing loudly over.

Every field on the list is **already public elsewhere**: `characterId` and `locationId` are
the published `PublicCharacterMotion.characterId` and `.semanticLocationId`, and both
sequence numbers are published root fields. Nothing recorded here is a new disclosure.

`VisualRuntimeProblem.message` is conspicuously absent. It is the only free-text field on
the source record, and free text is exactly where a future edit would quietly interpolate
something private. The drop is enforced by a type signature — `toIncident` accepts
`Omit<VisualRuntimeProblem, 'message'>`, so TypeScript refuses an inline literal that
carries one — rather than by remembering to omit a key. The structured fields carry
strictly more attribution than the sentence did.

The recursive walk matters even though the row is flat today. A shallow allowlist would
pass every current case; what it would miss is a future nested "context bag" whose inner
keys nothing ever looked at.

## Operator query contract

```
inspectDynamicViewMetrics({ operatorId?, operatorToken?, worldId, windowMs?, limit? })
```

Registered in `architecture/module-boundaries.json` as
`{ kind: 'query', gate: 'operator' }`. Gated by the **existing** `schedule.inspect`
capability — reused, not extended. FR-Q002 / ART-134 owns operator *controls* over the
dynamic layer; minting a capability here would take a decision that belongs to that task.

Returns `{ worldId, generatedAt, windowMs, metrics }`, where `metrics` has **exactly one
entry per registry key** whatever the world's state, each
`{ key, prdName, provenance, owner, value, reason }`. A consumer can render the full PRD
list and see which entries are unmeasured, rather than discovering their absence by their
omission.

`windowMs` defaults to 24h and is clamped to 30 days; `limit` defaults to 20 attributed
incidents and is clamped to 200, the same clamping pattern as `listOperatorAudit`. Windowed
counts stop after 1000 rows and report `scanLimitReached` — an operator query that read a
year of audit rows to answer "how many in the last day" would be a self-inflicted outage,
and a bounded scan that says it was bounded is a distinguishable answer rather than a
quietly wrong one.

### Why the query lives in `operations`, not `publicRead`

The response needs the incident tables and the freshness classifier (`publicRead`) *and*
the LLM trace count (`observability`). The module policy forbids `publicRead` →
`observability` — a public read module that could import the generation path could trigger
one — and ART-128's suite actively asserts no `publicRead` file names it. `operations` may
depend on both, so the read lives there and the public read path stays unable to reach
observability at all.

## What this task deliberately did not do

- No product analytics (`live_*` events) — ART-47 / FR-Q007.
- No new operator capability, and no operator *control* — ART-134 / FR-Q002.
- No client-side write path for the two `client_external` metrics — see above.
- No logic behind the two `pending_feature` metrics — the features do not exist.
- No new call site writing `outcome: 'refused'`; only a count of what already exists.

## Related

- `docs/public-dynamic-projection.md` — the published contract these metrics observe
- `docs/public-runtime-snapshot.md` — where snapshot age comes from
- `docs/canon-runtime-synchronization.md` — why the runtime is re-derived, not synced
- `docs/public-read-only-guarantee.md` — what makes the two zeros structural
- `docs/simulation-operations-console.md` — the audit log and the denial-recording constraint
