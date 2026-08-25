# Public Read-Only Guarantee — Audit Record (ART-128)

- **Requirement IDs:** FR-O009 (PRD 2.0 §12 Epic O, §18.1, §22, RISK2-002)
- **Audit date:** 2026-08-07
- **Scope:** the entire client-reachable Convex surface of the deployment, not only the
  pages a public visitor is shown.
- **Method:** enumeration from source, adversarial invocation of every public mutation,
  and proof-by-absence for the retired interactive engine. See §3.

> **Amended by ART-45 (FR-J001), 2026-08-25.** This document records the audit as it stood on
> 2026-08-07, when the deployment exposed no viewer write because none was intended. FR-J001's
> daily environment vote is one, and the guarantee is now stated and enforced **per surface**
> rather than repository-wide. The amendment is §9; everything above it describes the audit at
> the time, and the counts in §1 and §5 are superseded there. The reasoning, and the alternative
> that was rejected, are in `docs/daily-environment-vote.md` §2.

## 1. Verdict

**The public read-only guarantee holds, and is now machine-enforced.**

PRD 2.0 §18.1 sets two numbers to exactly zero: viewer-triggered LLM calls, and successful
public mutations. Both hold. Public viewing is structurally incapable of mutating the
world or triggering generation:

- The shipped browser bundle names exactly **one** Convex function, and it is a `query`.
- Every one of the **24** client-reachable functions is either an anonymous read or an
  operator-gated control. There is **no anonymous mutation**, and there are **zero HTTP
  routes**.
- Every public mutation refuses an unauthenticated or forged caller **before reading any
  row**, so a denial cannot be used to probe what exists.

This was **not** true when the task started. Two Critical findings were fixed here; both
had been missed by ART-62's hand-maintained audit because nothing machine-checked the
surface. See §2.

| Severity | Found | Fixed | Pinned as correct |
|---|---|---|---|
| Critical | 2 | 2 | 0 |
| Medium | 3 | 3 | 0 |
| Low (already correct) | 1 | 0 | 1 |

## 2. Findings

### GAP 1 — Critical — a public mutation anyone could call, and it succeeded

`convex/init.ts` exported its handler with `mutation`, not `internalMutation`. Any
anonymous client holding the deployment URL could invoke it, and the call **succeeded** —
precisely the number PRD 2.0 §18.1 sets to zero. The handler's body was a no-op plus a
provider-configuration check, so the impact was low, but the *count* was not zero and the
release gate is stated as a count.

**Fixed:** `internalMutation`. `npm run predev` (`convex dev --run init --until-success`)
is unaffected: the CLI authenticates with the deployment admin key
(`runFunctionAndLog` → `setAdminAuth`), which reaches internal functions — the same path
the Convex dashboard uses to run them.

### GAP 2 — Critical — an unauthenticated HTTP action with an SSRF-shaped fetch

`POST /replicate_webhook` (`convex/http.ts` → `convex/music.ts`'s
`handleReplicateWebhook`) was an `httpAction` with **no signature verification**. An
anonymous POST caused the server to `fetch()` an attacker-influenced URL, store the
unbounded response body in Convex storage, and insert a database row.

The whole module was dead code: `enqueueBackgroundMusicGeneration` had zero callers
repo-wide, and `MusicButton.tsx` — the only consumer of its read side — was rendered by
nothing.

**Fixed by deletion, not by authentication.** `convex/music.ts` and
`src/components/buttons/MusicButton.tsx` are gone, `convex/http.ts` is reduced to an empty
router, and `replicate` is removed from `package.json`. The `music` table is left inert in
`convex/schema.ts`, the same treatment ADR-0004 gave the retired a16z tables — no data
migration.

### GAP 3 — Medium — the read-only client boundary covered only two directories

`readOnlyClientBoundary.roots` was `["src/components/public", "src/components/world"]`, so
`src/App.tsx`, `src/components/ConvexClientProvider.tsx` and `src/components/buttons/**`
were unpoliced — a write could have been added to the shipped bundle without tripping the
rule that exists to forbid it.

