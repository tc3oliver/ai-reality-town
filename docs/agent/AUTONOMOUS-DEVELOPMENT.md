# Autonomous Development

How Claude Code works autonomously on AI Reality Town, persistently and without relying on
conversation history.

## Principles

- The repository is the project record: Backlog tasks, merged PRs, tests, ADRs, git history.
- Conversation history is **not** the record — recover state from the repo each session.
- Make ordinary technical decisions without asking for approval.
- Stop only when the requested scope is complete or all remaining work is genuinely
  human-blocked (see `HUMAN-BLOCKERS.md`).

## PRD → Backlog

1. A product PRD lives at `docs/product/PRD.md`.
2. Decompose it via `/prd-to-backlog`: requirement traceability → milestone →
   independently acceptance-testable tasks → dependency graph.
3. Do **not** modify product code until the task graph is complete.

## Task selection

```
In Progress task          → resume it
else first Ready task     → select it (by dependency order, then ID)
else only Blocked tasks   → invoke /human-blocker
else no Ready tasks       → scope complete; stop (or request PRD if absent)
```

## One task / branch / PR

- One task maps to exactly one branch (from `main`) and one pull request.
- Branch naming: `<type>/ART-<n>-<topic>` (e.g. `feat/ART-12-canon-snapshot-query`).
- Conventional commit prefixes; single-purpose commits; no AI co-author trailer.

## Implementation plan

- Write the plan into the task (Backlog CLI) **before** coding.
- Plans live in the task, not in chat, so the next session can resume.

## Review & testing

- Add/update tests for new behavior.
- Run the offline gate: `npm run check` (typecheck + lint + tests + build).
- No lowered TypeScript strictness; no skipped failing tests; no secrets.

## CI repair

- If CI fails: investigate → fix → commit → push → re-verify. Do not bypass with
  `continue-on-error`; do not merge red.

## Merge and continue

- Merge after CI passes (merge commit preferred; rebase if merge is disallowed).
- Sync `main` (`git pull --ff-only origin main`; `git fetch --prune origin`).
- Move the task to **Done** via the Backlog CLI.
- Continue to the next Ready task automatically.

## Persisting context

When context is running low or a session ends, ensure:
- the current task's plan, notes, and status are up to date in Backlog;
- uncommitted work is committed and pushed to the task branch;
- `git status` is clean or clearly described in the task notes.

Then the next session recovers via `SESSION-RECOVERY.md`.
