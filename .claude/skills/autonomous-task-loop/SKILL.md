---
name: autonomous-task-loop
description: Use when the project has an In Progress task or at least one Ready Backlog.md task. Runs the full recover → plan → implement → test → review → commit → PR → fix-CI → merge → sync loop for one task, then continues to the next Ready task. Contains no human-approval checkpoints.
---

# autonomous-task-loop

Execute Backlog tasks end to end. No human-approval checkpoints between steps.

## Loop

1. Recover state: `npm run agent:check`, `npm run backlog -- instructions overview`,
   `npm run backlog -- task list --json`, `git status --short`, `git log -5 --oneline`.
2. Select or **resume** one task (In Progress wins; else next Ready).
3. Write the implementation plan into the task (via CLI) **before** coding.
4. Create a task branch from `main`.
5. Implement; add/update tests.
6. Run typecheck, lint, tests, build (the offline gate).
7. Review the diff; ensure no secrets and no lowered strictness.
8. Update task evidence (implementation notes, verification).
9. Commit (single-purpose, conventional; no AI co-author trailer), push the branch.
   **Batch** related small changes into this same branch/PR; open a separate PR only for
   independently reviewable work.
10. Open a PR and enable **auto-merge** (`gh pr merge --auto --merge --delete-branch`); do
    **not** block-watch CI — continue to the next work. If CI fails, GitHub will not
    auto-merge: investigate → fix → push → re-enable auto-merge.
11. (GitHub auto-merges when CI passes.) Sync `main` periodically
    (`git pull --ff-only origin main`; prune).
12. Move the task to **Done** (via CLI).
13. Continue to the next **Ready** task. Stop only at a documented Human Blocker or when
    the requested scope is complete.

## Sizing

Keep tasks at a meaningful size — a task should deliver a reviewable slice of value, not a
single trivial edit. Do not over-decompose work into tiny tasks; if several small changes
serve one goal, fold them into one task (and one PR).

## Rules

- One task ↔ one branch; batch related small changes into one PR; use auto-merge.
- Never push to `upstream`; never force-push shared branches; never work on `main`.
- See `docs/agent/AUTONOMOUS-DEVELOPMENT.md` and `docs/agent/HUMAN-BLOCKERS.md`.
