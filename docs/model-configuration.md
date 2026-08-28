# Per-module model configuration (FR-K005, ART-52)

Audited, versioned, per-module configuration of the eight FR-K005 settings — Model, Prompt
Version, Temperature, Token Limit, Timeout, Retry, Fallback and Daily Budget — behind the
existing authorized operations console.

- Pure model (validation, versioning, redaction, resolution): `convex/shared/moduleModelConfig.ts`
- Table: `moduleModelConfigs` in `convex/shared/schema.ts`
- Prompt version registry: `convex/simulation/promptVersions.ts`
- Simulation read seam: `convex/simulation/moduleConfig.ts`
- Operator surface: `convex/operations/moduleModelConfigFunctions.ts`
- Tests: `convex/shared/moduleModelConfig.test.ts`,
  `convex/operations/moduleModelConfigFunctions.test.ts`,
  `convex/simulation/moduleConfigSelection.test.ts`

## 1. What each setting was before this table existed

Every one of the eight was a hardcoded constant or a deployment environment variable, global to
the whole deployment. Nothing was per-module, and two of the eight did not exist at all.

| FR-K005 setting | Where it lived | Default now (`scene_simulation`) |
| --- | --- | --- |
| Model | `LLM_MODEL` env → `convex/simulation/providers/config.ts` | `null` = inherit `LLM_MODEL` |
| Prompt Version | **did not exist**; the prompt is a code literal in `sceneSimulation.ts` | `scene_simulation.v1` |
| Temperature | `0.4` literal at `sceneSimulation.ts` (also `0.2` in `openAICompatible.ts#proposeEvent`, `0` in `probes.ts`) | `0.4` |
| Token Limit | `4_000` literal at the same site (also `2_000` / `32`) | `4000` |
| Timeout | `LLM_TIMEOUT_MS` env, default `30_000` | `null` = inherit `LLM_TIMEOUT_MS` |
| Retry (transport) | `LLM_MAX_ATTEMPTS` env, default `3`; HTTP loop in `openAICompatible.ts` | `transportMaxAttempts: null` = inherit `LLM_MAX_ATTEMPTS` |
| Retry (semantic) | `simulateWholeScene(…, maxAttempts = 2)`, clamped 1–3 | `semanticMaxAttempts: 2` |
| Fallback | **did not exist** | `fallbackModel: null` |
| Daily Budget | **did not exist**; the repository had no cost or token accounting at all | `dailyTokenBudget: null` |

The defaults ARE those prior values. A world with no configuration row therefore behaves exactly
as it did before ART-52, and `moduleConfigSelection.test.ts` pins that with the literal numbers
rather than trusting this table.

**Why exactly three settings default to `null`.** `model`, `timeoutMs` and
`transportMaxAttempts` are the three whose pre-ART-52 value came from a deployment environment
variable rather than a code literal. Each becomes a per-REQUEST override, and
`OpenAICompatibleProvider` resolves an override as `overrides.x ?? this.config.x` — so a present
value always beats the provider instance, which is exactly where the environment variable lives.
Restating `30000` / `3` as table defaults would therefore make `LLM_TIMEOUT_MS` and
`LLM_MAX_ATTEMPTS` **dead for every world, including unconfigured ones**: a deployment running
`LLM_TIMEOUT_MS=90000` would silently start aborting at 30s. `null` means "inherit the
deployment value" and emits no key at all, keeping the environment variable the single source of
that answer. `temperature`, `maxTokens` and `semanticMaxAttempts` are non-nullable because they
never had an environment variable — a concrete default there reproduces the old literal exactly
rather than overriding anything.

**Retry is stored as two fields on purpose.** Two independent retry mechanisms exist and they
fail for different reasons: the transport layer retries a 429/5xx/timeout against the *same*
request, while the semantic layer re-runs the *whole prompt* when the model returned a valid HTTP
response whose content did not parse as a scene. Folding them into one number would make
"3 retries" silently mean up to nine provider calls.

## 2. The module enum — and which keys are placeholders

