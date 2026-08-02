---
name: human-blocker
description: Use only when work cannot continue without a human-only credential, permission, payment, irreversible action, legal acceptance, or non-inferable critical product decision. Emits the fixed HUMAN ACTION REQUIRED report and records the blocker on the affected task.
---

# human-blocker

Use **only** for genuine Human Blockers (see `docs/agent/HUMAN-BLOCKERS.md`). Test, build,
CI, merge, dependency, naming, architecture, and refactoring decisions are **not**
blockers — resolve them autonomously.

When invoked, record the blocker on the affected Backlog task (status → **Blocked**) and
emit exactly this report:

```markdown
# HUMAN ACTION REQUIRED

## Blocker
<code and description>

## Affected Task
<task>

## Evidence
<why it cannot be solved autonomously>

## Work Already Completed
<completed work>

## Exact Human Action
1. <step>
2. <step>

## Verification
<how completion will be verified>

## Work Continuing Elsewhere
<other autonomous work or None>
```

After emitting, continue any other autonomous work that does not depend on the blocker.
