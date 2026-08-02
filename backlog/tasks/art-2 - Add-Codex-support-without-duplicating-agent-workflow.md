---
id: ART-2
title: Add Codex support without duplicating agent workflow
status: In Progress
assignee:
  - '@tc3oliver'
created_date: '2026-08-02 15:03'
updated_date: '2026-08-02 15:19'
labels: []
dependencies: []
modified_files:
  - .codex/config.toml
  - CLAUDE.md
  - scripts/agent/check-bootstrap.mjs
  - docs/agent/AUTONOMOUS-DEVELOPMENT.md
  - docs/agent/BACKLOG-WORKFLOW.md
  - docs/agent/BOOTSTRAP-STATUS.md
  - docs/agent/HUMAN-BLOCKERS.md
  - docs/agent/SESSION-RECOVERY.md
  - .claude/skills/bootstrap-autonomy/SKILL.md
  - .claude/skills/prd-to-backlog/SKILL.md
  - .claude/skills/autonomous-task-loop/SKILL.md
  - .claude/skills/human-blocker/SKILL.md
priority: high
type: chore
ordinal: 2000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Configure OpenAI Codex to consume the existing agent-neutral repository workflow without creating a second control plane. Scope: .codex/config.toml, CLAUDE.md agent-neutral cleanup, bootstrap validation, bootstrap status documentation, and a Codex smoke test. Out of scope: AGENTS.md, Codex skills, Codex workflow duplication, PRD ingestion, product task creation, product implementation, and README changes.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Codex is configured to load CLAUDE.md
- [x] #2 CLAUDE.md remains the sole repository instruction source
- [x] #3 No AGENTS.md exists
- [x] #4 No .agents/skills directory exists
- [x] #5 No Codex-specific workflow copy exists
- [x] #6 Existing Claude Code bootstrap still passes
- [x] #7 Backlog.md remains the sole task source of truth
- [x] #8 Codex smoke test confirms mandatory startup instructions are loaded
- [ ] #9 All CI checks pass
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 All acceptance criteria are satisfied
- [x] #2 Relevant automated tests are added or updated
- [x] #3 Typecheck passes
- [x] #4 Lint passes
- [x] #5 Relevant tests pass
- [x] #6 Build passes when applicable
- [x] #7 No known regression is introduced
- [x] #8 No secret or credential is committed
- [x] #9 Documentation is updated
- [x] #10 PRD traceability is updated when applicable
- [x] #11 Implementation notes are complete
- [x] #12 Final summary includes verification evidence
- [x] #13 Changes are committed and pushed
- [ ] #14 Pull request is merged or explicitly blocked
<!-- DOD:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Make CLAUDE.md and the shared docs/agent workflow platform-neutral while preserving startup, state-selection, safety, Backlog, blocker, and Definition of Done rules.
2. Make the four existing .claude/skills entries thin pointers to the shared workflow documents.
3. Add the minimal Codex fallback configuration that loads CLAUDE.md.
4. Extend scripts/agent/check-bootstrap.mjs with config, forbidden duplicate control-plane, sole task-source, mandatory startup, platform-neutrality, and thin-skill checks.
5. Update bootstrap status, run Codex smoke tests and all repository checks, record evidence, commit, push, open a PR, enable merge, and verify the clean merged state.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Codex v0.146.0 smoke test passed in ephemeral read-only mode: it loaded CLAUDE.md, identified Backlog.md, reproduced all six startup commands, and limited human intervention to H01-H07. Backlog.md v1.48.0 rejects the mandated task list --json option; this pre-existing CLI mismatch was observed without creating an alternate Codex command or workflow.

Final local verification: npm ci passed; agent:check passed 34 checks with 0 FAIL and one expected offline fork-status WARN; typecheck, lint, 12 test suites/102 tests, and build passed; forbidden AGENTS/.agents searches were empty; duplicate Codex phrase grep only found explicit no-duplication assertions; git diff --check passed; README and product code were unchanged.

Commit 8b9bac5 was pushed to origin/chore/ART-2-codex-shared-instructions.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Configured Codex to load the sole repository instruction source, made shared workflow documents platform-neutral, reduced Claude Code skills to thin pointers, and expanded bootstrap validation against duplicate control planes. Verified locally with Codex v0.146.0 read-only smoke output, 34 agent checks, typecheck, lint, 102 tests, build, forbidden-path searches, and diff review; CI/merge evidence will be appended after the PR completes.
<!-- SECTION:FINAL_SUMMARY:END -->
