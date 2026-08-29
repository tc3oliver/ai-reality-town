# Server-Side Authorization and Release Security Audit (ART-62)

> **Superseded in part (2026-08-07, ART-128).** This document's inventory of the public
> surface is a hand-maintained snapshot and is now stale — it missed two Critical findings
> that ART-128 found and fixed: a public `mutation` in `convex/init.ts` that any anonymous
> caller could invoke successfully, and an unauthenticated `POST /replicate_webhook` HTTP
> action performing an SSRF-shaped server-side fetch. For the current, machine-enforced
> inventory of every client-reachable Convex function, read
> **`docs/public-read-only-guarantee.md`**. The surface is no longer maintained by hand:
> `publicFunctionSurface` in `architecture/module-boundaries.json` fails the build on any
> undeclared registration. The findings and remediations recorded below remain accurate as
> history.

- **Requirement IDs:** NFR-005, Public Test AC 20-23
- **Audit date:** 2026-08-04
- **Audited revision:** `origin/main` @ `67e60bd` (plus the fixes recorded in this document)
- **Method:** adversarial source review. Every claim below was checked by reading the
  implementation, not the docstring. Several modules carry docstrings asserting a
  property that the code does not have; those are recorded as findings.

## 0. Re-audit — 2026-08-29 against `origin/main` @ `b9fa935`

This audit was re-run in full rather than re-read. Every original finding was re-derived from
today's code; the status labels below **supersede** the ones in the sections that follow, which
are preserved unedited as the historical record of what was true on 2026-08-04.

Two things made this necessary. First, the original audit closed with **"RELEASE IS NOT CLEAR"**
while the task carried `status: Done` and all five acceptance criteria unchecked — the audit's own
conclusion contradicted its task metadata. Second, substantial work has landed since, and a
finding's label can move in either direction: one the report called FIXED can regress, and one it
called UNRESOLVED can be closed by unrelated work. Both happened.

### Original findings — current status

| # | Finding | 2026-08-04 | 2026-08-29 | Evidence |
|---|---|---|---|---|
| C-1 | Canon commit was a public unauthenticated mutation | FIXED | **RESOLVED** | `convex/canon/commit.ts:241` is `internalMutation`. The only write to `canonEvents` anywhere is `:200`, inside `commitProposedEvent`; every caller is server-side. `architecture/module-boundaries.json` lists all four symbols under `viewerWriteBoundary.forbiddenSymbols`, CI-enforced |
| C-2 | CC art credits deleted while assets ship; docs relicensed as MIT | FIXED | **RESOLVED**, hardened further | `ASSETS-LICENSE.md` registers 53 assets. `ATTRIBUTION.md:27-34`, `docs/upstream.md:129`, `README.md:130-137` all scope MIT to source only. ART-108/ART-144 added `scripts/assets/check-asset-licenses.mjs` to `npm run check` and both CI workflows, and deleted sixteen files that could not be cleared |
| H-1 | Operator identity path dead; shared bearer token in a mutation argument is the only credential | UNRESOLVED | **STILL OPEN** (partly ENVIRONMENT BLOCKED) | See §0.1 — the remediation is real but incomplete |
| H-2 | Public unauthenticated engine stop/resume | PARTLY FIXED | **SUPERSEDED** | `convex/testing.ts` no longer exists. ART-112 (`893961f`) retired the a16z engine. Pinned against return by `emergencyStopControls.test.ts:445` and `publicReadOnlyGuarantee.test.ts:427` |
| H-3 | Raw prompts and raw model output logged on the live agent path | FIXED | **RESOLVED** | Ten `console.*` sites remain in `convex/`; none logs prompt or completion content. `util/llm.ts:161` logs `{model, messageCount, stream}`, `:197` logs `{completionChars}`. `convex/simulation/providers/` — the live path today — has zero `console.*` |
| H-4 | Pre-generation safety classifier has zero production callers | UNRESOLVED | **STILL OPEN** (partial fix) | See §0.2 — it now has callers, but coverage is incomplete and the policy is inert for this project's content language |
| H-5 | Emergency stop does not halt the upstream AI Town engine | UNRESOLVED | **SUPERSEDED** | The named engine and its 60-second restart cron are deleted; `convex/crons.ts:29-31` records the removal. **Not closed by ART-102**, whose helpers `assertPublicWorldAdmitsSimulation`/`isPublicWorldEmergencyStopped` (`emergencyStopOperations.ts:98`,`:107`) have zero production callers and whose docstring still describes deleted files. The stop is effective today by a different route: `assertWorldAdmitsSimulation` at `worldDayLiveFunctions.ts:343` and `opsConsoleFunctions.ts:183`, plus schedule pausing in `schedulerOperations.ts:176-190` |
| H-6 | `runFoundationSimulation` was a public unauthenticated mutation | FIXED | **RESOLVED** | `convex/simulation/workflow.ts:132` is `internalMutation` |
| D-1 | `vercel.json` present and unguarded; auto-deploy unprovable from repo | RESOLVED | **RESOLVED**, re-verified live | `gh api repos/tc3oliver/ai-reality-town/hooks` → `[]`; `/deployments` → `[]`. No deploy job, no `secrets.*`, `permissions: contents: read` in both workflows, zero `convex deploy` in `package.json` |
| M-1 | Viewer input classifier has zero callers | UNRESOLVED | **RESOLVED** | `classifyViewerInput` is called at `viewer/environmentVote.ts:221`,`:283` and `viewer/viewerProgress.ts:314`, and is a `viewerWriteBoundary.requiredSymbols` entry — machine-enforced |
| M-5 | `package.json` SPDX field overstates the grant | UNRESOLVED | **STILL OPEN** (Low) | `package.json:6` still declares flat `"license": "MIT"`. `"private": true` at `:4` prevents publish |

**Both Criticals are closed. Of the six Highs: two resolved, two superseded by the ART-112 engine
retirement, two still open.** The retirement closed more of this audit than any remediation task
did — which is worth stating plainly, because it means the improvement is partly a consequence of
deleting code rather than of securing it.

### 0.1 H-1 — the remediation is real, and incomplete

`convex/auth.config.ts` now exists (ART-104). Four sub-questions, answered against code rather
than against its runbook comment:

**(a) With `CLERK_JWT_ISSUER_DOMAIN` unset, the identity branch is still dead.** `auth.config.ts:26`
emits `providers: []`, so `ctx.auth.getUserIdentity()` returns null and the subject lookup at
`operatorAuthorization.ts:360-365` cannot match. Unchanged from the original finding.

**(b) The token is still accepted and is still a function argument.** `opsConsoleFunctions.ts:98-99`
computes `allowTokenFallback = ... || !process.env.CLERK_JWT_ISSUER_DOMAIN`, which is `true` while
the domain is unset, so the token branch at `operatorAuthorization.ts:367-380` is the sole working
credential. It remains declared as `operatorToken: v.optional(v.string())` at
`opsConsoleFunctions.ts:66-69`.

**(c) The argument-logging exposure is unchanged.** Nothing in the code altered the transport.
**This remains unobserved rather than confirmed** — proving it requires a live deployment log, and
that limitation is inherited verbatim from the original audit.

**(d) Setting the env var does NOT close the token path everywhere.** `requireOperator`
(`opsConsoleFunctions.ts:86`) computes `allowTokenFallback` and passes it. `requireReviewer`
(`proposalReviewFunctions.ts:64-75`) calls `authorizeOperator` **without it**, and
`operatorAuthorization.ts:419` defaults it to `true`.

Consequence: after a Clerk cutover, the public queries `listProposedEventReviews`
(`proposalReviewFunctions.ts:109`) and `reviewProposedEvent` (`:132`) still accept the shared
static token. Anyone holding a leaked operator token keeps read access to the proposed-event
review queue — raw model output, traces, safety labels — permanently, revocable only by editing
`SIMULATION_OPS_OPERATORS`. The file's docstring at `:9-14` claims its authorization is "ART-48's,
unchanged"; it is ART-48's minus the H-1 remediation. That is the same defect class this audit was
created to catch: a docstring asserting a property the code does not have.

