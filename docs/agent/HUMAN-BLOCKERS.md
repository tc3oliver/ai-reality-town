# Human Blockers

A **Human Blocker** is the only valid reason to pause autonomous work and ask a human.
Everything else is resolved autonomously.

## Valid Human Blockers

| Code | Meaning |
| --- | --- |
| H01 | Required credential unavailable (e.g. interactive login that cannot be automated). |
| H02 | Paid resource or purchase required. |
| H03 | Irreversible or destructive action (e.g. force-push shared history, delete a repo). |
| H04 | Existing data cannot be safely isolated (unknown content in the target path). |
| H05 | Critical, non-inferable product decision (no clear default from PRD or code). |
| H06 | Legal or license acceptance required. |
| H07 | Platform-enforced human approval. |

When a blocker applies, invoke `/human-blocker`, set the task to **Blocked**, and continue
any unrelated autonomous work.

## NOT a Human Blocker

Resolve these autonomously — do not stop to ask:

- Test failure, build failure, lint/typecheck failure.
- CI failure (investigate and fix).
- Merge conflict.
- Dependency conflict or version choice.
- Architecture choice (when a defensible default exists).
- Naming choice.
- Reversible UX decision.
- Refactoring.
- Missing technical task (create it via the CLI).

A decision is only a blocker when it is **critical, non-inferable, and irreversible or
credential-gated**. When in doubt, prefer the least-surprising, reversible default and
document it.
