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
- [x] Skills installed (`bootstrap-autonomy`, `prd-to-backlog`, `autonomous-task-loop`, `human-blocker`)
- [x] SessionStart hook installed (`.claude/hooks/session-context.mjs`)
- [x] Safety hook installed (`.claude/hooks/guard-dangerous-command.mjs`)
- [x] Sensitive-file deny rules configured (`.claude/settings.json`)
- [x] Bootstrap scripts pass (`npm run agent:check`)
- [x] Bootstrap task completed (ART-1 → Done)
- [x] Bootstrap PR merged
- [x] Product development **not** started (no product milestone, no product task)

## Manual smoke test (new session)

When a fresh Claude Code session opens in this repo, it should be able to determine:

1. Backlog.md is the task source of truth.
2. Bootstrap is complete.
3. No product task should be started until a PRD exists and is decomposed.

If `npm run agent:check` fails in a fresh checkout, invoke `/bootstrap-autonomy`.