Disposition: **the two-line fix is CODE_BLOCKER; the remaining exposure is ENVIRONMENT_BLOCKED.**

### 0.2 H-4 — it now has callers, and the gate is still not effective

`assertPreGenerationSafe` is called at `convex/simulation/providers/openAICompatible.ts:73` and
`convex/util/llm.ts:154`, so the literal finding ("zero production callers") no longer holds. It
does not follow that content is screened. Complete egress inventory — six network calls under
`convex/`, zero under `src/`:

| Path | Provider call | Pre-generation safety |
|---|---|---|
| `OpenAICompatibleProvider.structuredChat` | `openAICompatible.ts:76` | `:73` — covered |
| `OpenAICompatibleProvider.proposeEvent` | `:110` → structuredChat | inherited |
| **`OpenAICompatibleProvider.embed`** | **`:94`** | **none** |
| `util/llm.ts chatCompletion` | `llm.ts:167` | `:154` — covered |
| **`util/llm.ts` embeddings** | **`llm.ts:239`, `:710`** | **none** |
| **`util/llm.ts` moderations** | **`llm.ts:281`** | **none** |

Four gaps, in descending severity:

1. **The policy is inert for the content this project generates.** `RULES` (`preGeneration.ts:61-83`)
   is sixteen English phrase regexes — `/\bexplicit sexual content\b/u`,
   `/\bextreme violence detail\b/u` — and `normalizeForSafety` lowercases with
   `.toLocaleLowerCase('en-US')`. Meanwhile `openAICompatible.ts:110` instructs the model to
   "Write every narrative text field in Traditional Chinese (zh-TW)" and the seed world is zh-TW.
   Prohibited zh-TW content matches no pattern, and `\b` does not fire between CJK codepoints in
   any case. **This makes the two covered rows above nominal rather than real**, and it is the most
   consequential item in this re-audit.
2. **`embed()` is ungated and live.** `openAICompatible.ts:93-94` sends character memories and
   retrieved private knowledge to the third-party provider unscreened. Reachable via `probes.ts:27`
   and the `probeConfiguredOpenAICompatibleProvider` action.
3. **The gate is in the adapter, not at the port.** `LanguageModelProvider`
   (`convex/simulation/provider.ts:76-79`) imposes no safety obligation, and `simulateWholeScene`
   (`sceneSimulation.ts:389`) dispatches through the bare interface, so a second adapter loses
   coverage with no test failure. `callWithPreGenerationSafety` (`preGeneration.ts:135`) — the one
   combinator that structurally prevents the callback firing on a block — has zero production
   callers; production uses the non-structural `assertPreGenerationSafe` throw.
4. **Unscreened side-channels on the covered paths.** `structuredChat` screens `request.messages`
   only, while `request.schemaName`/`request.jsonSchema` are serialized into the body at
   `openAICompatible.ts:79` (a JSON Schema `description` is a prompt channel). `chatCompletion`
   screens `body.messages` only; `body.tools[].function.description` and `body.user` go out
   unscreened at `llm.ts:174`.

**The coverage test does not test coverage.** `preGeneration.test.ts:109-118` proves it by
`readFileSync` + `toContain` on source text. That passes for dead code and asserts nothing about
`embed`, `fetchEmbedding`, `ollamaFetchEmbedding` or `fetchModeration`.

Disposition: **CODE_BLOCKER.**

### 0.3 New findings — the risk has moved to code written after this audit

The 2026-08-04 surface has been largely secured. The residual risk is now concentrated in the
viewer voting surface, which did not exist when this audit ran.

**N-1 (HIGH, CODE_BLOCKER) — ~16k anonymous calls permanently break the public ballot and deadlock
its cron.** `environmentVoteFunctions.ts:108-111` (the public ballot read) and `:244-247` (the
round-closing cron) both `.collect()` every ballot row in a round, unbounded. A Convex query
refuses to read more than 16,384 documents — a limit this repository already cites at
`operations/tokenBudgetFunctions.ts:71`. Past that, `getEnvironmentVoteBallot` throws for every
visitor **and** `tickEnvironmentVoteRounds` can no longer close the round, so it never elects a
winner and never resets: permanent DoS of a public feature, remote, unauthenticated, no rate limit.
`MAX_SUBMISSIONS_PER_ROUND = 100_000` (`environmentVote.ts:72`) is **six times above the limit that
actually bites**, so the declared ceiling provides no protection at all. Durable fix: maintain
per-candidate tallies on the round row so the read is O(catalog), not O(ballots).

**N-2 (MEDIUM, CODE_BLOCKER) — `VOTE_ROUND_FULL` still allocates a row.** The early return at
`environmentVoteFunctions.ts:184-186` covers only `VOTE_DEVICE_ATTEMPTS_EXHAUSTED`.
`VOTE_ROUND_FULL` falls through to the insert at `:196`, so the ceiling caps accepted votes but not
rows, and `environmentVoteBallots` is not in `TablesToVacuum` (`crons.ts:60-84`), making the growth
permanent. This contradicts the module's own comment at `environmentVote.ts:66-71`, and it is the
mechanism that makes N-1 reachable. The sibling surface gets this right — `viewerProgress.ts:190-195`
includes `PROGRESS_WORLD_FULL` in `NON_WRITING_REJECTION_CODES`.

**N-3 (MEDIUM) — ballot stuffing; no rate limiter exists and a docstring claims one is required.**
`submitEnvironmentVote` identifies callers by `args.deviceKey`, a raw client string hashed with
non-cryptographic FNV-1a; rotating it resets both per-device caps. The module admits this at
`environmentVote.ts:22-23`. `environmentVoteFunctions.ts:11` claims the boundary policy requires
naming "the safety classifier and the rate limiter" — `viewerWriteBoundary.requiredSymbols` is
`["classifyViewerInput","evaluateVoteSubmission","evaluateViewerProgressSubmission"]`. **There is no
rate limiter and the policy does not require one.** Blast radius is bounded: the winner becomes a
queued intervention that still faces full Canon validation, so an attacker chooses which of seven
sanctioned catalog events happens, not arbitrary Canon. Enough to defeat the feature's purpose; not
a canon-integrity break.

**N-4 (MEDIUM) — `getPublishedReadModel` (`readModelFunctions.ts:152-155`) is the only public read
with no `returns` validator.** Correcting a natural overstatement: this does **not** leak a raw
`Doc<>` or the row id — `toServed` (`readModel.ts:216-222`) builds an explicit `Pick` and omits
`id`. It does return `sourceEventIds`, `contentHash`, `status`, `version`, `publishedAt`,
`servedFrom` to anonymous callers, and `sanitizeForPublic` is applied to `payload` only, not the
envelope. Bounded by construction rather than by a declared contract; the finding is the missing
defence-in-depth every sibling query has.

**N-5 (LOW) — `getTracePublic` (`observability/traces.ts:51-60`) is an enumerable anonymous status
oracle.** Bare `traceId`, no `worldId` scoping, no rate limit — and trace ids are deterministic
(`worldDayLive.ts:259` derives them from world + day + slot, all public), so the space is
enumerable. The projection is sound (five fields, no prompts or token counts, pinned by the
guarantee test). The finding is an authorization inconsistency: per-slot generation success is
operator-gated as a metric but anonymously enumerable here.

**N-6 (LOW)** — `recordViewerProgress` performs three `ctx.db` reads (`viewerProgressFunctions.ts:193-198`)
before validating key shape, while its read sibling validates first at `:141`. No write results;
hygiene rather than a hole.

**N-7 (MEDIUM) — dependency CVEs, and still no CI gate.** Against installed `node_modules`: 1
critical (`shell-quote`, dev-only), 12 high / 9 production-high (`convex`→`ws` DoS is the genuine
runtime one; most others are build-toolchain packages that sit in `dependencies`). The original
audit's recommendation #9 — add a licence/audit gate to CI — was implemented for licences
(`check:asset-licenses`) but **not** for `npm audit`.

**N-8 (LOW) — `SECURITY.md:32-33` materially understates the posture**, stating that server-side
authorization "is not implemented beyond Convex defaults" and that client access "is anonymous
today". Both clauses are now false: 36 routes carry an enforced capability gate, and the upstream
app referred to was deleted. Understating is safer than overstating, but this is the file external
researchers read first.

