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
10. Open a PR; watch CI; **fix** failures (investigate → fix → push → re-verify).
11. Merge (merge commit preferred; rebase if merge commits are disallowed).
12. Sync `main` (`git pull --ff-only origin main`; prune).
13. Move the task to **Done** (via CLI).
14. Continue to the next **Ready** task. Stop only at a documented Human Blocker or when
    the requested scope is complete.

## Rules

- One task ↔ one branch ↔ one PR.
- Never push to `upstream`; never force-push shared branches; never work on `main`.
- See `docs/agent/AUTONOMOUS-DEVELOPMENT.md` and `docs/agent/HUMAN-BLOCKERS.md`.