`CONFIGURABLE_MODULES` is `scene_simulation`, `director_plan`, `character_intent`, `editorial`,
named in the style of the `postCommitStage` enumeration in `convex/operations/schema.ts`.
`editorial` names the module that owns the `episode` and `recap` post-commit stages.

**Only `scene_simulation` has a real consumer.** It is the single module in the repository that
calls a language model. `director_plan`, `character_intent` and `editorial` are deterministic
algorithms today with no provider dependency at all — nothing reads their configuration rows.
They are declared so that a configuration written for them is stored, versioned and audited the
same way, and so the console does not have to grow a new key on the day one of them acquires a
provider. They are **placeholders**, and `MODULE_MODEL_DEFAULTS` gives them the same numbers as
`scene_simulation` only because that is the least surprising thing to show an operator, not
because 0.4 is a considered value for a Director prompt.

This is asserted, not merely described: `MODULES_WITH_PROVIDER_CONSUMERS` is pinned by
`moduleModelConfig.test.ts`, so adding a consumer fails the suite until this section is updated
with it.

**A second existing fact this does not hide.** The real `OpenAICompatibleProvider` is still not
wired into the live simulation path. It is constructed only by the deployment probe
(`convex/simulation/providers/actions.ts`), and `createWorldDayStageHandlers` still defaults to
the deterministic `FakeWholeSceneProvider`, because `runQueuedWorldDaySlot` is an
`internalMutation` and a Convex mutation cannot `fetch`. Wiring the real provider into the live
path is a separate concern with its own atomicity design and is deliberately not part of ART-52.
The consequence for this document: `temperature`, `maxTokens`, `semanticMaxAttempts` and the
prompt version are honoured by whatever provider is injected (the fake included, for the prompt
and the retry count), while `model`, `timeoutMs` and `transportMaxAttempts` are honoured by
`OpenAICompatibleProvider` and are therefore inert until it is injected.

## 3. Versioning and dedup semantics

The protocol is transplanted from `commitReadModelVersion`
(`convex/publicRead/readModel.ts`), because it is the same problem:

- **Append-only.** A change writes a NEW row; a stored row's settings are never edited. The only
  patch this surface performs is demoting a prior row's `isCurrent` boolean.
- **Monotonic per target.** `version` counts per `(worldId, module)`. A world's scene
  configuration can be at v4 while its editorial configuration is still at v1.
- **Content-hash dedup.** Resubmitting a byte-identical configuration returns
  `{ deduplicated: true }`, appends no row, and audits a `no_op`. Without it, an ops console
  re-saving an unchanged form — or a retried mutation — would inflate the history with rows that
  record no decision, and the version history would stop meaning "someone changed something".
  `actor` and `reason` are deliberately **not** part of the hash: a fresh reason for unchanged
  numbers is not a configuration change.
- **Insert new, then demote prior.** If the insert fails, the previously-current row is untouched
  and keeps being served. The reverse order would open a window with no current configuration, in
  which every reader silently falls back to defaults.
- **At most one `isCurrent` per `(worldId, module)`**, guaranteed by demoting exactly the row that
  was current — and, underneath that, by the atomicity of the surrounding Convex mutation, which
  serialises two concurrent writes for the same target instead of letting both read the same
  `findCurrent` and both insert. Worth naming as a dependency because the live simulation path
  reads the current row with `.unique()`: two current rows would not merely confuse the console,
  they would make `resolveModuleConfig` throw and take that world's slots down with it.
- **A stored row that no longer validates resolves to the defaults** rather than throwing. A
  prompt version retired after a configuration referenced it must not be able to stop a world
  simulating; it must make the world run the documented defaults and report `source: 'default'`.

## 4. Authorization and audit

Two capabilities, added to `OPS_CAPABILITIES` and `CAPABILITY_MINIMUM_ROLE`:

| Capability | Function | Minimum role |
| --- | --- | --- |
| `model_config.write` | `setModuleModelConfig` (mutation) | `admin` |
| `model_config.inspect` | `inspectModuleModelConfig`, `listModuleModelConfigVersions`, `describeModuleModelDefaults` (queries) | `viewer` |