### 0.4 What improved most, and it was not a remediation task

`architecture/module-boundaries.json` `publicFunctionSurface` plus `scripts/architecture/check-boundaries.mjs`
is now the strongest control in the repository, and it is the right answer to this audit's core
methodological complaint. The public surface is machine-derived and CI-enforced **bidirectionally** —
`:421` fails on an undeclared registration, `:432` fails on a declaration whose function no longer
exists — so it cannot go stale the way a hand-maintained inventory does. The declared count (45:
36 operator, 6 anonymous, 3 viewer) matched an independent grep exactly, and
`publicReadOnlyGuarantee.test.ts` passes 44/44 while remaining exhaustive. The asset-licence gate
is the same pattern applied to C-2. Both exceed what this audit asked for.

### 0.5 Limits of this re-audit — stated rather than glossed

1. **Whether `operatorToken` actually appears in the Convex function log is unobserved.** It requires
   a live deployment log. The code path is unchanged from what was assessed on 2026-08-04, so that
   reasoning carries — but it is inference, not observation.
2. **Whether `CLERK_JWT_ISSUER_DOMAIN`, `SIMULATION_OPS_ALLOW_TOKEN_FALLBACK` and
   `SIMULATION_OPS_OPERATORS` are set on the production deployment cannot be determined from the
   repository.** These are Convex deployment environment variables. `.env.local` says nothing about
   the backend.
3. **The Convex per-query document limit used for N-1 is 16,384**, the figure this repository itself
   cites at `tokenBudgetFunctions.ts:71`, not one measured against a live deployment.

### 0.6 Release decision

**Not clear.** Three open High findings: N-1, H-4, H-1. Two of the three are pure code and can be
fixed in this repository today; the third is code plus one deployment configuration action.

Secrets scan is clean — tracked tree and full `git log --all -p` history, no matches for any
credential pattern.

---

## 1. Verdict (2026-08-04 — superseded by §0)

**Release is NOT clear for public test.**

Two Critical and six High findings were identified. Six were remediated inside this task;
D-1 was resolved 2026-08-04 by direct maintainer verification (see its entry in §6); the
remainder are recorded as explicit unresolved findings with recommended follow-up work.
Acceptance criterion #3 ("No unresolved Critical or High security finding remains before
public test") is therefore **still not satisfied** and is left unchecked deliberately.

| Severity | Found | Fixed in ART-62 | Unresolved |
|---|---|---|---|
| Critical | 2 | 2 | 0 |
| High | 7 (incl. D-1) | 4 (incl. D-1) | 3 (H-1, H-4, H-5) |
| Medium | 7 | 0 | 7 |
| Low / Info | 9 | 0 | 9 |

Unresolved Critical/High: **H-1** (the operator identity path cannot function, leaving a
shared bearer token in a mutation argument as the sole admin credential), **H-4**
(pre-generation safety classifier has zero production callers), and **H-5** (the FR-K006
emergency stop does not halt the upstream AI Town engine). **D-1 is resolved** - no Vercel
project is linked to this repository (verified via the GitHub API: zero webhooks, zero
deployments), so no auto-deploy risk exists today.

Both Criticals were fixed because both turned out to be safe to fix: the unauthenticated
canon-commit mutation had zero callers, and the license remediation is documentation-only.

**What I tried to break and could not.** The ART-48 role gate is applied as the first
statement of all 17 privileged routes, verified line by line, with a genuinely uniform
denial. The ART-57 trace pipeline resisted every attempt to get raw content or a
credential into a trace record. The public read projections genuinely filter on canon
`visibility` and build explicit object literals - no raw `Doc<>` is spread into a public
payload anywhere in `convex/publicRead/`. No secrets are committed. Those controls are
well built and are documented as passes in §4.

## 2. Method and scope

Audited surfaces:

1. **Public read boundary** - `convex/publicRead/` (`sanitizeForPublic`, every
   `rebuild*Projection`).
2. **Administrative boundary** - `convex/operations/`, `convex/simulation/*Operations.ts`.
3. **Secret and log handling** - `convex/observability/`, `convex/safety/`,
   `convex/simulation/providers/`, `convex/util/llm.ts`.
4. **Viewer input** - `convex/safety/viewerInput.ts`.
5. **License and attribution** - `LICENSE`, `ATTRIBUTION.md`, `package.json`,
   `docs/upstream.md`, `docs/open-source.md`, bundled assets.
6. **Production deployment safeguards** - CI, deploy scripts, runtime guards.

The primary technique was enumerating the *actual* client-reachable attack surface
rather than reading module documentation. In Convex, `query`/`mutation`/`action` are
reachable by any anonymous client that knows the deployment URL;
`internalQuery`/`internalMutation`/`internalAction` are not. The inventory below was
produced with:

```
grep -rnE "=\s*(query|mutation|action)\(" convex --include='*.ts' | grep -v _generated | grep -v '\.test\.'
```

## 3. Client-reachable route inventory

Every function below is reachable by an unauthenticated client. "Gate" is what actually
runs before the first row is read.

### 3.1 Authorized administrative routes (verified correct)

| Route | File:line | Capability | Min role | Gate verified |
|---|---|---|---|---|
| `pauseWorld` | `convex/operations/opsConsoleFunctions.ts:131` | `world.pause` | operator | yes (`:134`) |
| `resumeWorld` | `convex/operations/opsConsoleFunctions.ts:147` | `world.resume` | operator | yes (`:150`) |
| `advanceSlot` | `convex/operations/opsConsoleFunctions.ts:167` | `slot.advance` | operator | yes (`:170`) |
| `retryFailedSlot` | `convex/operations/opsConsoleFunctions.ts:195` | `run.retry` | operator | yes (`:198`) |
| `cancelUncommittedScene` | `convex/operations/opsConsoleFunctions.ts:236` | `scene.cancel` | operator | yes (`:239`) |
| `createWorldSnapshot` | `convex/operations/opsConsoleFunctions.ts:263` | `snapshot.create` | admin | yes (`:266`) |
| `inspectWorldState` | `convex/operations/opsConsoleFunctions.ts:298` | `world.inspect` | viewer | yes (`:301`) |
| `inspectScheduleAndQueue` | `convex/operations/opsConsoleFunctions.ts:313` | `schedule.inspect` | viewer | yes (`:317`) |
| `listOperatorAudit` | `convex/operations/opsConsoleFunctions.ts:337` | `schedule.inspect` | viewer | yes (`:340`) |
| `describeOperatorSession` | `convex/operations/opsConsoleFunctions.ts:359` | `schedule.inspect` | viewer | yes (`:362`) |
| `emergencyStop` | `convex/operations/emergencyStopFunctions.ts:63` | `world.emergency_stop` | admin | yes (`:66`) |
| `resumeFromEmergencyStop` | `convex/operations/emergencyStopFunctions.ts:98` | `world.emergency_resume` | admin | yes (`:101`) |
| `activateWorldRollback` | `convex/operations/emergencyStopFunctions.ts:131` | `world.rollback` | admin | yes (`:134`) |
| `clearWorldRollback` | `convex/operations/emergencyStopFunctions.ts:157` | `world.rollback` | admin | yes (`:160`) |
| `inspectEmergencyStop` | `convex/operations/emergencyStopFunctions.ts:189` | `world.inspect` | viewer | yes (`:192`) |
| `listProposedEventReviews` | `convex/operations/proposalReviewFunctions.ts:109` | `world.inspect` | viewer | yes (`:112`) |
| `reviewProposedEvent` | `convex/operations/proposalReviewFunctions.ts:132` | `world.inspect` | viewer | yes (`:135`) |

All 17 call `requireOperator` / `requireReviewer` as their first statement, before any
`ctx.db` read. This was verified line by line, not inferred from the module docstring.
The denial is uniform (`OPS_UNAUTHORIZED`,
`convex/operations/operatorAuthorization.ts:112-128`) so an unauthorized caller cannot
distinguish "not an operator" from "world does not exist". **This part of the system is
genuinely well built.** The caveat is finding H-1 below, which concerns *how* a
principal can authenticate at all, not whether the gate is applied.