**Fixed:** the root is now `["src"]`. `src/editor` (the dev-only level editor, a separate
Vite root that is not shipped) is excluded. `ConvexReactClient` was **added** to the
forbidden-symbol list, with a symbol-scoped exemption for the one file that legitimately
constructs the client — `useMutation`/`useAction` remain denied even there, so the
exemption covers construction and never a write.

### GAP 4/5 — Medium — nothing machine-checked the public surface

The surface was governed by a hand-written audit document, which is why GAP 1 and GAP 2
survived. **Fixed:** the new `publicFunctionSurface` policy section (§4).

### GAP 6 — Medium — the freshness clock was caller-suppliable

`getPublicRuntimeSnapshot` accepted an optional `nowMs`, which is the value
`classifyRuntimeFreshness` uses to decide `live | delayed | paused | stale`. Any caller
could therefore make an arbitrarily stale snapshot report `live`, or a current one report
`stale`, purely by choosing a number — and a non-finite `nowMs` (`NaN`/`Infinity`) was
never rejected, silently poisoning every elapsed-time comparison.

**Fixed:** `nowMs` is removed from the public query's validator; the server clock is
authoritative. `serveRuntimeSnapshot` keeps `nowMs` as a parameter so tests can sit at a
chosen instant, and now rejects a non-finite value.

### GAP 7 — Low — forged identifiers already fail safe (pinned, deliberately not changed)

A blank `worldId`/`modelRef`, or an unknown `modelKind`, throws a stable `*_INVALID_SHAPE`
error that names no stored value, no table and no world. A well-formed but nonexistent
identifier returns `null` cleanly, and another world's `modelRef` does not cross worlds.

This is correct fail-safe behaviour. It was **not** changed; it is pinned by tests as a
regression guard.

## 3. Method

A behavioural test cannot prove the absence of a mutation — it only shows that the paths
it happened to walk did not write, and says nothing about the anonymous caller who never
loads the app and posts straight at the deployment URL. So the proof operates on the
surface, at three levels:

