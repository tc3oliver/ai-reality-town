# CLAUDE.md

Stable rules every coding agent session must know for **AI Reality Town**. Detailed
workflows live in `docs/agent/` and via `npm run backlog -- instructions overview`; do not
duplicate them here. Platform-specific skills and hooks are convenience adapters, not
workflow sources of truth.

## 1. Project Control Plane

- **Backlog.md is the sole task source of truth.**
- The PRD (stored as `backlog doc` entries under `backlog/docs/prd/`) is the product requirement source of truth.
- Git history, merged PRs, tests, ADRs, and Backlog tasks are the persistent project record.
- Conversation history must **not** be treated as the project record.

## 2. Mandatory Session Startup

Before planning or modifying code in any session, run:

```bash
npm run agent:check
npm run backlog -- instructions overview
npm run backlog -- task list --json
git status --short
git branch --show-current
git log -5 --oneline
```

Then act by state:

- Bootstrap incomplete → follow `docs/agent/AUTONOMOUS-DEVELOPMENT.md` and **only** repair bootstrap.
- Bootstrap complete and PRD absent → do **not** invent requirements; request the PRD.
- PRD exists and no product task graph exists → follow the PRD-to-Backlog flow in `docs/agent/BACKLOG-WORKFLOW.md`.
- An In Progress task exists → resume it using the task loop in `docs/agent/AUTONOMOUS-DEVELOPMENT.md`.
- No In Progress task but a Ready task exists → select the highest-priority unblocked task using the same task loop.
- Only genuine Human Blockers remain → use the fixed Human Action Required format in `docs/agent/HUMAN-BLOCKERS.md`.

## 3. Autonomy Rule

- Do **not** ask for approval for ordinary technical decisions.
- Do **not** stop after planning, task creation, implementation, or PR creation.
- Request human help **only** for documented H01–H07 Human Blockers (`docs/agent/HUMAN-BLOCKERS.md`).

## 4. Backlog Rule

- Use the Backlog.md CLI (`npm run backlog -- …`) for task operations.
- Do **not** manually edit task Markdown when the CLI can perform the operation.
- Read the current workflow instructions before creating, executing, or finalizing tasks.
- One task ↔ one branch. **Batch** related small changes into one PR (multiple commits); open a separate PR only for independently reviewable work.
- After opening a PR, enable **auto-merge** (`gh pr merge --auto --merge --delete-branch`) and continue — do **not** block-watch CI. If CI fails, GitHub will not auto-merge; fix → push → re-enable auto-merge.
- Keep tasks at a meaningful, reviewable size; do **not** over-decompose work into tiny tasks.
- Implementation plans are written into the task before coding.

## 5. Git Rule

- Never push to `upstream`.
- Never force-push shared branches.
- Never work directly on `main`.
- Never delete or archive a remote repository.
- Never bypass Git hooks.
- Never commit secrets.
- Never perform a production deploy.
- Never append a `Co-Authored-By` (or any AI/model co-author) trailer to commit messages.

## 6. Project Architecture Invariants

High-level, long-term rules (not implemented in the bootstrap session):

- LLM providers may only **propose** events.
- Canonical events are **append-only**.
- Accepted canonical history is **never edited in place**.
- World reducers must be **deterministic**.
- Public reads must not directly trigger LLM generation.

See `docs/architecture/adr/` and `docs/DEVELOPMENT.md`.

## 7. Commands

`npm run check` is the gate. It runs, in order: `check:architecture` → `test:architecture` →
`check:asset-licenses` → `test:asset-licenses` → `typecheck` → `lint` → `test` → `build`.
`npm run check:offline` is the same with `test:foundation` instead of the full suite.

**`npm run e2e` is NOT part of `check`, and is not a required CI status check.** Run it
separately (`build:e2e` → Playwright) before claiming a change is verified — especially for
anything touching routes, fixtures, or the post-commit pipeline. It is slow enough that it
should be run alone.

| Need | Command |
| --- | --- |
| One test file | `npm test -- --runTestsByPath <path>` |
| Long-run 30-day sim | `npm run test:longrun` (env-gated, `ART60_LONG_RUN=1`) |
| Boundary policy only | `npm run check:architecture` / `npm run test:architecture` |
| Bootstrap health | `npm run agent:check` |

Three Jest projects, selected by filename: `*.test.ts` (unit, no DOM), `*.a11y.test.tsx`
(jsdom + jest-axe), `*.dom.test.tsx`. The a11y suite renders through
`renderToStaticMarkup` — **no effects run and no events fire**, so any component it covers
needs a presentational export separate from the `useQuery` default, and its layout must be a
pure function.

Two traps worth knowing:

- **`npx jest` directly fails** on `import.meta` (different module config). Always go through
  `npm test`.
- **`lint` enumerates specific directories.** `npx eslint convex/` reports problems outside
  that set; they are scope, not regressions.

## 8. Architecture Map

A Convex backend under `convex/`, a React client under `src/`, and a **module dependency
policy** in `architecture/module-boundaries.json` enforced by
`scripts/architecture/check-boundaries.mjs`. The policy is the fastest way to understand the
system: `shared` depends on nothing, `canon` depends only on `shared`, and everything else is
declared explicitly. Read it before adding a cross-module import.

