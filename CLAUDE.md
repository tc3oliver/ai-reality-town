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

## 7. Stop Rule

- Completing one task, milestone, plan, commit, or PR is **not** a stop condition.
- Stop only when the requested delivery scope is complete, or all remaining work is genuinely human-blocked.

## 8. References

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
