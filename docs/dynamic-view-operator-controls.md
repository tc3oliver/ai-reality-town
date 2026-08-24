# Operator Controls for the Dynamic Public View (FR-Q002 / ART-134)

Runbook additions for the dynamic layer: what an operator can do to the public view, what they
deliberately cannot, and where the record of it lives.

Related: `docs/simulation-operations-console.md` (the gate and audit path these reuse),
`docs/dynamic-view-observability.md` (the metrics behind AC#4),
`docs/dynamic-safety-filtering.md` (the *other* ledger, and why they are separate),
`docs/dynamic-view-degradation.md` (what the snapshot pin serves).

## 1. The five controls

| Command | Capability | Role | What it does |
|---|---|---|---|
| `setDynamicUpdatesPaused` | `dynamic.pause` | operator | Stops republishing the public projection. Canon keeps running |
| `setSnapshotPinned` | `dynamic.pin_snapshot` | operator | Serves the last valid runtime snapshot instead of the live projection |
| `setCharacterVisualHidden` | `dynamic.hide` | operator | Removes one character's public visual |
| `setSceneVisualHidden` | `dynamic.hide` | operator | Removes one scene's public visual |
| `rebuildDynamicProjection` | `dynamic.rebuild` | operator | Re-derives and republishes the projection |
| `inspectDynamicViewControls` | `dynamic.inspect` | **viewer** | Reads the controls in force and their history |

Every command takes `worldId` and `reason` (NFR-005: a privileged action states why), and each
takes `engaged: true | false` — engaging and releasing are the same command.

`dynamic.inspect` is a viewer capability on purpose: reading the state of the public view is not
the authority to change it.

### Why these are not folded into existing capabilities

`dynamic.pause` is separate from `world.pause` because they stop different things. Pausing the
**world** stops the simulation; pausing the dynamic **view** stops republishing what the public
sees while the world keeps running. Sharing one capability would mean an operator who can freeze
the public page can also halt Canon, which is a much larger action.

`dynamic.hide` is separate from `safety.override` for the same reason the two ledgers are
separate — see §4.

## 2. AC#4 is already delivered by ART-133

"Operators can inspect binding and synchronization errors" is satisfied by
`inspectDynamicViewMetrics` (`convex/operations/dynamicViewMetricsFunctions.ts`), which already
derives `missingCharacterBinding`, `missingLocationBinding` and `canonRuntimeLocationMismatch`
as `server_measured`, behind the same operator gate.

ART-134 deliberately does **not** rebuild it. Calling it from the control console and
re-exporting its output would give the console two places to read the same numbers from, and
the way that ends is one of them reporting a different figure for the same world.
`inspectDynamicViewControls` adds only the half ART-133 has no view of: which controls are
engaged, and who engaged them.

## 3. Append-only, and derived

Every control is a row appended to `dynamicViewControls`; the effective state is replayed from
the ledger, latest-wins per `(kind, target)`. **A release is a row, never a deletion.**

That is not tidiness. An operator control decides what the public can see, so the question asked
afterwards is never only "is it hidden now" — it is "who hid it, when, why, and what did they
release". A mutable `hidden: boolean` answers the first and destroys the rest.
`safetyStatusOverrides` (FR-P004) reached this first and this follows it rather than inventing a
second shape for the same problem.

Replay is ordered by `createdAt` rather than by row order, so a resolver does not silently
depend on how the store happened to collect.

## 4. This is not safety withholding

| | `safetyStatusOverrides` (FR-P004) | `dynamicViewControls` (FR-Q002) |
|---|---|---|
| Removes content because | a **classifier** refused it | an **operator** pulled it |
| Typical reason | policy violation | a binding renders wrongly, a sprite is being re-authored, an incident |
| Capability | `safety.override` | `dynamic.hide` |

Kept apart so neither can be mistaken for the other in an audit, and — the load-bearing half —
so a release here **cannot un-withhold something safety refused**. An operator trusted to take a
mis-rendering sprite off the map is not thereby trusted to reverse a safety decision.

## 5. Applied at build time, not read time

`applyDynamicViewControls` runs inside `rebuildLiveProjection`, before the payload is stored.

A read-time filter would leave the hidden character in the stored payload, and FR-O010's
last-known-good fallback would keep serving it the moment the current version could not be read
— the hidden thing would come back, from the mechanism designed to keep the page alive. FR-P004's
safety gate is applied at build time for exactly this reason.

**A hidden character is removed, not blanked** — the opposite of what FR-P004 does to a withheld
scene, and deliberately. A withheld scene becomes a placeholder because the map's job is to show
where the world is, and a character standing at a location whose scene has vanished is a bigger
lie than 「內容審核中」. There is no honest placeholder for a person's position, and a marker
saying "someone is here but we will not say who" tells a viewer more than hiding does.

A hidden character is also removed from every scene's `participantCharacterIds`. The id **is**
the thing being hidden, so leaving it there would keep publishing "this person is in that scene"
in the scene panel.

### Where the pure model lives, and why

`convex/shared/dynamicViewControls.ts`. Two modules must agree on it: `operations` owns the
commands, and `publicRead` must apply the result when it builds the projection — but
`architecture/module-boundaries.json` forbids `publicRead` from depending on `operations`, and
rightly, since that edge already runs the other way.

The alternative was for the projection builder to re-derive the effective state itself. That is
two implementations of "what is hidden", and the way those diverge is that something an operator
hid stays on screen while the console keeps reporting it as hidden. `shared` depends on nothing,
so both sides import the same resolver and the divergence is structurally impossible.

## 6. What these controls cannot do (AC#6, AC#7)

They govern the **projection** — the derived, republishable view — and nothing else. Canon is
append-only and is corrected through FR-K005's workflow. Hiding a character's sprite does not
edit an event, withdraw an accepted fact, or compensate anything.

The distinction is load-bearing: an operator who could quietly delete a Canon event through a
visibility control would have a correction path with **no compensating record**, which is
precisely what the correction workflow exists to prevent.

Enforced structurally by `dynamicViewControls.boundary.test.ts`, which reads the shipped files:

- the pure model **imports nothing at all**, so it cannot reach Canon, a correction function or
  a database;
- the wiring references no `canon` path and no `compensate` / `retcon` / `rollback` symbol;
- the only table it writes is its own ledger, extracted from the source rather than eyeballed;
- it never patches, replaces or deletes anything.

**The rebuild is the one command that touches the projection pipeline**, and it is the least
powerful thing that satisfies AC#5: a read of Canon as it already stands, then a write to the
read-model store — exactly what the post-commit orchestrator does after every accepted event.
`rebuildLiveProjection` stays an `internalMutation`; making it publicly callable would have put
an unauthenticated rebuild on the public surface.

**Rebuilding while paused is refused, not silently performed.** The pause is an operator's
statement that the public view should stop moving; honouring the rebuild would move it, and
doing that quietly is worse than refusing. Releasing the pause is one call away and appears in
the audit trail — which is where a decision to override another decision belongs.

## 7. The audit trail (AC#8)

`requireOperator` and `recordAudit` are imported from `opsConsoleFunctions`, not reimplemented.
The console's own documentation asks for this, and FR-K006's emergency-stop controls set the
precedent.

The consequence worth knowing operationally: these commands inherit the **whole** gate. They
fail closed on an unset `SIMULATION_OPS_OPERATORS`, they honour identity-over-token precedence
and the `CLERK_JWT_ISSUER_DOMAIN` cutover, and the audit row is written inside the command's own
transaction — so a control that throws leaves no audit row claiming it applied, and a control
whose audit row cannot be built does not apply.

**A no-op is still audited.** Pressing "hide" on something already hidden records
`outcome: 'no_op'` rather than being dropped: it is part of the account of what happened, and a
silent drop would leave a gap in it.

## 8. Two guards this task had to move, and why that is a narrowing

Both refused the branch, which is what they are for.

`operatorAuthorization.test.ts` enumerates every capability by name; the five new ones had to be
added deliberately. That is the guard working.

`publicReadOnlyGuarantee.test.ts` banned `characterId` as a declared argument on **any** public
function, because that is the shape of a player-control API. `setCharacterVisualHidden`
legitimately takes one. The ban is now **absolute for anonymous functions** and paired with a new
test requiring that any function declaring `characterId` is operator-gated. That is narrower than
before in the place that matters and no weaker anywhere: the alternative was exempting one
function by name, and a by-name exemption is how an exhaustive guard stops being exhaustive.
