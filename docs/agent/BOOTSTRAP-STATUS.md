# Bootstrap Status

Machine- and human-readable status of the autonomous development control plane. Verified
by `npm run agent:check` (the authoritative gate).

**Status: Complete** — bootstrap PR merged to `main`. No product development started.

## Checklist

- [x] Repository initialized (`origin` = this repo, `upstream` = a16z-infra/ai-town)
- [x] `origin` configured
- [x] `upstream` configured (AI Town)
- [x] Backlog dependency installed (`backlog.md` in `devDependencies`)
- [x] Backlog initialized (task prefix `ART`, `backlog/config.yml`)
- [x] Backlog instructions available (`npm run backlog -- instructions overview`)
- [x] `CLAUDE.md` installed (control-plane sections + mandatory session startup)
- [x] Codex loads `CLAUDE.md` through `project_doc_fallback_filenames`
- [x] No `AGENTS.md` or `AGENTS.override.md` exists
- [x] No duplicated Codex workflow or skills exist
- [x] Claude Code and Codex share `Backlog.md`, `docs/agent/`, and `scripts/agent/`
- [x] Skills installed (`bootstrap-autonomy`, `prd-to-backlog`, `autonomous-task-loop`, `human-blocker`)
- [x] SessionStart hook installed (`.claude/hooks/session-context.mjs`)
- [x] Safety hook installed (`.claude/hooks/guard-dangerous-command.mjs`)
- [x] Sensitive-file deny rules configured (`.claude/settings.json`)
- [x] Bootstrap scripts pass (`npm run agent:check`)
- [x] Bootstrap task completed (ART-1 → Done)
- [x] Bootstrap PR merged
- [x] Product development **not** started (no product milestone, no product task)

## Manual smoke tests (new session)

When a fresh coding agent session opens in this repo, it should be able to determine:

1. Backlog.md is the task source of truth.
2. Bootstrap is complete.
3. No product task should be started until a PRD exists and is decomposed.

If `npm run agent:check` fails in a fresh checkout, follow the bootstrap repair flow in
`docs/agent/AUTONOMOUS-DEVELOPMENT.md`.

When Codex is installed, run this read-only check from the repository root:

```bash
codex --ask-for-approval never \
  "Do not modify files. State the task source of truth, list the mandatory session startup commands, and explain when human intervention is allowed."
```

It must identify `Backlog.md`, reproduce all six startup commands from `CLAUDE.md`, and
limit intervention to the documented H01–H07 blockers. An unavailable Codex executable is
an environment warning, not a bootstrap failure.