### 3.2 Unauthenticated routes

| Route | File:line | Effect | Assessment |
|---|---|---|---|
| `validateAndCommitProposedEvent` | `convex/canon/commit.ts:219` | appends to canon | **C-1, fixed** |
| `runFoundationSimulation` | `convex/simulation/workflow.ts:126` | inserts runs, commits canon | **H-6, fixed** |
| `testing.stop` / `testing.resume` | `convex/testing.ts:68`, `:85` | halts/starts engine | **H-2, partly fixed** |
| `joinWorld` / `leaveWorld` / `sendWorldInput` | `convex/world.ts:111`, `:142`, `:167` | mutates world | **H-4, unresolved** |
| `heartbeatWorld` | `convex/world.ts:25` | keeps world alive | Low (upstream) |
| `messages.writeMessage` | `convex/messages.ts:31` | writes agent messages | **H-4, unresolved** |
| `aiTown.sendInput` | `convex/aiTown/main.ts:132` | engine input | **H-4, unresolved** |
| `getTracePublic` | `convex/observability/traces.ts:51` | trace metadata | Info - verified safe |
| `getPublishedReadModel` | `convex/publicRead/readModelFunctions.ts:150` | published snapshots | Info - verified safe |
| `worldState` / `gameDescriptions` / `previousConversation` / `userStatus` | `convex/world.ts` | world reads | Medium (M-3) |
| `music.getBackgroundMusic` | `convex/music.ts:28` | asset URL | Info |

## 4. Findings

### C-1 (Critical, FIXED) - Canon commit was a public, unauthenticated mutation

**What I checked.** Whether the append-only canonical event log can be written by an
anonymous client. The CLAUDE.md architecture invariants state that canonical events are
append-only, accepted history is never edited in place, and LLM providers may only
*propose* events. Canon is the trusted record every public projection is derived from.

**What I found.** `convex/canon/commit.ts:219` declared the canonical commit entry point
as a public Convex `mutation`:

```ts
export const validateAndCommitProposedEvent = mutation({
  args: { proposed: proposedEventArgs, traceId: v.string() },
```

The entire file contained no authorization of any kind - `grep -n "auth\|authorize\|
requireOperator\|identity" convex/canon/commit.ts` returned nothing. The pipeline
(`commitProposedEvent`, `convex/canon/commit.ts:62`) validates only the *shape* of a
proposal via `validateEventStructure` and the canon rules via `validateCanon`. Neither
authenticates the caller nor verifies that the proposal actually originated from the
simulation. `proposedBy` is caller-supplied data inside `proposedEventArgs`
(`convex/canon/proposedEvent.ts:121`), so a caller can also forge provenance.

**Impact.** Any anonymous party holding the deployment URL - which is shipped to every
browser as `VITE_CONVEX_URL` (`src/components/ConvexClientProvider.tsx:13`) - could
append arbitrary events to canonical world history, provided they satisfied the
structural validators. Because the public read projections are derived from canon
(`convex/publicRead/worldCharacterProjectionFunctions.ts:96`), forged canon becomes
published, viewer-visible content. Since accepted canon is never edited in place, there
is no in-band remediation path short of snapshot rollback. This defeats NFR-005 AC#1 and
the project's core integrity invariant.

**Why it was reachable.** This was not a theoretical concern about an intended feature:
the function had **zero callers anywhere in the repository**
(`grep -rn "validateAndCommitProposedEvent" src convex` matched only its own definition
and docstring). It was public purely because the original author anticipated future
frontend callers, as its docstring said: *"Future callers (frontend, director) commit
proposals through this."*

**Fix applied.** Converted to `internalMutation` (`convex/canon/commit.ts:20`, `:219`).
Internal mutations remain callable by server-side Convex functions - the director,
scheduler, and post-commit orchestration - but are not reachable by any client. Because
there were zero callers, this change carries no regression risk. A comment now records
why it must not be widened back.

---

### H-1 (High, UNRESOLVED) - The operator identity path cannot function; a shared bearer token in a mutation argument is the only working credential

**What I checked.** The ART-48 author self-reported the ops-token path as "a deliberate
weakening... a shared bearer secret in a mutation argument". The task brief asked me to
independently confirm or refute rather than repeat that self-assessment. I did, and the
real severity is **higher** than reported.

**What I found.** `resolveOperatorPrincipal`
(`convex/operations/operatorAuthorization.ts:253-280`) tries two credential sources in
order: a Convex-verified `ctx.auth` identity, then the shared token. The identity branch
(`:259-264`) is described throughout the module as the preferred path, with the token as
a bootstrap fallback.

**That identity branch is dead code in this repository.** Convex only populates
`ctx.auth.getUserIdentity()` when an auth provider is declared in
`convex/auth.config.ts`. No such file exists:

```
$ ls convex/auth.config.*
zsh: no matches found: convex/auth.config.*
```

The frontend confirms it - the Clerk provider is commented out
(`src/components/ConvexClientProvider.tsx:22-29`), leaving a bare `ConvexProvider` with
no auth. So `ctx.auth.getUserIdentity()` returns `null` on every call, the `subject`
lookup at `operatorAuthorization.ts:259-263` never matches, and **every** privileged
operation authenticates via the token branch at `:266-277` alone.

**Impact.** The sole credential protecting emergency stop, world rollback, snapshot
creation, pause/resume, and proposed-event review is a shared static secret passed as an
ordinary mutation argument, declared at `convex/operations/opsConsoleFunctions.ts:66-69`:

```ts
export const credentialArgs = {
  operatorId: v.optional(v.string()),
  operatorToken: v.optional(v.string()),
} as const;
```

Consequences that follow, none of which the module's own threat model addresses:

1. **The secret is very likely written to logs.** Convex records function arguments in
   the deployment function log and dashboard. `operatorToken` is a function argument, so
   every ops call plausibly writes the live admin secret into the log. NFR-005 requires
   that no secret reaches a log. The audit-row builder carefully refuses credential
   material (`operatorAuthorization.ts:338-364`) and the ART-57 trace pipeline is
   rigorous about the same rule - but the transport layer underneath both defeats it.
   *I could not execute against a live deployment to capture a log line, so this is
   assessed from Convex's documented logging behaviour rather than observed. It should be
   confirmed against a real deployment before release.*
2. **No expiry, rotation, or revocation.** The token is a static string in
   `SIMULATION_OPS_OPERATORS`. Revoking one operator means editing a JSON blob in an env
   var and redeploying.
3. **No per-request binding.** The token is a bearer credential with no nonce, timestamp,
   or request signature, so a captured call is replayable indefinitely.
4. **Role escalation follows directly from disclosure.** Roles are attached to the
   registry entry (`operatorAuthorization.ts:140-149`), so whoever holds an `admin`
   entry's token *is* admin. There is no second factor.

**What holds up.** The token comparison itself is done correctly.
`constantTimeEquals` (`:239-246`) folds length into the accumulator rather than
short-circuiting, and the loop at `:271-275` compares against every entry so a wrong
`operatorId` costs the same as a wrong token. That is genuinely careful work and I could
not find a timing distinguisher in it. The weakness is architectural, not algorithmic.

**Assessment.** The prior self-assessment ("a deliberate weakening") understates this.
A deliberate weakening implies a stronger path exists and is preferred; here the stronger
path cannot execute at all, so what was documented as a fallback is in practice the
entire authentication system for the administrative boundary.

**Recommendation (deferred - out of scope for ART-62).** Configure a real Convex auth
provider (`convex/auth.config.ts` plus re-enabling the Clerk provider in
`ConvexClientProvider.tsx`), then make the token path opt-in via an explicit env flag and
default it to off. Until then the administrative surface should be treated as protected
by a single shared secret that is probably in the logs. This is a substantial piece of
work with a product dependency (choice of identity provider) and should not be
retro-fitted inside an audit task. **Recommend a new task: "Configure Convex identity
provider and retire the shared ops-token path".**

---

### H-2 (High, PARTLY FIXED) - Public unauthenticated engine stop/resume bypasses the operator role gate