1. **Enumeration.** Every client-reachable registration under `convex/` is found in source
   and diffed against the declared allowlist in both directions. Each declared function's
   real runtime visibility flags (`isQuery`/`isMutation`/`isPublic`/`isInternal`, present
   on the object Convex's `queryGeneric`/`mutationGeneric` produce) are then read off the
   imported function object, so the policy is checked against runtime truth rather than
   against a docstring.
2. **Adversarial invocation.** Every public mutation is actually *called*, through its real
   `_handler`, with no identity and with forged credentials. The `db` it receives is a
   `Proxy` that throws on any property access, so "denied" and "denied **before reading
   any row**" are separately checkable. A gate that reads first can be used to probe which
   worlds exist; this proves none does.
3. **Absence.** The functions a viewer would need in order to join, move, chat or drive a
   world are proven not to exist, rather than proven to be unreachable.

The suite's teeth were verified by mutation testing: re-introducing a public mutation, a
read-before-authorize, and the caller-suppliable `nowMs` each fail the suite (see §7).

## 4. The three enforcement layers

| Layer | Where | What it makes impossible |
|---|---|---|
| `readOnlyClientBoundary` | `architecture/module-boundaries.json`, enforced by `npm run check:architecture` and `src/components/world/readOnlyWorldSurface.test.ts` | Any file in the shipped client naming a write API (`useMutation`, `useAction`, `useConvex`, `ConvexHttpClient`, `ConvexReactClient`, `ConvexClient`, `BaseConvexClient`, and the retired a16z input helpers). The two non-React `convex/browser` clients are listed because they expose `.mutation()`/`.action()` directly and the React hooks do not cover them. |
| `publicFunctionSurface` | same file, enforced by `validatePublicFunctionSurface` **and** `validateForbiddenHttpActions` in `scripts/architecture/check-boundaries.mjs` | Adding a client-reachable `query`/`mutation`/`action` anywhere under `convex/` without declaring it; leaving a stale declaration behind; naming `httpAction` at all; declaring a public mutation that is not operator-gated. |
| `authorizeOperator` | `convex/operations/operatorAuthorization.ts` | Reaching any operator control without a registry-listed principal. Fails closed on an unset registry, and every denial is byte-identical so a refusal leaks nothing. |

The three are independent: the first governs what the browser can *name*, the second what
the deployment *exposes*, the third what a caller may *do* with what is exposed. GAP 1 and
GAP 2 were both invisible to the first layer, which is why the second now exists.

## 5. Client-reachable inventory

Generated from `architecture/module-boundaries.json` → `publicFunctionSurface.allowed`,
and asserted equal to the registrations found in source by
`convex/publicRead/publicReadOnlyGuarantee.test.ts`.

**Anonymous reads (4)** — no authentication, queries only:

| Function | Module | Kind |
|---|---|---|
| `getPublishedReadModel` | `convex/publicRead/readModelFunctions.ts` | query |
| `getPublicDynamicProjection` | `convex/publicRead/liveStateFunctions.ts` | query |
| `getPublicRuntimeSnapshot` | `convex/publicRead/runtimeSnapshotFunctions.ts` | query |
| `getTracePublic` | `convex/observability/traces.ts` | query |

`getTracePublic` returns only `schemaVersion`, `traceId`, `worldId`, `worldDay` and
`finalStatus` — no prompt, no model output, no credential.

**Operator-gated reads (7):**

| Function | Module |
|---|---|
| `inspectWorldState`, `inspectScheduleAndQueue`, `listOperatorAudit`, `describeOperatorSession` | `convex/operations/opsConsoleFunctions.ts` |
| `inspectEmergencyStop` | `convex/operations/emergencyStopFunctions.ts` |
| `listProposedEventReviews`, `reviewProposedEvent` | `convex/operations/proposalReviewFunctions.ts` |

**Operator-gated mutations (13)** — every one calls `requireOperator` as its first
statement:

| Function | Module |
|---|---|
| `pauseWorld`, `resumeWorld`, `advanceSlot`, `retryFailedSlot`, `cancelUncommittedScene`, `createWorldSnapshot` | `convex/operations/opsConsoleFunctions.ts` |
| `emergencyStop`, `resumeFromEmergencyStop`, `activateWorldRollback`, `clearWorldRollback` | `convex/operations/emergencyStopFunctions.ts` |
| `createCorrectionEvent`, `createCompensationEvent`, `createRetconEvent` | `convex/operations/canonCorrectionFunctions.ts` |

**HTTP routes: 0.** **Anonymous mutations: 0.** **Anonymous actions: 0.**

The shipped browser bundle references exactly one of these —
`publicRead/readModelFunctions:getPublishedReadModel`, a query.

## 6. Acceptance criteria evidence

All tests are in `convex/publicRead/publicReadOnlyGuarantee.test.ts` unless noted.

| AC | Claim | Evidence |
|---|---|---|
| #1 | `/live` executes only read queries even when unauthenticated | *the shipped client reaches exactly one Convex function, and it is a read*; *every public function under convex/ is declared*; *each declared function carries the runtime visibility its policy entry claims* |
| #2 | Public viewing never creates a human player | *no human-player, heartbeat or world-lifecycle function survives*; *nothing under convex/aiTown/ registers a client-reachable function* |
| #3 | Public viewing never sends a heartbeat | *no declared public function is named for joining, moving, chatting or a heartbeat*; `readOnlyWorldSurface.test.ts` → *mounts no heartbeat or polling timer* |
| #4 | Public viewing never starts or resumes a world | *starting or resuming a world requires an operator* (calls `resumeWorld`, `pauseWorld`, `advanceSlot`, `retryFailedSlot`, `resumeFromEmergencyStop` unauthenticated; all reject with `OPS_UNAUTHORIZED`, none touches the db) |
| #5 | Public viewing adds no LLM trace | *trace recording is internal and cannot be reached from a client*; *the public trace read exposes only non-generative metadata*; *no public read module can reach a provider, the simulation, or observability writes*; *the anonymous read path is queries only* |
| #6 | Security tests intercept and reject all unauthorized mutation attempts | *every public mutation refuses an unauthenticated caller before reading any row*; *every operator-gated query refuses an unauthenticated caller too*; *an empty registry denies everyone*; *forged operator credentials are refused*; *every denial is the same* |
| #7 | Public APIs reject character control payloads server-side, not only by hiding UI | *character-control payloads are refused server-side, not merely hidden* (sends `playerId`/`characterId`/`destination`/`action: 'moveTo'`/`message`/`conversationId`); *no public function even declares a character-control argument* (inspects each function's real `exportArgs()`) |
| #8 | Forged `characterId`, `worldId` and `runtimeSequence` values are rejected | *a well-formed but nonexistent worldId returns null*; *another world's modelRef does not cross worlds*; *a blank worldId or an unknown modelKind is rejected without naming stored data*; *a forged runtime clock can no longer be supplied at all*; *the server clock is validated* |

Private-data leakage (the task's "private-data read attempts" requirement) is covered by
*every private field is stripped at every nesting depth*, which seeds a payload carrying
`prompt`, `apiKey`, `secret`, `privateNote`, `token`, `memory`, `knowledge` and
`password` at three nesting depths and asserts none survives, while the public fields do.
`dialogue` and character interiority are covered separately by
`PUBLIC_DYNAMIC_FORBIDDEN_FIELDS`.

## 7. Verification

```
npm run check:architecture     # public surface + client boundary + module graph
npm run test:architecture      # 26 policy tests
npm run check                  # full gate: + asset licenses, typecheck, lint, tests, build
```

Both architecture commands run in CI (`.github/workflows/ci.yml` and `bootstrap.yml`) ahead
of the typecheck step. A gate that only ran locally would not be a release gate.

The `publicFunctionSurface` gate was landed **before** GAP 1 and GAP 2 were fixed, to prove
it catches something real rather than being written to match the status quo:

```
BOUNDARY ERROR: convex/init.ts: client-reachable mutation 'init' is not declared in publicFunctionSurface
BOUNDARY ERROR: convex/music.ts: client-reachable query 'getBackgroundMusic' is not declared in publicFunctionSurface
BOUNDARY ERROR: convex/music.ts: 'handleReplicateWebhook' registers a forbidden httpAction
```

Three mutants were then introduced to confirm the suite has teeth:

| Mutant | Result |
|---|---|
| Add an undeclared anonymous `joinWorld` mutation | `check:architecture` fails; enumeration test fails |
| Read a row before authorizing in `pauseWorld` | 6 tests fail with `public caller reached the database: .query` |
| Restore the caller-suppliable `nowMs` | *a forged runtime clock can no longer be supplied at all* fails |
| Re-add the webhook in the idiomatic inline form — `http.route({ handler: httpAction(...) })` | `BOUNDARY ERROR: … 'httpAction' is forbidden anywhere under a scanned root`; *no httpAction is named anywhere under convex/* fails |

That last mutant is the one that matters most: it is the shape the deleted
`/replicate_webhook` actually had, it names no variable, and it passed both the allowlist
diff and the suite until the identifier check was added alongside them.

## 8. Non-goals

- **Retiring the a16z engine further.** Already done by ADR-0004 / ART-112. This task
  removed only what its own security scope required (`music.ts`, `MusicButton.tsx`).
- **Observability counters for the guarantee.** FR-Q001 / ART-133. This task *proves* the
  guarantee; ART-133 charts operational metrics about it.
- **Changing the ART-114/115/116/117 projection contracts.** Untouched, apart from GAP 6's
  removal of `nowMs` from one public validator.
- **"Fixing" GAP 7.** The forged-identifier behaviour is already fail-safe and is pinned,
  not altered.

## 9. Amendment — the one viewer write (ART-45 / FR-J001, 2026-08-25)

### What changed

PRD 1.0 §5.1 G11 requires a daily viewer ballot. This audit's blanket rule — *no anonymous
mutation exists anywhere* — could not express that exception, so the guarantee is now proven as
what PRD 2.0 §22.16 actually claims: 「公開**觀看**不執行任何成功 Mutation」, scoped by FR-O009 to
`/live` and by RISK2-002 to 觀看. Viewing still reaches nothing but reads.

### The surface today

**Anonymous reads: 5** (the four in §5, plus `getEnvironmentVoteBallot`).
**Operator-gated reads: 8. Operator-gated mutations: 13. Viewer-gated mutations: 1.
Anonymous mutations: 0. Anonymous actions: 0. HTTP routes: 0.**

The shipped browser bundle now names **six** Convex functions: five queries and
`viewer/environmentVoteFunctions:submitEnvironmentVote`, which is referenced from exactly one
file (`src/components/vote/useEnvironmentVote.ts`) and is asserted to be.

### Why this is not a hole

`anonymous` still means READ ONLY — `validatePolicy` rejects an anonymous mutation exactly as it
did before. The ballot uses a **third** gate, `viewer`, and every rule below is machine-checked
by `scripts/architecture/check-boundaries.mjs` and covered by
`scripts/architecture/check-boundaries.test.mjs`:

| Rule | Effect |
|---|---|
| Declared twice — `publicFunctionSurface.allowed` **and** `viewerWriteBoundary.allowed` | Opening a viewer write costs two edits in two places, not one word |
| `maxViewerMutations: 1` | A second viewer write fails the build even when fully declared |
| Must live under `convex/viewer` | It cannot sit in a module that may reach Canon, the read model or the simulation |
| May never be an `action` | A viewer cannot reach a provider; ADR-0001 stays enforceable |
| Module must NAME `classifyViewerInput` and `evaluateVoteSubmission` | The only rule in the policy that fails on ABSENCE — a viewer write that dropped its safety gate or its rate limiter fails the build |
| Module may name no Canon-write symbol | A vote cannot author a world fact, in either spelling: import or home-grown |
| A write-API exemption may only be granted under `src/components/vote` | `/live`, the world renderer, every public page and the app shell keep the exact guarantee they had; an exemption for them cannot be written down |

### The three layers, updated

`readOnlyClientBoundary` is unchanged in strength: `useMutation` and friends are still forbidden
in every file under `src`. There is now one exemption, for one file and one symbol, and the new
clientRoot rule bounds where such an exemption may ever be granted. The `ConvexClientProvider`
exemption is untouched — `ConvexReactClient` is construction, not a write, and `useMutation`
remains denied there.

### Evidence

- `convex/publicRead/publicReadOnlyGuarantee.test.ts` → *no anonymous mutation exists; every
  write is an operator control or the one ballot*, and the six tests under *the declared viewer
  write is exactly one bounded ballot*.
- `src/components/world/readOnlyWorldSurface.test.ts` → *every surface other than the vote module
  is still provably unable to write*, and *the vote module is one file wide and holds no logic*.
- `scripts/architecture/check-boundaries.test.mjs` → the seven viewer-write-gate tests, each of
  which introduces a mutant policy and asserts it is refused.
- `e2e/dynamicView.spec.ts` is unchanged and still asserts zero writes from `/live` through two
  independent mechanisms.

### Consequence for the release gate

§22's item 16 should be recorded as **"zero successful mutations caused by viewing; one
deliberately declared ballot write exists"**. That is a change in how the number is reported, not
a change in what viewing can do, and it is flagged here so ART-138 does not meet it as a surprise.
