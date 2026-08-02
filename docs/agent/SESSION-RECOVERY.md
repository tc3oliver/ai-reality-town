# Session Recovery

How every new Claude Code session recovers project state from the repository — without
relying on conversation history.

## Startup sequence

```bash
npm run agent:check
npm run backlog -- instructions overview
npm run backlog -- task list --json
git status --short
git branch --show-current
git log -5 --oneline
```

## Decide from state

- `agent:check` fails → invoke `/bootstrap-autonomy`; **only** repair the control plane.
- Bootstrap OK, no PRD → do not invent requirements; request the PRD.
- PRD present, no task graph → invoke `/prd-to-backlog`.
- An In Progress task exists → resume it via `/autonomous-task-loop`.
- No In Progress task but a Ready task exists → select the next one via `/autonomous-task-loop`.
- Only Blocked tasks → invoke `/human-blocker`.

## Read only what is relevant

- Read the current/resumed task, the relevant PRD section(s), the relevant ADR(s), and the
  specific code you will touch.
- Do **not** re-read the whole codebase or recreate completed planning.
- Do **not** depend on old chat context.

## Resume cleanly

- If a branch exists for the In Progress task, check it out; otherwise create it from
  `main`.
- Ensure `git status` is consistent with the task notes; reconcile any drift.
- Update the task plan/notes as you go, so the next session can resume you.