**What I checked.** Whether the ART-48 role gate is the only way to control world
execution, as `opsConsoleFunctions.ts:1-29` claims: *"This is the ONLY caller-facing
surface for privileged simulation control."*

**What I found.** It is not. `convex/testing.ts:68` and `:85` expose `stop` and `resume`
as public unauthenticated mutations that halt and start the engine directly via
`stopEngine` / `startEngine`. They perform no authorization. `pauseWorld` / `resumeWorld`
are reserved for the `operator` role, yet the same practical effect is available to
anonymous callers through a second, ungated path.

The two halves were also asymmetric. `stop` was guarded by an env switch
(`convex/testing.ts:70`):

```ts
if (process.env.STOP_NOT_ALLOWED) throw new Error('Stop not allowed');
```

`resume` (`:85`) had **no guard at all**. A deployment that set `STOP_NOT_ALLOWED` to
disable the developer freeze control still exposed an unauthenticated engine-start
mutation. The UI hides the control in that configuration
(`src/components/FreezeButton.tsx:24` renders `null` when `stopAllowed` is false), which
makes the gap easy to miss - the mutation stays callable directly over the API regardless
of what the UI renders.

**Fix applied.** Added the matching `STOP_NOT_ALLOWED` guard to `resume`
(`convex/testing.ts:85-91`) so both halves honour the same switch. This closes the
asymmetry and makes `STOP_NOT_ALLOWED=1` a complete off-switch for the pair.

**Residual risk (unresolved).** When `STOP_NOT_ALLOWED` is *unset* - the default - both
mutations remain anonymous engine controls that bypass the role gate. The control is
fail-open: forgetting to set an env var leaves it exposed. Making these `internalMutation`
would break `src/components/FreezeButton.tsx`, which is upstream AI Town debug UI, so the
correct fix is a product decision about whether that debug affordance ships at all.
**Recommend a follow-up task: "Remove or authorize the upstream AI Town debug controls
(FreezeButton, testing.stop/resume) for public test"**, and in the interim require
`STOP_NOT_ALLOWED` to be set in any deployment (see §6).

---

### H-3 (High, FIXED) - Raw prompts and raw model output were logged on the live agent path

**What I checked.** ART-57 built a deliberately secret-safe trace pipeline. I checked
whether raw model input/output can reach a log by *any* route, not just that one.

**What I found.** `convex/util/llm.ts:144` logged the entire chat-completion request
body:

```ts
console.log(body);
```

`body` is a `CreateChatCompletionRequest`, so `body.messages` carries the full prompt -
which on this codebase includes character memories and retrieved private knowledge, since
the prompts are assembled in `convex/agent/memory.ts` and `convex/agent/conversation.ts`.
Line `:178` logged raw model output:

```ts
console.log(content);
```

This is not dead upstream code. `chatCompletion` is called from the live agent path at
`convex/agent/conversation.ts:58`, `:128`, `:177` and `convex/agent/memory.ts:61`, `:247`,
`:362`.

**Impact.** The ART-57 pipeline goes to considerable lengths to keep raw content out of
traces - `normalizeLlmTraceDraft` (`convex/observability/llmTrace.ts:111-148`) enforces a
strict key allowlist and rejects anything matching `isSensitiveTraceKey` (`:76-87`), and
`publicLlmTrace` (`:150-158`) is a narrow `Pick`. All of that is sound. But a parallel
code path was writing the very content ART-57 forbids straight into the Convex function
log, which has a much weaker access boundary. This defeats the NFR-005 log-redaction
requirement regardless of how careful the trace module is.

**Note on what was *not* leaking.** The API key is not logged. `AuthHeaders()`
(`convex/util/llm.ts:112-117`) builds the `Authorization` header separately from `body`
and it is never passed to `console.log`. I checked the error paths too - `:161`
(`console.error({ error })`) logs the provider's response text, not the request headers.
So this finding is about prompt and completion content, not credentials.

**Fix applied.** Both statements now log bounded metadata only - model name, message
count, stream flag, and completion length (`convex/util/llm.ts:144-149`, `:178-181`),
matching the shape ART-57 already deemed safe to record. Debuggability is preserved; raw
content is not written.

---

### H-4 (High, UNRESOLVED) - Pre-generation safety classifier has zero production callers

**What I checked.** The task brief asked me to check whether `viewerInput.ts` is actually
wired to anything. I applied the same test to every module in `convex/safety/` rather
than only the one named, and found a more serious instance than the one I was pointed at.

**What I found.** `convex/safety/preGeneration.ts` exports
`evaluatePreGenerationSafety` (`:105`) and `callWithPreGenerationSafety` (`:135`). A
repository-wide search for either symbol returns exactly one non-test consumer - and it is
a test:

```
convex/canon/mistwoodSeed.test.ts:1:import { evaluatePreGenerationSafety } from '../safety/preGeneration';
```

There is no `preGenerationFunctions.ts` (contrast `postGenerationFunctions.ts`, which
exists). `classifyPostGeneration` *is* properly wired, at
`convex/editorial/episodeFunctions.ts:5` and `convex/simulation/sceneSimulation.ts:3`.
So the post-generation half of the safety pipeline is enforced and the pre-generation
half is not.

**Impact.** `PROHIBITED_GENERATION_CATEGORIES` (`convex/safety/preGeneration.ts:5`) and
`PRE_GENERATION_PROVIDER_CONSTRAINT` (`:121`) are never applied to a real provider call.
Nothing screens world text, prompt text, or assembled context before it is sent to the
LLM provider. The upstream agent path (`convex/agent/conversation.ts`,
`convex/agent/memory.ts`) calls `chatCompletion` directly with no safety interception at
all. A module that exists, is unit-tested, and is documented as a control - but is
invoked by nothing - provides no protection while creating the appearance of coverage,
which is the more dangerous failure mode.

**Recommendation (deferred).** Wiring a safety gate into the provider call path is a
functional change with real behavioural consequences (what happens on rejection, how it
interacts with retry and the trace pipeline) and belongs in a feature task, not in an
audit. **Recommend a new task: "Wire pre-generation safety into the provider call path"**,
blocking public test.

---

### H-5 (High, UNRESOLVED) - The emergency stop does not halt the upstream AI Town engine

**What I checked.** FR-K006 provides a kill switch. I checked whether engaging it
actually stops *all* simulation and generation, or only the ART executor.

**What I found.** The guard `assertWorldAdmitsSimulation`
(`convex/simulation/emergencyStopOperations.ts:78`) is enforced in exactly two places:

```
convex/simulation/worldDayLiveFunctions.ts:237
convex/operations/opsConsoleFunctions.ts:174
```

That covers the ART world-day executor and manual slot advance. It does **not** cover the
inherited AI Town engine, which runs independently and calls the LLM provider through
`convex/agent/conversation.ts` and `convex/agent/memory.ts`. Worse, `convex/crons.ts:16`
schedules an unconditional restart every 60 seconds:

```ts
crons.interval('restart dead worlds', { seconds: 60 }, internal.world.restartDeadWorlds);
```

`restartDeadWorlds` consults `worldStatus`, not the FR-K006 emergency-stop state.

**Impact.** An admin who engages the kill switch during a safety incident stops the ART
scene executor but leaves the upstream engine generating LLM content, and a cron may
restart engines the operator believed were halted. The kill switch does not do what an
operator would reasonably assume it does, which is the property that matters most for an
emergency control. Combined with H-2 (anonymous `testing.resume`), the world can also be
restarted by an unauthenticated caller.

**Recommendation (deferred).** Extend `assertWorldAdmitsSimulation` to the upstream
engine entry points and make `restartDeadWorlds` emergency-stop aware. This changes
engine lifecycle behaviour and needs its own tests and review. **Recommend a new task:
"Extend FR-K006 emergency stop to the upstream AI Town engine and world restart cron"**,
blocking public test.

---

### H-6 (High, FIXED) - Foundation simulation runner was a public unauthenticated mutation

**What I checked.** Whether any public route can drive simulation or write canon
indirectly.

**What I found.** `convex/simulation/workflow.ts:126` exposed `runFoundationSimulation`
as a public `mutation` with no authorization. It inserts rows into `simulationRuns` and
commits canon events through `commitProposedEvent`.