The two pipelines are the spine:

- **`convex/simulation/worldDayLive.ts`** — PRD §12 stages 1–10. Director plans a slot, scenes
  are authored through the vendor-neutral `LanguageModelProvider` port, proposals are committed
  to Canon.
- **`convex/operations/postCommitLive.ts`** — stages 11–21, run after each accepted event:
  projections, knowledge, memory, arcs, episodes, recaps, the safety gate, editorial
  publication, and the public read-model rebuilds.

Public reads never reach Canon. `convex/publicRead/` publishes versioned, content-hash-deduped
snapshots (`commitReadModelVersion`) and serves them (`serveReadModel`) with last-known-good
fallback. Adding a read model means registering the kind in three places: `readModel.ts`,
`publicRead/schema.ts`, `readModelFunctions.ts`.

The policy also carries two enforcement surfaces that are easy to trip:

- **`publicFunctionSurface`** — every registered public function must be declared, with a gate
  (`anonymous` / `operator` / `viewer`). `publicReadOnlyGuarantee.test.ts` asserts declared ==
  found *exhaustively*, and separately pins the `publicFunctionRef` literals under `src/`.
  Adding a public function is an architectural change, not a line edit.
- **`canonWriteBoundary.forbiddenModules`** — modules that may not name a write symbol at all.
  This is how "derived content must not produce new Canon" is a build failure rather than a
  convention.

**LLM configuration lives in the Convex deployment environment** (`npx convex env list`), not
in `.env.local`. A real OpenAI-compatible adapter exists but is currently reachable only from
a probe action; the world-day path binds the deterministic `FakeWholeSceneProvider`.

## 9. Conventions That Are Not Obvious From The Code

- **Fault injection is the standard of evidence.** A passing test is not evidence a guarantee
  holds; break the guarantee, watch the named test fail, restore it. Assertions that cannot
  fail have shipped here more than once.
- **`Tests: 0 total` means the suite failed to load.** In a grep-filtered summary it is
  indistinguishable from a clean pass. Always check the total against a baseline.
- **Anything added to the post-commit pipeline must sit downstream of `rebuildLiveProjection`
  and `rebuildOnboardingSummary`.** That stage is not failure-isolated, so a throw upstream of
  them stops a safety withhold from propagating.
- **Never `.collect()` a whole world on a per-event path**, especially on `v.any()` LLM-blob
  tables. Index-scope the read or bound it and justify it.
- **A validator must not be handed its own input.** Derive the accepted set independently
  (e.g. read Canon by index) or the check is a tautology.
- **Truncation is never silent** — publish what was omitted and why.
- **The E2E fixture transport throws on an unregistered query.** A new `modelRef` needs a
  branch in `src/e2e/fixtureWorld.ts`, keyed through a shared ref-builder so the fixture cannot
  drift from the server.
- **Comments must argue what the code does.** Several defects here have been a docblock
  asserting the opposite of its own function; when correcting one, say plainly that the old
  claim was wrong rather than silently replacing it.
- **When diffing a branch, use the merge-base** (`git diff $(git merge-base HEAD origin/main)`).
  Diffing against a moved `origin/main` shows other tasks' files as deletions.
- UI copy is zh-Hant, inline — there is no i18n framework. Bound text with the helpers in
  `convex/shared/publicText.ts`.

## 10. Stop Rule

- Completing one task, milestone, plan, commit, or PR is **not** a stop condition.
- Stop only when the requested delivery scope is complete, or all remaining work is genuinely human-blocked.

## 11. References

- `docs/agent/AUTONOMOUS-DEVELOPMENT.md`
- `docs/agent/HUMAN-BLOCKERS.md`
- `docs/agent/SESSION-RECOVERY.md`
- `docs/agent/BACKLOG-WORKFLOW.md`
- `docs/agent/BOOTSTRAP-STATUS.md`
- `backlog/docs/prd/` (PRD entries, one per version)
- `docs/DEVELOPMENT.md`, `docs/architecture/`

<!-- BACKLOG.MD GUIDELINES START -->
<!-- backlog.md-instructions-version: 1.48.0 -->
<CRITICAL_INSTRUCTION>

## Backlog.md Workflow

This project uses Backlog.md for task and project management.

**For every user request in this project, run `backlog instructions overview` before answering or taking action.**

Use the overview to decide whether to search, read, create, or update Backlog tasks.

Before task lifecycle actions, read the matching detailed guide:
- `backlog instructions task-creation` before creating or splitting tasks
- `backlog instructions task-execution` before planning, changing status or assignee, adding a plan or implementation notes, or implementing task work
- `backlog instructions task-finalization` before checking acceptance criteria, writing final summaries, or moving tasks to terminal statuses

Use `backlog <command> --help` before running unfamiliar commands. Help shows options, fields, and examples.

Do not edit Backlog task, draft, document, decision, or milestone markdown files directly. Use the `backlog` CLI so metadata, relationships, and history stay consistent.

</CRITICAL_INSTRUCTION>
<!-- BACKLOG.MD GUIDELINES END -->
