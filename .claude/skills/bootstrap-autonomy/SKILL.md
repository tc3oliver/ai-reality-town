---
name: bootstrap-autonomy
description: Use when the project autonomous-development bootstrap is missing, incomplete, invalid, or when `npm run agent:check` fails. Only repairs the control plane (Backlog.md, CLAUDE.md, skills, hooks, scripts, agent docs); never reads or decomposes the PRD and never starts product work.
---

# bootstrap-autonomy

Repair the project-local autonomous development control plane. **Scope is strictly the
control plane** — never read, parse, or decompose the PRD, and never begin product
implementation.

## Steps

1. Confirm `origin` and `upstream` remotes are correct and this is **not** a GitHub fork.
2. Verify Backlog.md is installed (`backlog.md` in `devDependencies`) and initialized
   (`backlog/config.yml`, task prefix `ART`).
3. Verify root `CLAUDE.md` contains the Mandatory Session Startup and the control-plane
   sections (preserve the `<!-- BACKLOG.MD GUIDELINES -->` block).
4. Verify the four skills exist with valid frontmatter:
   `bootstrap-autonomy`, `prd-to-backlog`, `autonomous-task-loop`, `human-blocker`.
5. Verify `.claude/settings.json` wires the SessionStart hook and the dangerous-command
   guard, and that deny rules protect secrets.
6. Verify `scripts/agent/check-bootstrap.mjs` and `scripts/agent/session-context.mjs` exist
   and run under Node.
7. Run `npm run agent:check`. Resolve every `FAIL` (and address `WARN`) until only `PASS`
   (and justified `WARN`) remain.
8. Complete the bootstrap task (ART-1) — write implementation notes, verification
   evidence, and final summary via the Backlog CLI, then move it to **Done**.
9. Open/merge the bootstrap PR.

## Stop

After the bootstrap task is Done and the PR is merged, **stop**. Do not select or start
any product task. See `docs/agent/AUTONOMOUS-DEVELOPMENT.md`.
