---
id: ART-1
title: Establish autonomous development control plane
status: Done
assignee: []
created_date: '2026-08-02 12:51'
updated_date: '2026-08-02 12:58'
labels: []
dependencies: []
priority: high
type: chore
ordinal: 1000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Goal: Install and verify the project-local autonomous development control plane so future Claude Code sessions can recover project rules and Backlog.md state without relying on conversation history.

Scope: Backlog.md installation and initialization; CLAUDE.md; project-local skills; SessionStart hook; safety hook; bootstrap verification scripts; autonomous workflow documentation; GitHub bootstrap PR.

Out of Scope: PRD analysis; product milestones; product task decomposition; product implementation; LLM integration; Canon implementation; Simulation implementation; UI implementation.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Backlog.md is installed as a locked project dependency
- [ ] #2 Backlog.md is initialized with task prefix ART
- [ ] #3 Backlog workflow instructions are accessible
- [ ] #4 CLAUDE.md exists and contains mandatory session startup rules
- [ ] #5 All required project skills exist and have valid SKILL.md frontmatter
- [ ] #6 SessionStart hook injects project context
- [ ] #7 Dangerous Git operations are guarded
- [ ] #8 Bootstrap verification script passes
- [ ] #9 A clean future session can determine the next workflow from repository state
- [ ] #10 No product task or milestone has been created
- [ ] #11 Bootstrap PR is merged
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 All acceptance criteria are satisfied
- [ ] #2 Relevant automated tests are added or updated
- [ ] #3 Typecheck passes
- [ ] #4 Lint passes
- [ ] #5 Relevant tests pass
- [ ] #6 Build passes when applicable
- [ ] #7 No known regression is introduced
- [ ] #8 No secret or credential is committed
- [ ] #9 Documentation is updated
- [ ] #10 PRD traceability is updated when applicable
- [ ] #11 Implementation notes are complete
- [ ] #12 Final summary includes verification evidence
- [ ] #13 Changes are committed and pushed
- [ ] #14 Pull request is merged or explicitly blocked
<!-- DOD:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
- **Backlog.md**: v1.48.0 installed as devDependency; config at `backlog/config.yml` (statuses To Do/In Progress/Blocked/In Review/Done; priorities Critical/High/Medium/Low; project DoD set); task prefix ART.
- **CLAUDE.md**: root, 8-section control plane (control plane, mandatory session startup, autonomy, backlog, git rules incl. no AI co-author trailer, architecture invariants, stop rule, references) + preserved `<!-- BACKLOG.MD GUIDELINES -->` block.
- **Skills**: `.claude/skills/{bootstrap-autonomy,prd-to-backlog,autonomous-task-loop,human-blocker}/SKILL.md`.
- **Hooks**: SessionStart `.claude/hooks/session-context.mjs`; PreToolUse Bash guard `.claude/hooks/guard-dangerous-command.mjs`; wiring + secret deny rules in `.claude/settings.json`.
- **Scripts**: `scripts/agent/check-bootstrap.mjs` (`npm run agent:check`, 22 checks); `scripts/agent/session-context.mjs` (`npm run agent:context`); npm scripts `backlog`/`agent:check`/`agent:context`.
- **CI**: `.github/workflows/bootstrap.yml` runs agent:check + offline typecheck/lint/test/build.
- **Docs**: `docs/agent/{AUTONOMOUS-DEVELOPMENT,HUMAN-BLOCKERS,SESSION-RECOVERY,BACKLOG-WORKFLOW,BOOTSTRAP-STATUS}.md`.
- **MCP**: deferred (CLI instructions are the required mechanism); not configured at user scope. Not a blocker.
- **Known limitations**: fork-status check requires gh/online (WARN if offline); ESLint scoped to project-owned modules (upstream type-checked lint debt is out of scope).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Autonomous development control plane installed. Future Claude Code sessions can recover project rules, Backlog.md state, task status, autonomous rules, human-blocker conditions, git/PR flow, and safety limits from repository state (via `npm run agent:check`, the SessionStart hook, CLAUDE.md, and the project skills). No product PRD decomposition or product implementation was performed.

Verification: `npm ci` ok; `npm run agent:check` = 22 PASS / 0 FAIL; typecheck, lint, tests (102), build all pass; `backlog instructions overview` readable. Bootstrap PR merged to main.
<!-- SECTION:FINAL_SUMMARY:END -->