**Impact.** Unauthenticated canon writes (a second instance of C-1's class) plus
unbounded row insertion, giving an anonymous caller a storage-growth and cost vector. It
uses `FakeSimulationProvider`, so it does not incur LLM spend directly - that is the only
reason this is High rather than Critical.

**Fix applied.** Converted to `internalMutation` (`convex/simulation/workflow.ts:21`,
`:126`). It had zero callers, so the change is regression-free.

---

### M-1 (Medium, UNRESOLVED) - Viewer input classifier has zero callers

**What I checked.** Whether `convex/safety/viewerInput.ts` (ART-56) is invoked anywhere.

**What I found.** It is not. A repository-wide search for `viewerInput`,
`classifyViewerInput`, or `ViewerInput` outside the module and its own test returns only
generated API type declarations (`convex/_generated/api.d.ts:107`, `:274`). The module is
393 lines with a 266-line test file and no production consumer.

**Assessment.** Rated Medium rather than High because ART-56's own scope note is accurate:
the consuming feature (ART-45 viewer voting) does not exist yet, so there is currently no
viewer input surface and therefore no live exposure. This is a latent rather than active
gap. It is recorded rather than passed because an unenforced control must not be counted
as coverage - and because the risk materialises silently the moment ART-45 lands if the
wiring is not made an explicit acceptance criterion there.

**Recommendation.** Add "viewer input passes through `classifyViewerInput` server-side"
as an explicit acceptance criterion on ART-45. No code change in ART-62.

---

### M-2 (Medium, UNRESOLVED) - `sanitizeForPublic` is a denylist but is documented as an allowlist

**What I checked.** The task brief asked me to confirm `sanitizeForPublic` and every
`rebuild*Projection` genuinely cannot leak a forbidden field, and specifically not to
assume the documented defence-in-depth pattern holds.

**What I found.** The projection builders are sound; the sanitizer is weaker than its
documentation claims.

`sanitizeForPublic` (`convex/publicRead/readModel.ts:96-107`) recursively strips keys
matching `PRIVATE_KEY_PATTERNS` (`:70-83`). That is a **denylist keyed on field name**.
But it is described as an allowlist in at least three places -
`readModel.ts:134` ("`payload` is already allowlisted"), `:213` ("applying the public
allowlist (AC#4)"), and `worldCharacterProjectionFunctions.ts:5` ("explicit-allowlist
pure builders").

A name-based denylist cannot catch a private field whose name does not match a pattern -
`innerMonologue`, `hiddenAgenda`, `recollection`, `unpublishedDraft`, and `internalNotes`
all pass, since only `adminnotes` is covered by `/admin(?:istrator)?notes?/i`. It also
cannot catch private *values* under an innocuous key.

**Why this is Medium, not High.** The defence-in-depth claim does hold in practice,
because the projection builders genuinely do allowlist. I verified this rather than
assuming it:

- `publicFactsFrom` (`worldCharacterProjectionFunctions.ts:35-52`) admits a fact only when
  `change.visibility === 'public' || change.visibility === 'canon'` (`:39`).
- `characterSourceFrom` (`:71-93`) maps state changes through an explicit field map
  (`CHARACTER_STATE_FIELD_MAP`, `:27-33`) and applies the same visibility filter at `:84`.
- `worldSourceFrom` (`:54-69`) constructs an explicit object literal with nine named
  fields.
- I checked every spread operator in `convex/publicRead/` for a raw DB row being splatted
  into a payload. There are none - each spread (`relationshipArcProjection.ts:141`, `:171`,
  `:175`, `:176`; `worldCharacterProjection.ts:123`; `onboardingSummary.ts:99-105`;
  `arcPrimer.ts:118-121`) operates on an already-narrowed typed value, not a `Doc<>`.

So the server layer does the real work and the sanitizer is a genuine second line. The
finding is that the second line is materially weaker than the comments assert, which
matters because a future projection author reading "already allowlisted" may reasonably
rely on a guarantee that is not there.

**Recommendation (deferred).** Either correct the three docstrings to say "denylist,
defence-in-depth only", or promote the sanitizer to a true structural allowlist. Both are
touching shared read-path code with cross-task blast radius (ART-40/43/69/84/85/95/96 all
publish through it), so this belongs in its own change rather than an audit commit.
**Recommend a follow-up task: "Make the public read-model sanitizer a true allowlist or
correct its contract documentation".**

---

### M-3 (Medium, UNRESOLVED) - Upstream AI Town world routes have authentication commented out

**What I checked.** The inherited `convex/world.ts` public routes.

**What I found.** Identity checks are present but commented out at four sites -
`convex/world.ts:102` (`userStatus`), `:116` (`joinWorld`), `:147` (`leaveWorld`), and
`:174` (`sendWorldInput`). Each has a disabled `ctx.auth.getUserIdentity()` block, with
the identity replaced by a shared constant `DEFAULT_NAME` (`:107`, `:122`, `:137`, `:157`).

`sendWorldInput` (`:167-180`) additionally accepts `args: v.any()` (`:171`) and forwards it
to `engineInsertInput` unvalidated.

**Impact.** All world participants share one identity, so `leaveWorld` operating on
`p.human === DEFAULT_NAME` (`:157`) means any anonymous caller can remove the player any
other anonymous caller joined as. This is upstream AI Town's demo posture rather than a
regression introduced by this project, and it is consistent with H-1 (no auth provider is
configured, so these checks *could not* work even if uncommented). Recorded so it is not
mistaken for audited-and-approved.

**Recommendation.** Fold into the H-1 identity-provider task; these blocks should be
re-enabled at the same time an auth provider is configured.

---

### M-4 (Medium, UNRESOLVED) - Denied administrative attempts are not persisted

**What I checked.** Whether the audit trail supports incident reconstruction.

**What I found.** `recordAudit` (`convex/operations/opsConsoleFunctions.ts:110-118`) is
called only on applied/no-op paths. The module documents the reason honestly at
`:104-108`: a Convex mutation is transactional, so an audit row written on the path to a
throw would roll back with it.

**Impact.** The reasoning is correct, but the consequence is that brute-force or
credential-probing against the ops token (H-1) leaves no durable trace in
`operatorAuditLog`. The module points to Convex function logs as the compensating
control, which is a weaker and more transient boundary - and per H-1 those same logs
likely contain the token being probed.

**Recommendation (deferred).** Record denials via a scheduled write or an action outside
the failing transaction. Ties into H-1.

---

### Low / Info findings

- **I-1 (Info, verified good) - LLM trace pipeline is genuinely secret-safe.** I tried to
  find a way to get raw content into a trace and could not.
  `normalizeLlmTraceDraft` (`convex/observability/llmTrace.ts:111-148`) rejects unknown
  keys outright (`:116`) *and* screens them against `isSensitiveTraceKey` (`:114`, defined
  `:76-87`) before the unknown-key check, so a sensitive key yields the specific
  `SENSITIVE_LLM_TRACE_FIELD` error. The write boundary is `internalMutation`
  (`convex/observability/traces.ts:34`). `getTracePublic` (`:51`) is public but returns
  only `publicLlmTrace` (`llmTrace.ts:150-158`), a five-field `Pick` of
  `schemaVersion`/`traceId`/`worldId`/`worldDay`/`finalStatus` - no prompt, no token
  counts, no model name. Role-based widening (`traceForRole`, `:161-168`) requires
  `operations`/`admin` and is only reachable through the authorized review surface.
- **I-2 (Info, verified good) - No secrets are committed.** `git ls-files` matching
  `.env|secret|credential|.pem|.key` returns only `.env.example` and a Backlog task file.
  `.gitignore:28-31, 48-49` covers `.env`, `.env.local`, `.env*.local`, `/.env.prod`. A
  scan for `sk-…`, `AKIA…`, and `ghp_…` patterns across tracked source returned nothing.
- **I-3 (Info, verified good) - Public read path takes no provider dependency.**
  `convex/publicRead/readModel.ts` imports no provider and no simulation module; reads are
  served from pre-computed snapshots via `PublicReadReadStore`
  (`readModel.ts:166-168`). The PRD invariant "public reads must not directly trigger LLM
  generation" holds structurally, not just by convention.
- **I-4 (Info, verified good) - Uniform denial is real.** Every failure path in
  `authorizeOperator` (`operatorAuthorization.ts:301-317`) throws the identical
  `unauthorized()` (`:126-128`) with a fixed code and message. I checked each of the six
  branches; none leaks a distinguishing message or a different error type.
- **I-5 (Low) - Audit secret-leak heuristic is narrow.**
  `buildOperatorAuditEntry` (`operatorAuthorization.ts:345-364`) blocks credential-looking
  audit text only when a forbidden field name is followed by `=` or `:` (`:362`). A reason
  string like `token abc123` passes. Minor, since the field is operator-supplied free text
  and the operator is already authenticated.

## 5. License and attribution

### C-2 (Critical, FIXED) - CC-licensed art credits were deleted while the assets still ship, and the docs relicensed the art as MIT

**What I checked.** AC#4 requires that "License/attribution is retained". I checked not
only whether the upstream MIT notice survived, but whether *every* license obligation
attached to what this repository distributes is satisfied - including the asset layer,
which is the part MIT does not reach.

**What I found (verified directly against the upstream baseline tag).**

The code paperwork is clean. `LICENSE:3` retains `Copyright (c) 2023 a16z-infra`
verbatim, and `git diff upstream-baseline-20260802 HEAD -- LICENSE` is empty - byte
identical. `package.json:4` sets `"private": true` and `:6` declares `"license": "MIT"`.
Upstream is attributed in five places (`README.md:5-6`, `:105-107`, `ATTRIBUTION.md:3`,
`:17`, `docs/upstream.md:9-10`, `docs/open-source.md:8`), including the exact baseline SHA.

**The asset layer was not.** Upstream AI Town's `README.md` carried an "Other credits"
block at lines 43-56. I read it directly from the tag:

```
$ git show upstream-baseline-20260802:README.md | sed -n '36,60p'
Other credits:
...
- Tilesheet:
  - https://opengameart.org/content/16x16-game-assets by George Bailey
  - https://opengameart.org/content/16x16-rpg-tileset by hilau
- Original assets by [ansimuz](https://opengameart.org/content/tiny-rpg-forest)
- The UI is based on original assets by
  [Mounir Tohami](https://mounirtohami.itch.io/pixel-art-gui-elements)
```

That block is gone. `grep -in "opengameart\|credits\|ansimuz\|Mounir\|musicgen"` across
`README.md`, `ATTRIBUTION.md`, and `docs/upstream.md` returned **no matches**. It was
removed by the rebranding commit `7744d88` ("chore: establish open-source project
foundation"), found via `git log -S"opengameart" -- README.md`.

The credited files are all still present and still shipped:
`public/assets/rpg-tileset.png`, `32x32folk.png`, `magecity.png`, `gentle-obj.png`,
`public/assets/spritesheets/*.png`, and `assets/ui/*.svg` (9 files).

**And the replacement documentation made it worse.** `ATTRIBUTION.md:24-28` stated that
**"all assets (`assets/`, `public/`, `data/`)... are retained from upstream under the MIT
License"**, and `docs/upstream.md:127-128` repeated the claim. a16z-infra never held
copyright in OpenGameArt or itch.io art and so could never have MIT-licensed it. The
project was documenting a license grant it has no right to make - which is worse than
silence, because downstream users would rely on it. `docs/upstream.md:129` then deferred
to `ATTRIBUTION.md` for third-party provenance, but `ATTRIBUTION.md:42-46` covered only
*code* dependencies and named no art source at all, so the reference was circular.

**Impact.** OpenGameArt and itch.io assets are typically CC-BY or CC-BY-SA. For those
licenses attribution is a **condition of the grant**, independent of MIT. Distributing
the art with the sole credit notice deleted is a plausible license breach rather than a
documentation gap, and AC#4 ("License/attribution is retained") was not satisfied.

**Fix applied.** Documentation-only, no code touched:

- Added `ASSETS-LICENSE.md` restoring the upstream credits verbatim, mapping each shipped
  file to its attributed source, and recording the unresolved provenance questions.
- Corrected `ATTRIBUTION.md:24-34` to scope the MIT grant to *source code* and to state
  explicitly that the asset layer is not MIT.
- Corrected `docs/upstream.md:126-131` to the same effect.
- Added an asset-license section to `README.md` linking `ASSETS-LICENSE.md` and naming the
  principal artists inline.

**Residual (Medium, unresolved).** The precise license *version* per asset is still
unconfirmed. I identified CC-BY / CC-BY-SA by inference from the OpenGameArt and itch.io
URLs; I did not fetch those pages, and this audit had no network access to do so. If any
asset proves CC-BY-SA, its share-alike obligation needs separate assessment. Likewise the
two bundled fonts (`public/assets/fonts/upheaval_pro.ttf`, `vcr_osd_mono.ttf`, loaded at
`src/index.css:6-12`) and `public/assets/background.mp3` have no license record at all.
These are recorded as open items in `ASSETS-LICENSE.md`. **Recommend a follow-up task:
"Confirm per-asset license versions and font/audio provenance at source"**, blocking
public test.

### M-5 (Medium, UNRESOLVED) - `package.json` SPDX field overstates the grant

`package.json:6` declares a single top-level `"license": "MIT"`, which asserts MIT over the
whole package including the CC-licensed art. The accurate form is a compound expression
(e.g. `MIT AND CC-BY-3.0`) or `"SEE LICENSE IN LICENSE"` alongside the asset notice. Left
unchanged because the correct expression depends on the per-asset license versions that
C-2's residual item must confirm first. Note `"private": true` (`package.json:4`)
correctly prevents accidental `npm publish`.

### L-1 (Low, UNRESOLVED) - Upstream trademarks in the derivative's own UI

`src/App.tsx:135-136` renders the a16z logo (`assets/a16z.png`) and `:138-139` the Convex
logo, while `README.md:109` states this is "**Not** the official AI Town project". MIT
grants no trademark rights. Retaining these is defensible as attribution, but a rebranded
derivative displaying the upstream sponsor's mark in its own chrome carries an
endorsement-confusion risk. This is a maintainer decision, not an automatic fix.

### I-6 (Info, verified good) - No copyleft dependency conflict

No GPL, AGPL, or LGPL dependency was found
(`grep -iE '"license": ".*(GPL|AGPL|LGPL|EPL|CDDL|SSPL)' package-lock.json` returns
nothing). `axe-core` is MPL-2.0 but arrives via `jest-axe`, a devDependency, and MPL's
file-scoped weak copyleft does not conflict with MIT distribution. `convex` is Apache-2.0
rather than MIT, which carries a §4(d) NOTICE-propagation obligation that was previously
undocumented; `ASSETS-LICENSE.md` now records it.

**Confidence caveat.** `node_modules` was not installed during this audit, so the
dependency scan read `package-lock.json` only. Roughly 764 of 866 lockfile entries carry
no license field, including `replicate` and `pixi.js`. A conclusive answer requires
`npm ci && npx license-checker --summary`; **recommend adding that to CI**.

## 6. Production deployment safeguards

**Finding: the "production deployment is disabled" posture is documentation prose, not a
technical safeguard. There is, however, no live deploy risk today.**

Both halves of that sentence matter, and the report would be misleading without both.

**What is genuinely safe (verified).** No deploy pipeline exists.
`.github/workflows/` contains exactly two files, `ci.yml` and `bootstrap.yml`. Both
trigger on `pull_request` and `push` to `main` (`ci.yml:3-6`, `bootstrap.yml:3-6`), both
declare read-only tokens (`ci.yml:8-9`, `bootstrap.yml:8-9`), and the terminal step of
each is `npm run build` (`ci.yml:42-43`, `bootstrap.yml:42-43`). Neither references
`secrets.*`, an `environment:`, or any job named deploy/release/publish. `git log` over
`.github/workflows/` shows only two commits and no deleted workflow, so a deploy workflow
never existed. `package.json` contains **zero** occurrences of `convex deploy`; its only
Convex invocations are `predev` (`:19`, `convex dev`), `dev:backend` (`:20`), and
`dashboard` (`:22`). SECURITY.md:43's claim of "CI that runs offline with no production
secrets" is accurate and independently verified.

The correct framing is therefore **unenforced convention**, not active vulnerability. The
absence of a deploy path is incidental - nothing was ever wired up - rather than the
product of a control. That distinction is exactly why the gaps below matter.

### M-6 (Medium, UNRESOLVED) - The agent guard hook enforces every CLAUDE.md "never" rule except the production-deploy one

`.claude/hooks/guard-dangerous-command.mjs:33-45` defines eleven blocking rules covering
`git push upstream` (`:34`), force-push (`:35`), hard reset to `origin/main` (`:36`),
`gh repo delete|archive` (`:37`), `gh release create` (`:38`), `npm publish` (`:39`),
`terraform destroy` (`:42`), `rm -rf /` (`:44`), and others. There is **no** pattern for
`convex deploy`, `vercel deploy`, `fly deploy`, `fly launch`, or `docker push` - so the
one rule it fails to enforce is CLAUDE.md:61, "Never perform a production deploy", while
its ten siblings are enforced. The hook is registered at `.claude/settings.json:13-23`.
It also fails open by design (`:12-14`, `:21-23`).

Not exploitable on its own, since no pipeline exists - but it is the cheapest of the three
gaps to close and it is the single stated deploy prohibition in the repository.

### D-1 (High, RESOLVED - no link exists) - `vercel.json` is present and unguarded; a push-to-main auto-deploy cannot be ruled out from the repository alone

`vercel.json` is git-tracked, syntactically valid, and declares a real framework preset
(`"framework": "vite"` at `:2`, with a rewrite at `:3-8`). `.vercelignore` is two lines
and does not exclude the app.

**Whether this repository is actually linked to a Vercel project was not determinable from
the repository contents alone.** Vercel's Git integration is configured server-side in the
Vercel dashboard and consults no repo-side allow/deny switch, and `.gitignore:43` ignores
`.vercel`, so no link artifact would be committed either way. If a link existed, every
merge to `main` would auto-deploy a publicly reachable production site - directly contrary
to `SECURITY.md:34` and `README.md:118-119` - for an application whose own SECURITY.md
(`:32-33`) concedes server-side authorization is absent.

**Maintainer verification completed 2026-08-04.** Vercel's GitHub integration always
registers a repository webhook and populates the GitHub Deployments API when a project is
linked. Both were checked directly against GitHub, not inferred:

```
$ gh api repos/tc3oliver/ai-reality-town/hooks
[]
$ gh api repos/tc3oliver/ai-reality-town/deployments
[]
```

Both empty. No Vercel project has ever been linked to this repository, and no deploy has
ever occurred through it. **No live deploy risk exists today.** `vercel.json` is inert
config with nothing consuming it. Downgraded to Info; no code or config change required.
The stale `fly/README.md` deploy runbook (M-7) and the guard-hook gap (M-6) remain
unresolved and still matter if a link is ever created in the future - this resolution
covers only "is one linked right now," not "could one be created later without a
technical block."

### M-7 (Medium, UNRESOLVED) - Shipped documentation contains a copy-pasteable production-deploy runbook

`fly/README.md:26` instructs `npx convex deploy`, `:31` references the same, and `:53`
says "Then `fly deploy` to redeploy it." These are the only three deploy-command strings
in the entire repository, and they contradict `README.md:10`, `README.md:118-119`, and
`SECURITY.md:34`. The file is stale inherited upstream content - `fly/README.md:16` still
tells the reader to clone `https://github.com/ai-town/ai-town.git`, the wrong repository.
`fly/backend/fly.toml` and `fly/dashboard/fly.toml` are inert static configs that do
nothing without a human running `fly launch`/`fly deploy`.

No automation executes any of this, hence Medium - but it is a production-deploy runbook
sitting inside a repository whose SECURITY.md forbids production deployment.

### Scope judgement on adding a hard technical block

The task brief asked me to judge whether building an actual deploy blocker belongs to
ART-62. **It does not.** ART-62's scope is to *audit* boundaries and *produce findings*;
its Out of Scope line explicitly excludes production deployment. Adding a real safeguard
means editing the agent guard hook and adding a CI gate - control-plane changes with their
own review and failure modes, and in the hook's case a file under `.claude/` that this
task has no mandate to alter. AC#4 asks that production deployment "remains disabled",
which is satisfied observationally (no pipeline exists) and is what this section
evidences.

**Recommend a new task: "Add technical production-deployment safeguards"**, covering the
guard-hook deploy patterns (M-6), a maintainer decision plus documentation fix on the Fly
runbook (M-7), and confirmation of the Vercel link status (D-1).

## 7. Changes made in this task

| File:line | Change | Finding |
|---|---|---|
| `convex/canon/commit.ts:20`, `:219` | `mutation` -> `internalMutation` | C-1 |
| `convex/simulation/workflow.ts:21`, `:126` | `mutation` -> `internalMutation` | H-6 |
| `convex/testing.ts:85-91` | added `STOP_NOT_ALLOWED` guard to `resume` | H-2 |
| `convex/util/llm.ts:144-149`, `:178-181` | log bounded metadata, not raw prompt/completion | H-3 |
| `ASSETS-LICENSE.md` (new) | restore upstream art/audio credits; record open provenance items | C-2 |
| `ATTRIBUTION.md:24-34`, `:48-53` | scope MIT to source code; stop relicensing assets as MIT | C-2 |
| `docs/upstream.md:126-131` | same correction | C-2 |
| `README.md:112-121` | asset-license section linking `ASSETS-LICENSE.md` | C-2 |

All are minimal and regression-free: the two `internalMutation` conversions had zero
callers, the `resume` guard mirrors the existing `stop` guard, the logging change alters
no control flow, and the license remediation touches documentation only.

## 8. Release decision

**Not clear for public test.**

Unresolved Critical/High:

- **H-1** - the ops identity path cannot function (no `convex/auth.config.ts`), so a shared
  bearer token passed as a mutation argument is the only working admin credential, and it
  is likely written to the Convex function log on every privileged call.
- **H-4** - the pre-generation safety classifier has zero production callers.
- **H-5** - the FR-K006 emergency stop does not halt the upstream AI Town engine, and a
  60-second cron restarts worlds regardless of it.

H-2 retains residual risk whenever `STOP_NOT_ALLOWED` is unset, which is the default.
D-1 is resolved (no Vercel link exists); it is not part of the release-blocking list above.

Recommended follow-up tasks, all blocking public test:

1. Configure a Convex identity provider and retire the shared ops-token path (H-1, M-3, M-4).
2. Wire pre-generation safety into the provider call path (H-4).
3. Extend FR-K006 emergency stop to the upstream engine and the restart cron (H-5).
4. Remove or authorize the upstream AI Town debug controls (H-2).
5. Confirm per-asset license versions and font/audio provenance at source (C-2 residual, M-5).
6. Add technical production-deployment safeguards (M-6, M-7, D-1).
7. Make the public read-model sanitizer a true allowlist or correct its contract docs (M-2).
8. Add a server-side viewer-input classification acceptance criterion to ART-45 (M-1).
9. Add `npm ci && npx license-checker --summary` to CI (I-6 confidence caveat).

## 9. Audit limitations

Stated so the evidence is not over-read:

- **No live deployment was exercised.** Every finding is from source review. The H-1
  claim that `operatorToken` reaches the Convex function log follows from Convex's
  documented argument-logging behaviour and was **not** observed in a real log; it should
  be confirmed against a deployment before release.
- **No network access.** Asset license versions (C-2 residual) were inferred from source
  URLs, not fetched.
- **`node_modules` was not installed**, so the dependency license scan read
  `package-lock.json` only, where ~88% of entries declare no license field.
- **The `authorize -> act -> audit` wrapper bodies remain typecheck-only**, as the ART-48
  author flagged. I verified by reading that the gate is applied first in all 17 routes,
  which is the property that matters most, but that is static verification - there is no
  end-to-end test proving an unauthorized caller is rejected at runtime. Adding those
  tests is worth a follow-up.