Writing is `admin` for the reason `snapshot.create` is: it takes effect on every subsequent scene
in the world, it is the lever that decides spend, and a wrong value is not visible in the output
until scenes have already been authored with it. An operator trusted to pause a running world is
not thereby trusted to change which model writes its scenes.

Every function goes through `requireOperator` from `opsConsoleFunctions.ts` — the same gate, not
a second one — so these commands inherit fail-closed behaviour on an unset registry, the
identity-over-token precedence, and the uniform `OPS_UNAUTHORIZED` denial raised before any row is
read. Each applied write appends exactly one `operatorAuditLog` row in the same transaction, with
`target: "<module>:v<version>"`. `operatorAuditLog` needed no schema change: `capability` is
`v.string()`.

## 5. Prompt versions: IDs are configuration, bodies are source

`moduleModelConfigs.promptVersion` stores an **ID** from `PROMPT_VERSION_IDS`.
`convex/simulation/promptVersions.ts` maps each id to the builder function; the bodies stay in
reviewed repository source.

The two are pinned by `satisfies Record<SceneSimulationPromptVersionId, WholeScenePromptBuilder>`
— **exhaustive**, so an id declared with no builder is a compile error. That is why the id list is
per-module (`SCENE_SIMULATION_PROMPT_VERSION_IDS`) rather than one flat list: a flat list could
only be checked with `Partial<Record<…>>`, which makes every key optional and so checks nothing.
The drift it would have admitted is not cosmetic — the operator write naming the builder-less id
would be accepted, and every world-day slot for that world would then fail at runtime with no
earlier signal. `moduleConfigSelection.test.ts` asserts the same property at runtime.

Storing bodies would breach AC#3 outright, and would also be silently self-defeating:
`sanitizeForPublic` drops every key matching `/prompt/i`, so a stored body would *vanish* from
anything that passed through the public allowlist rather than being caught. That same rule matches
`/token/i`, which is the second reason this configuration is kept off the public read path
entirely — `promptVersion`, `maxTokens` and `dailyTokenBudget` would all be silently deleted from
a public payload that tried to carry them. Configuration is an operator concern and stays one.

Keeping bodies in source also keeps the operator control honest: configuring a prompt version
*selects between prompts a human reviewed*. A free-text prompt field would let the console rewrite
what the model is told, which is a content-authoring power the operations console deliberately
does not have.

**A version that no longer exists resolves to the defaults; it does not halt the world.** Two
gates stand in front of that outcome and they cover different cases:

- `assertModuleModelSettings` refuses an unregistered id at **write** time, so an operator cannot
  store a prompt version that does not exist.
- `resolveEffectiveModuleConfig` re-validates the stored row at **read** time and returns
  `MODULE_MODEL_DEFAULTS` when it no longer passes — the case where a version was *retired after*
  a configuration referenced it. The world runs the default prompt and the console reports
  `source: 'default'` for it, so runtime and operator view agree. A retired prompt must not be
  able to stop a world simulating, which is the same reasoning §3 gives for any row that no longer
  validates.

`selectWholeScenePrompt` still throws `PROMPT_VERSION_UNKNOWN` (permanent), but that is a **guard
for a caller that bypasses the resolver**, not the retired-prompt policy — a configured world does
not reach it.

Adding a version: add the id to `PROMPT_VERSION_IDS`, add its builder, and **never edit an
existing version's body in place** — a stored `promptVersion` is a claim about which text ran.

### Known gap: prompt ids are not validated against the module they are stored on

`assertModuleModelSettings` checks that a `promptVersion` is a registered id. It does **not** check
that the id belongs to the module the row configures. This is unreachable today — every id in
`PROMPT_VERSION_IDS` derives from `SCENE_SIMULATION_PROMPT_VERSION_IDS`, so there is no
cross-module id to mis-assign.

**It stops being unreachable the moment a second module registers a prompt.** Storing
`director_plan.v1` on `scene_simulation` would then pass write validation, pass the resolver (the
id is genuinely registered), and only fail at `selectWholeScenePrompt` — a permanent
`PROMPT_VERSION_UNKNOWN` on every slot for that world, with no earlier signal. That is the same
failure shape the exhaustiveness split above was built to prevent, reached by a different route.

Whoever adds the second module's prompt: branch on `module` and validate against that module's own
id list. The per-module lists already exist, so the check is a couple of lines. This is recorded
here rather than in a code comment because the person who needs it will be editing
`promptVersions.ts`, not reading the validator.

## 6. Secret safety (AC#3)

- There is no credential field on the table, and no code path returns one.
- `assertNoCredentialMaterial` refuses any submitted **key** whose name is in
  `FORBIDDEN_CONFIG_FIELDS` (the same list as `FORBIDDEN_AUDIT_FIELDS` in
  `operatorAuthorization.ts`; the copy exists because `shared` may not depend on `operations`, and
  a test pins the two as equal), and any **string value** carrying `field=` / `field:` credential
  shape. `maxTokens` remains legal — the key sweep is an exact case-insensitive match, not a
  substring one.
- The operator read projection is built by `describeModuleModelConfig`, an **allowlist** modelled
  on `describeOpenAICompatibleConfig`. A spread would publish a newly added field by default; an
  allowlist does not.
- None of this is declared in `publicFunctionSurface` as anonymous; all four functions carry
  `gate: "operator"`.

## 7. What ART-52 deliberately does NOT do

This is a scope boundary taken from the task graph, not an omission.

**`fallbackModel` and `dailyTokenBudget` are stored, versioned, authorized, audited and readable —
and nothing spends, meters, or switches on them.**

- **ART-59 (FR-M003) owns enforcement, and has now shipped it** for `dailyTokenBudget`. The
  per-module cap is read from THIS table by `convex/simulation/tokenBudgetGate.ts` and handed to
  `evaluateReservation` as a parameter — it is delegated, never copied into ART-59's own policy
  row, so a console change here takes effect in enforcement without a second write. See
  `docs/token-budget-controls.md` §1. `fallbackModel` remains stored-only.
- **ART-91 owns the ordered degradation path** (same-model retry → compatible model → fewer scenes
  → …). It depends on both.

Building budget accounting or fallback switching here would duplicate work those tasks own, and
would do it without the spend ledger and concurrency model they define. `wholeSceneOptionsFor`
therefore omits both fields from the call options rather than passing values the call cannot
honour — passing them would *look* like they were being applied.
`moduleConfigSelection.test.ts` pins the omission so a later change cannot start forwarding them
silently, and that pin still holds after ART-59: enforcement reads `dailyTokenBudget` through the
budget gate, not through the call options.

ART-59 also preserved the **`null` model** invariant this document's §3 sets out. Budget
enforcement needs a concrete model id before the call — a per-model cap has to name a model — so
the world-day port supplies the deployment's model id for a module that configured `model: null`.
That id is used for **metering only**: `simulateWholeScene` sends a `model` override only when the
gate actually *changed* the model (a fast-class routing decision or an over-budget downgrade), so
an unconfigured module still sends no override at all and `LLM_MODEL` still decides.

## 8. Deployment notes

Nothing here needs a new environment variable. `LLM_MODEL`, `LLM_TIMEOUT_MS` and
`LLM_MAX_ATTEMPTS` remain the **deployment-level defaults**, used whenever the corresponding
setting is `null` — which is what all three default to, so an unconfigured world uses them
unchanged. Setting one to a number on a module overrides the environment variable *for that
module only*; setting it back to `null` restores the deployment value rather than a table
default. This is asserted in `moduleConfigSelection.test.ts`, which checks that an unconfigured
world's request carries **no key at all** for these three. `LLM_API_URL`, `LLM_API_KEY`,
`LLM_EMBEDDING_*` and `LLM_ALLOW_UNAUTHENTICATED` are deployment-level only and are **not**
configurable per module: they are connection and credential concerns, and putting a credential
behind an operator-writable table is precisely what AC#3 forbids.
